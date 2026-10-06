-- Menambahkan kolom user_id ke stock_movements untuk audit trail
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- MASALAH:
-- Tabel stock_movements tidak memiliki kolom user_id, sehingga tidak bisa
-- melacak siapa yang mencatat pergerakan stok. Ini penting untuk audit trail.

-- ============================================================
-- (1) Tambah kolom user_id ke stock_movements
-- ============================================================

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_user_id ON stock_movements(user_id);

COMMENT ON COLUMN stock_movements.user_id IS 'ID user yang mencatat pergerakan stok ini';


-- ============================================================
-- (2) Update fungsi record_stock_movement untuk menerima user_id
-- ============================================================

DROP FUNCTION IF EXISTS record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION record_stock_movement(
  p_product_id UUID,
  p_type TEXT,
  p_qty INTEGER,
  p_note TEXT DEFAULT NULL,
  p_mitra_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
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
    -- Syarat pr.stock >= p_qty membuat pengurangan tidak bisa membuat stok
    -- negatif, dan mengunci baris sampai transaksi selesai.
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
    INSERT INTO stock_movements AS sm (product_id, type, quantity, note, mitra_id, reason, user_id)
    VALUES (p_product_id, p_type, p_qty, p_note, COALESCE(v_mitra, p_mitra_id), p_reason, p_user_id)
    RETURNING sm.id, v_stock, sm.type, sm.quantity, sm.product_id, sm.note, sm.mitra_id, sm.reason;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, UUID)
  TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Kolom user_id ada di stock_movements:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'stock_movements' AND column_name = 'user_id';
--
-- 2. Fungsi bisa dipanggil dengan 7 parameter:
--    SELECT record_stock_movement(
--      '<id produk>', 'out', 2, 'uji alasan', NULL, 'ditarik_mitra', '<user_id>');
--    Stok harus turun 2 dan pergerakan tercatat dengan user_id.
--
-- 2. Index dan kolom user_id terbuat:
--    SELECT * FROM pg_indexes WHERE tablename = 'stock_movements' AND indexname = 'idx_stock_movements_user_id';