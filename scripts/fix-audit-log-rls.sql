-- Perbaikan: audit_log menolak semua operasi karena RLS aktif tanpa policy
--
-- GEJALA:
--   INSERT atau UPDATE ke produk, mitra, dan invoice gagal dengan:
--   {"code":"42501","message":"new row violates row-level security policy
--    for table \"audit_log\""}
--
--   Penyebabnya: tabel audit_log punya RLS aktif, tapi tidak ada satu pun
--   policy. Di PostgreSQL, RLS aktif tanpa policy berarti SEMUA akses ditolak,
--   dan itu berlaku juga untuk trigger. Addendum GRANT di file pertama tidak
--   cukup, karena GRANT memberi hak akses, sedangkan RLS yang menutupnya.
--
--   Dampaknya: setiap INSERT/UPDATE ke produk, mitra, dan invoice yang
--   mengubah kolom selain stok gagal. Penjualan di kasir tetap jalan karena
--   trigger lebih dulu mengembalikan diri untuk perubahan yang hanya menyentuh
--   stok (kolom itu sudah punya jejaknya sendiri di stock_movements).
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- CARA KERJA:
-- RLS di audit_log hanya mengizinkan SELECT. Tidak ada policy untuk INSERT,
-- sehingga aplikasi dan siapa pun yang memegang anon key tidak bisa menulis,
-- memalsukan, atau menghapus entri log. Penulisan hanya bisa dilakukan oleh
-- trigger, yang diubah menjadi SECURITY DEFINER supaya berjalan dengan hak
-- pemilik tabel, bukan hak pemanggilnya.


-- ============================================================
-- (1) RLS hanya mengizinkan baca
-- ============================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_baca" ON audit_log;
CREATE POLICY "audit_log_baca" ON audit_log
  FOR SELECT TO anon, authenticated
  USING (true);

-- Sengaja TIDAK ada policy INSERT, UPDATE, atau DELETE. Tanpa policy, ketiga
-- operasi itu otomatis ditolak oleh RLS. Ini yang membuat jejak audit tidak
-- bisa dipalsukan atau dirapikan dari sisi aplikasi.

-- Hak akses dan RLS sengaja ditumpuk: revoke menutup jalan yang biasa, RLS
-- menutup jalur yang tidak tertutup revoke. SECURITY DEFINER di bawah membuat
-- trigger tetap bisa menulis lewat keduanya.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM PUBLIC;
GRANT SELECT ON audit_log TO anon, authenticated;


-- ============================================================
-- (2) Trigger ditulis SECURITY DEFINER
-- ============================================================
-- Fungsi ini dijalankan dengan hak pemilik tabel (postgres), bukan hak role
-- pemanggil, jadi RLS dan hak akses pemanggil tidak berlaku untuk INSERT ke
-- audit_log. search_path dikunci supaya fungsi ini tidak bisa dialihkan ke
-- skema lain oleh siapa pun yang bisa membuat objek dengan nama yang sama.

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

    -- Hanya kolom stok yang berubah: sudah tercatat di stock_movements, jadi
    -- tidak perlu masuk audit_log. Perubahan modal/harga hasil koreksi tetap
    -- masuk, karena itu keputusan bisnis yang perlu diaudit.
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
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Hanya policy SELECT yang ada. returned 1 = benar (harus 1):
--    SELECT COUNT(*) FROM pg_policies WHERE tablename = 'audit_log';
--
-- 2. Jejak audit masuk. Ubah satu produk di aplikasi, lalu jalankan. Nilai
--    harus naik:
--    SELECT COUNT(*) FROM audit_log;
--
-- 3. Entri log tidak bisa dipalsukan. Dua query ini HARUS gagal dengan
--    error 42501, itu memang hasil yang diinginkan:
--    INSERT INTO audit_log (aksi, tabel) VALUES ('update', 'products');
--    UPDATE audit_log SET aksi = 'update';
--    DELETE FROM audit_log;
--
-- 4. Menulis produk tetap bisa. Jalankan dari aplikasi, bukan dari sini:
--    ubah harga satu produk, lalu pastikan masuk daftar "Ubah" di menu Audit Log.