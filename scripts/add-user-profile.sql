-- Fitur profil pengguna: foto akun, ubah nama & password sendiri
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- MASALAH YANG DISELESAIKAN:
-- 1. Pengguna tidak bisa mengubah nama, password, atau menambah
--    foto sendiri. Selama ini hanya admin lewat User Management.
-- 2. Akun mitra masih memakai password default (mitra123).
--
-- CATATAN KEAMANAN:
-- Aplikasi belum memakai Supabase Auth, jadi database tidak bisa
-- memverifikasi siapa pemanggil RPC. update_my_profile menerima
-- id pengguna dari klien. Ini setara dengan keamanan update_user
-- yang sudah ada: siapa pun dengan anon key bisa memanggilnya.
-- Verifikasi password lama dilakukan di peramban lewat login_user
-- sebelum update dikirim.

ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT;

-- login_user mengembalikan foto supaya avatar tampil setelah login.
CREATE OR REPLACE FUNCTION login_user(p_email TEXT, p_password TEXT)
RETURNS TABLE(id UUID, email TEXT, role TEXT, nama TEXT, photo TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.role, u.nama, u.photo
  FROM users u
  WHERE u.email = p_email
    AND u.password = crypt(p_password, u.password);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp;

REVOKE ALL ON FUNCTION login_user(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_user(TEXT, TEXT) TO anon, authenticated;

-- Update profil sendiri: nama, foto, dan password (opsional).
-- Sengaja tidak menyentuh email maupun role.
CREATE OR REPLACE FUNCTION update_my_profile(p_id UUID, p_nama TEXT, p_photo TEXT, p_password TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET nama = COALESCE(NULLIF(p_nama, ''), nama),
      photo = p_photo,
      password = CASE
        WHEN p_password IS NOT NULL AND p_password <> ''
        THEN crypt(p_password, gen_salt('bf'))
        ELSE password
      END
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION update_my_profile(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_my_profile(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- VERIFIKASI
-- 1. Kolom foto ada:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'users' AND column_name = 'photo';
--
-- 2. RPC tersedia:
--    SELECT routine_name FROM information_schema.routines
--    WHERE routine_schema = 'public'
--      AND routine_name IN ('login_user', 'update_my_profile');
