-- Dimensi ketiga produk: Kelompok (product_groups)
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali. Jalankan DULU sebelum deploy
-- aplikasi yang memakai kolom group_id.
--
-- LATAR BELAKANG:
-- Produk sudah punya dua dimensi: Kategori (perishable/non-perishable)
-- dan Jenis (Makanan Basah, Minuman, dst). Dimensi ketiga "Kelompok"
-- dipakai untuk tab pencarian di Menu Kasir, misalnya "Kue & Makanan
-- Utama". Disimpan sebagai tabel tersendiri supaya konsisten dengan
-- categories dan product_types: bisa ditambah/edit dari aplikasi, tidak
-- perlu teks bebas, dan tab tablet tetap rapi.
--
-- KEAMANAN:
-- Mengikuti pola categories/product_types (scripts/enable-rls-all-tables.sql):
-- SELECT, INSERT, UPDATE untuk anon; DELETE tidak diberi izin supaya
-- penghapusan selalu lewat soft delete dan tercatat di audit_log.

CREATE TABLE IF NOT EXISTS public.product_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- Penghubung ke produk. Opsional (nullable) dan tidak memberlakukan
-- integritas ketat supaya produk lama tetap bisa dipakai meskipun
-- kelompoknya dihapus.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS group_id uuid
  REFERENCES public.product_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_group_id
  ON public.products(group_id);

-- Nilai awal.
INSERT INTO public.product_groups (name)
SELECT 'Kue & Makanan Utama'
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_groups WHERE name = 'Kue & Makanan Utama'
);

-- Row Level Security.
ALTER TABLE public.product_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "baca" ON public.product_groups;
CREATE POLICY "baca" ON public.product_groups
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "tambah" ON public.product_groups;
CREATE POLICY "tambah" ON public.product_groups
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ubah" ON public.product_groups;
CREATE POLICY "ubah" ON public.product_groups
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

REVOKE DELETE ON public.product_groups FROM anon, authenticated;

COMMENT ON TABLE public.product_groups IS
  'Kelompok produk (dimensi ketiga setelah kategori dan jenis)';
COMMENT ON COLUMN public.products.group_id IS
  'Kelompok produk, opsional';

-- VERIFIKASI
-- 1. Tabel dan kolom ada:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'product_groups';
--    Harus ada id, name, created_at, updated_at, deleted_at.
--
-- 2. Kolom products baru:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'products' AND column_name = 'group_id';
--
-- 3. Seed ada:
--    SELECT name FROM public.product_groups;
--    Harus ada "Kue & Makanan Utama".
--
-- 4. RLS aktif:
--    SELECT tablename FROM pg_tables
--    WHERE schemaname = 'public' AND tablename = 'product_groups';
--    Lihat di dashboard Supabase -> Authentication -> Policies.
