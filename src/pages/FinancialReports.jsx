import { useState, useEffect, useMemo } from 'react';
import { transactionService, productService, returnService } from '../lib/services';
import {
  buildProfitRows,
  summarizeProfit,
  summarizeByMitra,
  summarizeByProduct,
  summarizeByDate,
  verifyConsistency,
  getLocalDate,
} from '../lib/profitReport';
import { downloadSpreadsheet, openPrintableReport } from '../lib/exportReport';
import Pagination from '../components/Pagination';

const rupiah = (value) => `Rp ${(Number(value) || 0).toLocaleString('id-ID')}`;

const getCurrentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const getMonthBounds = (month) => {
  const [year, monthIndex] = month.split('-').map(Number);
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
};

const ITEMS_PER_PAGE = 25;

const StatCard = ({ icon, label, value, caption, hero, tone = '' }) => (
  <div
    className={`rounded-xl p-6 shadow-sm flex flex-col justify-between min-h-[150px] relative overflow-hidden ${
      hero ? 'bg-primary text-on-primary shadow-md' : 'bg-surface-container-lowest border border-outline-variant'
    }`}
  >
    {hero && (
      <>
        <div className="absolute -right-8 -top-8 w-32 h-32 bg-primary-fixed-dim/20 rounded-full blur-xl" />
        <div className="absolute -left-8 -bottom-8 w-24 h-24 bg-secondary/20 rounded-full blur-lg" />
      </>
    )}
    <div className={`flex items-center justify-between relative ${hero ? 'text-on-primary/80' : 'text-on-surface-variant'}`}>
      <span className="font-label-md text-label-md">{label}</span>
      <span className={`material-symbols-outlined ${hero ? 'text-secondary-fixed' : 'text-primary'}`}>
        {icon}
      </span>
    </div>
    <div className="mt-4 relative">
      <span
        className={`font-display-lg text-display-lg font-numeric-data text-numeric-data tracking-tight ${
          hero ? 'text-secondary-fixed' : tone
        }`}
      >
        {value}
      </span>
      {caption && (
        <div className={`mt-1 font-label-sm text-label-sm ${hero ? 'text-tertiary-fixed' : 'text-on-surface-variant'}`}>
          {caption}
        </div>
      )}
    </div>
  </div>
);

function FinancialReports() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [returns, setReturns] = useState([]);
  const [products, setProducts] = useState([]);
  const [toast, setToast] = useState(null);

  const [startDate, setStartDate] = useState(getLocalDate(new Date()));
  const [endDate, setEndDate] = useState(getLocalDate(new Date()));
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedMitraId, setSelectedMitraId] = useState('semua');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoadError(null);
        const [transactionData, returnData, productData] = await Promise.all([
          transactionService.getHistory(),
          returnService.getAll(),
          productService.getAll(),
        ]);
        setTransactions(transactionData || []);
        setReturns(returnData || []);
        setProducts(productData || []);
      } catch (err) {
        setLoadError(err.message || 'Gagal memuat data keuangan');
        showToast('Gagal memuat data keuangan', 'error');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const rows = useMemo(
    () => buildProfitRows({ transactions, returns, products, startDate, endDate }),
    [transactions, returns, products, startDate, endDate]
  );

  const scopedRows = useMemo(
    () => (selectedMitraId === 'semua' ? rows : rows.filter((r) => String(r.mitraId) === selectedMitraId)),
    [rows, selectedMitraId]
  );

  const detailRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return scopedRows;
    return scopedRows.filter(
      (r) =>
        r.productName.toLowerCase().includes(keyword) ||
        r.mitraName.toLowerCase().includes(keyword)
    );
  }, [scopedRows, search]);

  const summary = useMemo(() => summarizeProfit(scopedRows), [scopedRows]);
  const byMitra = useMemo(() => summarizeByMitra(scopedRows), [scopedRows]);
  const byProduct = useMemo(() => summarizeByProduct(scopedRows), [scopedRows]);
  const byDate = useMemo(() => summarizeByDate(scopedRows), [scopedRows]);
  const problems = useMemo(() => verifyConsistency(summary, scopedRows), [summary, scopedRows]);

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return detailRows.slice(start, start + ITEMS_PER_PAGE);
  }, [detailRows, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate, selectedMonth, selectedMitraId, search]);

  const rangeLabel = useMemo(() => {
    if (!startDate && !endDate) return 'Semua Periode';
    if (startDate && endDate) return startDate === endDate ? startDate : `${startDate} s/d ${endDate}`;
    return startDate ? `Sejak ${startDate}` : `Sampai ${endDate}`;
  }, [startDate, endDate]);

  const setPreset = (preset) => {
    const today = getLocalDate(new Date());
    if (preset === 'today') {
      setSelectedMonth('');
      setStartDate(today);
      setEndDate(today);
      return;
    }
    if (preset === 'month') {
      const bounds = getMonthBounds(getCurrentMonth());
      setSelectedMonth(getCurrentMonth());
      setStartDate(bounds.start);
      setEndDate(bounds.end);
      return;
    }
    setSelectedMonth('');
    setStartDate('');
    setEndDate('');
  };

  const handleMonthChange = (value) => {
    setSelectedMonth(value);
    if (!value) return;
    const bounds = getMonthBounds(value);
    setStartDate(bounds.start);
    setEndDate(bounds.end);
  };

  const handleStartDateChange = (value) => {
    setSelectedMonth('');
    setStartDate(value);
    if (endDate && value && value > endDate) setEndDate(value);
  };

  const handleEndDateChange = (value) => {
    setSelectedMonth('');
    setEndDate(value);
    if (startDate && value && value < startDate) setStartDate(value);
  };

  const buildExportSections = () => [
    {
      heading: 'Pembagian Keuntungan',
      note: 'Aturan: Total Penjualan = Untuk Mitra + Untuk Owner. Mitra menerima harga yang ditetapkan mitra, Owner menerima selisihnya.',
      cards: [
        { label: 'Total Penjualan', value: summary.totalPenjualan, caption: `${summary.totalTransaksi} transaksi` },
        { label: 'Untuk Mitra', value: summary.untukMitra, caption: `${summary.porsiMitraPercent.toFixed(1)}% dari penjualan` },
        { label: 'Untuk Owner', value: summary.untukOwner, hero: true, caption: `Margin ${summary.marginPercent.toFixed(1)}%` },
      ],
    },
    {
      heading: 'Rincian per Mitra',
      headers: [
        { label: 'Mitra' },
        { label: 'Produk', align: 'right' },
        { label: 'Qty', align: 'right' },
        { label: 'Total Penjualan', align: 'right' },
        { label: 'Untuk Mitra', align: 'right' },
        { label: 'Untuk Owner', align: 'right' },
      ],
      rows: byMitra.map((m) => [
        m.mitraName,
        m.jumlahProduk,
        m.totalQty,
        { value: m.totalPenjualan, money: true, align: 'right' },
        { value: m.untukMitra, money: true, align: 'right' },
        { value: m.untukOwner, money: true, align: 'right', emphasis: true },
      ]),
      total: `${byMitra.length} mitra`,
    },
    {
      heading: 'Rincian per Produk',
      headers: [
        { label: 'Produk' },
        { label: 'Mitra' },
        { label: 'Qty', align: 'right' },
        { label: 'Modal Mitra', align: 'right' },
        { label: 'Harga Jual', align: 'right' },
        { label: 'Total Penjualan', align: 'right' },
        { label: 'Untuk Mitra', align: 'right' },
        { label: 'Untuk Owner', align: 'right' },
      ],
      rows: byProduct.map((p) => [
        p.productName,
        p.mitraName,
        p.totalQty,
        p.totalQty ? Math.round(p.untukMitra / p.totalQty) : 0,
        p.totalQty ? Math.round(p.totalPenjualan / p.totalQty) : 0,
        { value: p.totalPenjualan, money: true, align: 'right' },
        { value: p.untukMitra, money: true, align: 'right' },
        { value: p.untukOwner, money: true, align: 'right', emphasis: true },
      ]),
    },
    {
      heading: 'Rincian Harian',
      headers: [
        { label: 'Tanggal' },
        { label: 'Transaksi', align: 'right' },
        { label: 'Qty', align: 'right' },
        { label: 'Retur', align: 'right' },
        { label: 'Total Penjualan', align: 'right' },
        { label: 'Untuk Mitra', align: 'right' },
        { label: 'Untuk Owner', align: 'right' },
      ],
      rows: byDate.map((d) => [
        d.date,
        d.totalTransaksi,
        d.totalQty,
        d.totalRetur,
        { value: d.totalPenjualan, money: true, align: 'right' },
        { value: d.untukMitra, money: true, align: 'right' },
        { value: d.untukOwner, money: true, align: 'right', emphasis: true },
      ]),
    },
  ];

  const handleExportExcel = () => {
    const sheets = [
      {
        sheetName: 'Rekap Mitra',
        title: 'LAPAK BERKAH BUNTULIA - Pembagian Keuntungan',
        subtitle: `Periode: ${rangeLabel}`,
        headers: ['Mitra', 'Jumlah Produk', 'Qty', 'Total Penjualan', 'Untuk Mitra', 'Untuk Owner', 'Margin Owner (%)'],
        rows: byMitra.map((m) => [
          m.mitraName, m.jumlahProduk, m.totalQty,
          { value: m.totalPenjualan, money: true },
          { value: m.untukMitra, money: true },
          { value: m.untukOwner, money: true },
          Number(m.marginPercent.toFixed(1)),
        ]),
        summary: [
          ['Total Penjualan', { value: summary.totalPenjualan, money: true }],
          ['Untuk Mitra', { value: summary.untukMitra, money: true }],
          ['Untuk Owner', { value: summary.untukOwner, money: true }],
        ],
      },
      {
        sheetName: 'Rekap Produk',
        title: 'Rincian per Produk',
        subtitle: `Periode: ${rangeLabel}`,
        headers: ['Produk', 'Mitra', 'Qty', 'Modal Mitra', 'Harga Jual', 'Total Penjualan', 'Untuk Mitra', 'Untuk Owner'],
        rows: byProduct.map((p) => [
          p.productName, p.mitraName, p.totalQty,
          p.totalQty ? Math.round(p.untukMitra / p.totalQty) : 0,
          p.totalQty ? Math.round(p.totalPenjualan / p.totalQty) : 0,
          { value: p.totalPenjualan, money: true },
          { value: p.untukMitra, money: true },
          { value: p.untukOwner, money: true },
        ]),
      },
      {
        sheetName: 'Harian',
        title: 'Rincian Harian',
        subtitle: `Periode: ${rangeLabel}`,
        headers: ['Tanggal', 'Transaksi', 'Qty', 'Retur', 'Total Penjualan', 'Untuk Mitra', 'Untuk Owner'],
        rows: byDate.map((d) => [
          d.date, d.totalTransaksi, d.totalQty, d.totalRetur,
          { value: d.totalPenjualan, money: true },
          { value: d.untukMitra, money: true },
          { value: d.untukOwner, money: true },
        ]),
      },
      {
        sheetName: 'Detail Item',
        title: 'Detail Per Item',
        subtitle: `Periode: ${rangeLabel}`,
        headers: ['Tanggal', 'Mitra', 'Produk', 'Qty Terjual', 'Retur', 'Qty Netto', 'Modal Mitra', 'Harga Jual', 'Total Penjualan', 'Untuk Mitra', 'Untuk Owner'],
        rows: detailRows.map((r) => [
          r.date, r.mitraName, r.productName, r.soldQty, r.returnedQty, r.netQty,
          r.mitraPrice, r.sellingPrice,
          { value: r.totalSales, money: true },
          { value: r.untukMitra, money: true },
          { value: r.untukOwner, money: true },
        ]),
      },
    ];

    downloadSpreadsheet({
      fileName: `laporan-laba-profit-${startDate || 'awal'}-sd-${endDate || 'akhir'}.xls`,
      multiSheet: sheets,
    });

    showToast('Export Excel berhasil!', 'success');
  };

  const handleExportPdf = () => {
    const result = openPrintableReport({
      title: 'Laporan Pembagian Keuntungan',
      subtitle: `Periode: ${rangeLabel}`,
      sections: buildExportSections(),
    });

    if (!result.ok) {
      showToast('Popup diblokir. Izinkan popup untuk mencetak PDF.', 'error');
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
              <p className="font-body-md text-body-md text-on-surface-variant">Menghitung laporan keuntungan...</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const periodOptions = [
    { key: 'today', label: 'Hari Ini', active: selectedMonth === '' && startDate === endDate && startDate === getLocalDate(new Date()) },
    { key: 'month', label: 'Bulan Ini', active: selectedMonth === getCurrentMonth() },
    { key: 'all', label: 'Semua', active: !startDate && !endDate },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* Header */}
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">
                Laporan Pembagian Keuntungan
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                Laporan keuangan untuk Admin. Total Penjualan = Untuk Mitra + Untuk Owner.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center bg-surface-container-highest rounded-lg p-1">
                {periodOptions.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setPreset(option.key)}
                    className={`px-4 py-2 rounded-md font-label-md text-label-md h-[48px] transition-colors ${
                      option.active
                        ? 'bg-surface text-on-surface shadow-sm'
                        : 'text-on-surface-variant hover:bg-surface-variant'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleExportExcel}
                  className="bg-surface text-primary border border-primary hover:bg-surface-variant transition-colors px-4 py-2 rounded-lg font-label-md text-label-md flex items-center gap-2 h-[48px]"
                >
                  <span className="material-symbols-outlined text-[20px]">description</span>
                  Export Excel
                </button>
                <button
                  onClick={handleExportPdf}
                  className="bg-secondary text-on-secondary hover:bg-secondary/90 transition-colors px-4 py-2 rounded-lg font-label-md text-label-md flex items-center gap-2 h-[48px]"
                >
                  <span className="material-symbols-outlined text-[20px]">picture_as_pdf</span>
                  Export PDF
                </button>
              </div>
            </div>
          </header>

          {loadError && (
            <div className="bg-error-container/20 border border-error/30 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-error">error</span>
              <p className="font-body-md text-body-md text-error">{loadError}</p>
            </div>
          )}

          {/* Filter */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Filter Laporan</h3>
              <span className="font-label-md text-label-md text-on-surface-variant bg-surface-container-high px-3 py-1.5 rounded-full">
                Periode: {rangeLabel}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="block font-label-md text-label-md text-on-surface font-medium">Dari Tanggal</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="block font-label-md text-label-md text-on-surface font-medium">Sampai Tanggal</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="block font-label-md text-label-md text-on-surface font-medium">Filter Bulan</label>
                <input
                  type="month"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={selectedMonth}
                  onChange={(e) => handleMonthChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="block font-label-md text-label-md text-on-surface font-medium">Filter Mitra</label>
                <select
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={selectedMitraId}
                  onChange={(e) => setSelectedMitraId(e.target.value)}
                >
                  <option value="semua">Semua Mitra</option>
                  {byMitra.map((m) => (
                    <option key={m.mitraId || m.mitraName} value={String(m.mitraId)}>
                      {m.mitraName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Peringatan konsistensi */}
          {problems.length > 0 && (
            <div className="bg-[#fdf2d5] border border-[#ebd083] rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-[#7a590c]">warning</span>
              <div className="flex-1">
                <p className="font-label-md text-label-md text-[#7a590c]">Perhatian pada perhitungan</p>
                {problems.map((problem) => (
                  <p key={problem} className="font-body-sm text-body-sm text-[#7a590c] mt-1">{problem}</p>
                ))}
              </div>
            </div>
          )}

          {/* Tiga angka utama */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard
              icon="account_balance_wallet"
              label="Total Penjualan"
              value={rupiah(summary.totalPenjualan)}
              caption={`${summary.totalTransaksi} transaksi · ${summary.totalItem} item`}
            />
            <StatCard
              icon="store"
              label="Untuk Mitra"
              value={rupiah(summary.untukMitra)}
              caption={`Harga mitra · ${summary.porsiMitraPercent.toFixed(1)}% dari penjualan`}
            />
            <StatCard
              icon="trending_up"
              label="Untuk Owner"
              value={rupiah(summary.untukOwner)}
              caption={`Selisih harga jual - harga mitra · margin ${summary.marginPercent.toFixed(1)}%`}
              hero
            />
          </section>

          {/* Pendukung */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Qty Terjual</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {summary.totalQty.toLocaleString('id-ID')}
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Item Terdiretur</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {summary.totalRetur.toLocaleString('id-ID')}
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Jumlah Mitra</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {byMitra.length}
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Modal Mitra</p>
              <p className="font-headline-md text-headline-md text-on-surface font-numeric-data text-numeric-data">
                {rupiah(summary.untukMitra)}
              </p>
            </div>
          </section>

          {/* Per mitra */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Pembagian per Mitra</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Menjumlahkan seluruh produk milik mitra tersebut
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Mitra</th>
                    <th className="py-3 px-4 text-center">Produk</th>
                    <th className="py-3 px-4 text-right">Qty</th>
                    <th className="py-3 px-4 text-right">Total Penjualan</th>
                    <th className="py-3 px-4 text-right">Untuk Mitra</th>
                    <th className="py-3 px-4 text-right">Untuk Owner</th>
                    <th className="py-3 px-4 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50 text-sm">
                  {byMitra.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center py-8 text-on-surface-variant">
                        Belum ada penjualan pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    byMitra.map((m) => (
                      <tr
                        key={m.mitraId || m.mitraName}
                        className={`hover:bg-surface-container-low/50 transition-colors ${
                          selectedMitraId === String(m.mitraId) ? 'bg-surface-container-low' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <button
                            onClick={() => setSelectedMitraId(String(m.mitraId))}
                            className="text-on-surface font-medium hover:text-primary hover:underline text-left"
                          >
                            {m.mitraName}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-center text-on-surface-variant">{m.jumlahProduk}</td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">{m.totalQty}</td>
                        <td className="py-3 px-4 text-right text-on-background font-numeric-data text-numeric-data">
                          {rupiah(m.totalPenjualan)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(m.untukMitra)}
                        </td>
                        <td className="py-3 px-4 text-right text-primary font-semibold font-numeric-data text-numeric-data">
                          {rupiah(m.untukOwner)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {m.marginPercent.toFixed(1)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {byMitra.length > 0 && (
                  <tfoot className="border-t-2 border-outline-variant bg-surface-container-low">
                    <tr className="font-headline-sm text-headline-sm">
                      <td className="py-3 px-4">Total</td>
                      <td className="py-3 px-4 text-center">{byProduct.length}</td>
                      <td className="py-3 px-4 text-right">{summary.totalQty.toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4 text-right text-on-background">{rupiah(summary.totalPenjualan)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant">{rupiah(summary.untukMitra)}</td>
                      <td className="py-3 px-4 text-right text-primary">{rupiah(summary.untukOwner)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant">{summary.marginPercent.toFixed(1)}%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* Per produk */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Rincian per Produk</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Harga mitra vs harga jual tiap produk
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Produk</th>
                    <th className="py-3 px-4">Mitra</th>
                    <th className="py-3 px-4 text-right">Qty</th>
                    <th className="py-3 px-4 text-right">Modal Mitra</th>
                    <th className="py-3 px-4 text-right">Harga Jual</th>
                    <th className="py-3 px-4 text-right">Total Penjualan</th>
                    <th className="py-3 px-4 text-right">Untuk Mitra</th>
                    <th className="py-3 px-4 text-right">Untuk Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50 text-sm">
                  {byProduct.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center py-8 text-on-surface-variant">
                        Belum ada penjualan pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    byProduct.map((p) => (
                      <tr key={p.productId || p.productName} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="py-3 px-4 text-on-surface font-medium">{p.productName}</td>
                        <td className="py-3 px-4 text-on-surface-variant">{p.mitraName}</td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">{p.totalQty}</td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(p.totalQty ? Math.round(p.untukMitra / p.totalQty) : 0)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(p.totalQty ? Math.round(p.totalPenjualan / p.totalQty) : 0)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-background font-numeric-data text-numeric-data">
                          {rupiah(p.totalPenjualan)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(p.untukMitra)}
                        </td>
                        <td className="py-3 px-4 text-right text-primary font-semibold font-numeric-data text-numeric-data">
                          {rupiah(p.untukOwner)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Harian */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Rekap Harian</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant">Ringkasan per tanggal</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-4 text-center">Transaksi</th>
                    <th className="py-3 px-4 text-right">Qty</th>
                    <th className="py-3 px-4 text-right">Retur</th>
                    <th className="py-3 px-4 text-right">Total Penjualan</th>
                    <th className="py-3 px-4 text-right">Untuk Mitra</th>
                    <th className="py-3 px-4 text-right">Untuk Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50 text-sm">
                  {byDate.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center py-8 text-on-surface-variant">
                        Belum ada penjualan pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    byDate.map((d) => (
                      <tr key={d.date} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="py-3 px-4 text-on-surface font-medium">{d.date}</td>
                        <td className="py-3 px-4 text-center text-on-surface-variant">{d.totalTransaksi}</td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">{d.totalQty}</td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {d.totalRetur > 0 ? d.totalRetur : '-'}
                        </td>
                        <td className="py-3 px-4 text-right text-on-background font-numeric-data text-numeric-data">
                          {rupiah(d.totalPenjualan)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(d.untukMitra)}
                        </td>
                        <td className="py-3 px-4 text-right text-primary font-semibold font-numeric-data text-numeric-data">
                          {rupiah(d.untukOwner)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Detail item */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-background">Detail Per Item</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Sumber angka di laporan ini</p>
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">search</span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari produk atau mitra..."
                  className="pl-10 pr-4 py-2 border border-outline-variant rounded-lg bg-surface-container-lowest focus:ring-2 focus:ring-primary focus:border-primary w-full md:w-72 font-body-md text-body-md h-[48px] outline-none"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-4">Produk</th>
                    <th className="py-3 px-4">Mitra</th>
                    <th className="py-3 px-4 text-right">Qty</th>
                    <th className="py-3 px-4 text-right">Modal</th>
                    <th className="py-3 px-4 text-right">Harga Jual</th>
                    <th className="py-3 px-4 text-right">Untuk Mitra</th>
                    <th className="py-3 px-4 text-right">Untuk Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50 text-sm">
                  {pagedRows.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center py-8 text-on-surface-variant">
                        Tidak ada data yang cocok dengan filter.
                      </td>
                    </tr>
                  ) : (
                    pagedRows.map((r, idx) => (
                      <tr
                        key={`${r.transactionId}-${r.productId}-${idx}`}
                        className={`hover:bg-surface-container-low/50 transition-colors ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}
                      >
                        <td className="py-3 px-4 text-on-surface-variant font-numeric-data text-numeric-data">
                          {r.date}
                          {r.returnedQty > 0 && (
                            <span className="block text-[11px] text-[#7a590c]">retur {r.returnedQty} pcs</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-on-surface">{r.productName}</td>
                        <td className="py-3 px-4 text-on-surface-variant">{r.mitraName}</td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {r.netQty}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(r.mitraPrice)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface font-numeric-data text-numeric-data">
                          {rupiah(r.sellingPrice)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(r.untukMitra)}
                        </td>
                        <td className="py-3 px-4 text-right text-primary font-semibold font-numeric-data text-numeric-data">
                          {rupiah(r.untukOwner)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {detailRows.length > 0 && (
                  <tfoot className="border-t-2 border-outline-variant bg-surface-container-low">
                    <tr className="font-headline-sm text-headline-sm">
                      <td className="py-3 px-4" colSpan="3">Rekap Total</td>
                      <td className="py-3 px-4 text-right">{summary.totalQty.toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4" colSpan="2" />
                      <td className="py-3 px-4 text-right text-on-surface-variant">{rupiah(summary.untukMitra)}</td>
                      <td className="py-3 px-4 text-right text-primary">{rupiah(summary.untukOwner)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pagination
              totalItems={detailRows.length}
              itemsPerPage={ITEMS_PER_PAGE}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
            />
          </section>
        </div>
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center gap-2 ${
            toast.type === 'error'
              ? 'bg-error-container text-error border-error/30'
              : 'bg-surface-container-high text-on-background border-outline-variant'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {toast.type === 'error' ? 'error' : 'check_circle'}
          </span>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default FinancialReports;