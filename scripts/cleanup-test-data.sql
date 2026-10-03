-- Bersihkan sisa pengujian
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
--
-- KENAPA INI PERLU:
-- Verifikasi RLS membuat beberapa baris uji. File RLS mencabut hak DELETE dari
-- anon, jadi baris-baris itu tidak bisa dihapus dari peramban dan harus
-- dibersihkan dari SQL Editor.
--
-- Query di bawah aman dijalankan berulang kali: semuanya memakai pola nama yang
-- sama, jadi tidak akan ikut menghapus data asli. Tapi periksa hasilnya
-- SEBELUM menekan Run, supaya Anda bisa memastikan tidak ada yang tak
-- terduga ikut terhapus.

-- Lihat dulu apa yang akan dihapus. Jalankan ini lebih dulu dan periksa.
SELECT id, nama, email, role FROM users
WHERE email LIKE 'uji-%@x.id' OR email LIKE 'tes%@x.id'
   OR nama LIKE 'Uji %';

SELECT id, name FROM categories
WHERE name LIKE 'Uji Kategori%';

-- Kalau daftar di atas hanya berisi data uji, baru jalankan penghapusan.
DELETE FROM users
WHERE email LIKE 'uji-%@x.id' OR email LIKE 'tes%@x.id'
   OR nama LIKE 'Uji %';

DELETE FROM categories
WHERE name LIKE 'Uji Kategori%';

-- Verifikasi: keduanya harus 0
SELECT COUNT(*) AS sisa_users FROM users
WHERE email LIKE 'uji-%@x.id' OR nama LIKE 'Uji %';

SELECT COUNT(*) AS sisa_kategori FROM categories
WHERE name LIKE 'Uji Kategori%';

-- Cek bahwa data asli utuh. jumlah_baris tidak boleh 0.
SELECT COUNT(*) AS jumlah_users FROM users;
SELECT COUNT(*) AS jumlah_kategori FROM categories;