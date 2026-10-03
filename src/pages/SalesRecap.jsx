import { useState, useEffect, useMemo } from 'react';
import { transactionService, productService, returnService, mitraService } from '../lib/services';
import { buildProfitRows, summarizeProfit, summarizeByMitra } from '../lib/profitReport';
import { ringkasanPembayaran } from '../lib/paymentGateway';
import { downloadSpreadsheet, openPrintableReport } from '../lib/exportReport';

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
        untukMitra: 0,
        untukOwner: 0,
        retur: 0,
        paymentMethod: row.paymentMethod,
        status: row.status,
      };
      if (!existing.produk.includes(row.productName)) existing.produk.push(row.productName);
      existing.qty += row.netQty;
      existing.total += row.totalSales;
      existing.untukMitra += row.untukMitra;
      existing.untukOwner += row.untukOwner;
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

  const byMitra = useMemo(() => {
    const scoped = selectedMitra === 'Semua Mitra'
      ? profitRows
      : profitRows.filter((row) => row.mitraName === selectedMitra);
    return summarizeByMitra(scoped);
  }, [profitRows, selectedMitra]);

  const rangeLabel = useMemo(() => {
    if (!startDate && !endDate) return 'Semua Periode';
    if (startDate && endDate) return startDate === endDate ? startDate : `${startDate} s/d ${endDate}`;
    return startDate ? `Sejak ${startDate}` : `Sampai ${endDate}`;
  }, [startDate, endDate]);

  const totalSales = summary.totalPenjualan;
  const totalQty = summary.totalQty;
  const pembayaran = useMemo(() => ringkasanPembayaran(filteredTransactions), [filteredTransactions]);

  const handleExportExcel = () => {
    downloadSpreadsheet({
      fileName: `laporan-penjualan-${startDate || 'awal'}-sd-${endDate || 'akhir'}.xls`,
      multiSheet: [
        {
          sheetName: 'Transaksi',
          title: 'LAPAK BERKAH BUNTULIA - Laporan Penjualan',
          subtitle: `Periode: ${rangeLabel}`,
          headers: [
            'No', 'Tanggal', 'Mitra', 'Produk', 'Qty', 'Retur',
            'Total Penjualan', 'Untuk Mitra', 'Untuk Owner', 'Metode', 'Status',
          ],
          rows: filteredTransactions.map((t, i) => [
            i + 1, t.date, t.mitraName, t.productName, t.qty, t.retur,
            { value: t.total, money: true },
            { value: t.untukMitra, money: true },
            { value: t.untukOwner, money: true },
            t.paymentMethod, t.status,
          ]),
          summary: [
            ['Total Penjualan', { value: summary.totalPenjualan, money: true }],
            ['Untuk Mitra', { value: summary.untukMitra, money: true }],
            ['Untuk Owner', { value: summary.untukOwner, money: true }],
          ],
        },
        {
          sheetName: 'Per Mitra',
          title: 'Penjualan per Mitra',
          subtitle: `Periode: ${rangeLabel}`,
          headers: ['Mitra', 'Total Penjualan', 'Untuk Mitra', 'Untuk Owner', 'Qty'],
          rows: byMitra.map((m) => [
            m.mitraName,
            { value: m.totalPenjualan, money: true },
            { value: m.untukMitra, money: true },
            { value: m.untukOwner, money: true },
            m.totalQty,
          ]),
        },
      ],
    });
    showToast('Export Excel berhasil!', 'success');
  };

  const handleExportPDF = () => {
    const result = openPrintableReport({
      title: 'Laporan Penjualan',
      subtitle: `Periode: ${rangeLabel}`,
      sections: [
        {
heading: 'Pembagian Keuntungan',
          note: 'Total Penjualan = Untuk Mitra + Untuk Owner',
          cards: [
            { label: 'Total Penjualan', value: summary.totalPenjualan, money: true },
            { label: 'Untuk Mitra', value: summary.untukMitra, money: true },
            { label: 'Untuk Owner', value: summary.untukOwner, money: true },
          ],
        },
        {
          heading: 'Tunai vs Non-Tunai',
          note: 'Hanya transaksi berstatus Selesai. QRIS yang belum dibayar dan transaksi dibatalkan tidak dihitung.',
          cards: [
            { label: 'Tunai', value: pembayaran.tunai.transaksi, money: false, caption: `Rp ${pembayaran.tunai.nominal.toLocaleString('id-ID')}` },
            { label: 'Non-Tunai (QRIS)', value: pembayaran.nonTunai.transaksi, money: false, caption: `Rp ${pembayaran.nonTunai.nominal.toLocaleString('id-ID')}` },
            { label: 'Porsi Non-Tunai', value: `${pembayaran.persenNonTunai.toFixed(1)}%`, money: false, caption: `dari ${pembayaran.total.transaksi} transaksi` },
          ],
        },
        {
          heading: 'Rincian Transaksi',
          headers: [
            { label: 'No' },
            { label: 'Tanggal' },
            { label: 'Mitra' },
            { label: 'Produk' },
            { label: 'Qty', align: 'right' },
            { label: 'Total Penjualan', align: 'right' },
            { label: 'Untuk Mitra', align: 'right' },
            { label: 'Untuk Owner', align: 'right' },
          ],
          rows: filteredTransactions.map((t, i) => [
            i + 1, t.date, t.mitraName, t.productName, t.qty,
            { value: t.total, money: true, align: 'right' },
            { value: t.untukMitra, money: true, align: 'right' },
            { value: t.untukOwner, money: true, align: 'right', emphasis: true },
          ]),
        },
      ],
    });

    if (!result.ok) {
      showToast('Popup diblokir. Izinkan popup untuk export PDF.', 'error');
      return;
    }
    showToast('Dialog print dibuka, pilih "Save as PDF"', 'success');
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

          {/* Pemecahan Tunai vs non-Tunai. Dis terang owner karena selisih
              kas di kasir hampir selalu datang dari pembayaran non-tunai yang
              dicatat tanpa benar-benar dibayar. */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-label-lg text-label-lg text-on-surface">Tunai vs Non-Tunai</p>
                <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">
                  Hanya transaksi berstatus Selesai yang dihitung. Yang masih QRIS atau dibatalkan tidak masuk.
                </p>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant">account_balance_wallet</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl bg-surface-container p-4">
                <p className="font-label-sm text-label-sm text-on-surface-variant">Tunai</p>
                <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                  {pembayaran.tunai.transaksi}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  transaksi · Rp {pembayaran.tunai.nominal.toLocaleString('id-ID')}
                </p>
              </div>
              <div className="rounded-xl bg-surface-container p-4">
                <p className="font-label-sm text-label-sm text-on-surface-variant">Non-Tunai (QRIS)</p>
                <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                  {pembayaran.nonTunai.transaksi}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  transaksi · Rp {pembayaran.nonTunai.nominal.toLocaleString('id-ID')}
                </p>
              </div>
              <div className="rounded-xl bg-surface-container p-4">
                <p className="font-label-sm text-label-sm text-on-surface-variant">Porsi Non-Tunai</p>
                <p className="font-headline-md text-headline-md text-primary font-numeric-data text-numeric-data">
                  {pembayaran.persenNonTunai.toFixed(1)}%
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  dari {pembayaran.total.transaksi} transaksi selesai
                </p>
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
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Retur</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Total Penjualan</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Untuk Mitra</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Untuk Owner</th>
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
                          <span className={`font-numeric-data text-numeric-data ${transaction.retur > 0 ? 'text-[#7a590c]' : 'text-outline'}`}>
                            {transaction.retur > 0 ? transaction.retur : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-on-background font-semibold">Rp {transaction.total.toLocaleString('id-ID')}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-on-surface-variant">Rp {transaction.untukMitra.toLocaleString('id-ID')}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-primary font-semibold">Rp {transaction.untukOwner.toLocaleString('id-ID')}</span>
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
                  <tfoot className="border-t-2 border-outline-variant bg-surface-container-low">
                    <tr className="font-headline-sm text-headline-sm">
                      <td className="px-6 py-4" colSpan={4}>Rekap Total</td>
                      <td className="px-6 py-4 text-right">{summary.totalQty.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4 text-right">{summary.totalRetur > 0 ? summary.totalRetur : '-'}</td>
                      <td className="px-6 py-4 text-right text-on-background">Rp {summary.totalPenjualan.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4 text-right text-on-surface-variant">Rp {summary.untukMitra.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4 text-right text-primary">Rp {summary.untukOwner.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4" colSpan={2} />
                    </tr>
                  </tfoot>
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
