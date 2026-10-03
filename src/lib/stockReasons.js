// Alasan barang keluar dari stok.
//
// Produk di lapak ini sebagian besar makanan basah yang tidak bertahan lama,
// jadi barang ditarik mitra itu hal yang wajar. Tapi barang yang ditarik mitra,
// barang yang rusak, dan barang yang hilang akibatnya berbeda, jadi harus bisa
// dibedakan di laporan.
//
// Alasan ini dipakai bersama oleh menu Manajemen Stok, Mitra Dashboard, dan
// kolom reason di database, supaya label yang tampil sama dengan yang tersimpan.

export const ALASAN_STOK_KELUAR = [
  { nilai: 'ditarik_mitra', label: 'Ditarik Mitra', hint: 'Sisa tidak layak, diambil kembali oleh mitra' },
  { nilai: 'rusak', label: 'Rusak', hint: 'Rusak di tempat' },
  { nilai: 'kedaluwarsa', label: 'Kedaluwarsa', hint: 'Sudah tidak layak dimakan' },
  { nilai: 'hilang', label: 'Hilang', hint: 'Hilang atau selisih' },
  { nilai: 'lainnya', label: 'Lainnya', hint: 'Alasan lain' },
];

// Alasan yang dipakai untuk pergerakan lama yang tidak punya keterangan, dan
// untuk penjualan di kasir. Ini bukan penarikan barang.
export const ALASAN_LAINNYA = 'lainnya';
export const ALASAN_PENJUALAN = 'penjualan';

const PETA = new Map(ALASAN_STOK_KELUAR.map((a) => [a.nilai, a]));

export function labelAlasan(nilai) {
  if (!nilai) return '';
  if (nilai === ALASAN_PENJUALAN) return 'Penjualan';
  return PETA.get(nilai)?.label || nilai;
}

export function hintAlasan(nilai) {
  return PETA.get(nilai)?.hint || '';
}

/**
 * Ringkasan alasan stok keluar untuk laporan.
 *
 * Barang yang ditarik mitra dipisahkan dari barang yang hilang, karena Owner
 * biasanya hanya peduli pada satu-duanya: barang hilang berarti ada masalah,
 * barang ditarik mitra adalah hal normal untuk produk basah.
 */
export function ringkasanAlasan(movements) {
  const hasil = ALASAN_STOK_KELUAR.map((a) => ({ ...a, quantity: 0, occasions: 0 }));
  const index = new Map(hasil.map((h) => [h.nilai, h]));

  (movements || []).forEach((m) => {
    if (m.type !== 'out') return;
    // Penjualan bukan penarikan barang, jadi tidak dihitung sebagai alasan.
    if (m.reason === ALASAN_PENJUALAN) return;
    const baris = index.get(m.reason);
    if (!baris) return;
    baris.quantity += Number(m.quantity) || 0;
    baris.occasions += 1;
  });

  const total = hasil.reduce((s, h) => s + h.quantity, 0);
  return {
    daftar: hasil.filter((h) => h.quantity > 0),
    total,
    ditarikMitra: hasil.find((h) => h.nilai === 'ditarik_mitra')?.quantity || 0,
    masalah: hasil
      .filter((h) => h.nilai !== 'ditarik_mitra' && h.quantity > 0)
      .reduce((s, h) => s + h.quantity, 0),
  };
}