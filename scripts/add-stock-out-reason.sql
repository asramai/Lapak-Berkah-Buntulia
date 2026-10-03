-- Alur stok keluar oleh mitra, dan alasan penarikan barang
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.
--
-- KEBUTUHAN:
-- Produk di lapak ini sebagian besar makanan basah yang tidak bertahan lama.
-- Kalau ada sisa yang tidak layak, mitra menariknya kembali. Selama ini tidak
-- ada jalan untuk itu:
--
-- 1. pending_stock_validations tidak punya kolom jenis, jadi pengajuan mitra
--    selalu berarti stok masuk. Mitra tidak bisa mengajukan barang ditarik.
-- 2. stock_movements tidak punya kolom alasan, jadi tidak bisa dibedakan antara
--    barang yang ditarik mitra, barang rusak, dan barang kedaluwarsa.
--    Ketiganya berbeda secara bisnis dan Owner perlu tahu mana yang berapa.
--
-- Yang ditambahkan:
-- - pending_stock_validations.type, agar pengajuan bisa masuk atau keluar
-- - pending_stock_validations.reason, alasan barang ditarik
-- - stock_movements.reason, alasan pergerakan stok keluar
--
-- Stok keluar yang sudah tercatat tetap dianggap beralasan 'lainnya', supaya
-- angka lama tidak ikut berubah.


-- ============================================================
-- (1) Jenis dan alasan pada pengajuan
-- ============================================================

ALTER TABLE pending_stock_validations
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'in',
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Constraint type perlu constraint sendiri supaya nilai yang tidak dikenal
-- ditolak database, bukan hanya oleh form.
ALTER TABLE pending_stock_validations
  DROP CONSTRAINT IF EXISTS pending_stock_validations_type_check;

ALTER TABLE pending_stock_validations
  ADD CONSTRAINT pending_stock_validations_type_check CHECK (type IN ('in', 'out'));

COMMENT ON COLUMN pending_stock_validations.type IS
  'in = barang masuk, out = barang ditarik mitra. Default in agar pengajuan lama tidak berubah.';
COMMENT ON COLUMN pending_stock_validations.reason IS
  'Alasan barang ditarik. Hanya dipakai untuk type out.';


-- ============================================================
-- (2) Alasan pada pergerakan stok
-- ============================================================

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS reason TEXT;

CREATE INDEX IF NOT EXISTS stock_movements_reason_idx
  ON stock_movements (type, reason)
  WHERE type = 'out';

COMMENT ON COLUMN stock_movements.reason IS
  'Alasan stok keluar: ditarik_mitra, rusak, kedaluwarsa, hilang, atau adjustment. Kosong berarti belum dikategorikan.';


-- ============================================================
-- (3) Kembalikan fungsi pergerakan agar menerima alasan
-- ============================================================
-- Tanda tangan berubah, jadi versi lama harus dihapus lebih dulu. Kalau tidak,
-- keduanya hidup berdampingan dan PostgREST memakai yang lama.

DROP FUNCTION IF EXISTS record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID);

CREATE OR REPLACE FUNCTION record_stock_movement(
  p_product_id UUID,
  p_type TEXT,
  p_qty INTEGER,
  p_note TEXT DEFAULT NULL,
  p_mitra_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  stock INTEGER,
  type TEXT,
  quantity INTEGER,
  product_id UUID,
  note TEXT,
  mitra_id UUID,
  reason TEXT
) AS $$
DECLARE
  v_stock INTEGER;
  v_mitra UUID;
  v_tersedia INTEGER;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Jumlah harus lebih besar dari nol';
  END IF;
  IF p_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Jenis harus in atau out';
  END IF;

  -- Stok keluar wajib punya alasan. Tanpa itu, Owner tidak bisa membedakan
  -- barang yang ditarik mitra dengan barang yang rusak atau hilang, padahal
  -- ketiganya tercatat berbeda di laporan ke mitra.
  IF p_type = 'out' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'Stok keluar harus punya alasan';
  END IF;

  -- Mitra barang diambil dari produk supaya stok keluar ikut tercatat ke mitra
  -- mana barang itu ditarik.
  SELECT pr.mitra_id INTO v_mitra FROM products AS pr WHERE pr.id = p_product_id;

  IF p_type = 'out' THEN
    UPDATE products AS pr
    SET stock = pr.stock - p_qty
    WHERE pr.id = p_product_id AND pr.stock >= p_qty
    RETURNING pr.stock INTO v_stock;

    IF NOT FOUND THEN
      SELECT pr.stock INTO v_tersedia FROM products AS pr WHERE pr.id = p_product_id;
      IF v_tersedia IS NULL THEN
        RAISE EXCEPTION 'Produk tidak ditemukan';
      END IF;
      RAISE EXCEPTION 'Stok tidak cukup. Tersedia %, diminta %', v_tersedia, p_qty;
    END IF;
  ELSE
    UPDATE products AS pr
    SET stock = pr.stock + p_qty
    WHERE pr.id = p_product_id
    RETURNING pr.stock INTO v_stock;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk tidak ditemukan';
    END IF;
  END IF;

  RETURN QUERY
    INSERT INTO stock_movements AS sm (product_id, type, quantity, note, mitra_id, reason)
    VALUES (p_product_id, p_type, p_qty, p_note, COALESCE(v_mitra, p_mitra_id), p_reason)
    RETURNING sm.id, v_stock, sm.type, sm.quantity, sm.product_id, sm.note, sm.mitra_id, sm.reason;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID, TEXT)
  TO anon, authenticated;


-- ============================================================
-- (4) Backfill alasan untuk pergerakan lama
-- ============================================================
-- Pergerakan lama tidak punya alasan. Diberi 'lainnya' supaya laporan bisa
-- menghitung semua stok keluar tanpa ada yang luput, dan supaya jelas bedanya
-- dari alasan yang diisi sengaja.

UPDATE stock_movements SET reason = 'lainnya' WHERE reason IS NULL;

-- Pergerakan yang berasal dari penjualan di kasir sebenarnya bukan penarikan
-- barang. Ditandai 'penjualan' supaya tidak tercampur dengan barang ditarik.
UPDATE stock_movements
SET reason = 'penjualan'
WHERE type = 'out'
  AND reason = 'lainnya'
  AND (note LIKE 'Transaksi #%' OR note LIKE 'Retur #%');


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Tiga kolom baru ada (harus 3):
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name IN ('stock_movements','pending_stock_validations')
--      AND column_name IN ('type','reason');
--
-- 2. Stok keluar tanpa alasan harus DITOLAK:
--    SELECT record_stock_movement(
--      '<id produk>', 'out', 1, NULL, NULL, NULL);
--    Harus gagal dengan "Stok keluar harus punya alasan".
--
-- 3. Stok keluar dengan alasan berhasil. Catat stok dulu:
--    SELECT record_stock_movement(
--      '<id produk>', 'out', 2, 'uji alasan ditarik mitra', NULL, 'ditarik_mitra');
--    Stok turun 2. Setelah itu kembalikan:
--    SELECT record_stock_movement(
--      '<id produk>', 'in', 2, 'uji kembalikan', NULL, NULL);
--
-- 4. Pengajuan mitra bisa menyimpan jenis keluar:
--    SELECT type FROM pending_stock_validations LIMIT 3;
--    Semua harus 'in', karena pengajuan lama default-nya begitu.
--
-- 5. Bersihkan baris uji dari Dashboard Supabase: stock_movements dengan
--    note LIKE 'uji %'.