import { useState, useEffect, useMemo } from 'react';
import {
  productService,
  stockMovementService,
  pendingStockValidationService,
} from '../lib/services';
import Pagination from '../components/Pagination';
import { ALASAN_STOK_KELUAR, hintAlasan, labelAlasan, ringkasanAlasan } from '../lib/stockReasons';

function StockManagement() {
  const [productsList, setProductsList] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [pendingValidations, setPendingValidations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState('Semua');
  const [filterProduct, setFilterProduct] = useState('Semua');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [valStartDate, setValStartDate] = useState('');
  const [valEndDate, setValEndDate] = useState('');
  const [valMitra, setValMitra] = useState('Semua');
  const [formData, setFormData] = useState({ type: 'in', productId: '', quantity: '', note: '', reason: '' });
  const [cariProduk, setCariProduk] = useState('');
  const [toast, setToast] = useState(null);
  const [movementPage, setMovementPage] = useState(1);
  const [validationPage, setValidationPage] = useState(1);
  const [movementsPerPage] = useState(20);
  const [validationsPerPage] = useState(20);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadProducts = async () => {
    try {
      const data = await productService.getAll();
      setProductsList(
        data.map((p) => ({
          id: p.id,
          name: p.nama_produk,
          sku: p.sku,
          category: p.category?.name,
          type: p.type?.name,
          mitraName: p.mitra?.full_name,
          mitraId: p.mitra_id,
          stock: p.stock,
          unit: p.unit,
        })),
      );
    } catch {
      showToast('Gagal memuat produk', 'error');
    }
  };

  const loadMovements = async () => {
    try {
      const data = await stockMovementService.getAll();
      setStockMovements(
        data.map((m) => ({
          id: m.id,
          type: m.type,
          productId: m.product_id,
          productName: m.product?.nama_produk,
          quantity: m.quantity,
          date: m.date || (m.created_at ? m.created_at.split('T')[0] : ''),
          note: m.note,
          reason: m.reason,
          mitraName: m.mitra?.full_name,
          // stock_movements tidak punya kolom user_id, jadi pelakunya tidak
          // bisa diambil dari tabel itu. Yang bisa ditunjukkan adalah mitranya
          // dan apakah barang masuk atau keluar. Pergerakan dari pengajuan
          // mitra selalu punya mitra_id, sedangkan yang dicatat admin langsung
          // juga punya karena diambil dari produk. Ditandai lewat catatan saja.
          viaPengajuan: /pengajuan|validasi/i.test(m.note || ''),
        })),
      );
    } catch {
      showToast('Gagal memuat transaksi stok', 'error');
    }
  };

  const loadValidations = async () => {
    try {
      const data = await pendingStockValidationService.getAll();
      setPendingValidations(
        data.map((v) => ({
          id: v.id,
          mitraName: v.mitra?.full_name,
          mitraId: v.mitra_id,
          productId: v.product_id,
          productName: v.product?.nama_produk,
          quantity: v.quantity,
          date: v.date,
          note: v.note,
        })),
      );
    } catch {
      showToast('Gagal memuat validasi stok', 'error');
    }
  };

  const filteredMovements = useMemo(() => {
    return stockMovements.filter((m) => {
      const matchesType = filterType === 'Semua' || m.type === filterType;
      const matchesProduct = filterProduct === 'Semua' || m.productId === Number(filterProduct);
      const matchesDate = (!startDate || m.date >= startDate) && (!endDate || m.date <= endDate);
      return matchesType && matchesProduct && matchesDate;
    });
  }, [stockMovements, filterType, filterProduct, startDate, endDate]);

  const paginatedMovements = useMemo(() => {
    const start = (movementPage - 1) * movementsPerPage;
    return filteredMovements.slice(start, start + movementsPerPage);
  }, [filteredMovements, movementPage, movementsPerPage]);

  const totalMovements = filteredMovements.length;
  const alasanRingkas = useMemo(() => ringkasanAlasan(stockMovements), [stockMovements]);

  // Daftar produk diurutkan abjad dan bisa dicari lewat nama produk atau nama
  // mitra. Daftar produknya lebih dari seratus item, jadi tanpa pencarian dan
  // urutan abjad, memilih produk jadi sulit.
  const daftarProdukTersaring = useMemo(() => {
    const abjad = [...productsList].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'id', { sensitivity: 'base' }));
    const keyword = cariProduk.trim().toLowerCase();
    if (!keyword) return abjad;
    return abjad.filter((p) =>
      String(p.name || '').toLowerCase().includes(keyword)
      || String(p.sku || '').toLowerCase().includes(keyword)
      || String(p.mitraName || '').toLowerCase().includes(keyword));
  }, [productsList, cariProduk]);

  const filteredPendingValidations = useMemo(() => {
    return pendingValidations.filter((v) => {
      const matchesMitra = valMitra === 'Semua' || v.mitraName === valMitra;
      const matchesDate = (!valStartDate || v.date >= valStartDate) && (!valEndDate || v.date <= valEndDate);
      return matchesMitra && matchesDate;
    });
  }, [pendingValidations, valMitra, valStartDate, valEndDate]);

  const paginatedValidations = useMemo(() => {
    const start = (validationPage - 1) * validationsPerPage;
    return filteredPendingValidations.slice(start, start + validationsPerPage);
  }, [filteredPendingValidations, validationPage, validationsPerPage]);

  const totalValidations = filteredPendingValidations.length;

  useEffect(() => {
    (async () => {
      await Promise.all([loadProducts(), loadMovements(), loadValidations()]);
    })();
  }, []);

  useEffect(() => {
    setMovementPage(1);
  }, [filterType, filterProduct, startDate, endDate]);

  useEffect(() => {
    setValidationPage(1);
  }, [valMitra, valStartDate, valEndDate]);

  // Simpan lewat satu RPC: stok diubah dan pergerakannya dicatat dalam satu
  // transaksi. Dulu pergerakannya ditulis lebih dulu, jadi stok keluar yang
  // melebihi stok meninggalkan riwayat yang menyatakan barang keluar padahal
  // stoknya tidak pernah berkurang.
  const catatStok = async ({ productId, type, quantity, note, mitraId, reason = null }) => {
    await stockMovementService.catat({ productId, type, quantity, note, mitraId, reason });
    window.dispatchEvent(new CustomEvent('kasir:stock-updated'));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const product = productsList.find((p) => p.id === formData.productId);
    if (!product || !formData.quantity || Number(formData.quantity) <= 0) return;

    try {
      await catatStok({
        productId: String(formData.productId),
        type: formData.type,
        quantity: Number(formData.quantity),
        note: formData.note || null,
        // Stok keluar tetap dicatat mitranya: untuk produk basah, ini berarti
        // mitra menarik barang yang belum terjual. Productnya sudah punya
        // mitra, jadi biarkan fungsi yang mengisinya dari produk.
        mitraId: formData.type === 'in' && product.mitraId ? String(product.mitraId) : null,
        reason: formData.type === 'out' ? formData.reason : null,
      });
      setFormData({ type: 'in', productId: '', quantity: '', note: '', reason: '' });
      setCariProduk('');
      setShowForm(false);
      showToast('Transaksi stok berhasil disimpan!', 'success');
      await loadProducts();
      await loadMovements();
      await loadValidations();
    } catch (err) {
      showToast(err?.message || 'Gagal menyimpan transaksi stok', 'error');
    }
  };

  const handleValidate = async (validationId) => {
    const validation = pendingValidations.find((v) => v.id === validationId);
    if (!validation) return;

    const product = productsList.find((p) => p.id === validation.productId);
    if (!product) return;

    try {
      // Nama servicenya pendingStockValidationService, bukan
      // stockMovementService. Salah nama membuat fungsi ini selalu gagal
      // dengan "Gagal memvalidasi stok" tanpa pernah mengubah apa pun.
      await pendingStockValidationService.validate(validationId);

      await catatStok({
        productId: validation.productId,
        // Menghormati jenis pengajuan. Selama ini selalu 'in' walau pengajuan
        // sudah bisa berupa penarikan barang.
        type: validation.type || 'in',
        quantity: validation.quantity,
        note: validation.note,
        mitraId: validation.mitraId ? String(validation.mitraId) : null,
        reason: (validation.type || 'in') === 'out' ? validation.reason : null,
      });
      showToast('Stok berhasil divalidasi!', 'success');
      await loadProducts();
      await loadMovements();
      await loadValidations();
    } catch (err) {
      showToast(err?.message || 'Gagal memvalidasi stok', 'error');
    }
  };

  const mitraNames = useMemo(() => ['Semua', ...new Set(pendingValidations.map((v) => v.mitraName))], [pendingValidations]);

  useEffect(() => {
    setMovementPage(1);
  }, [filterType, filterProduct, startDate, endDate]);

  useEffect(() => {
    setValidationPage(1);
  }, [valMitra, valStartDate, valEndDate]);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* Page Header */}
          <header className="hidden md:flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Manajemen Stok</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                Validasi stok mitra dan catat stok masuk/keluar
              </p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="h-12 px-6 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-xl flex items-center gap-2 transition-all duration-200 font-label-md text-label-md shadow-sm hover:shadow-md active:scale-95"
            >
              <span className="material-symbols-outlined">add</span>
              {showForm ? 'Batal' : 'Tambah Transaksi'}
            </button>
          </header>

          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Stok</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Validasi dan manajemen stok</p>
            </div>
            <button
              onClick={() => setShowForm(!showForm)}
              className="h-10 w-10 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-full flex items-center justify-center transition-all duration-200 shadow-sm active:scale-95"
            >
              <span className="material-symbols-outlined">{showForm ? 'close' : 'add'}</span>
            </button>
          </div>

          {/* Ringkasan barang keluar. Untuk produk basah, barang ditarik mitra itu hal
              normal. Yang perlu diwaspadai adalah barang rusak dan hilang,
              jadi keduanya dipisahkan di sini. */}
          {alasanRingkas.total > 0 && (
            <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
              <div className="flex items-start gap-2 mb-3">
                <span className="material-symbols-outlined text-on-surface-variant">inventory</span>
                <div>
                  <p className="font-headline-sm text-headline-sm text-on-background">Barang Keluar dari Gudang</p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    Mencakup semua pergerakan stok keluar, bukan yang penjualan. Total {alasanRingkas.total} unit.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="rounded-xl bg-surface-container p-3">
                  <p className="font-label-sm text-label-sm text-on-surface-variant">Ditarik Mitra</p>
                  <p className="font-headline-sm text-headline-sm text-on-surface font-numeric-data text-numeric-data">
                    {alasanRingkas.ditarikMitra}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">normal untuk produk basah</p>
                </div>
                {alasanRingkas.daftar
                  .filter((a) => a.nilai !== 'ditarik_mitra')
                  .map((a) => (
                    <div key={a.nilai} className="rounded-xl bg-surface-container p-3">
                      <p className="font-label-sm text-label-sm text-on-surface-variant">{a.label}</p>
                      <p className="font-headline-sm text-headline-sm text-error font-numeric-data text-numeric-data">
                        {a.quantity}
                      </p>
                      <p className="font-label-sm text-label-sm text-on-surface-variant">{a.occasions} kejadian</p>
                    </div>
                  ))}
              </div>
              {alasanRingkas.masalah > 0 && (
                <p className="mt-3 font-body-sm text-body-sm text-on-surface-variant">
                  {alasanRingkas.masalah} unit keluar dengan alasan selain ditarik mitra. Kalau angkanya besar,
                  perlu dicek apakah memang barang hilang atau ada kesalahan pencatatan.
                </p>
              )}
            </div>
          )}

          {/* Validation Section */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-outline-variant/50 bg-surface">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-tertiary-fixed/20 flex items-center justify-center text-tertiary-container">
                  <span className="material-symbols-outlined">verified</span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-headline-sm text-on-background">Validasi Stok Mitra</h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    {pendingValidations.length} menunggu validasi
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="w-full md:w-48">
                  <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Filter Tanggal</label>
                  <input
                    type="date"
                    className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                    value={valStartDate}
                    onChange={(e) => setValStartDate(e.target.value)}
                  />
                </div>
                <div className="w-full md:w-48">
                  <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Sampai Tanggal</label>
                  <input
                    type="date"
                    className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                    value={valEndDate}
                    onChange={(e) => setValEndDate(e.target.value)}
                  />
                </div>
                <div className="w-full md:w-48">
                  <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Nama Mitra</label>
                  <select
                    className="w-full h-10 px-4 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none"
                    value={valMitra}
                    onChange={(e) => setValMitra(e.target.value)}
                  >
                    {mitraNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {paginatedValidations.length === 0 ? (
                <div className="p-8 text-center">
                  <span className="material-symbols-outlined text-5xl text-outline mb-2">check_circle</span>
                  <p className="font-body-md text-body-md text-on-surface-variant">Tidak ada stok yang menunggu validasi</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low border-b border-outline-variant">
                        <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Tanggal</th>
<th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Mitra &amp; Sumber</th>
                        <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Produk</th>
                        <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Jumlah</th>
                        <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Catatan</th>
                        <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                      {paginatedValidations.map((validation, idx) => {
                        const product = productsList.find((p) => p.id === validation.productId);
                        return (
                          <tr key={validation.id} className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}>
                            <td className="px-6 py-4">
                              <span className="font-body-sm text-body-sm text-on-surface">{validation.date}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="font-body-sm text-body-sm text-on-surface">{validation.mitraName}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="font-body-sm text-body-sm text-on-surface">{product?.name || '-'}</span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <span className="font-numeric-data text-numeric-data text-on-background">{validation.quantity} {product?.unit || ''}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="font-body-sm text-body-sm text-on-surface-variant">{validation.note || '-'}</span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => handleValidate(validation.id)}
                                className="h-9 px-4 bg-tertiary-fixed/20 hover:bg-tertiary-fixed text-tertiary-container rounded-lg font-label-md text-label-md transition-colors flex items-center gap-2 mx-auto"
                              >
                                <span className="material-symbols-outlined text-[18px]">check</span>
                                Validasi
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                totalItems={totalValidations}
                itemsPerPage={validationsPerPage}
                currentPage={validationPage}
                onPageChange={setValidationPage}
              />
            </div>
          </div>

          {/* Add/Edit Stock Movement Form */}
          {showForm && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md overflow-hidden">
              <div className="p-6 border-b border-outline-variant/50 bg-surface flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center text-on-secondary-container">
                  <span className="material-symbols-outlined">add_circle</span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-headline-sm text-on-background">Tambah Transaksi Stok</h3>
                  <p className="font-body-sm text-body-sm text-on-surface-variant">Catat stok masuk atau keluar</p>
                </div>
              </div>
              <form className="p-6 space-y-6" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Jenis Transaksi */}
                  <div className="space-y-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Jenis Transaksi</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                        <span className="material-symbols-outlined text-[20px]">swap_vert</span>
                      </div>
                      <select
                        className="w-full h-12 pl-12 pr-10 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none cursor-pointer"
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      >
                        <option value="in">Stok Masuk</option>
                        <option value="out">Stok Keluar</option>
                      </select>
                      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-outline">
                        <span className="material-symbols-outlined text-[20px]">arrow_drop_down</span>
                      </div>
                    </div>
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      {formData.type === 'in'
                        ? 'Barang baru datang dari mitra, atau koreksi hasil stok opname.'
                        : 'Barang keluar dari gudang. Untuk produk basah biasanya sisa yang ditarik mitra.'}
                    </p>
                  </div>

                  {/* Alasan. Wajib untuk stok keluar karena Owner perlu memisahkan
                      barang ditarik mitra dari barang rusak atau hilang. */}
                  {formData.type === 'out' && (
                    <div className="space-y-2">
                      <label className="block font-label-md text-label-md text-on-surface font-medium">
                        Alasan Barang Keluar
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                          <span className="material-symbols-outlined text-[20px]">report_problem</span>
                        </div>
                        <select
                          className="w-full h-12 pl-12 pr-10 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none cursor-pointer"
                          value={formData.reason}
                          onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                          required
                        >
                          <option value="">Pilih Alasan</option>
                          {ALASAN_STOK_KELUAR.map((a) => (
                            <option key={a.nilai} value={a.nilai}>{a.label}</option>
                          ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-outline">
                          <span className="material-symbols-outlined text-[20px]">arrow_drop_down</span>
                        </div>
                      </div>
                      {formData.reason && (
                        <p className="font-body-sm text-body-sm text-on-surface-variant">
                          {hintAlasan(formData.reason)}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Produk. Daftar diurutkan abjad dan bisa dicari lewat kotak pencarian,
                      karena daftar produknya sudah lebih dari seratus item. */}
                  <div className="space-y-2 md:col-span-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Produk</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                        <span className="material-symbols-outlined text-[20px]">search</span>
                      </div>
                      <input
                        type="text"
                        value={cariProduk}
                        onChange={(e) => setCariProduk(e.target.value)}
                        placeholder="Cari nama produk atau nama mitra..."
                        className="w-full h-11 pl-12 pr-4 rounded-xl border border-outline bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      />
                      {cariProduk && (
                        <button
                          type="button"
                          onClick={() => setCariProduk('')}
                          className="absolute inset-y-0 right-0 pr-4 flex items-center text-outline hover:text-on-surface"
                          aria-label="Bersihkan pencarian"
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      )}
                    </div>

                    {cariProduk && (
                      <p className="font-body-sm text-body-sm text-on-surface-variant">
                        {daftarProdukTersaring.length} dari {productsList.length} produk cocok
                      </p>
                    )}

                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                        <span className="material-symbols-outlined text-[20px]">shopping_bag</span>
                      </div>
                      <select
                        className="w-full h-12 pl-12 pr-10 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none cursor-pointer"
                        value={formData.productId}
                        onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
                        required
                      >
                        <option value="">Pilih Produk</option>
                        {daftarProdukTersaring.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.mitraName || 'Tanpa mitra'} (Stok: {p.stock} {p.unit})
                          </option>
                        ))}
                      </select>
                      <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-outline">
                        <span className="material-symbols-outlined text-[20px]">arrow_drop_down</span>
                      </div>
                    </div>

                    {cariProduk && daftarProdukTersaring.length === 0 && (
                      <p className="font-body-sm text-body-sm text-error">
                        Tidak ada produk yang cocok dengan &quot;{cariProduk}&quot;.
                      </p>
                    )}
                  </div>

                  {/* Jumlah */}
                  <div className="space-y-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Jumlah</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                        <span className="material-symbols-outlined text-[20px]">numbers</span>
                      </div>
                      <input
                        className="w-full h-12 pl-12 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        type="number"
                        placeholder="0"
                        value={formData.quantity}
                        onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                        required
                        min="1"
                      />
                    </div>
                  </div>

                  {/* Catatan */}
                  <div className="space-y-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium">Catatan</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-outline">
                        <span className="material-symbols-outlined text-[20px]">notes</span>
                      </div>
                      <input
                        className="w-full h-12 pl-12 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                        type="text"
                        placeholder="Opsional"
                        value={formData.note}
                        onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                {/* Form Actions */}
                <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-outline-variant/30">
                  <button
                    type="submit"
                    className="h-12 px-8 bg-secondary-fixed-dim hover:bg-secondary-container text-on-secondary-container font-label-md text-label-md rounded-xl flex items-center justify-center gap-2 transition-all duration-200 active:scale-95 shadow-sm"
                  >
                    <span className="material-symbols-outlined">save</span>
                    Simpan Transaksi
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="h-12 px-8 bg-surface border border-outline-variant text-on-surface-variant font-label-md text-label-md rounded-xl hover:bg-surface-container transition-all duration-200"
                  >
                    Batal
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Filters */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="w-full md:w-48">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Jenis</label>
                <select
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="Semua">Semua</option>
                  <option value="in">Stok Masuk</option>
                  <option value="out">Stok Keluar</option>
                </select>
              </div>
              <div className="w-full md:w-48">
                <label className="block font-label-md text-label-md text-on-surface font-medium mb-2">Produk</label>
                <select
                  className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none"
                  value={filterProduct}
                  onChange={(e) => setFilterProduct(e.target.value)}
                >
                  <option value="Semua">Semua</option>
                  {productsList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
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
            </div>
          </div>

          {/* Stock Movements Table */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-outline-variant bg-surface">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Riwayat Transaksi Stok</h3>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Menampilkan {totalMovements} transaksi</p>
            </div>

             {paginatedMovements.length === 0 ? (
              <div className="p-12 text-center">
                <span className="material-symbols-outlined text-6xl text-outline mb-3">inventory_2</span>
                <p className="font-body-md text-body-md text-on-surface-variant">Tidak ada transaksi stok</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low border-b border-outline-variant">
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Tanggal</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Jenis</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Produk</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-right">Jumlah</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Mitra</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Alasan</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider font-semibold text-left">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="font-body-md text-body-md divide-y divide-outline-variant/50">
                     {paginatedMovements.map((movement, idx) => {
                      const product = productsList.find((p) => p.id === movement.productId);
                      return (
                        <tr
                          key={movement.id}
                          className={`hover:bg-surface-container-low/50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-container-low/20' : ''}`}
                        >
                          <td className="px-6 py-4">
                            <span className="font-body-sm text-body-sm text-on-surface">{movement.date}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-label-md text-label-sm border ${
                                movement.type === 'in'
                                  ? 'bg-tertiary-fixed/15 text-tertiary-container border-tertiary-fixed/30'
                                  : 'bg-error-container/15 text-error border-error-container/30'
                              }`}
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                              {movement.type === 'in' ? 'Masuk' : 'Keluar'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-body-sm text-body-sm text-on-surface">{product?.name || '-'}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className={`font-numeric-data text-numeric-data ${movement.type === 'in' ? 'text-tertiary-container' : 'text-error'}`}>
                              {movement.type === 'in' ? '+' : '-'}
                              {movement.quantity} {product?.unit || ''}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-body-sm text-body-sm text-on-surface">{movement.mitraName || '-'}</span>
                            <div className="font-body-sm text-body-sm text-on-surface-variant">
                              {movement.viaPengajuan ? 'lewat pengajuan mitra' : 'dicatat admin'}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {movement.type === 'out' && movement.reason ? (
                              <span className="inline-flex items-center px-2 py-1 rounded-full font-label-sm text-label-sm bg-surface-container-high text-on-surface-variant">
                                {labelAlasan(movement.reason)}
                              </span>
                            ) : (
                              <span className="font-body-sm text-body-sm text-on-surface-variant">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className="font-body-sm text-body-sm text-on-surface-variant">{movement.note || '-'}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              totalItems={totalMovements}
              itemsPerPage={movementsPerPage}
              currentPage={movementPage}
              onPageChange={setMovementPage}
            />
          </div>
        </div>
      </main>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 ${toast.type === 'success' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-error-container text-on-error-container'}`}>
          <span className="material-symbols-outlined">{toast.type === 'success' ? 'check_circle' : 'error'}</span>
          <span className="font-label-md text-label-md">{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default StockManagement;