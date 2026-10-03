-- Perbaikan: daftar_konfirmasi_qris gagal dengan error tipe kolom
--
-- GEJALA:
--   SELECT * FROM daftar_konfirmasi_qris(10);
--   ERROR 42804: Returned type timestamp without time zone does not match
--   expected type timestamp with time zone. Column: tanggal
--
-- PENYEBAB:
--   Kolom transactions.created_at dibuat sebagai TIMESTAMP (tanpa zona waktu)
--   di supabase-schema.sql, sedangkan fungsi daftar_konfirmasi_qris
--   mendeklarasikan kolom kembaliannya TIMESTAMPTZ (dengan zona waktu).
--   PostgreSQL tidak mengonversi otomatis, jadi fungsi langsung error.
--
--   Perhatikan bahwa created_at memang tanpa zona waktu, sementara
--   confirmed_at yang ditambahkan sebelumnya TIMESTAMPTZ. Keduanya sah, tapi
--   harus dideklarasikan sesuai tipe aslinya masing-masing.
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.

CREATE OR REPLACE FUNCTION daftar_konfirmasi_qris(p_limit INTEGER DEFAULT 200)
RETURNS TABLE(
  id UUID,
  total NUMERIC,
  paid NUMERIC,
  tanggal TIMESTAMP,
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
-- 1. Fungsi jalan. Belum ada transaksi QRIS jadi hasilnya kosong, itu normal:
--    SELECT * FROM daftar_konfirmasi_qris(10);
--
-- 2. Setelah ada transaksi QRIS yang selesai, semua kolomnya harus terisi:
--    SELECT id, total, paid, tanggal, dikonfirmasi_oleh, dikonfirmasi_pada, metode
--    FROM daftar_konfirmasi_qris(10);
--    Jangan sampai muncul error 42804 lagi.