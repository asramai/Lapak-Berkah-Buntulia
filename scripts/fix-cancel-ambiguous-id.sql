-- Perbaikan: cancel_pending_transaction gagal dengan "column reference id is ambiguous"
--
-- GEJALA:
--   Membatalkan pesanan QRIS gagal dengan:
--     "Gagal membatalkan pesanan: column reference \"id\" is ambiguous"
--   Stok tidak dikembalikan dan pesanan tetap menggantung sampai kedaluwarsa.
--
-- PENYEBAB:
--   Fungsi ini mendeklarasikan RETURNS TABLE(id UUID, status TEXT,
--   stok_dikembalikan INTEGER). Setiap nama kolom di situ menjadi VARIABEL
--   PL/pgSQL di dalam badan fungsi.
--
--   Di dalam loop ada:
--     UPDATE products SET stock = stock + v_item.quantity WHERE id = v_item.product_id;
--
--   PostgreSQL melihat "id" dan tidak tahu yang dimaksud kolom products.id
--   atau variabel output id, jadi menolak. Tapi fungsi ini tetap berjalan untuk
--   transaksi tanpa item, karena baris yang bermasalah tidak pernah dieksekusi.
--   Itu sebabnya bug ini tidak terdeteksi saat verifikasi: fungsi dipanggil
--   dengan id palsu, yang lebih dulu gagal di pengecekan "Transaksi tidak
--   ditemukan" sebelum mencapai baris yang rusak.
--
--   Fungsi lain dengan pola serupa sudah aman karena menuliskan nama tabelnya
--   lengkap: complete_cash_payment dan confirm_qris_payment memakai
--   "WHERE transactions.id", bukan "WHERE id".
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten. Tipe return tidak berubah, jadi CREATE OR REPLACE cukup.

CREATE OR REPLACE FUNCTION cancel_pending_transaction(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT NULL
)
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

  -- id ditulis lengkap dengan nama tabel. Fungsi ini punya variabel output
  -- bernama "id" dari RETURNS TABLE(id UUID, ...), jadi "WHERE id" saja akan
  -- ambigu antara products.id dan variabel itu.
  FOR v_item IN
    SELECT product_id, quantity FROM transaction_items WHERE transaction_id = p_transaction_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      UPDATE products SET stock = stock + v_item.quantity WHERE products.id = v_item.product_id;
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION cancel_pending_transaction(UUID, TEXT) TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Fungsi terpasang:
--    SELECT proname FROM pg_proc
--    WHERE proname = 'cancel_pending_transaction';
--
-- 2. Uji nyata. Buat satu pesanan QRIS dari aplikasi, lalu tekan "Batalkan".
--    Ini akan gagal sebelum diperbaiki dan harus berhasil sesudahnya.
--    Periksa juga stok produknya kembali ke angka semula.
--
-- 3. Fungsi ini sekarang memakai search_path yang memuat "extensions",
--    sama seperti login_user, karena koreksi ini ikut ditulis ulang seluruh
--    badan fungsinya.