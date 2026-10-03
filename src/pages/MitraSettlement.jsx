import { useState, useEffect, useMemo } from 'react';
import { mitraSettlementService, mitraService, productService, transactionService, returnService } from '../lib/services';
import { buildProfitRows, summarizeProfit, getLocalDate } from '../lib/profitReport';
import { hitungRekonsiliasiMitra } from '../lib/mitraReconciliation';

function MitraSettlement({ user }) {
  const [settlements, setSettlements] = useState([]);
  const [mitraList, setMitraList] = useState([]);
  const [products, setProducts] = useState([]);
  const [soldQuantities, setSoldQuantities] = useState({});
  const [salesSummary, setSalesSummary] = useState(null);
  const [allTransactions, setAllTransactions] = useState([]);
  const [allReturns, setAllReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState(null);
  const [selectedSettlement, setSelectedSettlement] = useState(null);
  const [toast, setToast] = useState(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedMitraId, setSelectedMitraId] = useState('semua');
  const [statusFilter, setStatusFilter] = useState('semua');

  const [formData, setFormData] = useState({
    mitra_id: '',
    date: new Date().toISOString().split('T')[0],
    status: 'pending',
    items: [],
  });

  useEffect(() => {
    loadData();
  }, []);

  // Dihitung ulang setiap kali mitra atau data penjualan berubah, karena
  // sekarang qty dihitung di frontend dari satu sumber kalkulasi.
  useEffect(() => {
    if (!formData.mitra_id) {
      setSoldQuantities({});
      setSalesSummary(null);
      return;
    }
    const today = getLocalDate(new Date());
    calculateSoldQuantities(formData.mitra_id, formData.date || today, formData.date || today);
    // calculateSoldQuantities murni: hanya membaca props/closure yang sudah
    // ada di daftar dependensi di atas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.mitra_id, formData.date, allTransactions, allReturns, products]);

// Qty terjual untuk mitra terpilih.
//
// DULU bug di sini: qty dijumlahkan dari transaction_items DAN dari
// stock_movements(type 'out'). Satu kali penjualan menulis KEDUA record
// (KasirDesktop.jsx), jadi qty terhitung 2x dan nota mitra issued 2x lipat
// dari seharusnya. Sekarang cukup satu sumber: modul kalkulasi, yang juga
// sudah memotong retur dan mengabaikan transaksi Dibatalkan.
const calculateSoldQuantities = (mitraId, dateFrom, dateTo) => {
  const rows = buildProfitRows({
    transactions: allTransactions,
    returns: allReturns,
    products,
    startDate: dateFrom,
    endDate: dateTo,
  });

  const quantities = {};
  rows.forEach((row) => {
    if (String(row.mitraId) !== String(mitraId)) return;
    if (row.productId) {
      quantities[row.productId] = (quantities[row.productId] || 0) + row.netQty;
    }
  });

  const summary = summarizeProfit(rows.filter((row) => String(row.mitraId) === String(mitraId)));

  setSoldQuantities(quantities);
  setSalesSummary(summary);
  return { quantities, summary };
};

  const loadData = async () => {
    setLoading(true);
    try {
      const [settlementsData, mitraData, productsData, txData, returnData] = await Promise.all([
        mitraSettlementService.getAll().catch(() => []),
        mitraService.getAll(),
        productService.getAll(),
        transactionService.getHistory().catch(() => []),
        returnService.getAll().catch(() => []),
      ]);
      setSettlements(settlementsData || []);
      setMitraList(mitraData || []);
      setProducts(productsData || []);
      setAllTransactions(txData || []);
      setAllReturns(returnData || []);
    } catch {
      showToast('Gagal memuat data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const generateInvoiceNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `INV-${year}${month}${day}-${random}`;
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { product_id: '', product_name: '', quantity: 0, selling_price: 0, cost_price: 0 }],
    });
  };

  const updateItem = (index, field, value) => {
    const updatedItems = [...formData.items];
    if (field === 'product_id') {
      const product = products.find(p => p.id === value);
      const soldQty = soldQuantities[value] || 0;
      updatedItems[index] = {
        ...updatedItems[index],
        product_id: value,
        product_name: product?.nama_produk || '',
        selling_price: product?.selling_price || 0,
        cost_price: product?.mitra_price || 0,
        quantity: soldQty > 0 ? soldQty : 1,
      };
    } else {
      updatedItems[index] = { ...updatedItems[index], [field]: value };
    }
    setFormData({ ...formData, items: updatedItems });
  };

  const removeItem = (index) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const totals = useMemo(() => {
    const totalAmount = formData.items.reduce((sum, item) => sum + (item.selling_price * item.quantity), 0);
    const totalCost = formData.items.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
    const totalProfit = totalAmount - totalCost;
    return { totalAmount, totalCost, totalProfit };
  }, [formData.items]);

  // Rekonsiliasi kewajiban ke mitra: penjualan dikurangi yang sudah di-invoice.
  // Sengaja tidak ikut mengikuti filter tanggal dan mitra di atas, supaya Owner
  // selalu melihat posisi outstanding keseluruhan.
  const rekonsiliasi = useMemo(() => hitungRekonsiliasiMitra({
    transactions: allTransactions,
    returns: allReturns,
    products,
    settlements,
  }), [allTransactions, allReturns, products, settlements]);

  const filteredSettlements = useMemo(() => {
    return (settlements || []).filter((settlement) => {
      const rowDate = (settlement.date || '').slice(0, 10);
      if (startDate && rowDate < startDate) return false;
      if (endDate && rowDate > endDate) return false;
      if (selectedMitraId !== 'semua' && settlement.mitra_id !== selectedMitraId) return false;
      if (statusFilter === 'berhasil' && settlement.status === 'cancelled') return false;
      if (statusFilter !== 'semua' && statusFilter !== 'berhasil' && settlement.status !== statusFilter) return false;
      return true;
    });
  }, [settlements, startDate, endDate, selectedMitraId, statusFilter]);

  const recap = useMemo(() => {
    const activeRows = filteredSettlements.filter(s => s.status !== 'cancelled');
    const totalJual = activeRows.reduce((sum, s) => sum + (Number(s.total_amount) || 0), 0);
    const totalKeuntungan = activeRows.reduce((sum, s) => sum + (Number(s.total_profit) || 0), 0);
    const totalModal = activeRows.reduce(
      (sum, s) => sum + (s.items || []).reduce((inner, item) => inner + ((Number(item.cost_price) || 0) * (Number(item.quantity) || 0)), 0),
      0
    );
    const totalQty = activeRows.reduce(
      (sum, s) => sum + (s.items || []).reduce((inner, item) => inner + (Number(item.quantity) || 0), 0),
      0
    );
    const totalInvoice = activeRows.length;
    const marginPercent = totalJual > 0 ? (totalKeuntungan / totalJual) * 100 : 0;
    return { totalJual, totalKeuntungan, totalModal, totalQty, totalInvoice, marginPercent };
  }, [filteredSettlements]);

  const filterOptions = useMemo(() => {
    const idsWithInvoice = new Set((settlements || []).map(s => s.mitra_id));
    return mitraList
      .filter(mitra => idsWithInvoice.has(mitra.id))
      .map(mitra => ({ id: mitra.id, name: mitra.full_name }));
  }, [mitraList, settlements]);

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedMitraId('semua');
    setStatusFilter('semua');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validItems = (formData.items || []).filter(item => item.product_id && item.quantity > 0);
    if (!formData.mitra_id || validItems.length === 0) {
      showToast('Pilih mitra dan minimal satu produk', 'error');
      return;
    }

    try {
      const settlementData = {
        mitra_id: formData.mitra_id,
        invoice_number: editingSettlement ? editingSettlement.invoice_number : generateInvoiceNumber(),
        items: validItems,
        total_amount: totals.totalAmount,
        total_profit: totals.totalProfit,
        date: formData.date,
        status: formData.status,
        user_id: user?.id || null,
      };

      if (editingSettlement) {
        await mitraSettlementService.update(editingSettlement.id, settlementData);
        showToast('Invoice berhasil diperbarui!', 'success');
      } else {
        await mitraSettlementService.create(settlementData);
        showToast('Invoice berhasil dibuat!', 'success');
      }

      resetForm();
      await loadData();
    } catch {
      showToast('Gagal menyimpan invoice', 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      mitra_id: '',
      date: new Date().toISOString().split('T')[0],
      status: 'pending',
      items: [],
    });
    setShowForm(false);
    setEditingSettlement(null);
  };

  const handleEdit = (settlement) => {
    setEditingSettlement(settlement);
    setFormData({
      mitra_id: settlement.mitra_id,
      date: settlement.date,
      status: settlement.status,
      items: settlement.items || [],
    });
    setShowForm(true);
  };

  const handleDelete = async (id, nomor) => {
    if (!window.confirm(
      `Pindahkan invoice ${nomor || 'ini'} ke data terhapus?\n\n`
      + 'Data tidak hilang permanen dan bisa dipulihkan dari menu Audit Log. '
      + 'Riwayat pembayaran ke mitra tetap tercatat.'
    )) return;
    try {
      await mitraSettlementService.delete(id);
      showToast('Invoice dipindahkan ke data terhapus', 'success');
      await loadData();
    } catch {
      showToast('Gagal memindahkan invoice', 'error');
    }
  };

  const handlePrint = (settlement) => {
    setSelectedSettlement(settlement);
    setTimeout(() => {
      const printContent = document.querySelector('.print-section');
      if (!printContent) {
        showToast('Gagal mencetak: konten tidak ditemukan', 'error');
        return;
      }

      const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${settlement.invoice_number}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 5mm;
      font-family: Arial, sans-serif;
      color: #111;
      background: #fff;
      width: 58mm;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 4px 2px; vertical-align: top; font-size: 12px; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .font-bold { font-weight: bold; }
    .border-b { border-bottom: 1px solid #ccc; }
    .border-b-2 { border-bottom: 2px solid #000; }
    .border-double { border-style: double; }
    .border-t { border-top: 1px solid #ccc; }
    .border-t-2 { border-top: 2px solid #000; }
    .mt-4 { margin-top: 16px; }
    .mb-4 { margin-bottom: 16px; }
    .mb-2 { margin-bottom: 8px; }
    .mb-1 { margin-bottom: 4px; }
    .pt-2 { padding-top: 8px; }
    .pb-2 { padding-bottom: 8px; }
    .p-2 { padding: 8px; }
    .text-xl { font-size: 20px; }
    .text-sm { font-size: 12px; }
    .text-xs { font-size: 10px; }
    .space-y-1 > * + * { margin-top: 4px; }
    .grid { display: grid; }
    .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .gap-4 { gap: 16px; }
    .bg-gray-50 { background: #f8f9fa; }
    .rounded { border-radius: 4px; }
  </style>
</head>
<body>
  <div>
    <div class="text-center border-b-2 border-double border-gray-300 pb-2 mb-2">
      <h1 class="text-xl font-bold mb-1">LAPAK BERKAH BUNTULIA</h1>
      <p class="text-sm mb-1">Nota Penjualan Mitra</p>
      <div class="text-xs space-y-1">
        <p>No. Invoice: <span class="font-bold">${settlement.invoice_number}</span></p>
        <p>Tanggal: ${settlement.date}</p>
      </div>
    </div>

    <div class="mb-2 p-2 bg-gray-50 rounded">
      <p class="font-bold mb-1">Kepada:</p>
      <p class="font-bold">${settlement.mitra?.full_name || '-'}</p>
      <p class="text-xs">Mitra Lapak Berkah</p>
    </div>

    <table class="w-full text-xs border-collapse mb-2">
      <thead>
        <tr class="border-b-2 border-gray-300">
          <th class="text-left py-1 px-1">Produk</th>
          <th class="text-center py-1 px-1">Qty</th>
          <th class="text-right py-1 px-1">Harga</th>
          <th class="text-right py-1 px-1">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${(settlement.items || []).map((item, _index) => `
          <tr class="border-b border-gray-200">
            <td class="py-1 px-1">${item.product_name}</td>
            <td class="text-center py-1 px-1">${item.quantity}</td>
            <td class="text-right py-1 px-1">Rp ${(item.selling_price || 0).toLocaleString('id-ID')}</td>
            <td class="text-right py-1 px-1">Rp ${(item.selling_price * item.quantity || 0).toLocaleString('id-ID')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="border-t-2 border-gray-300 pt-1 space-y-1 mb-2">
      <div class="flex justify-between text-xs">
        <span>Total Jual:</span>
        <span class="font-bold">Rp ${(settlement.total_amount || 0).toLocaleString('id-ID')}</span>
      </div>
      <div class="flex justify-between text-xs">
        <span>Total Modal:</span>
        <span class="font-bold">Rp ${((settlement.items || []).reduce((sum, item) => sum + (item.cost_price * item.quantity), 0)).toLocaleString('id-ID')}</span>
      </div>
      <div class="flex justify-between text-sm font-bold border-t border-double border-gray-400 pt-1 mt-1">
        <span>Untuk Owner:</span>
        <span>Rp ${(settlement.total_profit || 0).toLocaleString('id-ID')}</span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4 mt-4 pt-2">
      <div class="text-center">
        <p class="font-bold mb-4">Mitra</p>
        <div class="border-b border-gray-400 mb-1" style="height: 24px;"></div>
        <p class="text-xs font-bold">${settlement.mitra?.full_name || '_________________'}</p>
        <p class="text-xs">Penerima</p>
      </div>
      <div class="text-center">
        <p class="font-bold mb-4">Owner/Admin</p>
        <div class="border-b border-gray-400 mb-1" style="height: 24px;"></div>
        <p class="text-xs font-bold">${settlement.user?.nama || user?.nama || '_________________'}</p>
        <p class="text-xs">Pembuat</p>
      </div>
    </div>

    <div class="mt-4 pt-2 border-t border-gray-200 text-center text-xs">
      <p>Dokumen ini dicetak secara otomatis oleh sistem Lapak Berkah Buntulia</p>
      <p>${new Date().toLocaleString('id-ID')}</p>
    </div>
  </div>
</body>
</html>`;

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, '_blank', 'width=800,height=600');
      if (!printWindow) {
        showToast('Popup diblokir. Izinkan popup untuk mencetak invoice.', 'error');
        URL.revokeObjectURL(url);
        return;
      }
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
          setTimeout(() => {
            printWindow.close();
            URL.revokeObjectURL(url);
          }, 100);
        }, 500);
      };
    }, 300);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'paid':
        return { label: 'Lunas', class: 'bg-tertiary-fixed/15 text-tertiary-container border-tertiary-fixed/30' };
      case 'pending':
        return { label: 'Menunggu', class: 'bg-[#fdf2d5] text-[#7a590c] border-[#ebd083]' };
      case 'cancelled':
        return { label: 'Dibatalkan', class: 'bg-error-container/15 text-error border-error-container/30' };
      default:
        return { label: status, class: 'bg-surface-container text-on-surface-variant border-outline-variant' };
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
        <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 flex items-center justify-center h-96">
            <div className="flex flex-col items-center gap-3">
              <span className="material-symbols-outlined text-6xl text-primary animate-pulse">progress_activity</span>
              <p className="font-body-md text-body-md text-on-surface-variant">Memuat data invoice...</p>
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
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Nota Penjualan Mitra</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                Buat dan kelola invoice penjualan ke mitra
              </p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="h-12 px-6 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-xl flex items-center gap-2 transition-all duration-200 font-label-md text-label-md shadow-sm hover:shadow-md active:scale-95"
            >
              <span className="material-symbols-outlined">{showForm ? 'close' : 'add'}</span>
              {showForm ? 'Batal' : 'Buat Invoice'}
            </button>
          </header>

          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Invoice Mitra</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Nota penjualan mitra</p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="h-10 w-10 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-full flex items-center justify-center transition-all duration-200 shadow-sm active:scale-95"
            >
              <span className="material-symbols-outlined">{showForm ? 'close' : 'add'}</span>
            </button>
          </div>

          {/* Create/Edit Form */}
          {showForm && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md overflow-hidden">
              <div className="p-6 border-b border-outline-variant/50 bg-surface flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined">{editingSettlement ? 'edit' : 'receipt'}</span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-headline-sm text-on-background">{editingSettlement ? 'Edit Invoice' : 'Buat Invoice Baru'}</h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">{editingSettlement ? 'Perbarui invoice penjualan' : 'Buat nota penjualan untuk mitra'}</p>
                </div>
              </div>
              <form className="p-6 space-y-6" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Mitra */}
                  <div className="space-y-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Mitra <span className="text-error">*</span></label>
                    <select
                      className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      value={formData.mitra_id}
                      onChange={(e) => setFormData({ ...formData, mitra_id: e.target.value })}
                      required
                    >
                      <option value="">Pilih Mitra</option>
                      {mitraList.map(mitra => (
                        <option key={mitra.id} value={mitra.id}>{mitra.full_name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Tanggal */}
                  <div className="space-y-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Tanggal <span className="text-error">*</span></label>
                    <input
                      type="date"
                      className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      required
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Status</label>
                    <select
                      className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    >
                      <option value="pending">Menunggu</option>
                      <option value="paid">Lunas</option>
                      <option value="cancelled">Dibatalkan</option>
                    </select>
                  </div>
                </div>

                {/* Items */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Detail Produk</label>
                    <button
                      type="button"
                      onClick={addItem}
                      className="h-10 px-4 bg-secondary-fixed-dim hover:bg-secondary-container text-on-secondary-container rounded-lg flex items-center gap-2 transition-colors font-label-md text-label-md"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                      Tambah Produk
                    </button>
                  </div>

                  <div className="space-y-3">
                    {/* Pembanding: penjualan riil dari modul kalkulasi vs nilai nota ini */}
                    {salesSummary && salesSummary.totalPenjualan > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
                          <p className="font-label-sm text-label-sm text-on-surface-variant">Terjual hari ini</p>
                          <p className="font-headline-sm text-headline-sm text-on-background font-numeric-data text-numeric-data">
                            Rp {salesSummary.totalPenjualan.toLocaleString('id-ID')}
                          </p>
                        </div>
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
                          <p className="font-label-sm text-label-sm text-on-surface-variant">Porsi Mitra (modal)</p>
                          <p className="font-headline-sm text-headline-sm text-on-surface-variant font-numeric-data text-numeric-data">
                            Rp {salesSummary.untukMitra.toLocaleString('id-ID')}
                          </p>
                        </div>
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
                          <p className="font-label-sm text-label-sm text-on-surface-variant">Porsi Owner (selisih)</p>
                          <p className="font-headline-sm text-headline-sm text-primary font-numeric-data text-numeric-data">
                            Rp {salesSummary.untukOwner.toLocaleString('id-ID')}
                          </p>
                        </div>
                      </div>
                    )}

                    {formData.items.map((item, index) => (
                      <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end p-4 bg-surface-container rounded-xl border border-outline-variant">
                        <div className="md:col-span-4 space-y-2">
                          <label className="block font-label-sm text-label-sm text-on-surface-variant">Produk</label>
                          <select
                            className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                            value={item.product_id}
                            onChange={(e) => updateItem(index, 'product_id', e.target.value)}
                            required
                          >
                             <option value="">Pilih Produk</option>
                             {products
                               .filter(p => !formData.mitra_id || p.mitra_id === formData.mitra_id)
                               .map(p => (
                               <option key={p.id} value={p.id}>
                                 {p.nama_produk} {soldQuantities[p.id] ? `(Terjual: ${soldQuantities[p.id]})` : ''}
                               </option>
                             ))}
                          </select>
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <label className="block font-label-sm text-label-sm text-on-surface-variant">Jumlah</label>
                          <input
                            type="number"
                            className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                            value={item.quantity || ''}
                            onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                            min="1"
                            required
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <label className="block font-label-sm text-label-sm text-on-surface-variant">Harga Jual</label>
                          <input
                            type="number"
                            className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                            value={item.selling_price || ''}
                            onChange={(e) => updateItem(index, 'selling_price', Number(e.target.value))}
                            min="0"
                            required
                          />
                        </div>
                        <div className="md:col-span-2 space-y-2">
                          <label className="block font-label-sm text-label-sm text-on-surface-variant">Harga Modal</label>
                          <input
                            type="number"
                            className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                            value={item.cost_price || ''}
                            onChange={(e) => updateItem(index, 'cost_price', Number(e.target.value))}
                            min="0"
                            required
                          />
                        </div>
                        <div className="md:col-span-1 flex items-end">
                          <button
                            type="button"
                            onClick={() => removeItem(index)}
                            className="h-10 w-10 rounded-lg bg-error-container/20 text-error hover:bg-error hover:text-on-error flex items-center justify-center transition-all"
                            title="Hapus"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals */}
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant space-y-2">
                  <div className="flex justify-between font-body-md text-body-md">
                    <span className="text-on-surface-variant">Total Jual</span>
                    <span className="font-semibold text-on-background">Rp {totals.totalAmount.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between font-body-md text-body-md">
                    <span className="text-on-surface-variant">Untuk Mitra (Harga Mitra)</span>
                    <span className="font-semibold text-on-background">Rp {totals.totalCost.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between font-headline-sm text-headline-sm">
                    <span className="text-primary">Untuk Owner (Selisih)</span>
                    <span className="text-primary font-semibold">Rp {totals.totalProfit.toLocaleString('id-ID')}</span>
                  </div>
                </div>

                {/* Submit */}
                <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant/50">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="h-12 px-6 rounded-xl border border-outline text-on-surface font-label-md hover:bg-surface-container transition-all"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="h-12 px-6 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-xl font-label-md shadow-sm transition-all"
                  >
                    {editingSettlement ? 'Perbarui Invoice' : 'Simpan Invoice'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Dashboard Rekap */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-background">Dashboard Rekap</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Ringkasan penjualan dan keuntungan nota mitra</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div className="w-11 h-11 rounded-xl bg-primary-fixed flex items-center justify-center text-on-primary-fixed">
                    <span className="material-symbols-outlined">payments</span>
                  </div>
                  <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">
                    {recap.totalInvoice} Invoice
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Penjualan yang Sudah Di-invoice</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">
                  Rp {recap.totalJual.toLocaleString('id-ID')}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
                  Tidak sama dengan Laporan Penjualan. Angka ini hanya penjualan yang sudah ditagihkan ke mitra.
                </p>
              </div>

              <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div className="w-11 h-11 rounded-xl bg-tertiary-fixed flex items-center justify-center text-on-tertiary-fixed">
                    <span className="material-symbols-outlined">trending_up</span>
                  </div>
                  <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">
                    {recap.marginPercent.toFixed(1)}%
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Untung Owner pada Invoice Terbit</p>
                <p className="font-display-lg text-display-lg text-primary tracking-tight">
                  Rp {recap.totalKeuntungan.toLocaleString('id-ID')}
                </p>
              </div>

              <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div className="w-11 h-11 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                    <span className="material-symbols-outlined">inventory_2</span>
                  </div>
                  <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">
                    {recap.totalQty.toLocaleString('id-ID')} Qty
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Untuk Mitra pada Invoice Terbit</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">
                  Rp {recap.totalModal.toLocaleString('id-ID')}
                </p>
              </div>

              <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div className="w-11 h-11 rounded-xl bg-surface-container-high flex items-center justify-center text-on-surface-variant">
                    <span className="material-symbols-outlined">percent</span>
                  </div>
                  <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">
                    {filteredSettlements.length} Data
                  </span>
                </div>
                <p className="font-label-md text-label-md text-on-surface-variant mb-1">Margin Keuntungan</p>
                <p className="font-display-lg text-display-lg text-on-background tracking-tight">
                  {recap.marginPercent.toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Rekonsiliasi kewajiban ke mitra. Ini yang menghubungkan angka
                penjualan dengan angka yang sudah ditagihkan ke mitra, supaya
                Owner tahu berapa yang sudah keluar dan berapa yang belum. */}
            <div className="mt-4 rounded-xl border border-outline-variant bg-surface-container-low p-4">
              <div className="flex items-start gap-2 mb-3">
                <span className="material-symbols-outlined text-on-surface-variant">account_balance_wallet</span>
                <div>
                  <p className="font-headline-sm text-headline-sm text-on-background">Posisi Kewajiban ke Mitra</p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    Dihitung dari penjualan yang sudah tercatat, dikurangi yang sudah jadi invoice. Tidak ikut
                    terpengaruh filter di bawah supaya Owner selalu melihat posisi keseluruhan.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-lg bg-surface-container p-3">
                  <p className="font-label-sm text-label-sm text-on-surface-variant">Harus Dibayar ke Mitra</p>
                  <p className="font-headline-sm text-headline-sm text-on-surface font-numeric-data text-numeric-data">
                    Rp {rekonsiliasi.total.liability.toLocaleString('id-ID')}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">dari seluruh penjualan</p>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <p className="font-label-sm text-label-sm text-on-surface-variant">Sudah Di-invoice</p>
                  <p className="font-headline-sm text-headline-sm text-on-surface font-numeric-data text-numeric-data">
                    Rp {rekonsiliasi.total.diInvoice.toLocaleString('id-ID')}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">sudah ditagihkan</p>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <p className="font-label-sm text-label-sm text-on-surface-variant">Sudah Dibayar Mitra</p>
                  <p className="font-headline-sm text-headline-sm text-tertiary-container font-numeric-data text-numeric-data">
                    Rp {rekonsiliasi.total.sudahDibayar.toLocaleString('id-ID')}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">sudah diterima mitra</p>
                </div>
                <div className="rounded-lg bg-surface-container p-3">
                  <p className="font-label-sm text-label-sm text-on-surface-variant">Belum Di-tagih</p>
                  <p className="font-headline-sm text-headline-sm text-primary font-numeric-data text-numeric-data">
                    Rp {rekonsiliasi.total.belumDitagih.toLocaleString('id-ID')}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">penjualan belum jadi invoice</p>
                </div>
              </div>

              {rekonsiliasi.total.belumDibayar > 0.5 && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-error-container text-on-error-container p-3">
                  <span className="material-symbols-outlined">warning</span>
                  <span className="font-body-sm text-body-sm">
                    Masih ada invoice yang belum dibayar ke mitra: Rp{' '}
                    {rekonsiliasi.total.belumDibayar.toLocaleString('id-ID')}.
                  </span>
                </div>
              )}

              {rekonsiliasi.masalah.mitraLebihDitagih.length > 0 && (
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-error-container text-on-error-container p-3">
                  <span className="material-symbols-outlined">report</span>
                  <div className="font-body-sm text-body-sm">
                    <p className="mb-1">
                      {rekonsiliasi.masalah.mitraLebihDitagih.length} mitra punya invoice yang lebih besar dari
                      penjualan yang tercatat. Ini perlu dicek manual, karena berarti invoice dibuat dari
                      penjualan yang belum masuk ke kasir.
                    </p>
                    <ul className="list-disc pl-4">
                      {rekonsiliasi.masalah.mitraLebihDitagih.map((m) => (
                        <li key={m.mitraId}>
                          {m.namaMitra}: invoice Rp {m.diInvoice.toLocaleString('id-ID')}, penjualan
                          tercatat Rp {m.liability.toLocaleString('id-ID')} (selisih Rp{' '}
                          {Math.abs(m.belumDitagih).toLocaleString('id-ID')})
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Filter Tanggal & Filter Mitra */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Filter</h3>
              <button
                onClick={resetFilters}
                className="h-9 px-3 rounded-lg border border-outline text-on-surface-variant hover:bg-surface-container flex items-center gap-1.5 transition-colors font-label-md text-label-md"
              >
                <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
                Reset
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="space-y-2">
                <label className="block font-label-md text-label-md text-on-surface font-medium">Dari Tanggal</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={startDate}
                  max={endDate || undefined}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="block font-label-md text-label-md text-on-surface font-medium">Sampai Tanggal</label>
                <input
                  type="date"
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
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
                  {filterOptions.map(option => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="block font-label-md text-label-md text-on-surface font-medium">Filter Status</label>
                <select
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="semua">Semua Status</option>
                  <option value="berhasil">Tanpa Dibatalkan</option>
                  <option value="pending">Menunggu</option>
                  <option value="paid">Lunas</option>
                  <option value="cancelled">Dibatalkan</option>
                </select>
              </div>
            </div>
          </section>

          {/* Settlements List */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-on-background">Daftar Invoice</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">Riwayat nota penjualan ke mitra</p>
              </div>
              <span className="font-label-md text-label-md text-on-surface-variant bg-surface-container-high px-3 py-1.5 rounded-full self-start sm:self-auto">
                {filteredSettlements.length} dari {settlements.length} invoice
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-xs uppercase tracking-wider">
                    <th className="py-3 px-4">No. Invoice</th>
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-4">Mitra</th>
                    <th className="py-3 px-4 text-right">Total Jual</th>
                    <th className="py-3 px-4 text-right">Untuk Owner</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/50 text-sm">
                  {filteredSettlements.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="text-center py-8 text-on-surface-variant">
                        {settlements.length === 0 ? 'Belum ada invoice.' : 'Tidak ada invoice yang cocok dengan filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredSettlements.map((settlement) => {
                      const badge = getStatusBadge(settlement.status);
                      return (
                        <tr key={settlement.id} className="hover:bg-surface-container-low/50 transition-colors">
                          <td className="py-3 px-4 font-mono text-xs text-on-surface-variant">{settlement.invoice_number}</td>
                          <td className="py-3 px-4 text-on-surface">{settlement.date}</td>
                          <td className="py-3 px-4 text-on-surface">{settlement.mitra?.full_name || '-'}</td>
                          <td className="py-3 px-4 text-right font-medium text-on-background">
                            Rp {(settlement.total_amount || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-3 px-4 text-right font-medium text-primary">
                            Rp {(settlement.total_profit || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs border ${badge.class}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handlePrint(settlement)}
                                className="w-8 h-8 rounded-lg bg-secondary-container/50 hover:bg-secondary-container text-on-secondary-container flex items-center justify-center transition-all"
                                title="Cetak"
                                aria-label="Cetak invoice"
                              >
                                <span className="material-symbols-outlined text-sm">print</span>
                              </button>
                              <button
                                onClick={() => handleEdit(settlement)}
                                className="w-8 h-8 rounded-lg bg-secondary-container/50 hover:bg-secondary-container text-on-secondary-container flex items-center justify-center transition-all"
                                title="Edit"
                                aria-label="Edit invoice"
                              >
                                <span className="material-symbols-outlined text-sm">edit</span>
                              </button>
                              <button
                                onClick={() => handleDelete(settlement.id, settlement.invoice_number)}
                                className="w-8 h-8 rounded-lg bg-error-container/30 hover:bg-error-container/50 text-error flex items-center justify-center transition-all"
                                title="Pindahkan ke data terhapus"
                                aria-label="Hapus invoice"
                              >
                                <span className="material-symbols-outlined text-sm">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {filteredSettlements.length > 0 && (
                  <tfoot className="border-t-2 border-outline-variant bg-surface-container-low">
                    <tr className="font-headline-sm text-headline-sm">
                      <td className="py-3 px-4" colSpan="3">Rekap Total</td>
                      <td className="py-3 px-4 text-right text-on-background">
                        Rp {recap.totalJual.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4 text-right text-primary">
                        Rp {recap.totalKeuntungan.toLocaleString('id-ID')}
                      </td>
                      <td className="py-3 px-4" colSpan="2" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center gap-2 animate-bounce ${
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

      {/* Print Area */}
      {selectedSettlement && (
        <div className="print-section">
          <div className="bg-white rounded-lg shadow-2xl overflow-auto w-full max-w-[80mm] mx-auto">
            <div className="p-8">
              {/* Invoice Header */}
              <div className="text-center border-b-2 border-double border-gray-300 pb-4 mb-4">
                <h1 className="text-2xl font-bold mb-1">LAPAK BERKAH BUNTULIA</h1>
                <p className="text-sm text-gray-600 mb-2">Nota Penjualan Mitra</p>
                <div className="text-xs space-y-1">
                  <p>No. Invoice: <span className="font-bold">{selectedSettlement.invoice_number}</span></p>
                  <p>Tanggal: {selectedSettlement.date}</p>
                </div>
              </div>

              {/* Mitra Info */}
              <div className="mb-4 p-3 bg-gray-50 rounded">
                <p className="font-bold mb-1">Kepada:</p>
                <p className="font-bold">{selectedSettlement.mitra?.full_name || '-'}</p>
                <p className="text-xs text-gray-600">Mitra Lapak Berkah</p>
              </div>

              {/* Items Table */}
              <table className="w-full text-xs border-collapse mb-4">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="text-left py-2 px-1">Produk</th>
                    <th className="text-center py-2 px-1">Qty</th>
                    <th className="text-right py-2 px-1">Harga</th>
                    <th className="text-right py-2 px-1">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedSettlement.items || []).map((item, index) => (
                    <tr key={index} className="border-b border-gray-200">
                      <td className="py-2 px-1">{item.product_name}</td>
                      <td className="text-center py-2 px-1">{item.quantity}</td>
                      <td className="text-right py-2 px-1">Rp {(item.selling_price || 0).toLocaleString('id-ID')}</td>
                      <td className="text-right py-2 px-1">Rp {(item.selling_price * item.quantity || 0).toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals */}
              <div className="border-t-2 border-gray-300 pt-2 space-y-1 mb-6">
                <div className="flex justify-between text-sm">
                  <span>Total Jual:</span>
                  <span className="font-bold">Rp {(selectedSettlement.total_amount || 0).toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Total Modal:</span>
                  <span className="font-bold">Rp {((selectedSettlement.items || []).reduce((sum, item) => sum + (item.cost_price * item.quantity), 0)).toLocaleString('id-ID')}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-double border-gray-400 pt-2 mt-2">
                  <span>Untuk Owner:</span>
                  <span className="text-primary">Rp {(selectedSettlement.total_profit || 0).toLocaleString('id-ID')}</span>
                </div>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 mt-8 pt-4">
                <div className="text-center">
                  <p className="font-bold mb-8">Mitra</p>
                  <div className="border-b border-gray-400 mb-2 h-8"></div>
                  <p className="text-sm font-bold">{selectedSettlement.mitra?.full_name || '_________________'}</p>
                  <p className="text-xs text-gray-500">Penerima</p>
                </div>
                <div className="text-center">
                  <p className="font-bold mb-8">Owner/Admin</p>
                  <div className="border-b border-gray-400 mb-2 h-8"></div>
                  <p className="text-sm font-bold">{selectedSettlement.user?.nama || user?.nama || '_________________'}</p>
                  <p className="text-xs text-gray-500">Pembuat</p>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-8 pt-4 border-t border-gray-200 text-center text-xs text-gray-500">
                <p>Dokumen ini dicetak secara otomatis oleh sistem Lapak Berkah Buntulia</p>
                <p>{new Date().toLocaleString('id-ID')}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MitraSettlement;
