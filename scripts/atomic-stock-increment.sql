-- Atomic stock increment RPC
-- Dipakai saat retur barang. Melengkapi decrement_product_stock di atomic-stock-decrement.sql.
--
-- PENTING: jalankan migration ini di Supabase SQL Editor SEBELUM memakai fitur retur.
-- Tanpa fungsi ini, retur tidak bisa mengembalikan stok dengan aman.
--
-- Mengapa perlu fungsi ini (bukan update dari frontend):
-- Read-then-write dari browser (baca stok, tambah qty, tulis balik) rawan race condition.
-- Dua retur yang bersamaan bisa saling menimpa dan membuat stok hilang.
-- UPDATE ... SET stock = stock + p_qty dikerjakan oleh database dalam satu transaksi,
-- jadi tidak ada celah untuk dua request saling menimpa.

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