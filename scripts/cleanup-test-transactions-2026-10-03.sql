-- Bersihkan data uji 3 Oktober 2026
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel SELURUH file ini.
-- Jalankan dalam DUA TAHAP. Jangan langsung menekan Run untuk bagian kedua.
--
-- TAHAP 1: jalankan seluruh bagian "LIHAT DULU". Periksa hasilnya. Kalau ada
--          transaksi yang bukan hasil uji coba, STOP dan jangan lanjut.
-- TAHAP 2: baru jalankan bagian "HAPUS".
--
-- KENAPA HARUS DI SQL EDITER:
--   Tabel transactions, transaction_items, stock_movements, users, dan mitra
--   tidak punya policy DELETE untuk role anon, dan memang sengaja begitu.
--   Penghapusan hanya bisa dilakukan oleh pemilik tabel, yaitu akun postgres
--   yang dipakai SQL Editor. Ini bukan error, memang supaya begitu.
--
-- APA SAJA YANG DIHAPUS:
--   - 18 transaksi uji tanggal 3 Oktober 2026 beserta itemnya (otomatis
--     ikut terhapus lewat ON DELETE CASCADE)
--   - 31 pergerakan stok tanggal 3 Oktober 2026
--   - 1 keranjang tertahan dari uji coba
--   - mitra uji "Asram" beserta akun loginnya
--
-- APA YANG TIDAK DIUBAH:
--   - Stok dikembalikan HANYA dari transaksi berstatus Selesai. Transaksi
--     Dibatalkan sudah mengembalikan stoknya sendiri lewat pembatalan, jadi
--     menghitungnya lagi akan menambah stok dua kali.
--   - 61 transaksi asli sebelum 3 Oktober tidak tersentuh.
--   - Harga produk tidak diubah. Satu produk sempat diubah saat menguji
--     Audit Log, tapi sudah dikembalikan ke nilai semula.


-- ============================================================
-- TAHAP 1: LIHAT DULU
-- ============================================================

-- (1) Transaksi yang akan terhapus. Harus 18, semuanya uji coba.
SELECT id, created_at, status, metode_pembayaran, total,
       1 ASTransactions_yang_akan_terhapus
FROM transactions
WHERE created_at >= '2026-10-03'
ORDER BY created_at;

-- (2) Rincian per status. Total harus 18: 3 Selesai dan 15 Dibatalkan.
SELECT status, COUNT(*) AS jumlah, SUM(total) AS nominal
FROM transactions
WHERE created_at >= '2026-10-03'
GROUP BY status;

-- (3) Stok yang akan dikembalikan, dihitung dari transaksi Selesai saja.
--     Bandingkan dengan catatan yang sudah dikonfirmasi:
--       Es mambo yoni (LBB-106) : +2  -> stok 63 jadi 65
--       Mabel sri   (LBB-100) : +1  -> stok  1 jadi  2
SELECT p.nama_produk, p.sku, p.stok AS stok_sekarang,
       SUM(ti.quantity) AS akan_kembali, p.stock + SUM(ti.quantity) AS stok_akhir
FROM transaction_items ti
JOIN transactions t  ON t.id = ti.transaction_id
JOIN products p      ON p.id = ti.product_id
WHERE t.created_at >= '2026-10-03'
  AND t.status = 'Selesai'
GROUP BY p.id, p.nama_produk, p.sku, p.stok
ORDER BY p.nama_produk;

-- (4) Mitra dan akun yang akan terhapus.
SELECT m.id, m.full_name, m.email, m.created_at, u.nama AS nama_akun
FROM mitra m
LEFT JOIN users u ON u.email = m.email
WHERE m.email IN ('asram@gmail.com');

-- (5) Transaksi asli yang harus tetap aman. Harus 61, semuanya sebelum 3 Oktober.
SELECT COUNT(*) AS transaksi_asli FROM transactions WHERE created_at < '2026-10-03';


-- ============================================================
-- TAHAP 2: HAPUS
-- ============================================================
-- Jalankan seluruh blok di bawah HANYA kalau hasil TAHAP 1 sudah sesuai.


-- (2a) Kembalikan stok dari transaksi uji yang berstatus Selesai.
--      Dihitung dari transaction_items supaya angkanya pasti benar.
WITH harus_kembali AS (
  SELECT ti.product_id, SUM(ti.quantity) AS qty
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti.transaction_id
  WHERE t.created_at >= '2026-10-03'
    AND t.status = 'Selesai'
  GROUP BY ti.product_id
)
UPDATE products p
SET stock = p.stock + harus_kembali.qty
FROM harus_kembali
WHERE p.id = harus_kembali.product_id;

-- (2b) Hapus transaksi uji. transaction_items ikut terhapus otomatis karena
--      kolomnya memakai ON DELETE CASCADE.
DELETE FROM transactions WHERE created_at >= '2026-10-03';

-- (2c) Hapus pergerakan stok dari pengujian supaya riwayat stok bersih.
DELETE FROM stock_movements WHERE created_at >= '2026-10-03';

-- (2d) Hapus keranjang tertahan dari uji coba.
DELETE FROM held_transactions;

-- (2e) Hapus akun login mitra uji, lalu mitra-nya.
--      Akun dihapus lebih dulu supaya tidak ada akun yatim.
DELETE FROM users WHERE email = 'asram@gmail.com';
DELETE FROM mitra  WHERE email = 'asram@gmail.com';


-- ============================================================
-- TAHAP 3: VERIFIKASI
-- ============================================================
-- Semua angka di sini harus sesuai dengan catatan di TAHAP 1.

-- (1) Transaksi. Harus 61, semuanya Selesai, semua sebelum 3 Oktober.
SELECT COUNT(*) AS total, MAX(created_at) AS transaksi_terakhir,
       MIN(created_at) AS transaksi_pertama
FROM transactions;

-- (2) Sisa data uji. Harus 0 untuk semua.
SELECT
  (SELECT COUNT(*) FROM transactions WHERE created_at >= '2026-10-03') AS sisa_transaksi,
  (SELECT COUNT(*) FROM transaction_items ti
     JOIN transactions t ON t.id = ti.transaction_id
     WHERE t.created_at >= '2026-10-03')                             AS sisa_item,
  (SELECT COUNT(*) FROM stock_movements WHERE created_at >= '2026-10-03') AS sisa_pergerakan,
  (SELECT COUNT(*) FROM held_transactions)                             AS sisa_tertahan,
  (SELECT COUNT(*) FROM mitra WHERE email = 'asram@gmail.com')         AS sisa_mitra;

-- (3) Stok harus sudah kembali: Es mambo yoni 65, Mabel sri 2.
SELECT nama_produk, sku, stock
FROM products
WHERE sku IN ('LBB-106', 'LBB-100');

-- (4) Stok tidak boleh negatif di seluruh produk.
SELECT nama_produk, sku, stock
FROM products
WHERE stock < 0;

-- (5) Jumlah transaksi asli harus tetap 61.
SELECT status, COUNT(*) AS jumlah FROM transactions GROUP BY status;

-- (6) Mitra asli harus 41 (42 dikurangi 1 mitra uji).
SELECT COUNT(*) AS total_mitra FROM mitra;

-- (7) Jejak audit. TIDAK dihapus, karena audit_log sengaja hanya bisa ditambah.
--     Baris dari pengujian akan tetap terlihat di menu Audit Log. Itu tidak
--     memengaruhi stok maupun perhitungan. Kalau tetap mau dibersihkan, jalankan
--     perintah ini sendiri:
--
--   DELETE FROM audit_log WHERE created_at >= '2026-10-03';