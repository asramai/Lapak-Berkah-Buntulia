// SATU-SUMBER kalkulasi laba untuk seluruh aplikasi.
//
// Setiap halaman laporan WAJIB memakai modul ini supaya angkanya selalu identik.
// Jangan menghitung margin di halaman mana pun secara manual.
//
// MODEL BISNIS (sudah dikonfirmasi owner Lapak Berkah Buntulia):
//   Setiap produk punya harga yang ditetapkan mitra (mitra_price / harga modal).
//   Toko menjual dengan harga sendiri yang lebih tinggi (selling_price).
//   Dari harga jual itu:
//     - bagian MITRA  = qty x mitra_price
//     - bagian OWNER  = qty x (selling_price - mitra_price)
//
//   Contoh Naskun Daun milik Yuyun, modal 10.000, harga jual 12.000, qty 3:
//     Total Penjualan = 36.000
//     Untuk Mitra    = 30.000
//     Untuk Owner    =  6.000
//
// IDENTITAS YANG SELALU BERLAKU:
//   totalPenjualan === untukMitra + untukOwner
//
// CATATAN PENTING SOAL BIAYA:
//   Harga mitra dibaca dari snapshot `transaction_items.cost_price` (diisi saat
//   penjualan). Fallback ke `products.mitra_price` hanya untuk data lama yang
//   belum punya snapshot. Jangan naikkan fallback ke nilai default lain karena
//   itu membuat laba terlihat benar padahal salah.

export const ACTIVE_TRANSACTION_STATUS = 'Selesai';

export const getLocalDate = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// Indeks modal per produk, dibaca dari products.mitra_price.
// Dipakai hanya sebagai fallback untuk baris yang belum punya snapshot.
export function buildCostIndex(products) {
  const index = new Map();
  (products || []).forEach((p) => {
    index.set(p.id, toNumber(p.mitra_price));
  });
  return index;
}

// Jumlah retur per transaction_item_id.
// Retur mengurangi qty yang benar-benar terjual, sehingga tidak lagi dihitung
// sebagai penjualan di semua laporan.
export function buildReturnIndex(returns) {
  const index = new Map();
  (returns || []).forEach((row) => {
    if (!row.transaction_item_id) return;
    index.set(
      row.transaction_item_id,
      (index.get(row.transaction_item_id) || 0) + toNumber(row.quantity)
    );
  });
  return index;
}

const resolveCostPrice = (item, costIndex) => {
  if (item.cost_price !== null && item.cost_price !== undefined && item.cost_price !== '') {
    return toNumber(item.cost_price);
  }
  const fallback = costIndex.get(item.product_id);
  return fallback === undefined ? null : toNumber(fallback);
};

const inRange = (date, startDate, endDate) => {
  if (!date) return false;
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
};

/**
 * Mengubah data mentah menjadi baris kalkulasi per item.
 *
 * @param {object} input
 * @param {Array}  input.transactions  baris transactions + items (dari query)
 * @param {Array}  input.returns       baris tabel returns
 * @param {Array}  input.products      baris products (fallback modal)
 * @param {string} [input.startDate]   batas bawah YYYY-MM-DD, kosong = tak terbatas
 * @param {string} [input.endDate]     batas atas YYYY-MM-DD, kosong = tak terbatas
 * @param {boolean} [input.activeOnly] true = hanya status Selesai (default true)
 */
export function buildProfitRows({ transactions, returns, products, startDate, endDate, activeOnly = true }) {
  const costIndex = buildCostIndex(products);
  const returnIndex = buildReturnIndex(returns);
  const rows = [];
  const transaksiTidakTerhitung = [];

  (transactions || []).forEach((tx) => {
    if (activeOnly && tx.status !== ACTIVE_TRANSACTION_STATUS) return;

    // Sumber tanggal:(created_at dari query, atau `date` kalau halaman
    // sudah memapping datanya sendiri. Tanpa fallback ini, baris yang
    // tanggalnya kosong akan dibuang diam-diam dan laporan menampilkan nol.
    const rawDate = tx.created_at || tx.date || '';
    const date = rawDate ? getLocalDate(rawDate) : '';

    const items = tx.items || tx.rawItems;
    if (!items || !date) {
      transaksiTidakTerhitung.push({ id: tx.id, punyaTanggal: Boolean(date), punyaItem: Boolean(items?.length) });
      return;
    }

    if (!inRange(date, startDate, endDate)) return;

    items.forEach((item) => {
      const soldQty = toNumber(item.quantity);
      const returnedQty = returnIndex.get(item.id) || 0;
      // Kembalikan lebih dari yang dibeli tidak mungkin; penjaga defensif.
      const netQty = Math.max(0, soldQty - returnedQty);

      const sellingPrice = toNumber(item.harga_satuan);
      const rawCost = resolveCostPrice(item, costIndex);
      // Modal tidak diketahui (produk dihapus / tidak ada di tabel products).
      // Angka laba baris ini tidak bisa dipercaya, jadi ditandai untuk
      // ditampilkan sebagai peringatan di laporan.
      const modalTidakDiketahui = rawCost === null;
      const mitraPrice = modalTidakDiketahui ? 0 : rawCost;
      const totalSales = netQty * sellingPrice;
      const untukMitra = netQty * mitraPrice;
      const untukOwner = netQty * (sellingPrice - mitraPrice);

      rows.push({
        transactionId: tx.id,
        date,
        createdAt: tx.created_at || '',
        status: tx.status || '-',
        paymentMethod: tx.metode_pembayaran || '-',
// Mitra yang jadi acuan adalah mitra PRODUK, bukan mitra di header
      // transaksi. Header hanya bisa menyimpan satu mitra untuk satu keranjang,
      // padahal keranjang bisa berisi produk dari beberapa mitra, sehingga
      // atribusi per mitranya jadi salah. Total keseluruhan tetap sama karena
      // penjumlahannya; yang berubah hanya pembagian per mitra, dan itu justru
      // yang benar untuk menentukan siapa yang berhak menerima uang.
      mitraId: item.product?.mitra_id || tx.mitra_id || null,
      mitraName: item.product?.mitra?.full_name || tx.mitra?.full_name || '-',
        productId: item.product_id,
        productName: item.product?.nama_produk || '-',
        soldQty,
        returnedQty,
        netQty,
        sellingPrice,
        mitraPrice,
        modalTidakDiketahui,
        totalSales,
        untukMitra,
        untukOwner,
        transactionHeaderTotal: toNumber(tx.total),
      });
    });
  });

  // Diagnostik: transaksi aktif yang tidak bisa dihitung. Kalau angka ini
  // lebih dari 0, berarti bentuk data yang dikirim tidak sesuai (misalnya
  // field tanggal atau item tidak terbaca) sehingga laporan akan terlihat nol
  // tanpa ada peringatan. Halaman mengeceknya lewat verifyConsistency.
  return Object.assign(rows, {
    transaksiTidakTerhitung,
    ringkasanGagal: transaksiTidakTerhitung.length,
  });
}

/**
 * Ringkasan satu sumber kebenaran.
 * Mengembalikan figure yang harus dipakai semua halaman.
 */
export function summarizeProfit(rows) {
  const reduce = (key) => rows.reduce((sum, r) => sum + toNumber(r[key]), 0);

  const totalPenjualan = reduce('totalSales');
  const untukMitra = reduce('untukMitra');
  const untukOwner = reduce('untukOwner');
  const totalQty = reduce('netQty');
  const totalRetur = reduce('returnedQty');
  const totalTerjual = reduce('soldQty');
  const totalTransaksi = new Set(rows.map((r) => r.transactionId)).size;
  const barisModalTidakDiketahui = rows.filter((r) => r.modalTidakDiketahui);
  const omzetModalTidakDiketahui = barisModalTidakDiketahui
    .reduce((sum, r) => sum + toNumber(r.totalSales), 0);

  return {
    totalPenjualan,
    untukMitra,
    untukOwner,
    totalQty,
    totalRetur,
    totalTerjual,
    totalItem: rows.length,
    totalTransaksi,
    marginPercent: totalPenjualan > 0 ? (untukOwner / totalPenjualan) * 100 : 0,
    porsiMitraPercent: totalPenjualan > 0 ? (untukMitra / totalPenjualan) * 100 : 0,
    // Selalu 0 kalau kalkulasi benar. Dipakai sebagai alarm di UI.
    selisih: totalPenjualan - (untukMitra + untukOwner),
    // Baris yang modalnya tidak diketahui membuat laba Owner terlihat lebih
    // besar dari kenyataan. Harus diperingatkan ke user.
    barisModalTidakDiketahui: barisModalTidakDiketahui.length,
    omzetModalTidakDiketahui,
    produkModalTidakDiketahui: [...new Set(barisModalTidakDiketahui.map((r) => r.productName))],
  };
}

/**
 * Agregasi per mitra. Laporan "Untuk Mitra" dan "Untuk Owner" per mitra.
 */
export function summarizeByMitra(rows) {
  const map = new Map();

  rows.forEach((row) => {
    const key = row.mitraId || `unknown-${row.mitraName}`;
    const existing = map.get(key) || {
      mitraId: row.mitraId,
      mitraName: row.mitraName,
      totalPenjualan: 0,
      untukMitra: 0,
      untukOwner: 0,
      totalQty: 0,
      totalRetur: 0,
      totalItem: 0,
      produk: new Set(),
    };
    existing.totalPenjualan += toNumber(row.totalSales);
    existing.untukMitra += toNumber(row.untukMitra);
    existing.untukOwner += toNumber(row.untukOwner);
    existing.totalQty += toNumber(row.netQty);
    existing.totalRetur += toNumber(row.returnedQty);
    existing.totalItem += 1;
    if (row.productName && row.productName !== '-') existing.produk.add(row.productName);
    map.set(key, existing);
  });

  return Array.from(map.values())
    .map((entry) => ({
      mitraId: entry.mitraId,
      mitraName: entry.mitraName,
      totalPenjualan: entry.totalPenjualan,
      untukMitra: entry.untukMitra,
      untukOwner: entry.untukOwner,
      totalQty: entry.totalQty,
      totalRetur: entry.totalRetur,
      totalItem: entry.totalItem,
      jumlahProduk: entry.produk.size,
      marginPercent: entry.totalPenjualan > 0 ? (entry.untukOwner / entry.totalPenjualan) * 100 : 0,
    }))
    .sort((a, b) => b.totalPenjualan - a.totalPenjualan);
}

/**
 * Agregasi per produk. Dipakai untuk melihat produk mana yang paling untung.
 */
export function summarizeByProduct(rows) {
  const map = new Map();

  rows.forEach((row) => {
    const key = row.productId || `unknown-${row.productName}`;
    const existing = map.get(key) || {
      productId: row.productId,
      productName: row.productName,
      mitraId: row.mitraId,
      mitraName: row.mitraName,
      totalPenjualan: 0,
      untukMitra: 0,
      untukOwner: 0,
      totalQty: 0,
      totalRetur: 0,
    };
    existing.totalPenjualan += toNumber(row.totalSales);
    existing.untukMitra += toNumber(row.untukMitra);
    existing.untukOwner += toNumber(row.untukOwner);
    existing.totalQty += toNumber(row.netQty);
    existing.totalRetur += toNumber(row.returnedQty);
    map.set(key, existing);
  });

  return Array.from(map.values())
    .map((entry) => ({
      ...entry,
      marginPercent: entry.totalPenjualan > 0 ? (entry.untukOwner / entry.totalPenjualan) * 100 : 0,
    }))
    .sort((a, b) => b.totalPenjualan - a.totalPenjualan);
}

/**
 * Agregasi harian, untuk tabel riwayat.
 */
export function summarizeByDate(rows) {
  const map = new Map();

  rows.forEach((row) => {
    if (!row.date) return;
    const existing = map.get(row.date) || {
      date: row.date,
      totalPenjualan: 0,
      untukMitra: 0,
      untukOwner: 0,
      totalQty: 0,
      totalRetur: 0,
      totalTransaksi: new Set(),
    };
    existing.totalPenjualan += toNumber(row.totalSales);
    existing.untukMitra += toNumber(row.untukMitra);
    existing.untukOwner += toNumber(row.untukOwner);
    existing.totalQty += toNumber(row.netQty);
    existing.totalRetur += toNumber(row.returnedQty);
    existing.totalTransaksi.add(row.transactionId);
    map.set(row.date, existing);
  });

  return Array.from(map.values())
    .map((entry) => ({
      date: entry.date,
      totalPenjualan: entry.totalPenjualan,
      untukMitra: entry.untukMitra,
      untukOwner: entry.untukOwner,
      totalQty: entry.totalQty,
      totalRetur: entry.totalRetur,
      totalTransaksi: entry.totalTransaksi.size,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Pemeriksa konsistensi. Kalau selisih !== 0 berarti ada bug perhitungan.
 * Halaman laporan bisa memakai ini untuk menampilkan peringatan.
 */
export function verifyConsistency(summary, rows = null) {
  const problems = [];
  if (Math.abs(summary.selisih) > 0.01) {
    problems.push(`Total Penjualan tidak sama dengan (Mitra + Owner), selisih ${summary.selisih}`);
  }
  if (summary.untukOwner < 0) {
    problems.push('Ada advantage Owner negatif, periksa harga mitra vs harga jual');
  }
  if (summary.barisModalTidakDiketahui > 0) {
    problems.push(
      `${summary.barisModalTidakDiketahui} baris tanpa harga mitra (${summary.produkModalTidakDiketahui.join(', ')}). `
      + 'Laba Owner pada baris itu terhitung 100% dan belum bisa dipercaya.'
    );
  }
  if (rows && rows.ringkasanGagal > 0) {
    const contoh = rows.transaksiTidakTerhitung.slice(0, 3).map((r) => r.id).join(', ');
    problems.push(
      `${rows.ringkasanGagal} transaksi tidak bisa dihitung karena data tidak lengkap `
      + `(contoh: ${contoh}). Laporan ini belum utuh.`
    );
  }
  return problems;
}