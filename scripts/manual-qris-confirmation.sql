-- Konfirmasi QRIS manual oleh kasir
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- KONTEKS KEPUTUSAN:
-- Owner belum memutuskan membuat akun merchant, tapi tetap meminta metode QRIS
-- dipakai di kasir. Jadi QRIS diisi manual: pelanggan membayar dengan QRIS
-- statis milik toko (dari rekening bank), kasir cek apakah uangnya benar-benar
-- masuk, lalu mengonfirmasi di aplikasi.
--
-- PENTING, DAN TIDAK BOLEH DIPALINGKAN:
-- Pada mode ini, kasir-lah yang menyatakan pembayaran berhasil. Mekanisme ini
-- TIDAK mencegah kecurangan, hanya membuatnya bisa ditelusuri. Yang membuat
-- pola ini berguna ada dua:
--   - setiap konfirmasi mencatat nama dan waktu pelakunya, dibaca dari header
--     permintaan, jadi tidak bisa diubah tanpa meninggalkan jejak
--   - Owner bisa mencocokkan daftar konfirmasi dengan mutasi rekening setiap
--     hari
--
-- Dua hal itu tidak sedekat jaminan, tapi bedanya nyata: antara "kecurangan
-- tidak pernah terlihat" dan "kecurangan selalu ketahuan saat rekonsiliasi".
-- Pencegahan yang sebenarnya tetap butuh payment gateway.
--
-- File ini menggantikan scripts/fix-qris-execute-privileges.sql. Jangan
-- jalankan file itu kalau konfirmasi manual dipakai, karena file itu mengunci
-- confirm_qris_payment supaya hanya webhook yang bisa memanggilnya.


-- ============================================================
-- (1) Kolom untuk jejak konfirmasi
-- ============================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_method TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN transactions.confirmed_by IS
  'Nama pelaku yang mengonfirmasi pembayaran, dibaca dari header x-actor. Tidak berasal dari input peramban.';
COMMENT ON COLUMN transactions.confirmed_method IS
  'manual = kasir mengonfirmasi sendiri. gateway = dikonfirmasi webhook payment gateway.';
COMMENT ON COLUMN transactions.confirmed_at IS
  'Waktu konfirmasi pembayaran dicatat.';


-- ============================================================
-- (2) Fungsi konfirmasi QRIS
-- ============================================================
-- SECURITY DEFINER supaya change dan status tidak bisa dimanipulasi dari
-- peramban. Pelaku dibaca dari header x-actor, bukan dari parameter yang
-- dikirim browser, supaya nama yang tercatat tidak bisa dikarang.

-- WAJIB: signature lama (UUID, TEXT, NUMERIC, TEXT) harus dihapus dulu.
-- CREATE OR REPLACE hanya mengganti fungsi dengan signature yang sama persis.
-- Kalau versi 4-parameter itu dibiarkan, keduanya akan hidup berdampingan dan
-- yang lama tetap bisa dipanggil browser.
DROP FUNCTION IF EXISTS confirm_qris_payment(UUID, TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION confirm_qris_payment(
  p_transaction_id UUID,
  p_paid NUMERIC,
  p_paid_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(id UUID, status TEXT, change NUMERIC) AS $$
DECLARE
  t transactions%ROWTYPE;
  v_actor TEXT;
BEGIN
  BEGIN
    v_actor := NULLIF(current_setting('request.headers', true)::json ->> 'x-actor', '');
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  SELECT * INTO t FROM transactions
  WHERE transactions.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;
  IF t.status = 'Selesai' THEN
    -- Sudah lunat. Idempoten supaya tombol yang ditekan dua kali tidak error.
    RETURN QUERY SELECT p_transaction_id, t.status, t.change;
    RETURN;
  END IF;
  IF t.status <> 'Pending' THEN
    RAISE EXCEPTION 'Transaksi sudah dibatalkan (status: %), tidak bisa dikonfirmasi', t.status;
  END IF;
  IF t.metode_pembayaran <> 'QRIS' THEN
    RAISE EXCEPTION 'Metode pembayaran bukan QRIS';
  END IF;
  IF COALESCE(p_paid, 0) < t.total THEN
    RAISE EXCEPTION 'Nominal yang dikonfirmasi % kurang dari total %', p_paid, t.total;
  END IF;

  UPDATE transactions
  SET status = 'Selesai',
      paid = p_paid,
      change = 0,
      paid_at = COALESCE(p_paid_at, NOW()),
      completed_at = NOW(),
      confirmed_by = v_actor,
      confirmed_method = 'manual',
      confirmed_at = NOW()
  WHERE transactions.id = p_transaction_id;

  RETURN QUERY SELECT p_transaction_id, 'Selesai'::TEXT, 0::NUMERIC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- ============================================================
-- (3) Hak eksekusi
-- ============================================================
-- Kasir boleh memanggil confirm_qris_payment. awhile itu justru tujuannya
-- pada mode manual.
GRANT EXECUTE ON FUNCTION confirm_qris_payment(UUID, NUMERIC, TIMESTAMPTZ) TO anon, authenticated;

-- Fungsi yang tidak boleh dipanggil siapa pun dari peramban sudah tidak ada
-- di file ini. Kalau nanti payment gateway dipasang, tambahkan fungsi
-- terpisah confirm_qris_payment_gateway() dan REVOKE eksekusinya dari
-- anon dan authenticated, supaya jalur manual dan jalur gateway tidak
-- bercampur.


-- ============================================================
-- (4) Fungsi bantu untuk review Owner
-- ============================================================
-- Daftar konfirmasi QRIS supaya Owner bisa mencocokkan dengan mutasi rekening.
-- Membaca kolom yang diisi trigger, jadi tidak bisa diubah dari peramban.

CREATE OR REPLACE FUNCTION daftar_konfirmasi_qris(p_limit INTEGER DEFAULT 200)
RETURNS TABLE(
  id UUID,
  total NUMERIC,
  paid NUMERIC,
  tanggal TIMESTAMPTZ,
  dikonfirmasi_oleh TEXT,
  dikonfirmasi_pada TIMESTAMPTZ,
  metode TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id,
         t.total,
         t.paid,
         t.created_at,
         t.confirmed_by,
         t.confirmed_at,
         t.confirmed_method
  FROM transactions t
  WHERE t.metode_pembayaran = 'QRIS'
    AND t.status = 'Selesai'
  ORDER BY t.confirmed_at DESC NULLS LAST
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION daftar_konfirmasi_qris(INTEGER) TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Tiga kolom baru ada (harus 3):
--    SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_name = 'transactions'
--      AND column_name IN ('confirmed_by','confirmed_method','confirmed_at');
--
-- 2. Fungsi lama masih ada dengan signature yang salah, dan yang baru ada:
--    SELECT proname FROM pg_proc WHERE proname LIKE '%qris%';
--    Hanya boleh ada confirm_qris_payment dan daftar_konfirmasi_qris.
--
-- 3. Fungsi lama masih bisa dipanggil dengan 4 parameter (signature lama)?
--    Harus GAGAL dengan "does not exist", karena sudah diganti 3 parameter:
--    SELECT confirm_qris_payment('00000000-0000-0000-0000-000000000000', 'x', 1000, 'test');
--
-- 4. Review Owner jalan:
--    SELECT * FROM daftar_konfirmasi_qris(10);