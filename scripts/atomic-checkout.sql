-- Checkout atomik
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten, aman dijalankan berulang kali.
--
-- MASALAH YANG DISELESAIKAN:
-- Checkout sebelumnya berjalan di empat langkah terpisah dari peramban:
--   1. tulis header transaksi
--   2. tulis item transaksi
--   3. catat pergerakan stok
--   4. kurangi stok tiap produk
--
-- Kalau langkah 3 atau 4 gagal, langkah 1 dan 2 sudah terlanjur tersimpan.
-- Hasilnya ada transaksi menggantung tanpa item, dengan stok yang tidak
-- berkurang. Pada tombol hapus dari Audit Log, ini persis yang hampir terjadi
-- dan hanya tertangkap karena kebetulan.
--
-- SOLUSI:
-- Satu fungsi database yang menjalankan semuanya dalam satu transaksi
-- PostgreSQL. Kalau ada satu bagian yang gagal, semuanya dibatalkan bersama
-- dan tidak ada yang tersisa.
--
-- Yang juga diperbaiki: pemeriksaan stok dilakukan untuk SEMUA item sebelum
-- satu baris pun ditulis, dan baris produk dikunci dengan FOR UPDATE. Jadi
-- dua kasir yang menjual produk terakhir di detik yang sama tidak bisa
-- sama-sama berhasil.
--
-- CATATAN:
-- cancel_pending_transaction sengaja TIDAK diubah di file ini. Fungsi itu sudah
-- berjalan sebagai satu transaksi database, jadi tidak ada masalah atomicity
-- di sana. Masalah pembatalan sebagian ada di alur retur peramban, bukan di
-- fungsi itu.


-- ============================================================
-- Fungsi checkout
-- ============================================================
-- Sengaja TIDAK memakai SECURITY DEFINER. Atomicitas berasal dari fungsi ini
-- dijalankan sebagai satu transaksi PostgreSQL, bukan dari hak khusus. Dengan
-- SECURITY INVOKER (bawaan), RLS tetap berlaku di dalam fungsi, jadi fungsi ini
-- tidak bisa dipakai untuk melewati aturan RLS yang sudah dipasang.

CREATE OR REPLACE FUNCTION create_pos_transaction(
  p_header JSONB,
  p_items JSONB
)
RETURNS UUID AS $$
DECLARE
  v_tx_id UUID;
  v_item JSONB;
  v_product UUID;
  v_qty INTEGER;
  v_sisa INTEGER;
  v_nama TEXT;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang masih kosong';
  END IF;

  -- Tahap 1: periksa stok semua item dulu. Belum ada satu baris pun ditulis,
  -- jadi kalau ada satu produk yang kurang, tidak ada sisa penulisan sama sekali.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product := (v_item ->> 'product_id')::UUID;
    v_qty := (v_item ->> 'quantity')::INTEGER;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Jumlah item tidak valid';
    END IF;

    -- FOR UPDATE mengunci baris produk sampai transaksi selesai, jadi stok yang
    -- dicek di sini tidak bisa berubah di tengah jalan oleh kasir lain.
    SELECT p.stock, p.nama_produk INTO v_sisa, v_nama
    FROM products p
    WHERE p.id = v_product
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk tidak ditemukan';
    END IF;

    IF v_sisa < v_qty THEN
      RAISE EXCEPTION 'Stok "%" tidak cukup: tersedia %, diminta %', v_nama, v_sisa, v_qty;
    END IF;
  END LOOP;

  -- Tahap 2: header transaksi. Status dipaksa trigger menjadi Pending, jadi tidak
  -- ada jalur membuat transaksi yang langsung berstatus lunat.
  INSERT INTO transactions (user_id, mitra_id, total, metode_pembayaran, payment_expires_at)
  VALUES (
    NULLIF(p_header ->> 'user_id', '')::UUID,
    NULLIF(p_header ->> 'mitra_id', '')::UUID,
    (p_header ->> 'total')::NUMERIC,
    p_header ->> 'metode_pembayaran',
    NULLIF(p_header ->> 'payment_expires_at', '')::TIMESTAMPTZ
  )
  RETURNING id INTO v_tx_id;

  -- Tahap 3: item, pergerakan stok, dan pengurangan stok. Kunci baris produk
  -- sudah dipegang dari Tahap 1, jadi di sini aman.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product := (v_item ->> 'product_id')::UUID;
    v_qty := (v_item ->> 'quantity')::INTEGER;

    INSERT INTO transaction_items (transaction_id, product_id, quantity, harga_satuan, cost_price, subtotal)
    VALUES (
      v_tx_id,
      v_product,
      v_qty,
      (v_item ->> 'harga_satuan')::NUMERIC,
      NULLIF(v_item ->> 'cost_price', '')::NUMERIC,
      (v_item ->> 'subtotal')::NUMERIC
    );

    INSERT INTO stock_movements (product_id, type, quantity, note, mitra_id)
    VALUES (
      v_product,
      'out',
      v_qty,
      'Transaksi #' || right(v_tx_id::TEXT, 2),
      NULLIF(p_header ->> 'mitra_id', '')::UUID
    );

    UPDATE products SET stock = stock - v_qty WHERE id = v_product;
  END LOOP;

  RETURN v_tx_id;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION create_pos_transaction(JSONB, JSONB) TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Fungsi ada (harus 1):
--    SELECT proname FROM pg_proc WHERE proname = 'create_pos_transaction';
--
-- 2. Fungsi cancel_pending_transaction tidak berubah, signature-nya tetap dua
--    parameter (harus 1):
--    SELECT proname FROM pg_proc
--    WHERE proname = 'cancel_pending_transaction' AND pronargs = 2;
--
-- 3. Checkout benar-benar atomik. Cari satu produk, catat stoknya, lalu
--    panggil dari SQL Editor:
--    SELECT create_pos_transaction(
--      '{"total": 1000, "metode_pembayaran": "Tunai"}'::jsonb,
--      '[{"product_id": "<id produk>", "quantity": 1,
--         "harga_satuan": 1000, "cost_price": 800, "subtotal": 1000}]'::jsonb);
--    Stok harus berkurang 1, dan harus ada tepat satu transaksi_items baru.
--
-- 4. Stok kurang harus menolak SEBELUM menulis apa pun. Panggil dengan quantity
--    yang jauh lebih besar dari stoknya:
--    SELECT create_pos_transaction(
--      '{"total": 999999, "metode_pembayaran": "Tunai"}'::jsonb,
--      '[{"product_id": "<id produk>", "quantity": 9999,
--         "harga_satuan": 1000, "cost_price": 800, "subtotal": 999999}]'::jsonb);
--    Harus gagal dengan pesan "tidak cukup". Setelah itu, pastikan tidak ada
--    transaksi baru yang tersimpan dan stok tidak berubah. Ini yang membedakan
--    checkout atomik dari yang lama.
--
-- 5. Bersihkan transaksi uji dari Dashboard Supabase, karena fungsi ini tidak
--    menyediakan penghapusan dan tabel transactions tidak boleh dihapus dari
--    peramban.
--
-- 6. Login masih jalan. Coba masuk dari aplikasi dengan akun yang ada.