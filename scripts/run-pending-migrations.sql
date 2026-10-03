-- Migration yang masih tertunda di Supabase
--
-- CARA PAKAI: buka Supabase -> SQL Editor -> New query -> tempel SELURUH file ini -> Run.
-- Aman dijalankan berulang kali, semua memakai IF NOT EXISTS / OR REPLACE.
--
-- STATUS SAAT INI (diverifikasi lewat REST API, 3 Oktober 2026):
--   1. transaction_items.cost_price  -> BELUM ADA (error 42703)
--   2. increment_product_stock        -> BELUM ADA (error PGRST202)
--   3. decrement_product_stock        -> SUDAH ADA (HTTP 200)
--
-- DAMPA KALAU BELUM DIJALANKAN:
--   (1) Kasir gagal menyimpan penjualan. `transactionService.create` sudah
--       lebih dulu menulis header transaksi, jadi penjualan yang gagal
--       menyisakan transaksi tanpa item. Laporan laba untuk transaksi itu nol.
--   (2) Retur barang gagal mengembalikan stok karena RPC-nya tidak ada.
--
-- Urutan: (1) dulu, karena tanpa snapshot modal seluruh laporan laba historis
-- tidak bisa dipercaya.


-- ============================================================
-- (1) Snapshot harga modal (harga mitra) di level item transaksi
-- ============================================================
-- Laba historis harus stabil. Kalau laba dihitung dari products.mitra_price
-- (harga mitra SEKARANG), setiap kali harga mitra diedit atau produk dihapus,
-- seluruh laporan laba bulan lalu ikut berubah retroactive.

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2);

COMMENT ON COLUMN transaction_items.cost_price IS
  'Snapshot harga mitra pada saat penjualan. Diisi otomatis oleh kasir.';

-- Backfill data lama memakai harga mitra saat ini. Ini penaksiran terbaik:
-- harga historis memang tidak pernah disimpan, tapi jauh lebih baik daripada
-- laporan lama yang ikut berubah setiap kali harga diedit.
UPDATE transaction_items ti
SET cost_price = p.mitra_price
FROM products p
WHERE p.id = ti.product_id
  AND ti.cost_price IS NULL;

-- Baris yang produknya sudah dihapus diberi 0, bukan NULL, supaya
-- perhitungan tidak error saat runtime.
UPDATE transaction_items
SET cost_price = 0
WHERE cost_price IS NULL;


-- ============================================================
-- (2) RPC pengembalian stok saat retur
-- ============================================================
-- Read-then-write dari browser (baca stok, tambah, tulis balik) rawan race
-- condition: dua retur bersamaan bisa saling menimpa dan membuat stok hilang.
-- UPDATE ... SET stock = stock + p_qty dikerjakan database dalam satu
-- transaksi, jadi tidak ada celah untuk dua request saling menimpa.

CREATE OR REPLACE FUNCTION increment_product_stock(
  p_product_id UUID,
  p_qty INTEGER
)
RETURNS INTEGER AS $$
DECLARE
  new_stock INTEGER;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN NULL;
  END IF;

  UPDATE products
  SET stock = stock + p_qty
  WHERE id = p_product_id
  RETURNING stock INTO new_stock;

  RETURN new_stock;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- Jalankan tiga query ini setelah Run. Semua harus mengembalikan 0.
--
-- 1. Sisa baris tanpa cost_price (harus 0):
--    SELECT COUNT(*) AS masih_kosong
--    FROM transaction_items WHERE cost_price IS NULL;
--
-- 2. Kolom sudah ada (harus 1):
--    SELECT COUNT(*) AS kolom_ada
--    FROM information_schema.columns
--    WHERE table_name = 'transaction_items' AND column_name = 'cost_price';
--
-- 3. Fungsi retur sudah ada (harus 1):
--    SELECT COUNT(*) AS fungsi_ada
--    FROM pg_proc
--    WHERE proname IN ('increment_product_stock', 'decrement_product_stock');