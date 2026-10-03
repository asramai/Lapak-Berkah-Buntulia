import { useState, useEffect, useMemo } from 'react';
import { transactionService, productService, returnService, mitraService } from '../lib/services';
import { buildProfitRows, summarizeProfit } from '../lib/profitReport';

function SalesRecap() {
  const [transactions, setTransactions] = useState([]);
  const [returns, setReturns] = useState([]);
  const [products, setProducts] = useState([]);
  const [mitraList, setMitraList] = useState(['Semua Mitra']);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedMitra, setSelectedMitra] = useState('Semua Mitra');
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [txData, returnData, productData, mitraData] = await Promise.all([
          transactionService.getHistory(),
          returnService.getAll(),
          productService.getAll(),
          mitraService.getAll(),
        ]);

        setTransactions(txData || []);
        setReturns(returnData || []);
        setProducts(productData || []);
        setMitraList(['Semua Mitra', ...mitraData.map((m) => m.full_name)]);
      } catch {
        showToast('Gagal memuat data penjualan', 'error');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Satu sumber kalkulasi yang sama dengan Laporan Pembagian Keuntungan.
  // Retur sudah dipotong, transaksi Dibatalkan tidak dihitung.
  const profitRows = useMemo(
    () => buildProfitRows({ transactions, returns, products, startDate, endDate }),
    [transactions, returns, products, startDate, endDate]
  );

  const filteredTransactions = useMemo(() => {
    const grouped = new Map();
    profitRows.forEach((row) => {
      if (selectedMitra !== 'Semua Mitra' && row.mitraName !== selectedMitra) return;
      const existing = grouped.get(row.transactionId) || {
        id: row.transactionId,
        date: row.date,
        mitraName: row.mitraName,
        produk: [],
        qty: 0,
        total: 0,
        retur: 0,
        paymentMethod: row.paymentMethod,
        status: row.status,
      };
      if (!existing.produk.includes(row.productName)) existing.produk.push(row.productName);
      existing.qty += row.netQty;
      existing.total += row.totalSales;
      existing.retur += row.returnedQty;
      grouped.set(row.transactionId, existing);
    });
    return Array.from(grouped.values())
      .map((entry) => ({ ...entry, productName: entry.produk.join(', ') }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [profitRows, selectedMitra]);

  const summary = useMemo(() => {
    const scoped = selectedMitra === 'Semua Mitra'
      ? profitRows
      : profitRows.filter((row) => row.mitraName === selectedMitra);
    return summarizeProfit(scoped);
  }, [profitRows, selectedMitra]);

  const totalSales = summary.totalPenjualan;
  const totalQty = summary.totalQty;

  const handleExportExcel = () => {
    const headers = ['No', 'Tanggal', 'Mitra', 'Produk', 'Qty', 'Total', 'Metode', 'Status'];
    const rows = filteredTransactions.map((t, i) => [
      i + 1,
      t.date,
      `"${t.mitraName}"`,
      `"${t.productName}"`,
      t.qty,
      t.total,
      t.paymentMethod,
      t.status,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laporan-penjualan-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Export Excel berhasil!', 'success');
  };

  const handleExportPDF = () => {
    const rows = filteredTransactions.map((t, i) => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 8px; text-align: center;">${i + 1}</td>
        <td style="padding: 8px;">${t.date}</td>
        <td style="padding: 8px;">${t.mitraName}</td>
        <td style="padding: 8px;">${t.productName}</td>
        <td style="padding: 8px; text-align: center;">${t.qty}</td>
        <td style="padding: 8px; text-align: right;">Rp ${t.total.toLocaleString('id-ID')}</td>
        <td style="padding: 8px;">${t.paymentMethod}</td>
        <td style="padding: 8px;">${t.status}</td>
      </tr>
    `).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Laporan Penjualan</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #111; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f5f5f5; padding: 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #ccc; }
    .header { text-align: center; margin-bottom: 20px; }
    .header h1 { margin: 0 0 4px 0; font-size: 18px; }
    .header p { margin: 0; font-size: 12px; color: #666; }
    .summary { display: flex; gap: 20px; margin-bottom: 20px; font-size: 12px; }
    .summary div { padding: 8px 12px; background: #f9f9f9; border-radius: 4px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>LAPAK BERKAH BUNTULIA</h1>
    <p>Laporan Penjualan - ${new Date().toLocaleDateString('id-ID')}</p>
  </div>
  <div class="summary">
    <div><strong>Total Transaksi:</strong> ${filteredTransactions.length}</div>
    <div><strong>Total Penjualan:</strong> Rp ${totalSales.toLocaleString('id-ID')}</div>
    <div><strong>Total Qty:</strong> ${totalQty}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th>
        <th>Tanggal</th>
        <th>Mitra</th>
        <th>Produk</th>
        <th>Qty</th>
        <th>Total</th>
        <th>Metode</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, '_blank', 'width=800,height=600');
    if (!printWindow) {
      showToast('Popup diblokir. Izinkan popup untuk export PDF.', 'error');
      URL.revokeObjectURL(url);
      return;
    }
    showToast('Export PDF berhasil! Pilih "Save as PDF" di dialog cetak.', 'success');
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
        <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 flex items-center justify-center h-96">
            <div className="flex flex-col items-center gap-3">
              <span className="material-symbols-outlined text-6xl text-primary animate-pulse">progress_activity</span>
              <p className="font-body-md text-body-md text-on-surface-variant">Memuat data penjualan...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* Page Header */}
          <header className="hidden md:flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Laporan Penjualan</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                Ringkasan penjualan dan rekap transaksi
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExportExcel}
                className="h-12 px-6 bg-surface border border-primary text-primary rounded-xl flex items-center gap-2 transition-colors font-label-md text-label-md hover:bg-surface-container"
              >
                <span className="material-symbols-outlined text-[20px]">description</span>
                Export Excel
              </button>
              <button
                onClick={handleExportPDF}
                className="h-12 px-6 bg-secondary text-on-secondary rounded-xl flex items-center gap-2 transition-colors font-label-md text-label-md hover:bg-secondary/90"
              >
                <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
                Export PDF
              </button>
            </div>
          </header>

          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Laporan</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Rekap penjualan</p>
            </div>
            <div className="flex gap-2">
              <button onClick={handleExportExcel} aria-label="Export Excel" className="h-10 w-10 bg-surface border border-primary text-primary rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">description</span>
              </button>
              <button onClick={handleExportPDF} aria-label="Export PDF" className="h-10 w-10 bg-secondary text-on-secondary rounded-lg flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-primary-fixed flex items-center justify-center text-on-primary-fixed">
                  <span className="material-symbols-outlined">receipt_long</span>
                </div>
                <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">Total</span>
              </div>
              <div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Transaksi</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">{filteredTransactions.length}</p>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
                  <span className="material-symbols-outlined">shopping_cart</span>
                </div>
                <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">Qty</span>
              </div>
              <div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Item</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">{totalQty}</p>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed">
                  <span className="material-symbols-outlined">payments</span>
                </div>
                <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">Omzet</span>
              </div>
              <div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Penjualan</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">Rp {totalSales.toLocaleString('id-ID')}</p>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-[#d1f4e0] flex items-center justify-center text-[#0d592a]">
                  <span className="material-symbols-outlined">trending_up</span>
                </div>
                <span className="font-label-sm text-label-sm text-[#0d592a] bg-[#d1f4e0]/50 px-2 py-1 rounded-full">Rata-rata</span>
              </div>
              <div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Rata-rata Transaksi</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">Rp {filteredTransactions.length > 0 ? Math.round(totalSales / filteredTransactions.length).toLocaleString('id-ID') : 0}</p>
              </div>
            </div>
          </div>

          {/* Pembagian Mitra / Owner - angka ini sama persis dengan Laporan Pembagian Keuntungan */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Untuk Mitra</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                Rp {summary.untukMitra.toLocaleString('id-ID')}
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                Harga mitra · {summary.porsiMitraPercent.toFixed(1)}%
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Untuk Owner</p>
              <p className="font-headline-md text-headline-md text-primary font-numeric-data text-numeric-data">
                Rp {summary.untukOwner.toLocaleString('id-ID')}
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                Selisih harga jual - harga mitra · margin {summary.marginPercent.toFixed(1)}%
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Item Terdiretur</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {summary.totalRetur.toLocaleString('id-ID')}
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                Sudah dipotong dari omzet di atas
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Tanggal Mulai</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Tanggal Akhir</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Mitra</label>
                <select
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none"
                  value={selectedMitra}
                  onChange={(e) => setSelectedMitra(e.target.value)}
                >
                  {mitraList.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Transaction Table */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-outline-variant bg-surface">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Daftar Transaksi</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Menampilkan {filteredTransactions.length} transaksi</p>
            </div>

            {filteredTransactions.length === 0 ? (
              <div className="p-12 text-center">
                <span className="material-symbols-outlined text-6xl text-outline mb-3">receipt_long</span>
                <p className="font-body-md text-body-md text-on-surface-variant">Tidak ada transaksi yang ditemukan</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low border-b border-outline-variant">
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">ID</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Tanggal</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Mitra</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Produk</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Qty</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Total</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Metode</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                    {filteredTransactions.map((transaction, idx) => (
                      <tr
                        key={transaction.id}
                        className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}
                      >
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm bg-surface-container px-2 py-1 rounded-md text-on-surface-variant">#{transaction.id.toString().padStart(4, '0')}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-body-sm text-body-sm text-on-surface">{transaction.date}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-body-sm text-body-sm text-on-surface">{transaction.mitraName}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-body-sm text-body-sm text-on-surface">{transaction.productName}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-on-background">{transaction.qty}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-primary font-semibold">Rp {transaction.total.toLocaleString('id-ID')}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-label-sm bg-surface-container text-on-surface-variant border border-outline-variant">
                            {transaction.paymentMethod}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-label-md text-label-sm bg-tertiary-fixed/15 text-tertiary-container border border-tertiary-fixed/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                            {transaction.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center gap-2 animate-bounce ${
          toast.type === 'error' 
            ? 'bg-error-container text-error border-error/30' 
            : 'bg-surface-container-high text-on-background border-outline-variant'
        }`}>
          <span className="material-symbols-outlined text-[18px]">
            {toast.type === 'error' ? 'error' : 'check_circle'}
          </span>
          <span className="font-label-md text-label-md">{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default SalesRecap;
