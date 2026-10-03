import { useState, useEffect, useMemo, useCallback } from 'react';
import { transactionService, returnService, productService, stockMovementService } from '../lib/services';
import { buildProfitRows, summarizeProfit } from '../lib/profitReport';
import { printReceipt as printReceiptBluetooth, printReturnReceiptBluetooth } from '../lib/bluetoothPrinter';
import Pagination from '../components/Pagination';

function TransactionHistory({ user }) {
  const [history, setHistory] = useState([]);
  const [rawTransactions, setRawTransactions] = useState([]);
  const [returnRows, setReturnRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedPayment, setSelectedPayment] = useState('Semua');
  const [returnModal, setReturnModal] = useState({ open: false, transaction: null });
  const [returnItems, setReturnItems] = useState({});
  const [returnedQty, setReturnedQty] = useState({});
  const [returnReason, setReturnReason] = useState('');
  const [processingReturn, setProcessingReturn] = useState(false);
  const [toast, setToast] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(20);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const [data, returnData, productData] = await Promise.all([
        transactionService.getHistory(),
        returnService.getAll(),
        productService.getAll(),
      ]);

      const mapped = (data || []).map((tx) => {
        const txId = tx.transaction_id || `TX-${String(tx.id).padStart(3, '0')}`;
        const rawDate = tx.created_at || '';
        const formattedDate = rawDate
          ? rawDate.replace('T', ' ').replace(/\.\d+Z$/, '').substring(0, 16)
          : '';
        const totalQty = tx.items?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

        return {
          id: tx.id,
          transactionId: txId,
          date: formattedDate,
          mitraId: tx.mitra_id || null,
          mitraName: tx.mitra?.full_name || 'Tidak Diketahui',
          items: totalQty,
          rawItems: tx.items || [],
          total: tx.total || 0,
          paymentMethod: tx.metode_pembayaran || '-',
      confirmedBy: tx.confirmed_by || null,
      confirmedAt: tx.confirmed_at || null,
      confirmedMethod: tx.confirmed_method || null,
          status: tx.status || '-',
          paid: tx.paid || 0,
          change: tx.change || 0,
        };
      });

      setHistory(mapped);
      setRawTransactions(data || []);
      setReturnRows(returnData || []);
      setProducts(productData || []);
    } catch (err) {
      setError(err.message || 'Gagal memuat riwayat transaksi');
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredHistory = useMemo(() => {
    return history.filter((h) => {
      const matchesSearch = h.transactionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        h.mitraName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDate = (!startDate || h.date >= startDate) && (!endDate || h.date <= endDate + ' 23:59');
      const matchesPayment = selectedPayment === 'Semua' || h.paymentMethod === selectedPayment;
      return matchesSearch && matchesDate && matchesPayment;
    });
  }, [history, searchQuery, startDate, endDate, selectedPayment]);

  const paginatedHistory = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredHistory.slice(start, start + itemsPerPage);
  }, [filteredHistory, currentPage, itemsPerPage]);

  // Omzet memakai modul kalkulasi yang sama dengan Laporan Pembagian Keuntungan.
  // Penting: baris tabel HARUS memakai angka yang sama dengan kartu, supaya
  // jumlah baris selalu sama dengan total di atas.
  const scopedProfitRows = useMemo(() => {
    // WAJIB memakai data mentah dari database, bukan `history` yang sudah
    // dimapping. Modul kalkulasi membaca `created_at` dan `items`; bentuk
    // mapped menyimpan `date` dan `rawItems`, sehingga semua baris akan
    // terbuang dan kolom报告显示 nol.
    const rows = buildProfitRows({
      transactions: rawTransactions,
      returns: returnRows,
      products,
      startDate: '0000-01-01',
      endDate: '9999-12-31',
    });
    const visibleIds = new Set(filteredHistory.map((h) => h.id));
    const scoped = rows.filter((r) => visibleIds.has(r.transactionId));
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return scoped;
    return scoped.filter(
      (r) => r.mitraName.toLowerCase().includes(keyword) || (r.productName || '').toLowerCase().includes(keyword)
    );
  }, [rawTransactions, returnRows, products, filteredHistory, searchQuery]);

  const omzetRows = useMemo(() => summarizeProfit(scopedProfitRows), [scopedProfitRows]);

  // Angka per transaksi untuk kolom tabel.
  const perTransaction = useMemo(() => {
    const map = new Map();
    scopedProfitRows.forEach((row) => {
      const existing = map.get(row.transactionId) || {
        totalSales: 0, untukMitra: 0, untukOwner: 0, retur: 0, qty: 0,
      };
      existing.totalSales += row.totalSales;
      existing.untukMitra += row.untukMitra;
      existing.untukOwner += row.untukOwner;
      existing.retur += row.returnedQty;
      existing.qty += row.netQty;
      map.set(row.transactionId, existing);
    });
    return map;
  }, [scopedProfitRows]);

  const totalTransactions = filteredHistory.length;
  const totalOmzet = omzetRows.totalPenjualan;

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, startDate, endDate, selectedPayment]);

  const openReturnModal = async (transaction) => {
    setReturnModal({ open: true, transaction });
    setReturnItems({});
    setReturnReason('');
    setReturnedQty({});

    try {
      const existing = await returnService.getByTransaction(transaction.id);
      const totals = {};
      (existing || []).forEach((row) => {
        if (!row.transaction_item_id) return;
        totals[row.transaction_item_id] = (totals[row.transaction_item_id] || 0) + (row.quantity || 0);
      });
      setReturnedQty(totals);
    } catch {
      showToast('Gagal memuat data retur sebelumnya', 'error');
    }
  };

  const getReturnableQty = (item) => {
    const sold = Number(item.quantity) || 0;
    const alreadyReturned = returnedQty[item.id] || 0;
    return Math.max(0, sold - alreadyReturned);
  };

  const handleReturnQuantityChange = (itemId, maxQty, value) => {
    const qty = Math.max(0, Math.min(Number(value) || 0, maxQty));
    setReturnItems((prev) => ({ ...prev, [itemId]: qty }));
  };

  const handleSubmitReturn = async () => {
    if (!returnModal.transaction || processingReturn) return;

    const itemsToReturn = Object.entries(returnItems)
      .filter(([_itemId, qty]) => qty > 0)
      .map(([itemId, qty]) => ({ itemId, qty: Number(qty) }));

    if (itemsToReturn.length === 0) {
      showToast('Pilih minimal satu item untuk diretur', 'error');
      return;
    }

    const transaction = returnModal.transaction;
    const details = itemsToReturn.map(({ itemId, qty }) => ({
      item: transaction.rawItems.find((i) => i.id === itemId),
      qty,
      maxQty: getReturnableQty(transaction.rawItems.find((i) => i.id === itemId) || { quantity: 0 }),
    }));

    const invalid = details.find((d) => !d.item || d.qty > d.maxQty);
    if (invalid) {
      showToast(
        invalid.item
          ? `Jumlah retur melebihi sisa yang bisa diretur (${invalid.maxQty} pcs)`
          : 'Item transaksi tidak ditemukan, muat ulang halaman',
        'error'
      );
      return;
    }

    setProcessingReturn(true);
    try {
      for (const { item, qty } of details) {
        await returnService.create({
          transaction_id: transaction.id,
          transaction_item_id: item.id,
          product_id: item.product_id,
          quantity: qty,
          reason: returnReason,
          user_id: user?.id || null,
        });

        const newStock = await productService.incrementStock(item.product_id, qty);
        if (newStock === null) {
          throw new Error(`Produk ${item.product?.nama_produk || item.product_id} tidak ditemukan`);
        }

        await stockMovementService.create({
          type: 'in',
          product_id: item.product_id,
          quantity: qty,
          note: `Retur #${transaction.transactionId}`,
          mitra_id: transaction.mitraId || null,
        });
      }

      await loadTransactions();
      showToast('Retur berhasil diproses', 'success');
      setReturnModal({ open: false, transaction: null });
      setReturnItems({});
      setReturnReason('');
      setReturnedQty({});
    } catch (err) {
      const raw = err?.message || '';
      if (/increment_product_stock|PGRST202|function.*does not exist/i.test(raw)) {
        showToast('Fitur retur belum siap: jalankan scripts/atomic-stock-increment.sql di Supabase', 'error');
      } else {
        showToast(raw || 'Gagal memproses retur', 'error');
      }
    } finally {
      setProcessingReturn(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* Page Header */}
          <header className="hidden md:flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Riwayat Transaksi</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                Daftar transaksi yang telah selesai
              </p>
            </div>
          </header>

          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Riwayat</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Transaksi selesai</p>
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
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">{totalTransactions}</p>
              </div>
            </div>

            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-secondary-fixed flex items-center justify-center text-on-secondary-fixed">
                  <span className="material-symbols-outlined">shopping_cart</span>
                </div>
                <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">Item</span>
              </div>
              <div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Item</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">{filteredHistory.reduce((sum, h) => sum + h.items, 0)}</p>
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
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">{loading ? '-' : `Rp ${totalOmzet.toLocaleString('id-ID')}`}</p>
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
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">Rp {totalTransactions > 0 ? Math.round(totalOmzet / totalTransactions).toLocaleString('id-ID') : 0}</p>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-error-container/20 border border-error/30 rounded-xl p-4 flex items-start gap-3">
              <span className="material-symbols-outlined text-error">error</span>
              <div className="flex-1">
                <p className="font-label-md text-label-md text-error">Gagal memuat riwayat transaksi</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{error}</p>
              </div>
              <button
                onClick={loadTransactions}
                className="h-9 px-3 rounded-lg border border-error/40 text-error font-label-md text-label-md hover:bg-error/10 transition-colors"
              >
                Coba Lagi
              </button>
            </div>
          )}

          {/* Filters */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Cari Transaksi</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
                  <input
                    className="w-full h-12 pl-10 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md transition-all placeholder:text-outline/70"
                    placeholder="ID Transaksi atau Mitra..."
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="w-full md:w-48">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Dari Tanggal</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="w-full md:w-48">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Sampai Tanggal</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="w-full md:w-48">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Metode</label>
                <select
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none"
                  value={selectedPayment}
                  onChange={(e) => setSelectedPayment(e.target.value)}
                >
                  <option value="Semua">Semua</option>
                  <option value="Tunai">Tunai</option>
                  <option value="QRIS">QRIS</option>
                  <option value="Transfer">Transfer</option>
                </select>
              </div>
            </div>
          </div>

          {/* Transaction Table */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-outline-variant bg-surface">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Daftar Transaksi</h3>
               <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Menampilkan {totalTransactions} transaksi</p>
            </div>

             {loading && history.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center gap-3">
                <span className="material-symbols-outlined text-6xl text-primary animate-pulse">progress_activity</span>
                <p className="font-body-md text-body-md text-on-surface-variant">Memuat riwayat transaksi...</p>
              </div>
            ) : paginatedHistory.length === 0 ? (
              <div className="p-12 text-center">
                <span className="material-symbols-outlined text-6xl text-outline mb-3">receipt_long</span>
                <p className="font-body-md text-body-md text-on-surface-variant">
                  {error ? 'Gagal memuat data transaksi' : 'Tidak ada transaksi yang ditemukan'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low border-b border-outline-variant">
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">ID</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Tanggal</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Mitra</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Qty</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Retur</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Total Penjualan</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Untuk Mitra</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Untuk Owner</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Metode</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Status</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                     {paginatedHistory.map((h, idx) => {
                       const angka = perTransaction.get(h.id) || { totalSales: 0, untukMitra: 0, untukOwner: 0, retur: 0, qty: 0 };
                       return (
                      <tr key={h.id} className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}>
                        <td className="px-6 py-4">
                          <span className="font-mono text-sm bg-surface-container px-2 py-1 rounded-md text-on-surface-variant">#{h.transactionId}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-body-sm text-body-sm text-on-surface">{h.date}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-body-sm text-body-sm text-on-surface">{h.mitraName}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-on-background">{angka.qty}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={`font-numeric-data text-numeric-data ${angka.retur > 0 ? 'text-[#7a590c] font-semibold' : 'text-outline'}`}>
                            {angka.retur > 0 ? angka.retur : '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-on-background font-semibold">Rp {angka.totalSales.toLocaleString('id-ID')}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-on-surface-variant">Rp {angka.untukMitra.toLocaleString('id-ID')}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-numeric-data text-numeric-data text-primary font-semibold">Rp {angka.untukOwner.toLocaleString('id-ID')}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-label-sm bg-surface-container text-on-surface-variant border border-outline-variant">
                            {h.paymentMethod}
                          </span>
                          {h.paymentMethod === 'QRIS' && (
                            <div className="mt-1 font-body-xs text-body-xs text-on-surface-variant">
                              {h.confirmedBy ? (
                                <>
                                  oleh {h.confirmedBy}
                                  {h.confirmedAt && (
                                    <> · {new Date(h.confirmedAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
                                  )}
                                </>
                              ) : (
                                'belum dikonfirmasi'
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-label-md text-label-sm bg-tertiary-fixed/15 text-tertiary-container border border-tertiary-fixed/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                            {h.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openReturnModal(h)}
                              disabled={h.status !== 'Selesai'}
                              className="w-8 h-8 rounded-lg bg-tertiary-fixed/15 text-tertiary-container hover:bg-tertiary-fixed hover:text-on-tertiary-fixed flex items-center justify-center transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-tertiary-fixed/15 disabled:hover:text-tertiary-container"
                              title={h.status === 'Selesai' ? 'Retur' : 'Hanya transaksi Selesai yang bisa diretur'}
                              aria-label="Retur transaksi"
                            >
                              <span className="material-symbols-outlined text-[18px]">undo</span>
                            </button>
                            <button
                              onClick={async () => {
                                const receiptItems = (h.rawItems || []).map((item) => ({
                                  name: item.product?.nama_produk || 'Produk',
                                  qty: item.quantity || 0,
                                  sellingPrice: item.harga_satuan || 0,
                                }));
                                const receipt = { ...h, items: receiptItems, sellingPrice: h.total };
                                const result = await printReceiptBluetooth(receipt);
                                if (result && result.success) {
                                  setToast({ message: 'Struk berhasil dikirim ke printer', type: 'success' });
                                } else if (result && result.error) {
                                  setToast({ message: 'Gagal print Bluetooth: ' + result.error, type: 'error' });
                                }
                              }}
                              className="w-8 h-8 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-on-primary flex items-center justify-center transition-all duration-200"
                              title="Cetak Struk"
                              aria-label="Cetak struk"
                            >
                              <span className="material-symbols-outlined text-[18px]">print</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                     })}
                  </tbody>
                  <tfoot className="border-t-2 border-outline-variant bg-surface-container-low">
                    <tr className="font-headline-sm text-headline-sm">
                      <td className="px-6 py-4" colSpan={3}>Rekap Total</td>
                      <td className="px-6 py-4 text-right">{omzetRows.totalQty.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4 text-right">{omzetRows.totalRetur > 0 ? omzetRows.totalRetur : '-'}</td>
                      <td className="px-6 py-4 text-right text-on-background">Rp {omzetRows.totalPenjualan.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4 text-right text-on-surface-variant">Rp {omzetRows.untukMitra.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4 text-right text-primary">Rp {omzetRows.untukOwner.toLocaleString('id-ID')}</td>
                      <td className="px-6 py-4" colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
                <Pagination
                  totalItems={totalTransactions}
                  itemsPerPage={itemsPerPage}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                />
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

      {returnModal.open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-outline-variant rounded-xl shadow-lg max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-outline-variant">
              <h3 className="font-headline-md text-headline-md text-on-surface">Retur Transaksi</h3>
              <button onClick={() => setReturnModal({ open: false, transaction: null })} className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Transaksi: <span className="font-mono text-sm bg-surface-container px-2 py-1 rounded-md">#{returnModal.transaction?.transactionId}</span>
              </p>
              <div>
                <label className="font-label-md text-label-md text-on-surface block mb-1">Alasan Retur</label>
                <textarea
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg bg-surface text-on-surface font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder="Masukkan alasan retur..."
                />
              </div>
              <div className="space-y-2">
                <label className="font-label-md text-label-md text-on-surface block">Pilih Item</label>
                {returnModal.transaction?.rawItems?.map((item) => {
                  const remaining = getReturnableQty(item);
                  const alreadyReturned = returnedQty[item.id] || 0;
                  return (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/50">
                      <div className="flex-1">
                        <p className="font-body-md text-body-md text-on-surface">{item.product?.nama_produk || 'Produk'}</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant">
                          Qty: {item.quantity} | Rp {(item.harga_satuan * item.quantity).toLocaleString('id-ID')}
                          {alreadyReturned > 0 && ` | Sudah diretur: ${alreadyReturned}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={remaining}
                          disabled={remaining === 0}
                          value={returnItems[item.id] || ''}
                          onChange={(e) => handleReturnQuantityChange(item.id, remaining, e.target.value)}
                          className="w-16 px-2 py-1 border border-outline-variant rounded-md text-center font-numeric-data text-numeric-data text-on-surface focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40"
                          placeholder="0"
                        />
                        <span className="font-label-sm text-label-sm text-on-surface-variant">/ {remaining}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-outline-variant">
              <button
                onClick={() => setReturnModal({ open: false, transaction: null })}
                className="flex-1 h-10 px-4 bg-surface border border-outline-variant text-on-surface rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  const result = await printReturnReceiptBluetooth(returnModal.transaction, returnReason);
                  if (result && result.success) {
                    setToast({ message: 'Struk retur berhasil dikirim ke printer', type: 'success' });
                  } else if (result && result.error) {
                    setToast({ message: 'Gagal print Bluetooth: ' + result.error, type: 'error' });
                  }
                }}
                className="h-10 px-4 bg-surface border border-outline-variant text-on-surface rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors"
              >
                Print Struk Retur
              </button>
              <button
                onClick={handleSubmitReturn}
                disabled={processingReturn}
                className="flex-1 h-10 px-4 bg-tertiary-fixed text-on-tertiary-fixed rounded-lg font-label-md text-label-md hover:bg-tertiary-fixed/90 transition-colors disabled:opacity-50"
              >
                {processingReturn ? 'Memproses...' : 'Proses Retur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TransactionHistory;
