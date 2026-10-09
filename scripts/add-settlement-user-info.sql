-- Snapshot nama & role pembuat invoice ke tabel mitra_settlements
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali. Bisa dijalankan sebelum atau
-- sesudah deploy aplikasi: aplikasi tidak pernah menulis kolom ini dari
-- peramban (hanya mengirim user_id seperti sebelumnya), dan pembacaan
-- memakai SELECT * yang tidak menyebut nama kolom, jadi tidak mungkin
-- error PGRST204 walau urutannya terbalik.
--
-- MASALAH YANG DISELESAIKAN:
-- Nota Penjualan Mitra harus menampilkan nama pembuat invoice, tapi
-- relasi user:user_id selalu mengembalikan null dari peramban. Tabel
-- users sengaja tidak punya policy SELECT (lihat scripts/enable-rls-all-tables.sql)
-- supaya hash password tidak bisa dibaca lewat anon key.
--
-- SOLUSI:
-- Nama dan role di-snapshot ke kolom sendiri di mitra_settlements saat
-- invoice dibuat. Trigger di bawah membaca tabel users dengan hak
-- pemilik tabel (SECURITY DEFINER), sehingga RLS di tabel users tidak
-- menghalangi. Kolom ini juga ikut terekam otomatis di audit_log
-- karena trigger audit memakai to_jsonb(NEW).

ALTER TABLE mitra_settlements ADD COLUMN IF NOT EXISTS user_nama TEXT;
ALTER TABLE mitra_settlements ADD COLUMN IF NOT EXISTS user_role TEXT;

-- Isi dulu invoice yang sudah ada.
UPDATE mitra_settlements ms
SET user_nama = u.nama,
    user_role = u.role
FROM users u
WHERE ms.user_id = u.id
  AND ms.user_nama IS NULL;

-- Snapshot otomatis untuk invoice baru dan edit berikutnya.
-- Hanya mengisi kalau belum ada, supaya snapshot asli tidak
-- tertimpa saat invoice diedit.
CREATE OR REPLACE FUNCTION mitra_settlement_set_user_info()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.user_nama IS NULL THEN
    SELECT nama, role INTO NEW.user_nama, NEW.user_role
    FROM users
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_settlement_set_user_info ON mitra_settlements;
CREATE TRIGGER trg_settlement_set_user_info
  BEFORE INSERT OR UPDATE ON mitra_settlements
  FOR EACH ROW EXECUTE FUNCTION mitra_settlement_set_user_info();

-- VERIFIKASI
-- 1. Kolom baru ada:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'mitra_settlements'
--      AND column_name IN ('user_nama', 'user_role');
--    Harus 2 baris.
--
-- 2. Invoice lama sudah terisi:
--    SELECT invoice_number, user_nama, user_role FROM mitra_settlements
--    WHERE user_id IS NOT NULL ORDER BY created_at DESC LIMIT 5;
--
-- 3. Trigger terpasang:
--    SELECT trigger_name FROM information_schema.triggers
--    WHERE event_object_table = 'mitra_settlements';
