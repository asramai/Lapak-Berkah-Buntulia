-- Set role akun admin & owner sesuai email
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel SELURUH file ini -> Run.
--
-- AKUN:
--   admin@lapakberkah.com         -> role 'admin'  (semua menu)
--   lapakberkahbuntulia@gmail.com -> role 'owner'  (semua kecuali Audit Log & User Management)
--
-- Langkah 1 menambahkan 'admin' ke constraint role.
-- Tanpa langkah 1, UPDATE ke role='admin' ditolak dengan error 23514.

-- (1) Izinkan role 'admin' di tabel users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'owner', 'mitra', 'kasir'));

-- (2) Set role kedua akun
-- Trigger hash_user_password tidak mengubah password karena
-- password sudah berupa bcrypt hash ($2a$...).
UPDATE users SET role = 'admin' WHERE email = 'admin@lapakberkah.com';
UPDATE users SET role = 'owner' WHERE email = 'lapakberkahbuntulia@gmail.com';

-- (3) Verifikasi: harus menghasilkan 2 baris, role admin dan owner
SELECT nama, email, role
FROM users
WHERE email IN ('admin@lapakberkah.com', 'lapakberkahbuntulia@gmail.com');

-- (4) Cek constraint sekarang
SELECT conname, pg_get_constraintdef(oid) AS definisi
FROM pg_constraint
WHERE conrelid = 'users'::regclass AND contype = 'c';