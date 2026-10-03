-- Perbaikan: record_stock_movement gagal dengan "column reference is ambiguous"
--
-- GEJALA:
--   POST /rest/v1/rpc/record_stock_movement
--   ERROR 42702: It could refer to either a PL/pgSQL variable or a table column.
--
-- PENYEBAB:
--   Fungsi mendeklarasikan RETURNS TABLE(id UUID, stock INTEGER, type TEXT, ...).
--   Setiap nama di situ menjadi variabel PL/pgSQL di dalam badan fungsi.
--
--   Di dalam badan ada:
--     UPDATE products
--     SET stock = stock - p_qty
--     WHERE id = p_product_id AND stock >= p_qty
--     RETURNING record_stock_movement.stock INTO v_stock;
--
--   PostgreSQL melihat "stock" dan tidak tahu yang dimaksud kolom products.stock
--   atau variabel output stock. Qualified dengan nama fungsi juga tidak
--   membantu, karena nama fungsi bukan nama tabel.
--
--   Perbaikan: pakai alias tabel di dalam UPDATE dan INSERT, lalu rujuk kolomnya
--   lewat alias itu. Alias tidak bentrok dengan variabel output.
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.
--
-- Catatan: fungsi yang sekarang terpasang tidak bisa dipakai sama sekali, jadi
-- tidak ada data yang jadi rusak karena file sebelumnya.


CREATE OR REPLACE FUNCTION record_stock_movement(
  p_product_id UUID,
  p_type TEXT,
  p_qty INTEGER,
  p_note TEXT DEFAULT NULL,
  p_mitra_id UUID DEFAULT NULL
)
RETURNS TABLE(id UUID, stock INTEGER, type TEXT, quantity INTEGER, product_id UUID, note TEXT, mitra_id UUID) AS $$
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

  -- Mitra barang diambil dari produk supaya stok keluar ikut tercatat ke mitra
  -- mana barang itu ditarik. Untuk produk basah, inilah yang menandai barang
  -- yang belum terjual dan ditarik kembali oleh mitra.
  SELECT pr.mitra_id INTO v_mitra FROM products AS pr WHERE pr.id = p_product_id;

  IF p_type = 'out' THEN
    -- Syarat pr.stock >= p_qty membuat pengurangan tidak bisa membuat stok
    -- negatif, dan mengunci baris sampai transaksi selesai, jadi dua
    -- pengurangan hampir bersamaan tidak bisa saling menimpa.
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

  -- INSERT dan UPDATE di atas sudah mengubah stok. Kalau baris ini gagal,
  -- seluruh transaksi dibatalkan karena keduanya dalam satu fungsi.
  RETURN QUERY
    INSERT INTO stock_movements AS sm (product_id, type, quantity, note, mitra_id)
    VALUES (p_product_id, p_type, p_qty, p_note, COALESCE(v_mitra, p_mitra_id))
    RETURNING sm.id, v_stock, sm.type, sm.quantity, sm.product_id, sm.note, sm.mitra_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID)
  TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Fungsi terpasang (harus 1):
--    SELECT proname FROM pg_proc WHERE proname = 'record_stock_movement';
--
-- 2. Ganti kolom type dan id supaya tidak sama lagi dengan variabel fungsi.
--    Kalau kolomnya sudah berbeda dari nama variabel, error 42702 tidak akan
--    muncul dan pesan ini tidak perlu dijalankan. Cek dulu:
--
--    SELECT proname FROM pg_proc WHERE proname = 'record_stock_movement';
--
-- 3. Uji nyata. Catat stok satu produk, lalu jalankan dari SQL Editor:
--
--    SELECT record_stock_movement(
--      '<id produk>', 'out', 2, 'uji tarik mitra', NULL);
--    Stok harus turun 2 dan fungsi harus mengembalikan baris berisi stok
--    terbaru. Kalau muncul ERROR 42702 lagi, kirim pesannya.
--
-- 4. Uji penolakan. Harus gagal dengan "Stok tidak cukup", dan tidak boleh ada
--    pergerakan yang tersimpan:
--
--    SELECT record_stock_movement(
--      '<id produk>', 'out', 999999, 'uji harus gagal', NULL);
--
--    SELECT COUNT(*) FROM stock_movements WHERE note = 'uji harus gagal';
--    Harus 0.
--
-- 5. Kembalikan stok seperti semula:
--
--    SELECT record_stock_movement(
--      '<id produk>', 'in', 2, 'uji kembalikan', NULL);
--
-- 6. Bersihkan catatan uji dari Dashboard Supabase kalau tidak ingin ganggu
--    riwayat stok.