import { useState, useEffect, useMemo, useCallback } from 'react';
import { auditLogService, productService, mitraService, mitraSettlementService } from '../lib/services';
import Pagination from '../components/Pagination';

const TABEL_LABEL = {
  products: 'Produk',
  mitra: 'Mitra',
  categories: 'Kategori',
  product_types: 'Jenis Produk',
  mitra_settlements: 'Invoice Mitra',
};

const AKSI_LABEL = {
  create: 'Tambah',
  update: 'Ubah',
  delete: 'Hapus',
  restore: 'Pulihkan',
};

const AKSI_WARNA = {
  create: 'bg-tertiary-container text-on-tertiary-container',
  update: 'bg-secondary-container text-on-secondary-container',
  delete: 'bg-error-container text-on-error-container',
  restore: 'bg-primary-container text-on-primary-container',
};

// Service yang bisa dipulihkan per tabel. Hapus tidak pernah destroy data,
// jadi "pulihkan" selalu mungkin selama barisnya masih ada.
const RESTORE_SERVICE = {
  products: productService,
  mitra: mitraService,
  mitra_settlements: mitraSettlementService,
};

const formatWaktu = (iso) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

// Menampilkan field yang berubah antara sebelum dan sesudah, untuk create dan
// delete cukup menampilkan sisi yang ada.
const ringkasPerubahan = (aksi, sebelum, sesudah) => {
  if (aksi === 'create' && sesudah) {
    return Object.entries(sesudah)
      .filter(([k, v]) => !['created_at', 'photo'].includes(k) && v !== null && v !== '')
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' • ');
  }
  if (aksi === 'delete' && sebelum) {
    return Object.entries(sebelum)
      .filter(([k, v]) => !['created_at', 'deleted_at', 'photo'].includes(k) && v !== null && v !== '')
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' • ');
  }
  if (!sebelum || !sesudah) return '-';
  return Object.keys(sesudah)
    .filter((k) => !['updated_at', 'created_at'].includes(k) && JSON.stringify(sebelum[k]) !== JSON.stringify(sesudah[k]))
    .slice(0, 4)
    .map((k) => `${k}: ${sebelum[k] ?? '-'} → ${sesudah[k] ?? '-'}`)
    .join(' • ') || '-';
};

function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [deletedRows, setDeletedRows] = useState({ products: [], mitra: [], mitra_settlements: [] });
  const [tab, setTab] = useState('log');
  const [filterTabel, setFilterTabel] = useState('');
  const [filterAksi, setFilterAksi] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadLogs = useCallback(async () => {
    setError(null);
    try {
      const data = await auditLogService.getAll({
        limit: 500,
        tabel: filterTabel || null,
        aksi: filterAksi || null,
      });
      setLogs(data);
    } catch (err) {
      setError(err.message || 'Gagal memuat audit log');
    } finally {
      setLoading(false);
    }
  }, [filterTabel, filterAksi]);

  const loadDeleted = useCallback(async () => {
    try {
      const [products, mitra, settlements] = await Promise.all([
        productService.getAll({}, { includeDeleted: true }),
        mitraService.getAll({ includeDeleted: true }),
        mitraSettlementService.getAll({ includeDeleted: true }),
      ]);
      setDeletedRows({
        products: products.filter((p) => p.deleted_at),
        mitra: mitra.filter((m) => m.deleted_at),
        mitra_settlements: settlements.filter((s) => s.deleted_at),
      });
    } catch (err) {
      setError(err.message || 'Gagal memuat data terhapus');
    }
  }, []);

  useEffect(() => {
    if (tab === 'log') loadLogs();
    else loadDeleted();
  }, [tab, loadLogs, loadDeleted]);

  useEffect(() => { setPage(1); }, [search, filterTabel, filterAksi, tab]);

  const filteredLogs = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return logs;
    return logs.filter((l) =>
      [l.entitas_nama, l.user_email, l.tabel, l.aksi]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(keyword))
    );
  }, [logs, search]);

  const totalDeleted = Object.values(deletedRows).reduce((sum, rows) => sum + rows.length, 0);

  const pagedLogs = useMemo(
    () => filteredLogs.slice((page - 1) * perPage, page * perPage),
    [filteredLogs, page, perPage]
  );

  const handleRestore = async (tabel, id, label) => {
    const service = RESTORE_SERVICE[tabel];
    if (!service) return;
    if (!window.confirm(`Pulihkan kembali "${label}"? Data akan muncul lagi di daftar.`)) return;
    setBusyId(id);
    try {
      await service.restore(id);
      showToast(`${label} berhasil dipulihkan`);
      await loadDeleted();
      await loadLogs();
    } catch (err) {
      showToast(`Gagal memulihkan: ${err.message || 'tidak diketahui'}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deletedGroups = [
    { key: 'products', rows: deletedRows.products, name: (r) => r.nama_produk, sub: (r) => `SKU ${r.sku} • stok ${r.stock ?? 0} ${r.unit || ''}` },
    { key: 'mitra', rows: deletedRows.mitra, name: (r) => r.full_name, sub: (r) => r.email },
    { key: 'mitra_settlements', rows: deletedRows.mitra_settlements, name: (r) => r.invoice_number, sub: (r) => `${r.mitra?.full_name || '-'} • ${r.date || '-'}` },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display-lg text-display-lg text-on-background tracking-tight">Audit Log</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Setiap perubahan data tercatat. Hapus berarti dipindahkan, bukan dihapus, dan bisa dipulihkan.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setTab('log')}
                className={`h-10 px-4 rounded-lg font-label-md text-label-md transition-colors ${
                  tab === 'log' ? 'bg-primary text-on-primary' : 'bg-surface border border-outline-variant text-on-surface'
                }`}
              >
                Jejak Perubahan
              </button>
              <button
                onClick={() => setTab('sampah')}
                className={`h-10 px-4 rounded-lg font-label-md text-label-md transition-colors ${
                  tab === 'sampah' ? 'bg-primary text-on-primary' : 'bg-surface border border-outline-variant text-on-surface'
                }`}
              >
                Data Terhapus{totalDeleted > 0 ? ` (${totalDeleted})` : ''}
              </button>
            </div>
          </header>

          {tab === 'sampah' && (
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-primary-container text-on-primary-container">
              <span className="material-symbols-outlined">info</span>
              <span className="font-body-sm text-body-sm">
                Data di sini tidak hilang. Laporan, nota penjualan mitra, dan riwayat transaksi tetap menghitungnya
                seperti biasa karena barisnya masih utuh di database.
              </span>
            </div>
          )}

          {tab === 'log' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, pelaku, atau tabel..."
                className="h-10 px-3 rounded-lg bg-surface border border-outline-variant text-on-surface font-body-sm"
              />
              <select
                value={filterTabel}
                onChange={(e) => setFilterTabel(e.target.value)}
                className="h-10 px-3 rounded-lg bg-surface border border-outline-variant text-on-surface font-body-sm"
              >
                <option value="">Semua tabel</option>
                {Object.entries(TABEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select
                value={filterAksi}
                onChange={(e) => setFilterAksi(e.target.value)}
                className="h-10 px-3 rounded-lg bg-surface border border-outline-variant text-on-surface font-body-sm"
              >
                <option value="">Semua aksi</option>
                {Object.entries(AKSI_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-xl bg-error-container text-on-error-container font-body-sm">
              {error}
            </div>
          )}

          {tab === 'log' && (
            <div className="rounded-2xl bg-surface border border-outline-variant overflow-hidden">
              {loading ? (
                <p className="p-8 text-center text-on-surface-variant font-body-sm">Memuat audit log...</p>
              ) : pagedLogs.length === 0 ? (
                <p className="p-8 text-center text-on-surface-variant font-body-sm">
                  Belum ada jejak perubahan yang cocok dengan filter.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-surface-container text-on-surface-variant">
                      <tr className="font-label-sm text-label-sm">
                        <th className="px-4 py-3">Waktu</th>
                        <th className="px-4 py-3">Pelaku</th>
                        <th className="px-4 py-3">Aksi</th>
                        <th className="px-4 py-3">Data</th>
                        <th className="px-4 py-3">Perubahan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedLogs.map((log) => (
                        <tr key={log.id} className="border-t border-outline-variant/40 text-body-sm">
                          <td className="px-4 py-3 whitespace-nowrap text-on-surface-variant">{formatWaktu(log.created_at)}</td>
                          <td className="px-4 py-3 text-on-surface">{log.user_email || <span className="text-on-surface-variant">tidak diketahui</span>}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full font-label-sm text-label-sm ${AKSI_WARNA[log.aksi] || ''}`}>
                              {AKSI_LABEL[log.aksi] || log.aksi}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-on-surface">
                            <div>{log.entitas_nama || '-'}</div>
                            <div className="font-body-xs text-body-xs text-on-surface-variant">
                              {TABEL_LABEL[log.tabel] || log.tabel}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-on-surface-variant font-body-xs text-body-xs break-words">
                            {ringkasPerubahan(log.aksi, log.data_sebelum, log.data_sesudah)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {filteredLogs.length > perPage && (
                <Pagination
                  totalItems={filteredLogs.length}
                  itemsPerPage={perPage}
                  currentPage={page}
                  onPageChange={setPage}
                />
              )}
            </div>
          )}

          {tab === 'sampah' && (
            <div className="space-y-4">
              {deletedGroups.length === 0 ? (
                <div className="rounded-2xl bg-surface border border-outline-variant p-8 text-center">
                  <span className="material-symbols-outlined text-5xl text-on-surface-variant">check_circle</span>
                  <p className="mt-3 font-body-sm text-body-sm text-on-surface-variant">
                    Tidak ada data yang dihapus. Semua produk, mitra, dan invoice masih utuh.
                  </p>
                </div>
              ) : (
                deletedGroups.map((group) => (
                  <div key={group.key} className="rounded-2xl bg-surface border border-outline-variant overflow-hidden">
                    <div className="px-4 py-3 bg-surface-container font-label-md text-label-md text-on-surface">
                      {TABEL_LABEL[group.key]} ({group.rows.length})
                    </div>
                    <ul>
                      {group.rows.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-3 border-t border-outline-variant/40">
                          <div className="min-w-0">
                            <div className="font-body-md text-body-md text-on-surface truncate">
                              {group.name(row) || '-'}
                            </div>
                            <div className="font-body-xs text-body-xs text-on-surface-variant truncate">
                              {group.sub(row)}
                            </div>
                            <div className="font-body-xs text-body-xs text-on-surface-variant">
                              Dihapus {formatWaktu(row.deleted_at)}
                            </div>
                          </div>
                          {RESTORE_SERVICE[group.key] && (
                            <button
                              onClick={() => handleRestore(group.key, row.id, group.name(row))}
                              disabled={busyId === row.id}
                              className="shrink-0 h-9 px-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50"
                            >
                              {busyId === row.id ? 'Memulihkan...' : 'Pulihkan'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-24 md:bottom-6 right-4 z-50 px-5 py-3 rounded-xl shadow-lg font-body-sm text-body-sm ${
          toast.type === 'success' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-error-container text-on-error-container'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default AuditLog;
