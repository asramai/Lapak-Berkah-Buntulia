import { useState, useEffect, useMemo, useCallback } from 'react';
import { transactionService, productService, mitraService, mitraSettlementService } from '../lib/services';
import { downloadSpreadsheet, openPrintableReport } from '../lib/exportReport';
import Pagination from '../components/Pagination';

const rupiah = (value) => `Rp ${(Number(value) || 0).toLocaleString('id-ID')}`;

const getLocalDate = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getLocalTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

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

const ACTIVE_TRANSACTION_STATUS = 'Selesai';

function FinancialReports() {
  const [loading, setLoading] = useState(true);
  const [retailRows, setRetailRows] = useState([]);
  const [settlementRows, setSettlementRows] = useState([]);
  const [mitraNameById, setMitraNameById] = useState({});
  const [toast, setToast] = useState(null);

  const [startDate, setStartDate] = useState(getLocalDate(new Date()));
  const [endDate, setEndDate] = useState(getLocalDate(new Date()));
  const [selectedMonth, setSelectedMonth] = useState('');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [transactionData, productData, settlementData, mitraData] = await Promise.all([
          transactionService.getHistory(),
          productService.getAll(),
          mitraSettlementService.getAll().catch(() => []),
          mitraService.getAll(),
        ]);

        const costByProduct = new Map((productData || []).map((p) => [p.id, Number(p.mitra_price) || 0]));

        const mappedRetail = [];
        (transactionData || []).forEach((tx) => {
          const date = tx.created_at ? getLocalDate(tx.created_at) : '';
          (tx.items || []).forEach((item) => {
            const qty = Number(item.quantity) || 0;
            const hargaJual = Number(item.harga_satuan) || 0;
            const modal = costByProduct.get(item.product_id) || 0;
            mappedRetail.push({
              transactionId: tx.id,
              invoiceNumber: tx.transaction_number || `#${String(tx.id).slice(0, 8).toUpperCase()}`,
              date,
              time: getLocalTime(tx.created_at),
              status: tx.status || '-',
              paymentMethod: tx.metode_pembayaran || '-',
              mitraName: tx.mitra?.full_name || '-',
              productName: item.product?.nama_produk || '-',
              qty,
              hargaJual,
              modal,
              subtotal: qty * hargaJual,
              profit: qty * (hargaJual - modal),
            });
          });
        });

        const mappedSettlements = (settlementData || []).map((s) => ({
          id: s.id,
          invoiceNumber: s.invoice_number,
          date: (s.date || '').slice(0, 10),
          status: s.status || 'pending',
          mitraId: s.mitra_id,
          mitraName: s.mitra?.full_name || '-',
          totalJual: Number(s.total_amount) || 0,
          totalProfit: Number(s.total_profit) || 0,
        }));

        setRetailRows(mappedRetail);
        setSettlementRows(mappedSettlements);
        setMitraNameById(
          Object.fromEntries((mitraData || []).map((m) => [m.id, m.full_name]))
        );
      } catch {
        showToast('Gagal memuat data keuangan', 'error');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const inRange = useCallback((date) => {
    if (startDate && date < startDate) return false;
    if (endDate && date > endDate) return false;
    return true;
  }, [startDate, endDate]);

  const filteredRetail = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return retailRows.filter((row) => {
      if (!inRange(row.date)) return false;
      if (!keyword) return true;
      return (
        row.productName.toLowerCase().includes(keyword) ||
        row.mitraName.toLowerCase().includes(keyword) ||
        row.invoiceNumber.toLowerCase().includes(keyword)
      );
    });
  }, [retailRows, inRange, search]);

  const filteredSettlements = useMemo(
    () => settlementRows.filter((row) => inRange(row.date)),
    [settlementRows, inRange]
  );

  const retail = useMemo(() => {
    const counted = filteredRetail.filter((row) => row.status === ACTIVE_TRANSACTION_STATUS);
    const omzet = counted.reduce((sum, row) => sum + row.subtotal, 0);
    const modal = counted.reduce((sum, row) => sum + row.modal * row.qty, 0);
    const totalKotor = counted.reduce((sum, row) => sum + row.profit, 0);
    const totalQty = counted.reduce((sum, row) => sum + row.qty, 0);
    return {
      omzet,
      modal,
      totalKotor,
      totalQty,
      totalItem: counted.length,
      totalTransaksi: new Set(counted.map((row) => row.transactionId)).size,
      marginPercent: omzet > 0 ? (totalKotor / omzet) * 100 : 0,
    };
  }, [filteredRetail]);

  const mitraProfit = useMemo(() => {
    const counted = filteredSettlements.filter((row) => row.status !== 'cancelled');
    const byMitra = new Map();
    counted.forEach((row) => {
      const key = row.mitraId || 'unknown';
      const existing = byMitra.get(key) || {
        mitraId: row.mitraId,
        mitraName: row.mitraName === '-' ? (mitraNameById[row.mitraId] || '-') : row.mitraName,
        invoice: 0,
        totalJual: 0,
        totalProfit: 0,
      };
      existing.invoice += 1;
      existing.totalJual += row.totalJual;
      existing.totalProfit += row.totalProfit;
      byMitra.set(key, existing);
    });

    const rows = Array.from(byMitra.values()).sort((a, b) => b.totalProfit - a.totalProfit);
    return {
      rows,
      totalProfit: counted.reduce((sum, row) => sum + row.totalProfit, 0),
      totalJual: counted.reduce((sum, row) => sum + row.totalJual, 0),
      totalInvoice: counted.length,
    };
  }, [filteredSettlements, mitraNameById]);

  const ownerProfit = retail.totalKotor - mitraProfit.totalProfit;

  const pagedRetail = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredRetail.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredRetail, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate, selectedMonth, search]);

  const rangeLabel = useMemo(() => {
    if (!startDate && !endDate) return 'Semua Periode';
    if (startDate && endDate) {
      return startDate === endDate ? startDate : `${startDate} s/d ${endDate}`;
    }
    return startDate ? `Sejak ${startDate}` : ` Sampai ${endDate}`;
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

  const handleExportExcel = () => {
    const detailRows = filteredRetail.map((row, index) => [
      index + 1,
      row.date,
      row.time,
      row.mitraName,
      row.productName,
      row.qty,
      row.hargaJual,
      row.modal,
      row.subtotal,
      row.status === ACTIVE_TRANSACTION_STATUS ? row.profit : 0,
    ]);

    const summaryRows = [
      ['Total Omset', { value: retail.omzet, money: true }],
      ['Total Modal Mitra', { value: retail.modal, money: true }],
      ['Total Keuntungan (Kotor)', { value: retail.totalKotor, money: true }],
      ['Total Keuntungan Mitra', { value: mitraProfit.totalProfit, money: true }],
      ['Total Keuntungan Owner', { value: ownerProfit, money: true }],
    ];

    downloadSpreadsheet({
      fileName: `laporan-laba-profit-${startDate || 'awal'}-sd-${endDate || 'akhir'}.xls`,
      sheetName: 'Laba Profit',
      title: 'LAPAK BERKAH BUNTULIA - Laporan Laba & Profit',
      subtitle: `Periode: ${rangeLabel}`,
      headers: [
        'No', 'Tanggal', 'Jam', 'Mitra', 'Produk', 'Qty',
        'Harga Jual', 'Modal Mitra', 'Subtotal', 'Keuntungan',
      ],
      rows: detailRows,
      summary: summaryRows,
    });

    showToast('Export Excel berhasil!', 'success');
  };

  const handleExportPdf = () => {
    const result = openPrintableReport({
      title: 'Laporan Laba & Profit',
      subtitle: `Periode: ${rangeLabel}`,
      sections: [
        {
          heading: 'Ringkasan Keuntungan',
          note: 'Keuntungan Owner = Total Keuntungan (Kotor) - Total Keuntungan Mitra',
          cards: [
            { label: 'Total Keuntungan (Kotor)', value: retail.totalKotor, caption: `${retail.totalTransaksi} transaksi` },
            { label: 'Total Keuntungan Mitra', value: mitraProfit.totalProfit, caption: `${mitraProfit.totalInvoice} nota mitra` },
            { label: 'Total Keuntungan Owner', value: ownerProfit, hero: true, caption: `Margin ${retail.marginPercent.toFixed(1)}%` },
          ],
        },
        {
          heading: 'Rincian Omzet',
          cards: [
            { label: 'Total Omset', value: retail.omzet },
            { label: 'Total Modal Mitra', value: retail.modal },
            { label: 'Total Qty', value: retail.totalQty, caption: `${retail.totalItem} item` },
          ],
        },
        {
          heading: 'Keuntungan Mitra per Mitra',
          headers: [
            { label: 'Mitra' },
            { label: 'Nota', align: 'right' },
            { label: 'Total Jual', align: 'right' },
            { label: 'Keuntungan', align: 'right' },
          ],
          rows: mitraProfit.rows.map((row) => [
            row.mitraName,
            row.invoice,
            { value: row.totalJual, money: true, align: 'right' },
            { value: row.totalProfit, money: true, align: 'right', emphasis: true },
          ]),
          total: `${mitraProfit.rows.length} mitra`,
        },
        {
          heading: 'Detail Keuntungan Transaksi',
          headers: [
            { label: 'Tanggal' },
            { label: 'Mitra' },
            { label: 'Produk' },
            { label: 'Qty', align: 'right' },
            { label: 'Harga Jual', align: 'right' },
            { label: 'Modal Mitra', align: 'right' },
            { label: 'Keuntungan', align: 'right' },
          ],
          rows: filteredRetail.map((row) => [
            `${row.date} ${row.time}`,
            row.mitraName,
            row.productName,
            row.qty,
            { value: row.hargaJual, money: true, align: 'right' },
            { value: row.modal, money: true, align: 'right' },
            { value: row.profit, money: true, align: 'right', emphasis: true },
          ]),
        },
      ],
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
              <p className="font-body-md text-body-md text-on-surface-variant">Memuat data keuangan...</p>
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
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Laporan Laba &amp; Profit</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">Laporan keuangan harian untuk Admin.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex items-center bg-surface-container-highest rounded-lg p-1">
                <button
                  onClick={() => setPreset('today')}
                  className={`px-4 py-2 rounded-md font-label-md text-label-md h-[48px] transition-colors ${
                    selectedMonth === '' && startDate === endDate && startDate === getLocalDate(new Date())
                      ? 'bg-surface text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-variant'
                  }`}
                >
                  Hari Ini
                </button>
                <button
                  onClick={() => setPreset('month')}
                  className={`px-4 py-2 rounded-md font-label-md text-label-md h-[48px] transition-colors ${
                    selectedMonth === getCurrentMonth()
                      ? 'bg-surface text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-variant'
                  }`}
                >
                  Bulan Ini
                </button>
                <button
                  onClick={() => setPreset('all')}
                  className={`px-4 py-2 rounded-md font-label-md text-label-md h-[48px] transition-colors ${
                    !startDate && !endDate
                      ? 'bg-surface text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-variant'
                  }`}
                >
                  Semua
                </button>
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

          {/* Filter Tanggal & Filter Bulan */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Filter Laporan</h3>
              <span className="font-label-md text-label-md text-on-surface-variant bg-surface-container-high px-3 py-1.5 rounded-full">
                Periode: {rangeLabel}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            </div>
          </section>

          {/* Dashboard Rekap Keuntungan */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm flex flex-col justify-between min-h-[140px]">
              <div className="flex items-center justify-between text-on-surface-variant">
                <span className="font-label-md text-label-md">Total Keuntungan (Kotor)</span>
                <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
              </div>
              <div className="mt-4">
                <span className="font-display-lg text-display-lg font-numeric-data text-numeric-data text-on-background tracking-tight">
                  {rupiah(retail.totalKotor)}
                </span>
                <div className="flex items-center gap-1 mt-1 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px]">percent</span>
                  <span className="font-label-sm text-label-sm">Margin {retail.marginPercent.toFixed(1)}% dari omset</span>
                </div>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm flex flex-col justify-between min-h-[140px]">
              <div className="flex items-center justify-between text-on-surface-variant">
                <span className="font-label-md text-label-md">Total Keuntungan Mitra</span>
                <span className="material-symbols-outlined text-primary">store</span>
              </div>
              <div className="mt-4">
                <span className="font-display-lg text-display-lg font-numeric-data text-numeric-data text-on-background tracking-tight">
                  {rupiah(mitraProfit.totalProfit)}
                </span>
                <div className="flex items-center gap-1 mt-1 text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px]">groups</span>
                  <span className="font-label-sm text-label-sm">
                    {mitraProfit.rows.length} mitra · {mitraProfit.totalInvoice} nota
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-primary text-on-primary rounded-xl p-6 shadow-md flex flex-col justify-between min-h-[140px] relative overflow-hidden">
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-primary-fixed-dim/20 rounded-full blur-xl" />
              <div className="absolute -left-8 -bottom-8 w-24 h-24 bg-secondary/20 rounded-full blur-lg" />
              <div className="flex items-center justify-between text-on-primary/80 relative">
                <span className="font-label-md text-label-md">Total Keuntungan Owner</span>
                <span className="material-symbols-outlined text-secondary-fixed">trending_up</span>
              </div>
              <div className="mt-4 relative">
                <span className="font-display-lg text-display-lg font-numeric-data text-numeric-data text-secondary-fixed tracking-tight">
                  {rupiah(ownerProfit)}
                </span>
                <div className="flex items-center gap-1 mt-1 text-tertiary-fixed">
                  <span className="material-symbols-outlined text-[16px]">calculate</span>
                  <span className="font-label-sm text-label-sm">Kotor minus Keuntungan Mitra</span>
                </div>
              </div>
            </div>
          </section>

          {/* Ringkasan Pendukung */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Omset</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {rupiah(retail.omzet)}
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Modal Mitra</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {rupiah(retail.modal)}
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Jumlah Transaksi</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {retail.totalTransaksi}
              </p>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Qty Terjual</p>
              <p className="font-headline-md text-headline-md text-on-background font-numeric-data text-numeric-data">
                {retail.totalQty.toLocaleString('id-ID')}
              </p>
            </div>
          </section>

          {/* Rekap Keuntungan per Mitra */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-background">Rekap Keuntungan Mitra</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Keuntungan dari nota penjualan ke mitra</p>
              </div>
              <span className="font-label-md text-label-md text-on-surface-variant bg-surface-container-high px-3 py-1.5 rounded-full self-start sm:self-auto">
                Total {rupiah(mitraProfit.totalProfit)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">Mitra</th>
                    <th className="py-3 px-4 text-center">Nota</th>
                    <th className="py-3 px-4 text-right">Total Jual</th>
                    <th className="py-3 px-4 text-right">Keuntungan</th>
                    <th className="py-3 px-4 text-right">Porsi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50 text-sm">
                  {mitraProfit.rows.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8 text-on-surface-variant">
                        Belum ada nota penjualan ke mitra pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    mitraProfit.rows.map((row) => (
                      <tr key={row.mitraId || row.mitraName} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="py-3 px-4 text-on-surface font-medium">{row.mitraName}</td>
                        <td className="py-3 px-4 text-center text-on-surface-variant">{row.invoice}</td>
                        <td className="py-3 px-4 text-right text-on-background font-numeric-data text-numeric-data">
                          {rupiah(row.totalJual)}
                        </td>
                        <td className="py-3 px-4 text-right text-primary font-semibold font-numeric-data text-numeric-data">
                          {rupiah(row.totalProfit)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {mitraProfit.totalProfit > 0
                            ? `${((row.totalProfit / mitraProfit.totalProfit) * 100).toFixed(1)}%`
                            : '0%'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {mitraProfit.rows.length > 0 && (
                  <tfoot className="border-t-2 border-outline-variant bg-surface-container-low">
                    <tr className="font-headline-sm text-headline-sm">
                      <td className="py-3 px-4" colSpan="2">Total</td>
                      <td className="py-3 px-4 text-right text-on-background">{rupiah(mitraProfit.totalJual)}</td>
                      <td className="py-3 px-4 text-right text-primary">{rupiah(mitraProfit.totalProfit)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant">100%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* Detail Transaksi */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-background">Rincian Keuntungan Transaksi</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Perhitungan per item penjualan</p>
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
                    <th className="py-3 px-4">Waktu / ID</th>
                    <th className="py-3 px-4">Mitra / Produk</th>
                    <th className="py-3 px-4 text-center">Qty</th>
                    <th className="py-3 px-4 text-right">Harga Jual</th>
                    <th className="py-3 px-4 text-right">Modal Mitra</th>
                    <th className="py-3 px-4 text-right">Keuntungan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50 text-sm">
                  {pagedRetail.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="text-center py-8 text-on-surface-variant">
                        Tidak ada transaksi pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    pagedRetail.map((row, index) => (
                      <tr
                        key={`${row.transactionId}-${index}`}
                        className={`hover:bg-surface-container-low/50 transition-colors ${index % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-on-surface">{row.date} {row.time}</div>
                          <div className="text-on-surface-variant font-label-sm text-label-sm">{row.invoiceNumber}</div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-on-surface">{row.productName}</div>
                          <div className="text-on-surface-variant font-label-sm text-label-sm">{row.mitraName}</div>
                        </td>
                        <td className="py-3 px-4 text-center text-on-surface-variant font-numeric-data text-numeric-data">{row.qty}</td>
                        <td className="py-3 px-4 text-right text-on-background font-numeric-data text-numeric-data">
                          {rupiah(row.hargaJual)}
                        </td>
                        <td className="py-3 px-4 text-right text-on-surface-variant font-numeric-data text-numeric-data">
                          {rupiah(row.modal)}
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-semibold font-numeric-data text-numeric-data ${
                            row.status === ACTIVE_TRANSACTION_STATUS ? 'text-primary' : 'text-on-surface-variant'
                          }`}
                        >
                          {rupiah(row.profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredRetail.length > 0 && (
                  <tfoot className="border-t-2 border-outline-variant bg-surface-container-low">
                    <tr className="font-headline-sm text-headline-sm">
                      <td className="py-3 px-4" colSpan="2">Rekap Total</td>
                      <td className="py-3 px-4 text-center">{retail.totalQty.toLocaleString('id-ID')}</td>
                      <td className="py-3 px-4 text-right text-on-background">{rupiah(retail.omzet)}</td>
                      <td className="py-3 px-4 text-right text-on-surface-variant">{rupiah(retail.modal)}</td>
                      <td className="py-3 px-4 text-right text-primary">{rupiah(retail.totalKotor)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <Pagination
              totalItems={filteredRetail.length}
              itemsPerPage={ITEMS_PER_PAGE}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
            />
          </section>
        </div>
      </main>

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center gap-2 ${
          toast.type === 'error'
            ? 'bg-error-container text-error border-error/30'
            : 'bg-surface-container-high text-on-background border-outline-variant'
        }`}>
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
