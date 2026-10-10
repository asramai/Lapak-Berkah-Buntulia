import { useState, useEffect, useCallback } from 'react';
import { categoryService, productTypeService, productGroupService } from '../lib/services';

const TABS = [
  {
    id: 'kategori',
    label: 'Kategori',
    icon: 'category',
    service: categoryService,
    deskripsi: 'Kondisi barang. Contoh: Perishable, Non-Perishable.',
  },
  {
    id: 'jenis',
    label: 'Jenis',
    icon: 'nutrition',
    service: productTypeService,
    deskripsi: 'Jenis barang. Contoh: Makanan Basah, Minuman.',
  },
  {
    id: 'kelompok',
    label: 'Kelompok',
    icon: 'group_work',
    service: productGroupService,
    deskripsi: 'Pengelompokan produk, dipakai sebagai tab di Menu Kasir. Contoh: Kue & Makanan Utama.',
  },
];

const formatWaktu = (iso) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function DimensionManagement() {
  const [tab, setTab] = useState('kategori');
  const [items, setItems] = useState([]);
  const [deletedItems, setDeletedItems] = useState([]);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [nama, setNama] = useState('');
  const [busyId, setBusyId] = useState(null);

  const config = TABS.find((t) => t.id === tab);
  const service = config.service;

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aktif, terhapus] = await Promise.all([
        service.getAll(),
        service.getAll({ includeDeleted: true }),
      ]);
      setItems(aktif);
      setDeletedItems(terhapus);
    } catch {
      showToast('Gagal memuat data', 'error');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Bersihkan form setiap berpindah tab supaya tidak
  // menyimpan nama dari dimensi lain.
  const handleTabChange = (tabId) => {
    setTab(tabId);
    setShowForm(false);
    setEditingItem(null);
    setNama('');
    setShowDeleted(false);
  };

  const openForm = () => {
    setEditingItem(null);
    setNama('');
    setShowForm(true);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setNama(item.name);
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = nama.trim();
    if (!trimmed) {
      showToast('Nama tidak boleh kosong', 'error');
      return;
    }
    setBusyId('form');
    try {
      if (editingItem) {
        await service.update(editingItem.id, trimmed);
        showToast(`${config.label} berhasil diperbarui`, 'success');
      } else {
        await service.create(trimmed);
        showToast(`${config.label} berhasil ditambahkan`, 'success');
      }
      setShowForm(false);
      setEditingItem(null);
      setNama('');
      await loadData();
    } catch (error) {
      const detail = [error?.message, error?.details, error?.hint].filter(Boolean).join(' | ') || 'Terjadi kesalahan saat menyimpan';
      showToast(`Gagal menyimpan: ${detail}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(
      `Pindahkan "${item.name}" ke data terhapus?\n\n`
      + 'Data tidak hilang permanen dan bisa dipulihkan dari halaman ini.'
    )) return;
    setBusyId(item.id);
    try {
      await service.delete(item.id);
      showToast(`${config.label} dipindahkan ke data terhapus`, 'success');
      await loadData();
    } catch {
      showToast('Gagal menghapus', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (item) => {
    setBusyId(item.id);
    try {
      await service.restore(item.id);
      showToast(`${config.label} dipulihkan`, 'success');
      await loadData();
    } catch {
      showToast('Gagal memulihkan', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const daftar = showDeleted ? deletedItems : items;

  return (
    <div className="flex-1 flex flex-col w-full relative z-0 h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* Page Header */}
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Manajemen Dimensi Produk</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                Kelola Kategori, Jenis, dan Kelompok produk
              </p>
            </div>
          </header>

          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto hide-scrollbar border-b border-outline-variant">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTabChange(t.id)}
                className={`h-11 px-4 flex items-center gap-2 font-label-md text-label-md whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-primary text-primary font-semibold'
                    : 'border-transparent text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>

          <p className="font-body-sm text-body-sm text-on-surface-variant">{config.deskripsi}</p>

          {/* Toolbar */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-md overflow-hidden">
            <div className="p-4 md:p-6 border-b border-outline-variant/50 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-headline-sm text-headline-sm text-on-background">
                  Daftar {config.label}
                </h3>
                <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-1 rounded-full">
                  {loading ? '...' : daftar.length}
                </span>
                <button
                  onClick={() => setShowDeleted((v) => !v)}
                  className={`h-8 px-3 rounded-full font-label-sm text-label-sm border transition-colors ${
                    showDeleted
                      ? 'bg-surface-container-high text-on-surface border-outline'
                      : 'text-on-surface-variant border-outline-variant hover:bg-surface-container'
                  }`}
                >
                  {showDeleted ? 'Sembunyikan Terhapus' : `Data Terhapus (${deletedItems.length})`}
                </button>
              </div>
              {!showDeleted && (
                <button
                  onClick={openForm}
                  className="h-10 px-5 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-xl flex items-center gap-2 transition-all font-label-md text-label-md shadow-sm hover:shadow-md active:scale-95"
                >
                  <span className="material-symbols-outlined">add</span>
                  Tambah {config.label}
                </button>
              )}
            </div>

            {/* Add/Edit Form */}
            {showForm && !showDeleted && (
              <form className="p-6 border-b border-outline-variant/50 bg-surface-container-low" onSubmit={handleSubmit}>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                  <div className="flex-1 w-full space-y-2">
                    <label className="block font-label-md text-label-md text-on-surface font-medium" htmlFor="dimensi-nama">
                      Nama {config.label} <span className="text-error">*</span>
                    </label>
                    <input
                      className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all font-body-md text-body-md text-on-background placeholder:text-outline/70"
                      id="dimensi-nama"
                      type="text"
                      placeholder={`Contoh: ${tab === 'kategori' ? 'Perishable' : tab === 'jenis' ? 'Makanan Basah' : 'Kue & Makanan Utama'}`}
                      value={nama}
                      onChange={(e) => setNama(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busyId === 'form'}
                      className="h-12 px-6 bg-primary hover:bg-primary-fixed-variant text-on-primary rounded-xl font-label-md text-label-md transition-all active:scale-95 disabled:opacity-50"
                    >
                      {editingItem ? 'Simpan Perubahan' : 'Tambah'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForm(false);
                        setEditingItem(null);
                        setNama('');
                      }}
                      className="h-12 px-6 bg-surface-container-high hover:bg-surface-container text-on-surface rounded-xl font-label-md text-label-md transition-all"
                    >
                      Batal
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Table */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <p className="font-body-md text-body-md text-on-surface-variant">Memuat data...</p>
              </div>
            ) : daftar.length === 0 ? (
              <div className="text-center py-16">
                <span className="material-symbols-outlined text-4xl text-outline">inventory_2</span>
                <p className="font-body-md text-body-md text-on-surface-variant mt-2">
                  {showDeleted ? 'Tidak ada data terhapus.' : `Belum ada ${config.label.toLowerCase()}.`}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant font-label-md text-xs uppercase tracking-wider">
                      <th className="py-3 px-4">Nama</th>
                      <th className="py-3 px-4">{showDeleted ? 'Dihapus' : 'Ditambahkan'}</th>
                      <th className="py-3 px-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/50 text-sm">
                    {daftar.map((item) => (
                      <tr key={item.id} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="py-3 px-4 font-medium text-on-background">{item.name}</td>
                        <td className="py-3 px-4 text-on-surface-variant">
                          {formatWaktu(showDeleted ? item.deleted_at : item.created_at)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            {showDeleted ? (
                              <button
                                onClick={() => handleRestore(item)}
                                disabled={busyId === item.id}
                                className="h-8 px-3 rounded-lg bg-primary-container/50 hover:bg-primary-container text-on-primary-container flex items-center gap-1 font-label-sm text-label-sm transition-all disabled:opacity-50"
                                title="Pulihkan"
                                aria-label={`Pulihkan ${item.name}`}
                              >
                                <span className="material-symbols-outlined text-sm">restore</span>
                                Pulihkan
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleEdit(item)}
                                  className="w-8 h-8 rounded-lg bg-secondary-container/50 hover:bg-secondary-container text-on-secondary-container flex items-center justify-center transition-all"
                                  title="Edit"
                                  aria-label={`Edit ${item.name}`}
                                >
                                  <span className="material-symbols-outlined text-sm">edit</span>
                                </button>
                                <button
                                  onClick={() => handleDelete(item)}
                                  disabled={busyId === item.id}
                                  className="w-8 h-8 rounded-lg bg-error-container/30 hover:bg-error-container/50 text-error flex items-center justify-center transition-all disabled:opacity-50"
                                  title="Pindahkan ke data terhapus"
                                  aria-label={`Hapus ${item.name}`}
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              </>
                            )}
                          </div>
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
    </div>
  );
}

export default DimensionManagement;
