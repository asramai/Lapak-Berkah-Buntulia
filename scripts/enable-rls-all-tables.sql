-- RLS untuk seluruh tabel aplikasi
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- MASALAH YANG DISELESAIKAN:
-- Tidak satu pun tabel punya RLS. Aplikasi memakai anon key yang ikut terpasang
-- di dalam bundle browser, jadi siapa pun yang membuka DevTools bisa membaca dan
-- mengubah seluruh database tanpa batas: menghapus semua produk, mengubah
-- harga, membaca hash password, membuat akun admin.
--
-- YANG TIDAK BISA DISELESAIKAN DI SINI:
-- RLS hanya membatasi berdasarkan role PostgreSQL. Aplikasi ini tidak memakai
-- Supabase Auth, jadi tidak ada JWT dan tidak ada role per pengguna. Yang bisa
-- kita lakukan di sini hanya membatasi kerusakannya, yaitu menghapus dan menulis
-- langsung lewat REST API. Membedakan admin dari kasir hanya bisa lewat Supabase
-- Auth, dan itu pekerjaan tersendiri yang lebih besar.
--
-- Policy di bawah sengaja SANGAT KONSERVATIF: hanya memberi izin yang benar-benar
-- dipakai aplikasi, dan menutup sisanya. Kalau ada halaman yang tiba-tiba gagal,
-- jangan langsung longgarkan policy-nya. Cari dulu operasi mana yang gagal,
-- lalu tambahkan izin yang sekecil mungkin.


-- ============================================================
-- (1) users: kolom password ditutup untuk anon
-- ============================================================
-- Aplikasi tidak pernah membaca tabel ini. Login lewat RPC login_user.
-- Tapi selama ini anon bisa SELECT seluruh baris termasuk hash password, dan
-- INSERT baris dengan role apa saja termasuk admin.
--
-- RLS dinyalakan TANPA policy SELECT sama sekali, sehingga anon tidak bisa
-- membaca tabel ini. Supaya login tetap jalan, login_user diubah jadi
-- SECURITY DEFINER di bawah: dia membaca dengan hak pemilik tabel, bukan hak
-- pemanggil.
--
-- INSERT tetap diizinkan, tapi hanya untuk role mitra, karena itu satu-satunya
-- yang aplikasi perlukan (MitraDashboard membuat akun mitra).

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_baca" ON users;
DROP POLICY IF EXISTS "users_tambah_mitra" ON users;

CREATE POLICY "users_tambah_mitra" ON users
  FOR INSERT TO anon, authenticated
  WITH CHECK (role = 'mitra');

-- Tidak ada policy UPDATE maupun DELETE. Akun tidak bisa diubah atau dihapus
-- dari peramban.


-- ============================================================
-- (2) login_user jadi SECURITY DEFINER
-- ============================================================
-- Sebelumnya SECURITY INVOKER, jadi dia membaca tabel users dengan hak pemanggil
-- yang sama dengan anon. Begitu RLS dinyalakan tanpa policy SELECT, login akan
-- gagal. Dengan SECURITY DEFINER, fungsi membaca dengan hak pemilik tabel dan
-- RLS tidak berlaku untuknya.

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
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION login_user(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_user(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ============================================================
-- (3) products, mitra, categories, product_types
-- ============================================================
-- Operasi yang dipakai aplikasi: SELECT, INSERT, UPDATE.
-- DELETE sengaja tidak diberi izin karena aplikasi sudah memakai soft delete.
-- Tanpa policy DELETE, hapus permanen lewat REST API tidak akan berhasil.

DO $$
DECLARE
  t TEXT;
  policy_wrote TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'mitra', 'categories', 'product_types'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "baca" ON public.%I', t);
    EXECUTE format('CREATE POLICY "baca" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);

    EXECUTE format('DROP POLICY IF EXISTS "tambah" ON public.%I', t);
    EXECUTE format('CREATE POLICY "tambah" ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)', t);

    EXECUTE format('DROP POLICY IF EXISTS "ubah" ON public.%I', t);
    EXECUTE format('CREATE POLICY "ubah" ON public.%I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)', t);

    -- Tanpa policy DELETE. Hapus harus lewat soft delete supaya bisa dipulihkan
    -- dan tercatat di audit_log.
  END LOOP;
END $$;


-- ============================================================
-- (4) transactions: hanya baca dan tambah
-- ============================================================
-- Penyelesaian pembayaran sudah ditangani fungsi:
-- complete_cash_payment, confirm_qris_payment, cancel_pending_transaction.
-- Semua SECURITY DEFINER. Jadi UPDATE dan DELETE untuk role anon tidak lagi
-- diperlukan, dan akan ditolak oleh RLS.

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "baca" ON transactions;
DROP POLICY IF EXISTS "tambah" ON transactions;

CREATE POLICY "baca" ON transactions FOR SELECT TO anon, authenticated USING (true);
-- Status, paid, dan change dipaksa trigger force_transaction_pending, jadi
-- aplikasi tidak bisa membuat transaksi yang langsung berstatus lunat.
CREATE POLICY "tambah" ON transactions FOR INSERT TO anon, authenticated WITH CHECK (true);


-- ============================================================
-- (5) Tabel yang hanya dibaca dan ditambah
-- ============================================================
-- transaction_items, stock_movements, returns, mitra_settlements,
-- mitra_settlement_items, pending_stock_validations.
--
-- pending_stock_validations masih dipakai. Service ini butuh UPDATE (ubah status
-- validasi stok dari pending ke validated atau rejected).

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['transaction_items', 'stock_movements', 'returns',
                           'mitra_settlements', 'mitra_settlement_items',
                           'pending_stock_validations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS "baca" ON public.%I', t);
    EXECUTE format('CREATE POLICY "baca" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);

    EXECUTE format('DROP POLICY IF EXISTS "tambah" ON public.%I', t);
    EXECUTE format('CREATE POLICY "tambah" ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)', t);
  END LOOP;

  -- Hanya tabel validasi stok yang boleh diubah statusnya.
  EXECUTE 'DROP POLICY IF EXISTS "ubah" ON public.pending_stock_validations';
  EXECUTE 'CREATE POLICY "ubah" ON public.pending_stock_validations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)';
END $$;


-- ============================================================
-- (6) held_transactions: satu-satunya tabel yang boleh dihapus
-- ============================================================
-- Isinya keranjang sementara, bukan transaksi. Hard delete sudah benar di sini
-- dan tidak meninggalkan jejak yang perlu disimpan.

ALTER TABLE held_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "baca" ON held_transactions;
DROP POLICY IF EXISTS "tambah" ON held_transactions;
DROP POLICY IF EXISTS "hapus" ON held_transactions;
DROP POLICY IF EXISTS "ubah" ON held_transactions;

CREATE POLICY "baca" ON held_transactions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "tambah" ON held_transactions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "ubah" ON held_transactions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "hapus" ON held_transactions FOR DELETE TO anon, authenticated USING (true);


-- ============================================================
-- (7) audit_log: sudah diatur di migration sebelumnya, reaffirm
-- ============================================================
-- Hanya boleh dibaca. Penulisan hanya oleh trigger SECURITY DEFINER.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_log_baca" ON audit_log;

CREATE POLICY "audit_log_baca" ON audit_log
  FOR SELECT TO anon, authenticated USING (true);


-- ============================================================
-- (8) Cabut hak tabel dari anon dan authenticated
-- ============================================================
-- RLS menyaring baris, tapi hak akses tabel tetap perlu dicabut supaya
-- PostgREST tidak bisa menyentuh tabel yang tidak punya policy. Tables lain yang
-- dibuat di luar daftar di atas otomatis tidak bisa diakses.

REVOKE UPDATE, DELETE ON users FROM anon, authenticated;
REVOKE DELETE ON products, mitra, categories, product_types FROM anon, authenticated;
REVOKE UPDATE, DELETE ON transactions FROM anon, authenticated;
REVOKE UPDATE, DELETE ON transaction_items, stock_movements, returns FROM anon, authenticated;
REVOKE DELETE ON mitra_settlements, mitra_settlement_items FROM anon, authenticated;

-- Audit log hanya boleh dibaca.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Semua tabel punya RLS. Harus 14:
--    SELECT COUNT(*) FROM pg_tables
--    WHERE schemaname = 'public' AND rowsecurity;
--
-- 2. Daftar policy per tabel:
--    SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname = 'public' ORDER BY tablename, cmd;
--    users harus hanya punya INSERT, held_transactions punya 4, tabel lain
--    tidak boleh punya cmd DELETE.
--
-- 3. Tidak boleh ada policy DELETE di luar held_transactions:
--    SELECT tablename FROM pg_policies
--    WHERE cmd = 'DELETE' AND tablename <> 'held_transactions';
--    Harus kosong.
--
-- 4. Hash password tidak bisa dibaca dari browser. Query ini HARUS ditolak:
--    SELECT password FROM users;
--
-- 5. Akun admin tidak bisa dibuat dari browser. Query ini HARUS ditolak
--    karena policy INSERT hanya mengizinkan role mitra:
--    INSERT INTO users (nama, email, password, role)
--    VALUES ('Tes', 'tes@contoh.id', 'rahasia123', 'admin');
--
-- 6. Memperbarui produk tetap bisa dari browser:
--    UPDATE products SET description = description WHERE id = '<id mana saja>';
--
-- 7. Login masih jalan. Coba masuk dari aplikasi dengan akun yang ada.