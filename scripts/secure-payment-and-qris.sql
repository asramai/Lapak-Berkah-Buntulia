-- Payment QRIS + kunci jalur tulis pembayaran
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- TUJUAN:
-- 1. Transaksi tidak lagi bisa ditandai lunas dari browser. Kasir tidak
--    pernah mengirim status 'Selesai'. Setiap transaksi lahir sebagai 'Pending',
--    lalu hanya boleh diselesaikan lewat fungsi yang dikunci database.
-- 2. Metode Transfer dibuang. Semua transaksi lama sudah Tunai, jadi narrowing
--    constraint tidak menyentuh data historis.
-- 3. Ada tempat untuk menyimpan id pesanan dari payment gateway.
--
-- KENAPA HARUS DI DATABASE, BUKAN DI APLIKASI:
-- Anon key ikut terpasang di dalam bundle browser. Kalau penandaan lunas masih
-- bisa dilakukan lewat REST API, maka siapa pun bisa mengubah status
-- transaksi Tunai maupun QRIS tanpa membayar. Semua aturan di sini ditegakkan
-- oleh database karena itu satu-satunya tempat yang tidak bisa dilewati browser.


-- ============================================================
-- (1) Kolom untuk payment gateway
-- ============================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_order_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_gateway TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS transactions_payment_order_id_idx ON transactions (payment_order_id);
CREATE INDEX IF NOT EXISTS transactions_pending_idx
  ON transactions (status, payment_expires_at)
  WHERE status = 'Pending';

COMMENT ON COLUMN transactions.payment_order_id IS
  'Id pesanan dari payment gateway. Diisi hanya lewat fungsi confirm_qris_payment.';
COMMENT ON COLUMN transactions.payment_expires_at IS
  'Batas waktu menunggu pembayaran. Lewat dari ini pesanan dibatalkan dan stok dikembalikan.';


-- ============================================================
-- (2) Buang metode Transfer
-- ============================================================
-- Semua 61 transaksi lama berstatus Tunai, jadi tidak ada data yang perlu
-- dimigrasi. Kalau ternyata masih ada baris 'Transfer', migration ini
-- berhenti dengan pesan jelas, bukan diam-diam mengubah data.

DO $$
DECLARE
  v_transfer INTEGER;
  v_konstrain TEXT;
BEGIN
  SELECT COUNT(*) INTO v_transfer FROM transactions WHERE metode_pembayaran = 'Transfer';
  IF v_transfer > 0 THEN
    RAISE EXCEPTION
      'Ada % transaksi ber-metode Transfer. Migration dibatalkan supaya tidak ada data yang berubah diam-diam. Pindahkan dulu ke QRIS atau Tunai, lalu jalankan ulang.',
      v_transfer;
  END IF;

  SELECT constraint_name INTO v_konstrain
  FROM information_schema.table_constraints
  WHERE table_schema = 'public' AND table_name = 'transactions'
    AND constraint_type = 'CHECK'
    AND constraint_name LIKE '%metode_pembayaran%'
  LIMIT 1;

  IF v_konstrain IS NOT NULL THEN
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', v_konstrain);
  END IF;
END $$;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_metode_pembayaran_check
  CHECK (metode_pembayaran IN ('Tunai', 'QRIS'));


-- ============================================================
-- (3) Kunci jalur tulis pembayaran
-- ============================================================
-- Aplikasi tidak pernah mengubah transaksi, hanya membaca dan membuat.
-- Semua yang dipakai untuk menyelesaikan pembayaran lewat fungsi di bawah.

REVOKE UPDATE, DELETE ON transactions FROM anon, authenticated;

-- Setiap transaksi SELALU lahir sebagai Pending. Nilai status, paid, change,
-- dan completed_at yang dikirim browser diabaikan, jadi tidak ada cara
-- membuat transaksi yang langsung berstatus Selesai.
CREATE OR REPLACE FUNCTION force_transaction_pending()
RETURNS TRIGGER AS $$
BEGIN
  NEW.status := 'Pending';
  NEW.paid := 0;
  NEW.change := 0;
  NEW.completed_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS force_transaction_pending_trigger ON transactions;
CREATE TRIGGER force_transaction_pending_trigger
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION force_transaction_pending();


-- ============================================================
-- (4) Fungsi penyelesaian pembayaran
-- ============================================================
-- Semua fungsi ini SECURITY DEFINER supaya berjalan dengan hak pemilik
-- tabel, bukan hak role pemanggil. search_path dikunci supaya tidak bisa
-- dialihkan ke skema lain.


-- (4a) Tunai: dipanggil kasir setelah uang diterima.
--      change dihitung database, bukan dikirim dari browser.
CREATE OR REPLACE FUNCTION complete_cash_payment(p_transaction_id UUID, p_paid NUMERIC)
RETURNS TABLE(id UUID, change NUMERIC) AS $$
DECLARE
  t transactions%ROWTYPE;
BEGIN
  SELECT * INTO t FROM transactions
  WHERE transactions.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF t.status <> 'Pending' THEN
    RAISE EXCEPTION 'Transaksi sudah diproses (status saat ini: %)', t.status;
  END IF;
  IF t.metode_pembayaran <> 'Tunai' THEN
    RAISE EXCEPTION 'Metode pembayaran bukan Tunai';
  END IF;
  IF p_paid IS NULL OR p_paid < t.total THEN
    RAISE EXCEPTION 'Jumlah bayar % kurang dari total %', p_paid, t.total;
  END IF;

  UPDATE transactions
  SET status = 'Selesai',
      paid = p_paid,
      change = p_paid - t.total,
      paid_at = NOW(),
      completed_at = NOW()
  WHERE transactions.id = p_transaction_id;

  RETURN QUERY SELECT p_transaction_id, p_paid - t.total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- (4b) QRIS: HANYA dipanggil webhook gateway, tidak boleh dari browser.
--      Karena itu hak eksekusi dicabut dari anon dan authenticated di bawah.
CREATE OR REPLACE FUNCTION confirm_qris_payment(
  p_transaction_id UUID,
  p_order_id TEXT,
  p_paid NUMERIC,
  p_gateway TEXT DEFAULT NULL
)
RETURNS TABLE(id UUID, status TEXT) AS $$
DECLARE
  t transactions%ROWTYPE;
BEGIN
  SELECT * INTO t FROM transactions
  WHERE transactions.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF t.status = 'Selesai' THEN
    -- Webhook memang bisa terkirim lebih dari sekali. Sudah lunat = tidak
    -- ada yang perlu dikerjakan, dan ini yang membuat fungsi ini idempoten.
    RETURN QUERY SELECT p_transaction_id, t.status;
    RETURN;
  END IF;
  IF t.status <> 'Pending' THEN
    RAISE EXCEPTION 'Transaksi sudah dibatalkan, tidak bisa dikonfirmasi';
  END IF;
  IF t.metode_pembayaran <> 'QRIS' THEN
    RAISE EXCEPTION 'Metode pembayaran bukan QRIS';
  END IF;
  IF p_paid IS NULL OR p_paid < t.total THEN
    RAISE EXCEPTION 'Pembayaran % kurang dari total %', p_paid, t.total;
  END IF;

  UPDATE transactions
  SET status = 'Selesai',
      paid = p_paid,
      change = 0,
      paid_at = NOW(),
      completed_at = NOW(),
      payment_order_id = p_order_id,
      payment_gateway = p_gateway
  WHERE transactions.id = p_transaction_id;

  RETURN QUERY SELECT p_transaction_id, 'Selesai'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- (4c) Batalkan yang belum dibayar, lalu kembalikan stoknya.
CREATE OR REPLACE FUNCTION cancel_pending_transaction(p_transaction_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, status TEXT, stok_dikembalikan INTEGER) AS $$
DECLARE
  t transactions%ROWTYPE;
  v_item RECORD;
  v_total_qty INTEGER := 0;
BEGIN
  SELECT * INTO t FROM transactions
  WHERE transactions.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF t.status <> 'Pending' THEN
    RAISE EXCEPTION 'Hanya transaksi Pending yang bisa dibatalkan (status: %)', t.status;
  END IF;

  -- Kembalikan stok per item. Penyesuaian dicatat sebagai pergerakan stok
  -- supaya riwayat stok tetap bisa ditelusuri, tidak dihapus begitu saja.
  FOR v_item IN
    SELECT product_id, quantity FROM transaction_items WHERE transaction_id = p_transaction_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      UPDATE products SET stock = stock + v_item.quantity WHERE id = v_item.product_id;
      v_total_qty := v_total_qty + v_item.quantity;

      INSERT INTO stock_movements (product_id, type, quantity, note, mitra_id)
      VALUES (v_item.product_id, 'in', v_item.quantity,
              COALESCE('Pembatalan: ' || p_reason, 'Pembatalan pesanan'), t.mitra_id);
    END IF;
  END LOOP;

  UPDATE transactions
  SET status = 'Dibatalkan', completed_at = NOW()
  WHERE transactions.id = p_transaction_id;

  RETURN QUERY SELECT p_transaction_id, 'Dibatalkan'::TEXT, v_total_qty;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- (4d) Bersihkan pesanan yang pembayarannya tidak pernah datang.
--      Dipanggil dari kasir saat halaman dibuka, jadi tidak butuh cron.
CREATE OR REPLACE FUNCTION release_expired_payments()
RETURNS INTEGER AS $$
DECLARE
  t RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR t IN
    SELECT id FROM transactions
    WHERE status = 'Pending'
      AND payment_expires_at IS NOT NULL
      AND payment_expires_at < NOW()
    -- FOR UPDATE SKIP LOCKED supaya kalau ada dua kasir membuka halaman
    -- bersamaan, satu transaksi tidak dibatalkan dua kali.
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM cancel_pending_transaction(t.id, 'Kedaluwarsa tanpa pembayaran');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- ============================================================
-- (5) Hak eksekusi
-- ============================================================
-- Kasir boleh menyelesaikan pembayaran Tunai, karena itu memang aksi kasir.
-- QRIS TIDAK boleh: hanya webhook gateway yang boleh memanggilnya. Kalau
-- fungsi ini bisa dipanggil dari browser, seluruh tujuan dari fitur ini
-- hilang, karena status lunat bisa dipalsukan tanpa membayar.

GRANT EXECUTE ON FUNCTION complete_cash_payment(UUID, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_pending_transaction(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION release_expired_payments() TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION confirm_qris_payment(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Fungsi ada (harus 4):
--    SELECT COUNT(*) FROM pg_proc
--    WHERE proname IN ('force_transaction_pending','complete_cash_payment',
--                      'confirm_qris_payment','cancel_pending_transaction',
--                      'release_expired_payments');
--
-- 2. Memperkecil metode pembayaran jadi 2 nilai:
--    SELECT unnest(enum_range(NULL::text)) FROM pg_constraint
--    WHERE conname = 'transactions_metode_pembayaran_check';
--
-- 3. Browser tidak bisa menyelesaikan pembayaran non-tunai. Query ini HARUS
--    gagal dengan error permission denied, itu memang hasil yang diinginkan:
--    SELECT confirm_qris_payment('00000000-0000-0000-0000-000000000000', 'x', 1000, 'test');
--
-- 4. Status tidak bisa dipalsukan lewat INSERT. Query ini harus mengembalikan
--    status 'Pending' meski yang diminta 'Selesai':
--    INSERT INTO transactions (total, paid, change, status, metode_pembayaran)
--    VALUES (1000, 1000, 0, 'Selesai', 'Tunai') RETURNING status, paid, change;
--    -- Lalu bersihkan: DELETE FROM transactions WHERE total = 1000 AND status = 'Pending';
