-- Pergerakan stok dan perubahan stok dalam satu transaksi
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.
--
-- MASALAH YANG DISELESAIKAN:
-- Halaman stok dan Mitra Dashboard menulis pergerakan stok lebih dulu, baru
-- mengubah stok produk, lewat dua permintaan terpisah. Kalau langkah kedua
-- gagal, langkah pertama sudah terlanjur tersimpan. Untuk stok keluar yang
-- melebihi stok, hasilnya riwayat pergerakan Movement menyatakan barang keluar
-- padahal stoknya tidak pernah berkurang.
--
-- Fungsi di bawah melakukan keduanya dalam satu transaksi database. Kalau satu
-- bagian gagal, keduanya batal.
--
-- CATATAN SOAL STOK KELUAR:
-- Stok keluar di menu Manajemen Stok berarti mitra menarik barang yang belum
-- terjual, misalnya produk basah yang sudah tidak layak. Ini BUKAN penjualan,
-- jadi sengaja tidak membuat baris di tabel transactions: Laporan Penjualan
-- tidak berubah karena barang ditarik bukan karena terjual.
-- Fungsi ini menerima p_mitra_id supaya barang yang ditarik tetap bisa
-- ditelusuri ke mitramana.


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
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Jumlah harus lebih besar dari nol';
  END IF;
  IF p_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Jenis harus in atau out';
  END IF;

  -- Stok masuk selalu mengikuti mitra barang. Stok keluar juga, supaya barang
  -- yang ditarik mitra bisa ditelusuri; parameter ini boleh kosong kalau
  -- memang tidak diketahui.
  v_mitra := COALESCE(p_mitra_id, (SELECT p.mitra_id FROM products p WHERE p.id = p_product_id));

  IF p_type = 'out' THEN
    -- Syarat stock >= p_qty membuat pengurangan tidak bisa membuat stok
    -- negatif, dan tidak ada celah untuk dua pengurangan saling menimpa.
    UPDATE products
    SET stock = stock - p_qty
    WHERE id = p_product_id AND stock >= p_qty
    RETURNING record_stock_movement.stock INTO v_stock;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stok tidak cukup. Tersedia %, diminta %',
        (SELECT p.stock FROM products p WHERE p.id = p_product_id), p_qty;
    END IF;
  ELSE
    UPDATE products
    SET stock = stock + p_qty
    WHERE id = p_product_id
    RETURNING record_stock_movement.stock INTO v_stock;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk tidak ditemukan';
    END IF;
  END IF;

  RETURN QUERY
    INSERT INTO stock_movements (product_id, type, quantity, note, mitra_id)
    VALUES (p_product_id, p_type, p_qty, p_note, v_mitra)
    RETURNING stock_movements.id, v_stock, stock_movements.type,
              stock_movements.quantity, stock_movements.product_id,
              stock_movements.note, stock_movements.mitra_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp;

GRANT EXECUTE ON FUNCTION record_stock_movement(UUID, TEXT, INTEGER, TEXT, UUID)
  TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Fungsi ada (harus 1):
--    SELECT proname FROM pg_proc WHERE proname = 'record_stock_movement';
--
-- 2. Stok keluar melebihi stok harus DITOLAK, dan tidak boleh ada pergerakan
--    yang tersimpan. Catat stok produk dulu, lalu jalankan dari SQL Editor:
--    SELECT record_stock_movement(
--      '<id produk>', 'out', 999999, 'uji stok kurang', NULL);
--    Harus gagal dengan "Stok tidak cukup". Setelah itu cek:
--    SELECT stock FROM products WHERE id = '<id produk>';
--    SELECT COUNT(*) FROM stock_movements
--    WHERE note = 'uji stok kurang';
--    Keduanya harus tidak berubah dan 0. Inilah yang membedakan perbaikan ini
--    dari kode lama, yang pergerakan stoknya sudah tertulis lebih dulu.
--
-- 3. Stok masuk harus menambah dan mencatat.:
--    SELECT record_stock_movement(
--      '<id produk>', 'in', 5, 'uji stok masuk', NULL);
--    Stok naik 5 dan muncul satu pergerakan. Bersihkan catatan 'uji stok
--    masuk' dari Dashboard Supabase kalau tidak ingin ganggu.