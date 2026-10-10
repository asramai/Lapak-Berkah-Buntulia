-- Pasang ulang fungsi record_stock_movement (7 parameter)
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- MASALAH YANG DISELESAIKAN:
-- Menu Manajemen Stok dan Mitra Dashboard memanggil
-- POST /rpc/record_stock_movement dengan 7 parameter
-- (p_product_id, p_type, p_qty, p_note, p_mitra_id,
-- p_reason, p_user_id), tapi fungsinya tidak ada di
-- database sehingga setiap penambahan stok gagal 404.
--
-- Fungsi ini menambah/mengurangi stok SEKALIGUS mencatat
-- pergerakannya dalam satu transaksi. Kalau salah satu
-- gagal, keduanya batal. Stok keluar tidak bisa membuat
-- stok negatif karena syarat pr.stock >= p_qty.
--
-- Versi ini adalah gabungan final dari:
-- - add-stock-out-reason.sql (kolom reason, p_reason)
-- - add-user-id-to-stock-movements.sql (kolom user_id, p_user_id)

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS reason TEXT;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS stock_movements_reason_idx
  ON stock_movements (type, reason)
  WHERE type = 'out';

CREATE INDEX IF NOT EXISTS idx_stock_movements_user_id ON stock_movements(user_id);

COMMENT ON COLUMN stock_movements.reason IS
  'Alasan stok keluar: ditarik_mitra, rusak, kedaluwarsa, hilang, atau adjustment. Kosong berarti belum dikategorikan.';
COMMENT ON COLUMN stock_movements.user_id IS 'ID user yang mencatat pergerakan stok ini';

-- Tanda tangan berubah dari waktu ke waktu, jadi versi lama
-- harus dihapus lebih dulu. Kalau tidak, keduanya hidup
-- berdampingan dan PostgREST memakai yang lama.
DROP FUNCTION IF EXISTS record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID, TEXT);
DROP FUNCTION IF EXISTS record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID);

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

  -- Stok keluar wajib punya alasan. Tanpa itu, Owner tidak bisa
  -- membedakan barang ditarik mitra, rusak, kedaluwarsa, atau hilang.
  IF p_type = 'out' AND (p_reason IS NULL OR p_reason = '') THEN
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
-- 1. Fungsi terpasang (harus 1 baris, 7 argumen):
--    SELECT proname, pronargs FROM pg_proc
--    WHERE proname = 'record_stock_movement';
--
-- 2. Kolom pendukung ada:
--    SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'stock_movements'
--      AND column_name IN ('reason', 'user_id');
--
-- 3. Uji nyata (ganti <id produk> dan <user id>):
--    SELECT * FROM record_stock_movement(
--      '<id produk>', 'in', 2, 'uji stok masuk', NULL, NULL, '<user id>');
--    Stok naik 2. Setelah itu kembalikan:
--    SELECT * FROM record_stock_movement(
--      '<id produk>', 'out', 2, 'uji kembalikan', NULL, 'adjustment', '<user id>');
--
-- 4. Stok keluar tanpa alasan harus DITOLAK:
--    SELECT * FROM record_stock_movement(
--      '<id produk>', 'out', 1, NULL, NULL, NULL, NULL);
--    Harus gagal dengan "Stok keluar harus punya alasan".
--
-- 5. Bersihkan baris uji dari Dashboard Supabase:
--    stock_movements dengan note LIKE 'uji %'.
