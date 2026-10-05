-- Perbaikan: tombol hapus invoice tetap tidak berfungsi karena policy terlalu ketat
--
-- GEJALA:
--   Tombol Hapus di Nota Penjualan Mitra tidak melakukan apa-apa.
--   PATCH deleted_at mengembalikan HTTP 401 dengan pesan:
--     new row violates row-level security policy for table "mitra_settlements"
--
-- PENYEBAB:
--   Policy ubah sebelumnya ditulis:
--     USING (deleted_at IS NULL)
--     WITH CHECK (deleted_at IS NULL)
--
--   WITH CHECK dinilai terhadap NILAI BARU. Mengisi deleted_at berarti nilai
--   baru bukan null, jadi baris yang baru itu melanggar WITH CHECK dan
--   PostgreSQL menolak. Soft delete menjadi mustahil terjadi.
--
--   USING dinilai terhadap NILAI LAMA. Karena itu baris yang sudah terhapus
--   tidak bisa diubah lagi, dan tidak bisa dipulihkan lewat peramban.
--
-- KEBUTUHAN YANG BERTENTAKAN:
--   Pemulihan invoice lewat menu Audit Log juga memakai UPDATE dari peramban.
--   Kalau baris terhapus dikunci di USING, tombol Pulihkan di Audit Log ikut
--   mati. Dua fitur itu tidak bisa dipenuhi sekaligus oleh satu policy.
--
--   Yang dipilih: buka akses UPDATE untuk tiga tabel ini, seperti desain
--   awal. Hapus sudah tidak merusak data karena soft delete, dan jejaknya
--   tercatat di audit_log. Yang tetap dikunci adalah tabel pembayaran.
--
-- YANG TETAP TERKUNCI:
--   transactions tetap tanpa policy UPDATE, sehingga pembayaran tidak bisa
--   diubah dari peramban. Ini yang diuji ulang di bawah.
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.


-- ============================================================
-- Tiga tabel yang memang diedit dari aplikasi
-- ============================================================

DROP POLICY IF EXISTS "ubah" ON public.mitra_settlements;
CREATE POLICY "ubah" ON public.mitra_settlements
  FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ubah" ON public.products;
CREATE POLICY "ubah" ON public.products
  FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "ubah" ON public.mitra;
CREATE POLICY "ubah" ON public.mitra
  FOR UPDATE TO anon, authenticated
  USING (true) WITH CHECK (true);


-- ============================================================
-- Bersihkan sisa pengujian
-- ============================================================
-- Invoice uji yang dibuat saat diagnosa tidak pernah dihapus karena soft delete
-- tidak bisa berjalan. Sekarang bisa, jadi dihapus di sini.
-- Hapus baris ini kalau tidak ada invoice uji di database.

DELETE FROM mitra_settlements WHERE invoice_number LIKE 'UJI-TEMP-%';


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Tiga tabel punya policy UPDATE (harus 3):
--    SELECT tablename FROM pg_policies
--    WHERE cmd = 'UPDATE' AND schemaname = 'public'
--      AND tablename IN ('mitra_settlements', 'products', 'mitra');
--
-- 2. Soft delete harus berhasil. Ambil satu invoice aktif, lalu jalankan:
--
--    SELECT id, invoice_number FROM mitra_settlements
--    WHERE deleted_at IS NULL LIMIT 1;
--
--    UPDATE mitra_settlements SET deleted_at = NOW()
--    WHERE id = '<id di atas>' RETURNING id, invoice_number, deleted_at;
--    Harus mengembalikan SATU baris dengan deleted_at terisi.
--
--    Kalau mengembalikan error 42501, WITH CHECK masih salah.
--
-- 3. Restore dari Audit Log harus berhasil:
--
--    UPDATE mitra_settlements SET deleted_at = NULL
--    WHERE id = '<id yang sama>' RETURNING id, invoice_number;
--    Harus mengembalikan SATU baris.
--
-- 4. Pembayaran tetap terkunci. Harus gagal dengan 401, itu memang hasil
--    yang diinginkan:
--    UPDATE transactions SET total = 1;
--
-- 5. Menghapus invoice secara permanen tetap tidak bisa dari peramban:
--    DELETE FROM mitra_settlements;
--    Harus gagal. Penghapusan hanya lewat menu Audit Log.
