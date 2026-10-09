-- Set role akun admin & owner sesuai email
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
--
-- AKUN:
--   admin@lapakberkah.com        -> role 'admin'  (semua menu)
--   lapakberkahbuntulia@gmail.com -> role 'owner' (semua kecuali Audit Log & User Management)
--
-- Jalankan ini SEKALI. Setelah itu login lagi (logout dulu) supaya
-- role yang baru terbaca.

UPDATE users
SET role = 'admin'
WHERE email = 'admin@lapakberkah.com';

UPDATE users
SET role = 'owner'
WHERE email = 'lapakberkahbuntulia@gmail.com';

-- Verifikasi: harus menghasilkan 2 baris dengan role admin dan owner
SELECT nama, email, role
FROM users
WHERE email IN ('admin@lapakberkah.com', 'lapakberkahbuntulia@gmail.com');