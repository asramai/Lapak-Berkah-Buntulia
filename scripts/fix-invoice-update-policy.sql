-- Perbaikan: edit dan hapus invoice tidak berfungsi karena tidak ada policy UPDATE
--
-- GEJALA:
--   Edit invoice gagal dengan pesan "Gagal menyimpan invoice".
--   Tombol hapus tidak melakukan apa-apa.
--
--   PATCH ke mitra_settlements mengembalikan HTTP 200 dengan body [],
--   yang berarti nol baris berubah, bukan error.
--
-- PENYEBAB:
--   migration RLS sebelumnya hanya memberi tiga policy untuk tabel ini:
--     baca  : SELECT
--     tambah: INSERT
--     ubah  : tidak ada
--
--   Tanpa policy UPDATE, PostgreSQL menyaring semua baris sehingga UPDATE
--   mengenai nol baris. PostgREST mengembalikan 200 [], jadi kodenya mengira
--   berhasil padahal tidak ada yang berubah. Tidak ada error yang terlihat.
--
--   Nota Penjualan Mitra memakai UPDATE untuk dua hal: menyimpan hasil edit
--   invoice, dan soft delete lewat kolom deleted_at. Keduanya tertahan.
--
-- CATATAN PENTING:
--   Ini hanya memberi izin UPDATE pada baris yang belum dihapus
--   (deleted_at IS NULL). Baris yang sudah dipindahkan ke data terhapus tidak
--   bisa diubah lagi lewat peramban, dan tidak bisa dipulihkan lewat
--   peramban juga. Pemulihan tetap lewat menu Audit Log.
--
--   Transaksi dan item transaksi TIDAK diberi policy UPDATE, karena keduanya
--   sengaja dikunci agar pembayaran tidak bisa dimanipulasi dari peramban.
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.


-- ============================================================
-- Policy UPDATE untuk tabel yang memang diedit dari aplikasi
-- ============================================================
-- Hanya tiga tabel, satu per satu, supaya kalau ada yang gagal penyebabnya
-- jelas dan tabel lain tidak ikut terkunci.

-- Nota Penjualan Mitra: edit invoice dan soft delete.
DROP POLICY IF EXISTS "ubah" ON public.mitra_settlements;
CREATE POLICY "ubah" ON public.mitra_settlements
  FOR UPDATE TO anon, authenticated
  USING (deleted_at IS NULL)
  WITH CHECK (deleted_at IS NULL);

-- Product Management: edit produk.
-- Sudah ada dari migration sebelumnya, tapi ditulis ulang di sini supaya
-- migrate idempoten dan jelas.
DROP POLICY IF EXISTS "ubah" ON public.products;
CREATE POLICY "ubah" ON public.products
  FOR UPDATE TO anon, authenticated
  USING (deleted_at IS NULL)
  WITH CHECK (deleted_at IS NULL);

-- Mitra Dashboard: edit data mitra.
DROP POLICY IF EXISTS "ubah" ON public.mitra;
CREATE POLICY "ubah" ON public.mitra
  FOR UPDATE TO anon, authenticated
  USING (deleted_at IS NULL)
  WITH CHECK (deleted_at IS NULL);


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Tiga tabel punya policy UPDATE (harus 3):
--    SELECT tablename FROM pg_policies
--    WHERE cmd = 'UPDATE' AND schemaname = 'public'
--      AND tablename IN ('mitra_settlements', 'products', 'mitra');
--
-- 2. Edit dan hapus invoice harus benar-benar mengubah baris. Jalankan dari
--    SQL Editor dan perhatikan body responsnya, harus berisi baris, bukan []:
--
--    SELECT id FROM mitra_settlements
--    WHERE deleted_at IS NULL LIMIT 1;
--
--    UPDATE mitra_settlements
--    SET total_amount = total_amount
--    WHERE id = '<id dari query di atas>' RETURNING id, invoice_number;
--    Harus mengembalikan satu baris.
--
--    UPDATE mitra_settlements
--    SET deleted_at = NOW()
--    WHERE id = '<id yang sama>' RETURNING id, invoice_number;
--    Harus mengembalikan satu baris.
--
--    Kalau dua query itu mengembalikan baris, edit dan hapus invoice sudah
--   normal di aplikasi. Kalau mengembalikan nol baris, policy belum terpasang.
--
-- 3. Transaksi tetap terkunci (harus 401):
--    UPDATE transactions SET total = total WHERE id = '<id mana saja>';
--    Gagal di sini memang hasil yang diinginkan: pembayaran tidak boleh diubah
--    dari peramban.
--
-- 4. Baris yang sudah dihapus tidak bisa diubah lagi:
--    UPDATE mitra_settlements SET status = 'paid'
--    WHERE deleted_at IS NOT NULL;
--    Harus mengembalikan nol baris.