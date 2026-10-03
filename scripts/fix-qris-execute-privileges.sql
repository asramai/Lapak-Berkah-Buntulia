-- Perbaikan: confirm_qris_payment masih bisa dipanggil dari browser
--
-- GEJALA:
--   POST /rest/v1/rpc/confirm_qris_payment dari anon key TIDAK ditolak, dan
--   badan fungsinya benar-benar berjalan (mengembalikan "Transaksi tidak
--   ditemukan", bukan error permission denied).
--
--   Artinya siapa pun yang memegang anon key bisa menandai transaksi QRIS
--   lunat tanpa membayar. Ini Persis hal yang harus dicegah oleh fitur ini,
--   jadi selama ini belum aktif berarti belum terpasang.
--
-- PENYEBAB:
--   File sebelumnya memakai REVOKE ... FROM PUBLIC. Tapi proyek Supabase punya
--   default: GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon,
--   authenticated, service_role. Itu grant EKSPLISIT ke role, dan hak akses di
--   PostgreSQL itu dijumlahkan. Menghapus grant PUBLIC tidak menghapus grant
--   eksplisit ke anon, jadi anon tetap boleh memanggil fungsi tersebut.
--
-- CARA PAKAI: Supabase -> SQL Editor -> New query -> tempel file ini -> Run.
-- Idempoten.
--
-- CATATAN PENTING:
--   service_role TIDAK ikut dicabut, karena webhook gateway membutuhkannya.
--   Kalau webhook tidak jalan, periksa lagi hak eksekusinya di sini sebelum
--   menyalahkan kode webhook-nya.


-- confirm_qris_payment hanya boleh dipanggil webhook gateway.
REVOKE EXECUTE ON FUNCTION confirm_qris_payment(UUID, TEXT, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;

-- Fungsi di bawah ini memang dimaksudkan bisa dipanggil kasir dari browser:
-- complete_cash_payment          -> kasir menyelesaikan pembayaran Tunai
-- cancel_pending_transaction     -> kasir membatalkan pesanan
-- release_expired_payments       -> pembersihan otomatis
-- Grant eksplisitnya ditulis ulang supaya tidak bergantung pada default
-- Supabase, yang bisa saja berubah atau ditimpa oleh grant later.
GRANT EXECUTE ON FUNCTION complete_cash_payment(UUID, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_pending_transaction(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION release_expired_payments() TO anon, authenticated;


-- ============================================================
-- VERIFIKASI
-- ============================================================
-- 1. Fungsi yang TIDAK boleh dipanggil browser. Dua query ini harus gagal
--    dengan permission denied untuk function:
--    SELECT confirm_qris_payment('00000000-0000-0000-0000-000000000000', 'x', 1000, 'test');
--    SELECT proacl FROM pg_proc WHERE proname = 'confirm_qris_payment';
--    proacl harus TIDAK mengandung '{anon}' maupun '{authenticated}'.
--
-- 2. Fungsi yang BOLEH dipanggil kasir, tiga query ini harus berhasil:
--    SELECT release_expired_payments();
--    SELECT complete_cash_payment('00000000-0000-0000-0000-000000000000', 1000);
--    SELECT cancel_pending_transaction('00000000-0000-0000-0000-000000000000', 'probe');
--    Dua yang terakhir akan mengembalikan error "Transaksi tidak ditemukan",
--    itu sudah benar karena id-nya memang tidak ada. Yang penting bukan
--    "permission denied".
--
-- 3. Cek siapa saja yang boleh mengeksekusi fungsi sensitif:
--    SELECT proname, proacl FROM pg_proc
--    WHERE proname IN ('confirm_qris_payment','complete_cash_payment');
--    confirm_qris_payment tidak boleh punya anon atau authenticated,
--    sedangkan complete_cash_payment boleh punya keduanya.