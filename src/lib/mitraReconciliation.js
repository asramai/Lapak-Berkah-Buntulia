// Rekonsiliasi kewajiban ke mitra.
//
// Dipisah dari halaman supaya bisa diuji tanpa browser, dan supaya Laporan
// Penjualan maupun Nota Penjualan Mitra memakai angka yang sama kalau suatu saat
// perlu dibandingkan.
//
// MASALAH YANG DISELESAIKAN:
// Halaman ini menampilkan rekap dari mitra_settlements, sedangkan Laporan
// Penjualan menghitung dari transactions. Keduanya memang mengukur hal berbeda,
// tapi labelnya dulu sama-sama "Total Penjualan" sehingga selalu terlihat
// seperti selisih yang tidak dijelaskan. Modul ini memberi Owner angka yang
// memperhubungkan keduanya: kewajiban dari penjualan dikurangi yang sudah
// di-invoice.
//
// ATRIBUSI KE MITRA:
// Kewajiban dihitung dari mitra PRODUK, bukan dari transactions.mitra_id.
// Field itu diambil dari item pertama di keranjang, dan 37 dari 61 transaksi di
// database berisi produk dari beberapa mitra, sehingga field itu tidak bisa
// dipercaya untuk menghitung kewajiban per mitra. Total keseluruhan tetap sama
// karena penjumlahannya, hanya pembagian per mitranya yang berbeda.

/**
 * @param {object} input
 * @param {Array} input.transactions  Transaksi mentah dari transactionService.getHistory()
 * @param {Array} input.returns       Retur dari returnService.getAll()
 * @param {Array} input.products      Produk dari productService.getAll()
 * @param {Array} input.settlements   Invoice dari mitraSettlementService.getAll()
 */
export function hitungRekonsiliasiMitra({ transactions, returns, products, settlements }) {
  const costPrice = new Map();
  const mitraProduk = new Map();
  (products || []).forEach((p) => {
    costPrice.set(p.id, Number(p.mitra_price) || 0);
    mitraProduk.set(p.id, p.mitra_id || null);
  });

  // Retur mengurangi qty per item transaksi, sama seperti modul laba.
  const returPerItem = new Map();
  (returns || []).forEach((r) => {
    const id = r.transaction_item_id;
    if (!id) return;
    returPerItem.set(id, (returPerItem.get(id) || 0) + (Number(r.quantity) || 0));
  });

  // Kewajiban per mitra: qty bersih x harga mitra snapshot.
  const kewajiban = new Map();
  (transactions || []).forEach((tx) => {
    if (tx.status !== 'Selesai') return;
    (tx.items || []).forEach((item) => {
      const mitraId = mitraProduk.get(item.product_id);
      if (!mitraId) return;
      const qty = Number(item.quantity) || 0;
      const retur = returPerItem.get(item.id) || 0;
      const netQty = qty - retur;
      if (netQty <= 0) return;
      const modal = Number(item.cost_price) || 0;
      const nominal = netQty * (modal || costPrice.get(item.product_id) || 0);
      if (nominal <= 0) return;

      const entry = kewajiban.get(mitraId) || {
        mitraId,
        namaMitra: '-',
        totalPenjualan: 0,
        liability: 0,
        qty: 0,
      };
      entry.liability += nominal;
      entry.totalPenjualan += netQty * (Number(item.harga_satuan) || 0);
      entry.qty += netQty;
      kewajiban.set(mitraId, entry);
    });
  });

  // Nama mitra diambil dari produk supaya tidak perlu query tambahan.
  (products || []).forEach((p) => {
    const entry = kewajiban.get(p.mitra_id);
    if (entry && entry.namaMitra === '-') entry.namaMitra = p.mitra?.full_name || '-';
  });

  // Invoice: bagian mitra = total_amount - total_profit.
  const invoice = new Map();
  (settlements || []).forEach((s) => {
    if (s.deleted_at || s.status === 'cancelled') return;
    const mitraId = s.mitra_id;
    if (!mitraId) return;
    const totalJual = Number(s.total_amount) || 0;
    const untungOwner = Number(s.total_profit) || 0;
    const untukMitra = totalJual - untungOwner;
    const entry = invoice.get(mitraId) || {
      diInvoice: 0, sudahDibayar: 0, belumDibayar: 0, jumlahInvoice: 0,
    };
    entry.diInvoice += untukMitra;
    entry.jumlahInvoice += 1;
    if (s.status === 'paid') entry.sudahDibayar += untukMitra;
    else entry.belumDibayar += untukMitra;
    invoice.set(mitraId, entry);
  });

  const daftar = [...kewajiban.values()]
    .map((row) => {
      const inv = invoice.get(row.mitraId) || { diInvoice: 0, sudahDibayar: 0, belumDibayar: 0, jumlahInvoice: 0 };
      // Kewajiban belum ditagih: penjualan sudah terjadi tapi belum jadi invoice.
      const belumDitagih = row.liability - inv.diInvoice;
      return {
        mitraId: row.mitraId,
        namaMitra: row.namaMitra,
        qty: row.qty,
        totalPenjualan: row.totalPenjualan,
        liability: row.liability,
        diInvoice: inv.diInvoice,
        sudahDibayar: inv.sudahDibayar,
        belumDibayar: inv.belumDibayar,
        belumDitagih,
        jumlahInvoice: inv.jumlahInvoice,
        // Negatif berarti lebih besar dari penjualan yang tercatat, jadi invoice
        // kemungkinan keliru atau dibuat dari penjualan yang belum masuk kasir.
        kelebihan: inv.diInvoice > row.liability,
        standout: belumDitagih,
      };
    })
    .sort((a, b) => b.outstand - a.outstand);

  const sum = (fn) => daftar.reduce((s, r) => s + (Number(fn(r)) || 0), 0);
  const total = {
    liability: sum((r) => r.liability),
    diInvoice: sum((r) => r.diInvoice),
    sudahDibayar: sum((r) => r.sudahDibayar),
    belumDibayar: sum((r) => r.belumDibayar),
    belumDitagih: sum((r) => r.belumDitagih),
  };

  return {
    daftar,
    total,
    masalah: {
      mitraLebihDitagih: daftar.filter((r) => r.kelebihan),
      invoiceBelumDibayar: daftar.filter((r) => r.belumDibayar > 0.5),
    },
  };
}