-- Perbaikan: login_user gagal dengan "function crypt(text, text) does not exist"
--
-- GEJALA:
--   POST /rest/v1/rpc/login_user -> 404
--   function crypt(text, text) does not exist
--
-- PENYEBAB:
--   Fungsi crypt() milik extension pgcrypto. Di proyek Supabase, extension itu
--   dipasang pada skema "extensions", bukan "public". migration sebelumnya
--   mengeraskan login_user dengan SET search_path = public, pg_temp, yang
--   membuat schemas "extensions" tidak lagi dicari. Akibatnya PostgreSQL tidak
--   menemukan crypt, dan fungsi gagal setiap kali dipanggil.
--
--   Jadi pengetatan search_path justru merusak fungsi yang seharusnya dilindungi.
--   Ini trade-off yang tidak terlihat dari error tersebut saja.
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.
--
-- CATATAN:
--  Skema "extensions" selalu ada di proyek Supabase, dan PostgreSQL
--   mengabaikan skema yang tidak ada di search_path. Jadi aman untuk ditulis di
--   sini baik pgcrypto ada di extensions maupun di public.

CREATE OR REPLACE FUNCTION login_user(p_email TEXT, p_password TEXT, p_role TEXT)
RETURNS TABLE(id UUID, email TEXT, role TEXT, nama TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.email, u.role, u.nama
  FROM users u
  WHERE u.email = p_email
    AND u.role = p_role
    AND u.password = crypt(p_password, u.password);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp;

REVOKE ALL ON FUNCTION login_user(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_user(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Fungsi jalan. Query ini harus mengembalikan baris, bukan error:
--    SELECT id, email, role, nama FROM login_user(
--      'admin@lapakberkah.com', '<password yang sebenarnya>', 'admin');
--    Ganti email dan password dengan akun yang benar-benar ada.
--
-- 2. Kalau masih error "does not exist", berarti pgcrypto tidak terpasang di
--    skema manapun yang dicari. Periksa di mana crypt berada:
--    SELECT n.nspname FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE p.proname = 'crypt';
--    Kalau hasilnya "public", tidak ada masalah. Kalau baris kosong, pgcrypto
--    belum terpasang dan perlu:
--    CREATE EXTENSION IF NOT EXISTS pgcrypto;
--
-- 3. Login masih harus jalan dari browser. Coba masuk dari aplikasi.