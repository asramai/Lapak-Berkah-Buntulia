-- Snapshot harga modal (harga mitra) di level item transaksi
--
-- MASALAH YANG DISELESAIKAN:
-- Dulu laba dihitung dari products.mitra_price (harga mitra SEKARANG).
-- Kalau harga mitra berubah atau produk dihapus, seluruh laporan laba historis
-- ikut berubah retroactive - laporan untuk bulan lalu menjadi tidak benar.
--
-- SOLUSI:
-- Simpan harga mitra saat penjualan terjadi. Dari sini, laporan laba bersifat
-- historis dan stabil selamanya.
--
-- CARA PAKAI: jalankan file ini SATU KALI di Supabase SQL Editor.

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10,2);

COMMENT ON COLUMN transaction_items.cost_price IS
  'Snapshot harga mitra pada saat penjualan. Diisi otomatis oleh kasir.';

-- Backfill data lama memakai harga mitra saat ini.
-- Ini adalah PENAKSIRAN TERBAIK karena harga historis tidak pernah disimpan,
-- tapi jauh lebih baik daripada reports lama yang ikut berubah saat harga diedit.
UPDATE transaction_items ti
SET cost_price = p.mitra_price
FROM products p
WHERE p.id = ti.product_id
  AND ti.cost_price IS NULL;

-- Jaring pengaman: baris yang produknya sudah tidak ada (produk dihapus)
-- diberi 0, bukan NULL, supaya perhitungan tidak error saat runtime.
UPDATE transaction_items
SET cost_price = 0
WHERE cost_price IS NULL;

-- Verifikasi (opsional): pastikan tidak ada baris kosong
-- SELECT COUNT(*) AS masih_kosong FROM transaction_items WHERE cost_price IS NULL;