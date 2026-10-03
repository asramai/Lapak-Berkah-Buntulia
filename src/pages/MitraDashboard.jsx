import { useState, useEffect, useMemo } from 'react';
import { mitraService, productService, pendingStockValidationService, stockMovementService, transactionService, returnService, userService } from '../lib/services';
import { buildProfitRows } from '../lib/profitReport';
import Pagination from '../components/Pagination';
import compressImage from '../utils/compressImage';

function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bgColor = type === 'success' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-error-container text-on-error-container';

  return (
    <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 ${bgColor} animate-pulse`}>
      <span className="material-symbols-outlined">{type === 'success' ? 'check_circle' : 'error'}</span>
      <span className="font-label-md text-label-md">{message}</span>
    </div>
  );
}

function StatCard({ icon, label, value, subtitle, trend, trendUp, colorClass = 'bg-primary-fixed text-on-primary-fixed' }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200 group">
      <div className="flex justify-between items-start mb-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${colorClass} group-hover:scale-110 transition-transform duration-200`}>
          <span className="material-symbols-outlined">{icon}</span>
        </div>
        {trend && (
          <span className={`flex items-center gap-1 font-label-sm text-label-sm px-2 py-1 rounded-full ${trendUp ? 'bg-tertiary-fixed/20 text-tertiary-container' : 'bg-error-container/20 text-error'}`}>
            <span className="material-symbols-outlined text-[14px]">{trendUp ? 'arrow_upward' : 'arrow_downward'}</span>
            {trend}
          </span>
        )}
      </div>
      <div>
        <p className="font-label-md text-label-md text-on-surface-variant mb-1">{label}</p>
        <p className="font-display-lg text-display-lg text-on-background tracking-tight">{value}</p>
        {subtitle && <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

function MitraDashboard({ role, user }) {
  const isMitra = role === 'mitra';
  const getLocalDate = (value) => {
    const d = value instanceof Date ? value : new Date(value);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const [mitraList, setMitraList] = useState([]);
  const [allMitra, setAllMitra] = useState([]);
  const [products, setProducts] = useState([]);
  const [stockInputs, setStockInputs] = useState([]);
  const [stockHistory, setStockHistory] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [returnRows, setReturnRows] = useState([]);
  const [rawProducts, setRawProducts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState(null);
  const [showStockForm, setShowStockForm] = useState(false);
  const [selectedMitra, setSelectedMitra] = useState(isMitra ? '' : '');
  const [stockDate, setStockDate] = useState(() => getLocalDate(new Date()));
  const [stockFormData, setStockFormData] = useState({ productId: '', stock: '', note: '' });
  const [formData, setFormData] = useState({
    fullName: '',
    address: '',
    phone: '',
    email: '',
    gender: 'Laki-laki',
    photo: '',
    status: 'Aktif',
  });

  const [productFilter, setProductFilter] = useState(isMitra ? 'Semua' : 'Semua');
  const [activeTab, setActiveTab] = useState('stock');

  const loggedInMitraId = useMemo(() => {
    if (!isMitra || !user?.email) return null;
    const currentMitra = allMitra.find((m) => m.email === user.email);
    return currentMitra ? String(currentMitra.id) : null;
  }, [isMitra, user?.email, allMitra]);

  useEffect(() => {
    if (isMitra && loggedInMitraId) {
      setSelectedMitra(loggedInMitraId);
    }
  }, [isMitra, loggedInMitraId]);

  const visibleProductIds = useMemo(() => {
    if (isMitra) {
      if (!loggedInMitraId) return new Set();
      return new Set(products.filter((p) => String(p.mitraId) === loggedInMitraId || !p.mitraId).map((p) => p.id));
    }
    const activeFilter = activeTab === 'stock' ? selectedMitra : productFilter;
    if (!activeFilter || activeFilter === 'Semua') return new Set();
    return new Set(products.filter((p) => String(p.mitraId) === activeFilter).map((p) => p.id));
  }, [isMitra, loggedInMitraId, activeTab, selectedMitra, productFilter, products]);

  const [profitMonth, setProfitMonth] = useState(new Date().toISOString().slice(0, 7));
  const [profitStartDate, setProfitStartDate] = useState('');
  const [profitEndDate, setProfitEndDate] = useState('');
  const [editingMitra, setEditingMitra] = useState(null);
  const [editMitraName, setEditMitraName] = useState('');
  const [mitraSearch, setMitraSearch] = useState('');
  const [mitraPage, setMitraPage] = useState(1);
  const [mitraPerPage] = useState(10);

  const loadData = async () => {
    try {
      const [allMitraData, productData, pendingStockData, stockHistoryData, txData, returnData] = await Promise.all([
        mitraService.getAll(),
        productService.getAll(),
        pendingStockValidationService.getAll(),
        pendingStockValidationService.getAllHistory(),
        transactionService.getHistory(),
        returnService.getAll(),
      ]);

      const mappedMitra = (allMitraData || []).map((m) => ({
        id: m.id,
        fullName: m.full_name,
        address: m.address,
        phone: m.phone,
        email: m.email,
        gender: m.gender,
        photo: m.photo,
        status: m.status,
        totalTransaction: m.total_transaction || 0,
        totalOmzet: m.total_omzet || 0,
      }));

      const mappedProducts = (productData || []).map((p) => ({
        id: p.id,
        name: p.nama_produk,
        sku: p.sku,
        category: p.category?.name || '',
        type: p.type?.name || '',
        mitraName: p.mitra?.full_name || p.mitra_name || '-',
        mitraId: p.mitra_id,
        unit: p.unit || '',
        mitraPrice: p.mitra_price || 0,
        stock: p.stock || 0,
      }));

      const mitraMap = new Map((allMitraData || []).map((m) => [m.id, m]));
      const productMap = new Map((productData || []).map((p) => [p.id, p]));

      const mappedPendingStock = (pendingStockData || []).map((s) => {
        const mitra = mitraMap.get(s.mitra_id);
        const product = productMap.get(s.product_id);
        return {
          id: s.id,
          mitraId: s.mitra_id,
          productId: s.product_id,
          date: s.date,
          quantity: s.quantity,
          note: s.note || '',
          status: s.status,
          mitraName: mitra?.full_name || s.mitra?.full_name || '-',
          productName: product?.nama_produk || s.product?.nama_produk || '-',
        };
      });

      const mappedStockHistory = (stockHistoryData || []).map((s) => {
        const mitra = mitraMap.get(s.mitra_id);
        const product = productMap.get(s.product_id);
        return {
          id: s.id,
          mitraId: s.mitra_id,
          productId: s.product_id,
          date: s.date,
          quantity: s.quantity,
          note: s.note || '',
          status: s.status,
          mitraName: mitra?.full_name || s.mitra?.full_name || '-',
          productName: product?.nama_produk || s.product?.nama_produk || '-',
          currentStock: product?.stock || 0,
        };
      });

      setAllMitra(mappedMitra);
      setProducts(mappedProducts);
      setStockInputs(mappedPendingStock);
      setStockHistory(mappedStockHistory);
      setTransactions(txData || []);
      setReturnRows(returnData || []);
      setRawProducts(productData || []);
    } catch {
      setToast({ message: 'Gagal memuat data dashboard', type: 'error' });
    }
  };

  const filteredMitra = useMemo(() => {
    return allMitra.filter((mitra) =>
      mitra.fullName.toLowerCase().includes(mitraSearch.toLowerCase()) ||
      mitra.email.toLowerCase().includes(mitraSearch.toLowerCase()) ||
      mitra.phone.includes(mitraSearch)
    );
  }, [allMitra, mitraSearch]);

  const paginatedMitra = useMemo(() => {
    const start = (mitraPage - 1) * mitraPerPage;
    return filteredMitra.slice(start, start + mitraPerPage);
  }, [filteredMitra, mitraPage, mitraPerPage]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setMitraPage(1);
  }, [mitraSearch]);

  const activeMitra = allMitra.filter((m) => m.status === 'Aktif').length;
  const totalTransaction = allMitra.reduce((sum, m) => sum + (m.totalTransaction || 0), 0);
  const totalOmzet = allMitra.reduce((sum, m) => sum + (m.totalOmzet || 0), 0);

  const today = getLocalDate(new Date());
  const mitraIdNum = selectedMitra;

  const todayTransactions = useMemo(() => transactions.filter((tx) => {
    if (!isMitra) return tx.date === today;
    return tx.date === today && String(tx.mitraId) === mitraIdNum;
  }), [transactions, isMitra, today, mitraIdNum]);

const todayOmzet = useMemo(() => todayTransactions.reduce((sum, tx) => sum + tx.total, 0), [todayTransactions]);
  const todayTransactionCount = useMemo(() => todayTransactions.length, [todayTransactions]);

  const todayStock = stockHistory.filter((s) => s.date === stockDate);
  const filteredTodayStock = useMemo(() => {
    if (isMitra) {
      if (!loggedInMitraId) return [];
      return todayStock.filter((s) => String(s.mitraId) === loggedInMitraId);
    }
    if (selectedMitra) {
      return todayStock.filter((s) => String(s.mitraId) === selectedMitra);
    }
    return todayStock;
  }, [isMitra, loggedInMitraId, selectedMitra, todayStock]);

  useEffect(() => {
    setMitraPage(1);
  }, [mitraSearch]);

  const tabs = useMemo(() => {
    const base = [
      { id: 'stock', label: 'Input Stok Harian', icon: 'inventory' },
      { id: 'product', label: 'Daftar Produk', icon: 'shopping_bag' },
    ];
    if (isMitra) {
      return [...base, { id: 'profit', label: 'Riwayat Laba Bersih', icon: 'payments' }];
    }
    return [{ id: 'mitra', label: 'Daftar Mitra', icon: 'group' }, ...base];
  }, [isMitra]);

  const profitHistory = useMemo(() => {
    // Baris dihitung oleh modul kalkulasi yang sama dengan halaman laporan,
    // supaya kartu di sini tidak pernah beda dengan Laporan Pembagian Keuntungan.
    let rows = buildProfitRows({
      transactions,
      returns: returnRows,
      products: rawProducts,
      startDate: profitStartDate,
      endDate: profitEndDate,
    });

    if (isMitra && mitraIdNum) {
      rows = rows.filter((r) => String(r.mitraId) === String(mitraIdNum));
    }
    if (profitMonth) {
      rows = rows.filter((r) => r.date.startsWith(profitMonth));
    }

    const grouped = new Map();
    rows.forEach((row) => {
      const existing = grouped.get(row.date) || {
        date: row.date,
        omzet: 0,
        untukMitra: 0,
        untukOwner: 0,
        qty: 0,
        count: 0,
        set: new Set(),
      };
      existing.omzet += row.totalSales;
      existing.untukMitra += row.untukMitra;
      existing.untukOwner += row.untukOwner;
      existing.qty += row.netQty;
      existing.set.add(row.transactionId);
      grouped.set(row.date, existing);
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        date: entry.date,
        omzet: entry.omzet,
        modal: entry.untukMitra,
        profit: entry.untukOwner,
        qty: entry.qty,
        count: entry.set.size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, returnRows, rawProducts, isMitra, mitraIdNum, profitMonth, profitStartDate, profitEndDate]);

  const totalProfit = profitHistory.reduce((sum, row) => sum + row.profit, 0);
  const totalOmzetFiltered = profitHistory.reduce((sum, row) => sum + row.omzet, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const rawEmail = (formData.email || '').trim();
      const emailValue = rawEmail ? rawEmail.toLowerCase() : `mitra-${Date.now()}@local`;
      const normalizedExisting = new Set(mitraList.map((m) => (m.email || '').toLowerCase()));
      const finalEmail = normalizedExisting.has(emailValue) ? `mitra-${Date.now()}@local` : emailValue;

      const newMitra = await mitraService.create({
        full_name: formData.fullName,
        address: formData.address,
        phone: formData.phone,
        email: finalEmail,
        gender: formData.gender,
        photo: formData.photo,
        status: formData.status,
        total_transaction: 0,
        total_omzet: 0,
      });

      const defaultPassword = 'mitra123';
      await userService.create({
        nama: newMitra.full_name,
        email: newMitra.email,
        password: defaultPassword,
        role: 'mitra',
      });

      setMitraList([
        ...mitraList,
        {
          id: newMitra.id,
          fullName: newMitra.full_name,
          address: newMitra.address,
          phone: newMitra.phone,
          email: newMitra.email,
          gender: newMitra.gender,
          photo: newMitra.photo,
          status: newMitra.status,
          totalTransaction: newMitra.total_transaction || 0,
          totalOmzet: newMitra.total_omzet || 0,
        },
      ]);
      setAllMitra([
        ...allMitra,
        {
          id: newMitra.id,
          fullName: newMitra.full_name,
          address: newMitra.address,
          phone: newMitra.phone,
          email: newMitra.email,
          gender: newMitra.gender,
          photo: newMitra.photo,
          status: newMitra.status,
          totalTransaction: newMitra.total_transaction || 0,
          totalOmzet: newMitra.total_omzet || 0,
        },
      ]);
      setFormData({ fullName: '', address: '', phone: '', email: '', gender: 'Laki-laki', photo: '' });
      setShowForm(false);
      setToast({
        message: `Mitra berhasil ditambahkan! Akun login: ${newMitra.email}`,
        type: 'success',
      });
    } catch {
      setToast({ message: 'Gagal menambahkan mitra', type: 'error' });
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file, {
          maxWidth: 400,
          maxHeight: 400,
          quality: 0.7,
          mimeType: 'image/jpeg',
        });
        setFormData({ ...formData, photo: compressed.dataUrl });
        showToast(`Foto berhasil dimuat (${compressed.sizeKB}KB)`, 'success');
      } catch {
        showToast('Gagal memproses foto', 'error');
      }
    }
  };

  const handleStockSubmit = async (e) => {
    e.preventDefault();
    if (!selectedMitra || !stockFormData.productId || !stockFormData.stock) return;
    const quantity = Number(stockFormData.stock);
    const isAdminInput = !isMitra;
    try {
      const newStock = await pendingStockValidationService.create({
        mitra_id: selectedMitra,
        product_id: stockFormData.productId,
        date: stockDate,
        quantity,
        note: stockFormData.note,
        status: isAdminInput ? 'validated' : 'pending',
      });

      const mitra = mitraList.find((m) => m.id === selectedMitra);
      const product = products.find((p) => p.id === stockFormData.productId);

      setStockInputs([
        ...stockInputs,
        {
          id: newStock.id,
          mitraId: newStock.mitra_id,
          productId: newStock.product_id,
          date: newStock.date,
          quantity: newStock.quantity,
          note: newStock.note || '',
          status: newStock.status,
          mitraName: mitra?.fullName || '-',
          productName: product?.name || '-',
        },
      ]);

      if (isAdminInput && product) {
        const updatedStock = (product.stock || 0) + quantity;
        await productService.update(product.id, { stock: updatedStock });
        setProducts((prev) =>
          prev.map((p) => (p.id === product.id ? { ...p, stock: updatedStock } : p)),
        );
      }

      await loadData();
      setStockFormData({ productId: '', stock: '', note: '' });
      setShowStockForm(false);
      setToast({
        message: isAdminInput ? 'Stok harian berhasil disimpan dan divalidasi otomatis!' : 'Stok harian berhasil disimpan dan menunggu validasi admin!',
        type: 'success',
      });
    } catch {
      setToast({ message: 'Gagal menyimpan stok harian', type: 'error' });
    }
  };

  const handleEditMitra = (mitra) => {
    setEditingMitra(mitra.id);
    setEditMitraName(mitra.fullName);
  };

  const handleValidateStock = async (stockId) => {
    const stock = stockInputs.find((s) => s.id === stockId);
    if (!stock) {
      setToast({ message: 'Data stok tidak ditemukan', type: 'error' });
      return;
    }

    const product = products.find((p) => p.id === stock.productId);
    if (!product) {
      setToast({ message: 'Produk tidak ditemukan untuk stok ini', type: 'error' });
      return;
    }

    try {
      await pendingStockValidationService.validate(stockId);

      const payload = {
        type: 'in',
        product_id: String(stock.productId),
        quantity: Number(stock.quantity),
        note: stock.note || '',
        mitra_id: stock.mitraId ? String(stock.mitraId) : null,
      };

      await stockMovementService.create(payload);

      setStockInputs((prev) => prev.filter((s) => s.id !== stockId));

      if (product) {
        const updatedStock = (product.stock || 0) + Number(stock.quantity);
        await productService.update(product.id, { stock: updatedStock });
        setProducts((prev) =>
          prev.map((p) => (p.id === product.id ? { ...p, stock: updatedStock } : p)),
        );
      }

      await loadData();
      setToast({ message: 'Stok berhasil divalidasi!', type: 'success' });
    } catch {
      const detail = [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(' | ') || JSON.stringify(error);
      setToast({ message: 'Gagal memvalidasi stok: ' + detail, type: 'error' });
    }
  };

  const handleUpdateMitra = async () => {
    if (!editingMitra || !editMitraName.trim()) return;
    try {
      await mitraService.update(editingMitra, { full_name: editMitraName });
      setMitraList((prev) => prev.map((m) => (m.id === editingMitra ? { ...m, fullName: editMitraName } : m)));
      setAllMitra((prev) => prev.map((m) => (m.id === editingMitra ? { ...m, fullName: editMitraName } : m)));
      setEditingMitra(null);
      setEditMitraName('');
      setToast({ message: 'Mitra berhasil diperbarui!', type: 'success' });
    } catch {
      setToast({ message: 'Gagal memperbarui mitra', type: 'error' });
    }
  };

  const handleDeleteMitra = async (mitraId) => {
    const productsInMitra = products.filter((p) => p.mitraId === mitraId).length;
    if (productsInMitra > 0) {
      setToast({ message: `Tidak dapat menghapus! Ada ${productsInMitra} produk milik mitra ini.`, type: 'error' });
      return;
    }
    if (!window.confirm('Apakah Anda yakin ingin menghapus mitra ini?')) return;
    try {
      await mitraService.delete(mitraId);
      setMitraList((prev) => prev.filter((m) => m.id !== mitraId));
      setAllMitra((prev) => prev.filter((m) => m.id !== mitraId));
      setToast({ message: 'Mitra berhasil dihapus!', type: 'success' });
    } catch {
      setToast({ message: 'Gagal menghapus mitra', type: 'error' });
    }
  };

  const statsCards = isMitra ? (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <StatCard icon="receipt_long" label="Transaksi Hari Ini" value={todayTransactionCount} subtitle={today} colorClass="bg-secondary-fixed text-on-secondary-fixed" />
      <StatCard icon="payments" label="Omzet Hari Ini" value={`Rp ${todayOmzet.toLocaleString('id-ID')}`} subtitle="Total penjualan hari ini" colorClass="bg-primary-fixed text-on-primary-fixed" />
    </div>
  ) : (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard icon="group" label="Total Mitra" value={allMitra.length} subtitle="Semua mitra terdaftar" colorClass="bg-primary-fixed text-on-primary-fixed" />
      <StatCard icon="check_circle" label="Mitra Aktif" value={activeMitra} subtitle={`${allMitra.length > 0 ? Math.round((activeMitra / allMitra.length) * 100) : 0}% dari total`} trend={`${allMitra.length > 0 ? Math.round((activeMitra / allMitra.length) * 100) : 0}%`} trendUp colorClass="bg-tertiary-fixed text-on-tertiary-fixed" />
      <StatCard icon="receipt_long" label="Total Transaksi" value={totalTransaction.toLocaleString('id-ID')} subtitle="Bulan ini" colorClass="bg-secondary-fixed text-on-secondary-fixed" />
      <StatCard icon="payments" label="Total Omzet" value={`Rp ${totalOmzet.toLocaleString('id-ID')}`} subtitle="Bulan ini" colorClass="bg-primary-fixed text-on-primary-fixed" />
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* Page Header */}
          <header className="hidden md:flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Mitra Dashboard</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                {isMitra ? 'Pantau stok dan performa mitra Anda' : 'Kelola data mitra dan pantau performa penjualan.'}
              </p>
            </div>
            {!isMitra && activeTab === 'mitra' && (
              <button
                onClick={() => setShowForm(!showForm)}
                className="h-12 px-6 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-xl flex items-center gap-2 transition-all duration-200 font-label-md text-label-md shadow-sm hover:shadow-md active:scale-95"
              >
                <span className="material-symbols-outlined">person_add</span>
                {showForm ? 'Batal' : 'Tambah Mitra'}
              </button>
            )}
          </header>

          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Mitra</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">{isMitra ? 'Dashboard Mitra' : 'Kelola data mitra'}</p>
            </div>
            {!isMitra && activeTab === 'mitra' && (
              <button
                onClick={() => setShowForm(!showForm)}
                className="h-10 w-10 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-full flex items-center justify-center transition-all duration-200 shadow-sm active:scale-95"
              >
                <span className="material-symbols-outlined">{showForm ? 'close' : 'add'}</span>
              </button>
            )}
          </div>

          {/* Statistics Cards */}
          {statsCards}

          {/* Tabs */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="flex border-b border-outline-variant bg-surface overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3.5 font-label-md text-label-md whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'text-primary border-b-2 border-primary bg-surface-container-low/50'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/30'
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-4 md:p-6">
              {activeTab === 'stock' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4 mb-4">
                    <button
                      onClick={() => setShowStockForm(!showStockForm)}
                      className="h-10 px-4 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-lg flex items-center gap-2 transition-colors font-label-md text-label-md w-full sm:w-auto justify-center"
                    >
                      <span className="material-symbols-outlined text-[18px]">{showStockForm ? 'close' : 'add'}</span>
                      {showStockForm ? 'Batal' : 'Tambah Stok'}
                    </button>
                  </div>

                  {showStockForm && (
                    <form className="p-6 border border-outline-variant rounded-xl bg-surface-container-low mb-4 space-y-4" onSubmit={handleStockSubmit}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <label className="block font-label-sm text-label-sm text-on-surface font-medium">Mitra</label>
                          {isMitra ? (
                            <div className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low font-body-md text-body-md flex items-center text-on-surface-variant">
                               {mitraList.find((m) => m.id === selectedMitra)?.fullName || '-'}
                            </div>
                          ) : (
                            <select
                              className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                              value={selectedMitra}
                              onChange={(e) => setSelectedMitra(e.target.value)}
                              required
                            >
                              <option value="">Pilih Mitra</option>
                              {mitraList.filter((m) => m.status === 'Aktif').map((m) => (
                                <option key={m.id} value={m.id}>{m.fullName}</option>
                              ))}
                            </select>
                          )}
                        </div>
                         <div className="space-y-2">
                           <label className="block font-label-sm text-label-sm text-on-surface font-medium">Produk</label>
                           <select
                             className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                             value={stockFormData.productId}
                             onChange={(e) => setStockFormData({ ...stockFormData, productId: e.target.value })}
                             required
                           >
                             <option value="">Pilih Produk</option>
                              {products
                                .filter((p) => {
                                  if (isMitra) {
                                    return visibleProductIds.has(p.id);
                                  }
                                  return visibleProductIds.size === 0 || visibleProductIds.has(p.id);
                                })
                                .map((p) => (
                                <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                              ))}
                           </select>
                         </div>
                        <div className="space-y-2">
                          <label className="block font-label-sm text-label-sm text-on-surface font-medium">Stok</label>
                          <input
                            className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                            type="number"
                            placeholder="0"
                            value={stockFormData.stock}
                            onChange={(e) => setStockFormData({ ...stockFormData, stock: e.target.value })}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="block font-label-sm text-label-sm text-on-surface font-medium">Catatan</label>
                          <input
                            className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                            type="text"
                            placeholder="Opsional"
                            value={stockFormData.note}
                            onChange={(e) => setStockFormData({ ...stockFormData, note: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button type="submit" className="h-10 px-6 bg-secondary-fixed-dim hover:bg-secondary-container text-on-secondary-container rounded-lg font-label-md text-label-md transition-colors">
                          Simpan Stok
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="flex flex-col sm:flex-row gap-4 mb-4">
                    <div className="flex-1">
                      <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Filter Tanggal</label>
                      <input
                        type="date"
                        className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        value={stockDate}
                        onChange={(e) => setStockDate(e.target.value)}
                      />
                    </div>
                    {!isMitra && (
                      <div className="flex-1">
                        <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Filter Mitra</label>
                        <select
                          className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                          value={selectedMitra}
                          onChange={(e) => setSelectedMitra(e.target.value)}
                        >
                          <option value="">Semua Mitra</option>
                          {mitraList.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.fullName}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                   </div>

                   <div className="overflow-x-auto">
                       <table className="w-full text-left border-collapse">
                         <thead>
                           <tr className="bg-surface-container-low border-b border-outline-variant">
                             <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Tanggal</th>
                             <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Mitra</th>
                             <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Produk</th>
                             <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Stok Masuk</th>
                             <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Stok Saat Ini</th>
                             <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Status</th>
                             <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Catatan</th>
                             {!isMitra && (
                               <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Aksi</th>
                             )}
                           </tr>
                         </thead>
                         <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                           {filteredTodayStock.length === 0 ? (
                             <tr>
                               <td colSpan={isMitra ? 7 : 8} className="px-6 py-12 text-center">
                                <span className="material-symbols-outlined text-6xl text-outline mb-3">inventory_2</span>
                                <p className="font-body-md text-body-md text-on-surface-variant">Tidak ada data stok untuk tanggal ini</p>
                              </td>
                            </tr>
                          ) : (
                              filteredTodayStock.map((stock, idx) => {
                                const product = products.find((p) => p.id === stock.productId);
                               return (
                                 <tr key={stock.id} className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}>
                                   <td className="px-6 py-4">
                                     <span className="font-body-sm text-body-sm text-on-surface">{stock.date || (stock.created_at ? stock.created_at.split('T')[0] : '-')}</span>
                                   </td>
                                  <td className="px-6 py-4">
                                    <span className="font-body-sm text-body-sm text-on-surface">{stock.mitraName}</span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className="font-body-sm text-body-sm text-on-surface">{stock.productName}</span>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <span className="font-numeric-data text-numeric-data text-on-background">{stock.quantity} {product?.unit || ''}</span>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <span className="font-numeric-data text-numeric-data text-on-background">{stock.currentStock ?? product?.stock ?? 0} {product?.unit || ''}</span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-label-md text-label-sm border ${stock.status === 'validated' ? 'bg-tertiary-fixed/15 text-tertiary-container border-tertiary-fixed/30' : 'bg-[#fdf2d5] text-[#7a590c] border-[#ebd083]'}`}>
                                      <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                                      {stock.status === 'validated' ? 'Tervalidasi' : 'Menunggu'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className="font-body-sm text-body-sm text-on-surface-variant">{stock.note || '-'}</span>
                                  </td>
                                  {!isMitra && (
                                    <td className="px-6 py-4 text-center">
                                      {stock.status === 'pending' ? (
                                        <button
                                          onClick={() => handleValidateStock(stock.id)}
                                          className="h-9 px-4 bg-tertiary-fixed/20 hover:bg-tertiary-fixed text-tertiary-container rounded-lg font-label-md text-label-md transition-colors flex items-center gap-2 mx-auto"
                                        >
                                          <span className="material-symbols-outlined text-[18px]">check</span>
                                          Validasi
                                        </button>
                                      ) : (
                                        <span className="font-body-sm text-body-sm text-on-surface-variant">-</span>
                                      )}
                                    </td>
                                  )}
                                </tr>
                              );
                            })
                         )}
                       </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'mitra' && !isMitra && (
                <div className="space-y-4">
                  {showForm && (
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md overflow-hidden">
                      <div className="p-6 border-b border-outline-variant/50 bg-surface flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                          <span className="material-symbols-outlined">person_add</span>
                        </div>
                        <div>
                          <h3 className="font-headline-sm text-headline-sm text-on-background">Tambah Mitra Baru</h3>
                          <p className="font-body-sm text-body-sm text-on-surface-variant">Isi data mitra dengan lengkap</p>
                        </div>
                      </div>
                      <form className="p-6 space-y-6" onSubmit={handleSubmit}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="block font-label-md text-label-md text-on-surface font-medium" htmlFor="fullName">Nama Lengkap <span className="text-error">*</span></label>
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                                <span className="material-symbols-outlined text-[20px]">person</span>
                              </div>
                              <input className="w-full h-12 pl-12 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all font-body-md text-body-md text-on-background placeholder:text-outline/70" id="fullName" type="text" placeholder="Masukkan nama lengkap" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} required />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="block font-label-md text-label-md text-on-surface font-medium" htmlFor="email">Email <span className="text-error">*</span></label>
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                                <span className="material-symbols-outlined text-[20px]">mail</span>
                              </div>
                              <input className="w-full h-12 pl-12 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all font-body-md text-body-md text-on-background placeholder:text-outline/70" id="email" type="email" placeholder="email@example.com" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="block font-label-md text-label-md text-on-surface font-medium" htmlFor="phone">No HP <span className="text-error">*</span></label>
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                                <span className="material-symbols-outlined text-[20px]">phone</span>
                              </div>
                              <input className="w-full h-12 pl-12 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all font-body-md text-body-md text-on-background placeholder:text-outline/70" id="phone" type="tel" placeholder="081234567890" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} required />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="block font-label-md text-label-md text-on-surface font-medium" htmlFor="gender">Jenis Kelamin <span className="text-error">*</span></label>
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                                <span className="material-symbols-outlined text-[20px]">wc</span>
                              </div>
                              <select className="w-full h-12 pl-12 pr-10 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all font-body-md text-body-md text-on-background appearance-none cursor-pointer" id="gender" value={formData.gender} onChange={(e) => setFormData({ ...formData, gender: e.target.value })}>
                                <option value="Laki-laki">Laki-laki</option>
                                <option value="Perempuan">Perempuan</option>
                              </select>
                              <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-outline">
                                <span className="material-symbols-outlined text-[20px]">arrow_drop_down</span>
                              </div>
                            </div>
                          </div>
                          <div className="md:col-span-2 space-y-2">
                            <label className="block font-label-md text-label-md text-on-surface font-medium" htmlFor="address">Alamat <span className="text-error">*</span></label>
                            <div className="relative">
                              <div className="absolute top-4 left-0 pl-4 flex items-center pointer-events-none text-outline">
                                <span className="material-symbols-outlined text-[20px]">location_on</span>
                              </div>
                              <textarea className="w-full h-24 pl-12 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all font-body-md text-body-md text-on-background placeholder:text-outline/70 resize-none" id="address" placeholder="Masukkan alamat lengkap" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} required />
                            </div>
                          </div>
                          <div className="md:col-span-2 space-y-2">
                            <label className="block font-label-md text-label-md text-on-surface font-medium" htmlFor="photo">Foto Mitra</label>
                            <div className="flex items-center gap-6">
                              <div className="w-20 h-20 rounded-full bg-surface-container overflow-hidden border-2 border-outline-variant flex items-center justify-center flex-shrink-0 shadow-sm">
                                {formData.photo ? (
                                   <img src={formData.photo} alt="Preview" width="80" height="80" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                                ) : (
                                  <span className="material-symbols-outlined text-outline text-4xl">person</span>
                                )}
                              </div>
                              <div className="flex-1">
                                <input type="file" id="photo" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                                <label htmlFor="photo" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-outline bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md cursor-pointer transition-colors shadow-sm">
                                  <span className="material-symbols-outlined text-[18px]">upload</span>
                                  Pilih Foto
                                </label>
                                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1.5">Format: JPG, PNG atau WEBP. Maks. 2MB.</p>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-outline-variant/50">
                          <button type="submit" className="h-12 px-8 bg-secondary-fixed-dim hover:bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-xl flex items-center justify-center gap-2 transition-all duration-200 active:scale-95 shadow-sm">
                            <span className="material-symbols-outlined">save</span>
                            Simpan Mitra
                          </button>
                          <button type="button" onClick={() => setShowForm(false)} className="h-12 px-8 bg-surface border border-outline-variant text-on-surface-variant font-label-md text-label-md rounded-xl hover:bg-surface-container transition-all duration-200">
                            Batal
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
                      <input
                        className="w-full h-10 pl-10 pr-4 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        placeholder="Cari mitra..."
                        value={mitraSearch}
                        onChange={(e) => setMitraSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-container-low border-b border-outline-variant">
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Mitra</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Kontak</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Status</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Transaksi</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Omzet</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                         {paginatedMitra.length === 0 ? (
                           <tr>
                             <td colSpan={6} className="px-6 py-12 text-center">
                               <span className="material-symbols-outlined text-6xl text-outline mb-3">person_off</span>
                               <p className="font-body-md text-body-md text-on-surface-variant">Tidak ada mitra yang ditemukan</p>
                             </td>
                           </tr>
                            ) : (
                              paginatedMitra.map((mitra, idx) => (
                            <tr key={mitra.id} className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}>
                              <td className="px-6 py-4">
                                {editingMitra === mitra.id ? (
                                  <input
                                    className="w-full h-10 px-3 rounded-lg border border-primary bg-surface font-body-md text-body-md outline-none"
                                    value={editMitraName}
                                    onChange={(e) => setEditMitraName(e.target.value)}
                                    onBlur={handleUpdateMitra}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleUpdateMitra();
                                      if (e.key === 'Escape') {
                                        setEditingMitra(null);
                                        setEditMitraName('');
                                      }
                                    }}
                                    autoFocus
                                  />
                                ) : (
                                  <span className="font-semibold text-on-surface text-base">{mitra.fullName}</span>
                                )}
                              </td>
                              <td className="px-6 py-4">
                                {editingMitra === mitra.id ? (
                                  <span className="font-body-sm text-body-sm text-on-surface-variant">Tekan Enter untuk simpan, Esc untuk batal</span>
                                ) : (
                                  <div>
                                    <div className="flex items-center gap-2 text-on-surface mb-1">
                                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant">phone</span>
                                      <span className="font-numeric-data text-numeric-data text-sm">{mitra.phone}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-on-surface-variant">
                                      <span className="material-symbols-outlined text-[16px]">mail</span>
                                      <span className="font-body-sm text-body-sm">{mitra.email}</span>
                  </div>
                   <Pagination
                     totalItems={filteredMitra.length}
                     itemsPerPage={mitraPerPage}
                     currentPage={mitraPage}
                     onPageChange={setMitraPage}
                   />
                </div>
              )}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {editingMitra === mitra.id ? (
                                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full font-label-md text-label-sm bg-primary/10 text-primary border border-primary/20">
                                    <span className="material-symbols-outlined text-[14px]">edit</span>
                                    Mengedit...
                                  </span>
                                ) : (
                                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-label-md text-label-md ${mitra.status === 'Aktif' ? 'bg-tertiary-fixed/15 text-tertiary-container border border-tertiary-fixed/30' : 'bg-error-container/15 text-error border border-error-container/30'}`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                                    {mitra.status}
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right">
                                {editingMitra === mitra.id ? (
                                  <span className="font-numeric-data text-numeric-data text-on-surface-variant">-</span>
                                ) : (
                                  <span className="font-numeric-data text-numeric-data text-on-background">{mitra.totalTransaction}</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right">
                                {editingMitra === mitra.id ? (
                                  <span className="font-numeric-data text-numeric-data text-on-surface-variant">-</span>
                                ) : (
                                  <span className="font-numeric-data text-numeric-data text-primary font-semibold">Rp {mitra.totalOmzet.toLocaleString('id-ID')}</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center">
                                 {editingMitra === mitra.id ? (
                                   <div className="flex items-center justify-center gap-2">
                                      <button
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={handleUpdateMitra}
                                        className="h-8 w-8 rounded-lg bg-tertiary-fixed/20 text-tertiary-container hover:bg-tertiary-fixed hover:text-on-tertiary-fixed flex items-center justify-center transition-all"
                                        title="Simpan"
                                        aria-label="Simpan"
                                      >
                                        <span className="material-symbols-outlined text-[18px]">check</span>
                                      </button>
                                      <button
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => { setEditingMitra(null); setEditMitraName(''); }}
                                        className="h-8 w-8 rounded-lg bg-surface-container text-on-surface-variant hover:bg-error hover:text-on-error flex items-center justify-center transition-all"
                                        title="Batal"
                                        aria-label="Batal"
                                      >
                                        <span className="material-symbols-outlined text-[18px]">close</span>
                                      </button>
                                   </div>
                                 ) : (
                                   <div className="flex items-center justify-center gap-2">
                                     <button
                                       onClick={() => handleEditMitra(mitra)}
                                       className="h-8 w-8 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-on-primary flex items-center justify-center transition-all"
                                       title="Edit"
                                       aria-label="Edit mitra"
                                     >
                                       <span className="material-symbols-outlined text-[18px]">edit</span>
                                     </button>
                                     <button
                                       onClick={() => handleDeleteMitra(mitra.id)}
                                       className="h-8 w-8 rounded-lg bg-error/10 text-error hover:bg-error hover:text-on-error flex items-center justify-center transition-all"
                                       title="Hapus"
                                       aria-label="Hapus mitra"
                                     >
                                       <span className="material-symbols-outlined text-[18px]">delete</span>
                                     </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'product' && (
                <div className="space-y-4">
                  {!isMitra && (
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4">
                      <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Filter Mitra</label>
                      <select
                        className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        value={productFilter}
                        onChange={(e) => setProductFilter(e.target.value)}
                      >
                        <option value="Semua">Semua Mitra</option>
                        {mitraList.filter((m) => m.status === 'Aktif').map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.fullName}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-container-low border-b border-outline-variant">
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Produk</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">SKU</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Kategori</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Jenis</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Mitra</th>
                        </tr>
                      </thead>
                         <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                            {products
                              .filter((p) => {
                                if (isMitra) {
                                  return visibleProductIds.has(p.id);
                                }
                                return visibleProductIds.size === 0 || visibleProductIds.has(p.id);
                              })
                              .map((product, idx) => (
                            <tr key={product.id} className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}>
                              <td className="px-6 py-4">
                                <span className="font-body-sm text-body-sm text-on-surface">{product.name}</span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="font-mono text-sm bg-surface-container px-2 py-1 rounded-md text-on-surface-variant">{product.sku}</span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-label-sm bg-surface-container text-on-surface-variant border border-outline-variant">
                                  {product.category}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-label-sm text-label-sm bg-surface-container text-on-surface-variant border border-outline-variant">
                                  {product.type}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <span className="font-body-sm text-body-sm text-on-surface">{product.mitraName}</span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'profit' && isMitra && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Filter Bulan</label>
                      <input
                        type="month"
                        className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        value={profitMonth}
                        onChange={(e) => setProfitMonth(e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Dari Tanggal</label>
                      <input
                        type="date"
                        className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        value={profitStartDate}
                        onChange={(e) => setProfitStartDate(e.target.value)}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Sampai Tanggal</label>
                      <input
                        type="date"
                        className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        value={profitEndDate}
                        onChange={(e) => setProfitEndDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
                      <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Omzet</p>
                      <p className="font-display-lg text-display-lg text-on-background tracking-tight">Rp {totalOmzetFiltered.toLocaleString('id-ID')}</p>
                    </div>
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
                      <p className="font-label-md text-label-md text-on-surface-variant mb-1">Total Laba Bersih</p>
                      <p className="font-display-lg text-display-lg text-primary font-semibold tracking-tight">Rp {totalProfit.toLocaleString('id-ID')}</p>
                    </div>
                    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5">
                      <p className="font-label-md text-label-md text-on-surface-variant mb-1">Jumlah Transaksi</p>
                      <p className="font-display-lg text-display-lg text-on-background tracking-tight">{profitHistory.reduce((sum, row) => sum + row.count, 0)}</p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-container-low border-b border-outline-variant">
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Tanggal</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Omzet</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Modal</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Laba Bersih</th>
                          <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Transaksi</th>
                        </tr>
                      </thead>
                      <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                        {profitHistory.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-6 py-12 text-center">
                              <span className="material-symbols-outlined text-6xl text-outline mb-3">payments</span>
                              <p className="font-body-md text-body-md text-on-surface-variant">Tidak ada data laba untuk periode ini</p>
                            </td>
                          </tr>
                        ) : (
                          profitHistory.map((row, idx) => (
                            <tr key={row.date} className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}>
                              <td className="px-6 py-4">
                                <span className="font-body-sm text-body-sm text-on-surface">{row.date}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <span className="font-numeric-data text-numeric-data text-on-surface-variant">Rp {row.omzet.toLocaleString('id-ID')}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <span className="font-numeric-data text-numeric-data text-on-surface-variant">Rp {row.modal.toLocaleString('id-ID')}</span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <span className="font-numeric-data text-numeric-data text-primary font-semibold">Rp {row.profit.toLocaleString('id-ID')}</span>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className="font-numeric-data text-numeric-data text-on-background">{row.count}</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

export default MitraDashboard;
