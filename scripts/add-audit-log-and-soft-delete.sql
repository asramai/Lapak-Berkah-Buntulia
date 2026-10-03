-- Audit log + hapus non-destruktif (soft delete)
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel SELURUH file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- MASALAH YANG DISELESAIKAN:
-- 1. Semua hapus di aplikasi memakai .delete() langsung ke database. Sekali
--    terhapus, data produk/mitra/invoice hilang permanen. Laporan laba, nota
--    penjualan mitra, dan riwayat transaksi ikut berubah retroactive karena
--    referensinya ikut hilang.
-- 2. Tidak ada jejak siapa mengubah apa dan kapan. Kalau ada selisih angka di
--    laporan, tidak ada cara memastikan penyebabnya.
--
-- SOLUSI:
-- 1. Tambah kolom deleted_at. Hapus berarti ditandai, bukan hilang, jadi bisa
--    dikembalikan. Baris yang terhapus disaring dari semua query daftar.
-- 2. Tabel audit_log yang hanya bisa ditambah, diisi otomatis oleh trigger
--    database untuk setiap perubahan. Dipakai trigger, bukan pemanggilan dari
--    UI, karena anon key ikut terpasang di dalam bundle browser: audit yang
--    hanya diisi dari UI bisa dilewati begitu saja lewat REST API.


-- ============================================================
-- (1) Tabel audit log
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_email TEXT,
  aksi TEXT NOT NULL CHECK (aksi IN ('create', 'update', 'delete', 'restore')),
  tabel TEXT NOT NULL,
  entitas_id UUID,
  entitas_nama TEXT,
  data_sebelum JSONB,
  data_sesudah JSONB
);

-- Jejak audit tidak boleh diubah atau dihapus, termasuk oleh aplikasi sendiri.
-- Ini satu-satunya tempat yang benar-benar dijaga lewat hak akses, karena
-- soft delete saja tidak mencegah penghapusan langsung lewat REST API.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
GRANT SELECT, INSERT ON audit_log TO anon, authenticated;

-- Pencarian log terakhir per tabel, dan log untuk satu baris tertentu.
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entitas_idx ON audit_log (entitas_id, created_at DESC);


-- ============================================================
-- (2) Kolom soft delete
-- ============================================================
-- NULL = masih aktif. Terisi = dihapus, tapi datanya utuh dan bisa dipulihkan.
-- sengaja tidak dipakai TIMESTAMPTZ DEFAULT NOW() supaya baris lama otomatis
-- dianggap aktif tanpa perlu backfill.

ALTER TABLE products           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE mitra              ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE categories         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE product_types      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE mitra_settlements  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Saringan ini dipakai setiap query daftar, jadi harus ikut terindeks.
CREATE INDEX IF NOT EXISTS products_deleted_at_idx           ON products (deleted_at);
CREATE INDEX IF NOT EXISTS mitra_deleted_at_idx              ON mitra (deleted_at);
CREATE INDEX IF NOT EXISTS categories_deleted_at_idx         ON categories (deleted_at);
CREATE INDEX IF NOT EXISTS product_types_deleted_at_idx      ON product_types (deleted_at);
CREATE INDEX IF NOT EXISTS mitra_settlements_deleted_at_idx  ON mitra_settlements (deleted_at);


-- ============================================================
-- (3) Uniqueness hanya berlaku pada baris yang masih aktif
-- ============================================================
-- Tanpa ini, soft delete justru merusak aplikasi: produk dengan SKU "ABC-01"
-- yang sudah dihapus masih memakai SKU itu, jadi produk baru dengan SKU sama
-- akan ditolak walaupun produk lamanya sudah tidak aktif. Constrain UNIQUE yang
-- sekarang diganti jadi UNIQUE parsial WHERE deleted_at IS NULL, jadi tabrakan
-- antar produk aktif tetap dicegah seperti sebelumnya.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name, tc.constraint_name, COUNT(kcu.column_name) AS jumlah_kolom
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'UNIQUE'
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('products', 'mitra', 'categories', 'product_types', 'mitra_settlements')
    GROUP BY tc.table_name, tc.constraint_name
    HAVING COUNT(kcu.column_name) = 1
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
  END LOOP;
END $$;

-- products.barcode_id punya dua kondisi: NULL tidak boleh bentrok dengan NULL,
-- jadi NULL ikut dikecualikan.
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_uniq
  ON products (sku) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_id_uniq
  ON products (barcode_id) WHERE deleted_at IS NULL AND barcode_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_uniq
  ON categories (name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_types_name_uniq
  ON product_types (name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mitra_email_uniq
  ON mitra (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mitra_settlements_invoice_number_uniq
  ON mitra_settlements (invoice_number) WHERE deleted_at IS NULL;


-- ============================================================
-- (4) Trigger audit
-- ============================================================
-- Perubahan yang hanya menyentuh kolom stock sengaja diabaikan: perubahan
-- stok sudah punya jejaknya sendiri di tabel stock_movements, dan kasir
-- memicunya setiap kali penjualan, sehingga audit_log akan cepat penuh tanpa
-- nilai. Perubahan modal/harga/stok hasil koreksi tetap tercatat.

CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS TRIGGER AS $$
DECLARE
  v_aksi TEXT;
  v_actor TEXT;
  v_entitas_id UUID;
  v_nama TEXT;
  v_sebelum JSONB;
  v_sesudah JSONB;
BEGIN
  -- Header x-actor dikirim klien (lihat src/lib/supabase.js). Kalau request
  -- datang tanpa header, jejak tetap tercatat tanpa nama pelaku.
  BEGIN
    v_actor := NULLIF(current_setting('request.headers', true)::json ->> 'x-actor', '');
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    v_aksi := 'create';
    v_sebelum := NULL;
    v_sesudah := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_aksi := 'delete';
    v_sebelum := to_jsonb(OLD);
    v_sesudah := NULL;
  ELSE
    v_sebelum := to_jsonb(OLD);
    v_sesudah := to_jsonb(NEW);

    -- Hanya kolom stok yang berubah, sudah tercatat di stock_movements.
    IF (v_sesudah - 'stock') = (v_sebelum - 'stock') THEN
      RETURN NEW;
    END IF;

    v_aksi := 'update';
    IF v_sebelum ? 'deleted_at' THEN
      IF (v_sebelum ->> 'deleted_at') IS NULL AND (v_sesudah ->> 'deleted_at') IS NOT NULL THEN
        v_aksi := 'delete';
      ELSIF (v_sebelum ->> 'deleted_at') IS NOT NULL AND (v_sesudah ->> 'deleted_at') IS NULL THEN
        v_aksi := 'restore';
      END IF;
    END IF;
  END IF;

  BEGIN
    v_entitas_id := COALESCE((COALESCE(v_sesudah, v_sebelum) ->> 'id')::UUID, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_entitas_id := NULL;
  END;

  -- Nama yang ditampilkan di daftar log, mengikuti kolom yang dipakai tiap tabel.
  v_nama := COALESCE(
    v_sesudah ->> 'nama_produk', v_sebelum ->> 'nama_produk',
    v_sesudah ->> 'full_name',   v_sebelum ->> 'full_name',
    v_sesudah ->> 'invoice_number', v_sebelum ->> 'invoice_number',
    v_sesudah ->> 'name',         v_sebelum ->> 'name'
  );

  INSERT INTO audit_log (user_email, aksi, tabel, entitas_id, entitas_nama, data_sebelum, data_sesudah)
  VALUES (v_actor, v_aksi, TG_TABLE_NAME, v_entitas_id, v_nama, v_sebelum, v_sesudah);

  -- COALESCE(NEW, OLD) tidak bisa diandalkan untuk tipe record di PL/pgSQL,
  -- jadi dikembalikan eksplisit per operasi.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_products_trigger           ON products;
CREATE TRIGGER audit_products_trigger
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

DROP TRIGGER IF EXISTS audit_mitra_trigger              ON mitra;
CREATE TRIGGER audit_mitra_trigger
  AFTER INSERT OR UPDATE OR DELETE ON mitra
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

DROP TRIGGER IF EXISTS audit_categories_trigger         ON categories;
CREATE TRIGGER audit_categories_trigger
  AFTER INSERT OR UPDATE OR DELETE ON categories
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

DROP TRIGGER IF EXISTS audit_product_types_trigger      ON product_types;
CREATE TRIGGER audit_product_types_trigger
  AFTER INSERT OR UPDATE OR DELETE ON product_types
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

DROP TRIGGER IF EXISTS audit_mitra_settlements_trigger  ON mitra_settlements;
CREATE TRIGGER audit_mitra_settlements_trigger
  AFTER INSERT OR UPDATE OR DELETE ON mitra_settlements
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Lima kolom deleted_at sudah ada (harus 5):
--    SELECT COUNT(*) FROM information_schema.columns
--    WHERE table_schema='public' AND column_name='deleted_at';
--
-- 2. Lima trigger terpasang (harus 5):
--    SELECT COUNT(*) FROM pg_trigger WHERE tgname LIKE 'audit_%_trigger';
--
-- 3. Jejak audit masuk (jalankan sebelum & sesudah, harus naik 1):
--    SELECT COUNT(*) FROM audit_log;
--
-- 4. Jejak audit tidak bisa diubah (harus muncul error, ini memang hasil yang diinginkan):
--    UPDATE audit_log SET aksi = 'update' WHERE id = '<id>';
--    DELETE FROM audit_log WHERE id = '<id>';
--
-- 5. Soft delete tidak merusak uniqueness: dua produk aktif dengan SKU sama
--    harus ditolak, tapi SKU yang sama dengan produk terhapus harus boleh:
--    INSERT INTO products (nama_produk, sku, mitra_price, selling_price)
--    VALUES ('Uji Tabrakan', 'SKU-YANG-SAMA', 1000, 1500);  -- harus gagal
--    SELECT sku, deleted_at FROM products WHERE sku = 'SKU-YANG-SAMA';