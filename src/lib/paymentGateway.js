// Pembayaran QRIS: lapisan yang memisahkan kasir dari gateway.
//
// Kenapa file ini ada: integrasi gateway butuh server key dan webhook, sedangkan
// aplikasi ini murni frontend statis. Memanggil gateway langsung dari browser
// tidak akan pernah benar karena server key akan ikut terpasang di bundle.
//
// Jadi pemisahnya: browser hanya bertanggung jawab membuat pesanan lewat fungsi
// database, lalu menunggu. Verifikasi pembayaran SELALU datang dari webhook,
// bukan dari peramban. Tidak ada kode di browser yang bisa menyatakan transaksi
// sudah lunat.
//
// Ganti adapter di bawah tanpa perlu menyentuh halaman kasir.

const GATEWAY_URLS = {
  midtrans: 'https://app.midtrans.com/snap/v1/transactions',
  xendit: 'https://api.xendit.co/v2/qr_codes',
};

// Keadaan status pesanan yang dipakai seluruh aplikasi, dibersona supaya
// apa pun yang datang dari gateway tidak langsung dipercaya.
const STATUS = {
  idle: 'idle',
  menunggu: 'menunggu',
  lunas: 'lunas',
  gagal: 'gagal',
  kedaluwarsa: 'kedaluwarsa',
};

/**
 * Pembayaran Tunai. Selesai begitu kasir menekan tombol, setelah uang
 * benar-benar diterima. Change dihitung database.
 */
export const tuneaiPayment = {
  metode: 'Tunai',
  perluGateway: false,

  async mulai({ total }) {
    return { status: STATUS.munggu, total };
  },

  // Tunai tidak butuh polling karena penyelesaiannya dipanggil langsung ke
  // database lewat complete_cash_payment.
  async cekStatus() {
    return { status: STATUS.lunas };
  },
};

/**
 * Adapter QRIS yang belum tersambung ke gateway manapun.
 *
 * Ini sengaja BUKAN meniru pembayaran sungguhan. Tujuannya supaya alur
 * pending -> lunas bisa dibangun dan diuji sebelum ada akun merchant, tanpa
 * pernah memberi ilusi bahwa uang benar-benar masuk.
 *
 * Kalau dipakai sungguhan, transaksi akan tetap menggantung sampai kedaluwarsa
 * dan stoknya dikembalikan. Itu lebih baik daripada menandai lunat tanpa
 * pembayaran, karena itu justru bahaya yang ingin kita cegah.
 */
export const qrisTanpaGateway = {
  metode: 'QRIS',
  perluGateway: true,
  nama: 'belum-ada-gateway',

  async mulai({ total, transactionId }) {
    return { status: STATUS.menunggu, total, transactionId, gatewayTerpasang: false, qrPayload: null, pesan: 'QRIS belum terhubung ke payment gateway. Jalankan scripts/secure-payment-and-qris.sql lalu hubungkan adapter gateway.' };
  },

  async cekStatus() {
    // Tidak pernah melunas tanpa webhook dari gateway yang benar-benar membayar.
    return { status: STATUS.menunggu, gatewayTerpasang: false };
  },
};

/**
 * Adapter Midtrans Snap.
 *
 * Sengaja tidak diimplementasikan panggilannya di file ini. Memanggilnya butuh
 * server key, dan server key tidak boleh ada di frontend. Implementasi
 * seharusnya hidup di serverless function /api/QRIS, yang juga menerima
 * webhook notifikasi dari Midtrans.
 *
 * Fungsi ini sengaja melempar error supaya tidak ada jalur yang diam-diam
 * menandai pembayaran berhasil.
 */
export const midtransAdapter = {
  metode: 'QRIS',
  perluGateway: true,
  nama: 'midtrans',

  GATEWAY_URL: GATEWAY_URLS.midtrans,

  async mulai() {
    throw new Error(
      'Adapter Midtrans belum diimplementasikan. Integrasi harus lewat /api/qris-create '
      + 'dan webhook /api/qris-notify, bukan dari browser.'
    );
  },
};

export const STATUS_PEMBAYARAN = STATUS;

/**
 * Pilih adapter berdasarkan metode pembayaran.
 */
export function adapterUntuk(metode) {
  if (metode === 'Tunai') return tuneaiPayment;
  if (metode === 'QRIS') return qrisTanpaGateway;
  throw new Error(`Metode pembayaran tidak dikenal: ${metode}`);
}

/**
 * Ringkasan untuk laporan: berapa transaksi dan berapa nilainya per metode.
 * Memakai modul kalkulasi yang sama supaya angkanya selalu cocok dengan
 * laporan lain.
 */
export function ringkasanPembayaran(rows) {
  const tunai = { transaksi: 0, nominal: 0 };
  const qris = { transaksi: 0, nominal: 0 };
  const sudahDihitung = new Set();

  (rows || []).forEach((row) => {
    if (row.status !== 'Selesai') return;

    const bucket = row.paymentMethod === 'Tunai' ? tunai : qris;
    // Baris laporan satu per ITEM, bukan per transaksi. Transaksi yang berisi
    // tiga produk akan muncul sebagai tiga baris, jadi transaksi harus dihitung
    // dari id unik supaya tidak terhitung berkali-kali.
    if (row.transactionId && !sudahDihitung.has(row.transactionId)) {
      sudahDihitung.add(row.transactionId);
      bucket.transaksi += 1;
    }
    bucket.nominal += Number(row.totalSales) || 0;
  });

  const totalTransaksi = tunai.transaksi + qris.transaksi;
  const totalNominal = tunai.nominal + qris.nominal;
  const nonTunaiTransaksi = qris.transaksi;
  const nonTunaiNominal = qris.nominal;

  return {
    tunai,
    qris,
    nonTunai: { transaksi: nonTunaiTransaksi, nominal: nonTunaiNominal },
    total: { transaksi: totalTransaksi, nominal: totalNominal },
    // Persentasenon-tunai, supaya laporan mudah dibaca tanpa menghitung manual.
    persenNonTunai: totalTransaksi === 0 ? 0 : (nonTunaiTransaksi / totalTransaksi) * 100,
    persenTunai: totalTransaksi === 0 ? 0 : (tunai.transaksi / totalTransaksi) * 100,
  };
}