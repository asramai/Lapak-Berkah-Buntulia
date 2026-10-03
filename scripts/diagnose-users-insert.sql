-- Diagnosis: kenapa INSERT users role=mitra ditolak
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel SELURUH file ini -> Run.
-- Semua query di sini hanya membaca, tidak mengubah data apa pun.
--
-- Lalu salin hasil outputnya dan kirim ke saya. Jangan ubah apa pun dulu.

-- (A) Policy apa saja yang menempel di tabel users
SELECT policyname, cmd, roles, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'users'
ORDER BY cmd, policyname;

-- (B) RLS aktif? dipaksa untuk pemilik tabel?
SELECT relname, relrowsecurity AS rls_aktif, relforcerowsecurity AS rls_paksa
FROM pg_class
WHERE relname = 'users';

-- (C) Hak akses tabel users untuk role anon
-- Kalau boleh_insert false, itu penyebabnya: policy-nya benar, tapi role anon
-- tidak punya hak INSERT sama sekali.
SELECT
  has_table_privilege('anon', 'users', 'INSERT') AS boleh_insert,
  has_table_privilege('anon', 'users', 'SELECT') AS boleh_select,
  has_table_privilege('anon', 'users', 'UPDATE') AS boleh_update,
  has_table_privilege('anon', 'users', 'DELETE') AS boleh_delete;

-- (D) Trigger pem hashing password: ada dan aktif?
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS definisi
FROM pg_trigger
WHERE tgrelid = 'users'::regclass AND NOT tgisinternal;

-- (E) Benar-benar berapa baris di tabel users
SELECT COUNT(*) AS jumlah_baris FROM users;