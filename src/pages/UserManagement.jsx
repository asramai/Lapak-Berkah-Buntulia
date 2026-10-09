import { useState, useEffect, useMemo, useCallback } from 'react';
import { userService, mitraService } from '../lib/services';

const ROLE_LABELS = {
  admin: 'Admin',
  owner: 'Owner',
  mitra: 'Mitra',
  kasir: 'Kasir',
};

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
  { value: 'mitra', label: 'Mitra' },
  { value: 'kasir', label: 'Kasir' },
];

const DEFAULT_MITRA_PASSWORD = 'mitra123';

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [mitraList, setMitraList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    nama: '',
    email: '',
    password: '',
    role: 'kasir',
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('semua');
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [userData, mitraData] = await Promise.all([
        userService.getAll(),
        mitraService.getAll({ includeDeleted: true }),
      ]);
      setUsers(userData || []);
      setMitraList(mitraData || []);
    } catch (err) {
      showToast('Gagal memuat data: ' + err?.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getMitraByEmail = useCallback((email) => {
    if (!email) return null;
    return mitraList.find((m) => m.email?.toLowerCase() === email.toLowerCase()) || null;
  }, [mitraList]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      showToast('Konfirmasi kata sandi tidak cocok', 'error');
      return;
    }
    if (password && password.length < 6) {
      showToast('Kata sandi minimal 6 karakter', 'error');
      return;
    }

    const isAdmin = true;
    const roleChanged = editingUser && editingUser.role !== formData.role;
    const becomingMitra = formData.role === 'mitra';
    const leavingMitra = editingUser?.role === 'mitra' && formData.role !== 'mitra';

    if ((roleChanged && (becomingMitra || leavingMitra)) && !isAdmin) {
      showToast('Hanya admin yang bisa mengubah peran Mitra', 'error');
      return;
    }

    try {
      const payload = {
        nama: formData.nama,
        email: formData.email,
        role: formData.role,
      };
      if (password) payload.password = password;

      if (editingUser) {
        await userService.update(editingUser.id, payload);
        showToast('Pengguna berhasil diperbarui', 'success');
      } else {
        payload.password = password;
        await userService.create(payload);
        showToast('Pengguna berhasil ditambahkan', 'success');
      }

      if (becomingMitra) {
        const existingMitra = getMitraByEmail(formData.email);
        if (!existingMitra) {
          await mitraService.create({
            full_name: formData.nama,
            address: '',
            phone: '',
            email: formData.email,
            gender: 'Laki-laki',
            photo: '',
            status: 'Aktif',
            total_transaction: 0,
            total_omzet: 0,
          });
          await userService.update(editingUser?.id || '', { password: DEFAULT_MITRA_PASSWORD });
          showToast(`Akun Mitra dibuat. Password default: ${DEFAULT_MITRA_PASSWORD}`, 'success');
        }
      } else if (leavingMitra) {
        const mitra = getMitraByEmail(formData.email);
        if (mitra) {
          await mitraService.update(mitra.id, { status: 'Tidak Aktif' });
        }
      }

      setShowForm(false);
      setFormData({ nama: '', email: '', password: '', role: 'kasir' });
      setPassword('');
      setConfirmPassword('');
      setEditingUser(null);
      loadData();
    } catch (err) {
      showToast('Gagal menyimpan: ' + err?.message, 'error');
    }
  };

  const handleResetMitraPassword = async (user) => {
    if (!window.confirm(`Reset password user "${user.nama}" ke default (${DEFAULT_MITRA_PASSWORD})?`)) return;
    try {
      await userService.update(user.id, { password: DEFAULT_MITRA_PASSWORD });
      showToast(`Password direset ke ${DEFAULT_MITRA_PASSWORD}`, 'success');
      loadData();
    } catch (err) {
      showToast('Gagal reset password: ' + err?.message, 'error');
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      nama: user.nama,
      email: user.email,
      role: user.role,
    });
    setPassword('');
    setConfirmPassword('');
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirmDelete) {
      setDeletingId(id);
      setConfirmDelete(true);
      return;
    }

    const user = users.find((u) => u.id === id);
    const mitra = user ? getMitraByEmail(user.email) : null;

    if (mitra) {
      if (!window.confirm(
        `User "${user?.nama}" terhubung ke Mitra "${mitra.full_name}".\n` +
        `Menghapus user akan memutus akses login Mitra.\n` +
        `Data Mitra (produk, transaksi) TETAP DI SIMPAN.\n\n` +
        `Lanjutkan hapus user saja?`
      )) {
        setDeletingId(null);
        setConfirmDelete(false);
        return;
      }
    }

    try {
      await userService.delete(id);
      showToast('Pengguna berhasil dihapus', 'success');
      loadData();
    } catch (err) {
      showToast('Gagal menghapus: ' + err?.message, 'error');
    } finally {
      setDeletingId(null);
      setConfirmDelete(false);
    }
  };

  const handleCancelDelete = () => {
    setDeletingId(null);
    setConfirmDelete(false);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingUser(null);
    setFormData({ nama: '', email: '', password: '', role: 'kasir' });
    setPassword('');
    setConfirmPassword('');
  };

  const filteredUsers = useMemo(() => {
    let result = users;
    if (roleFilter !== 'semua') {
      result = result.filter((u) => u.role === roleFilter);
    }
    if (search) {
      const term = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.nama?.toLowerCase().includes(term) ||
          u.email?.toLowerCase().includes(term)
      );
    }
    return result;
  }, [users, roleFilter, search]);

  const usersWithMitra = useMemo(() => {
    return filteredUsers.map((user) => {
      const mitra = getMitraByEmail(user.email);
      return {
        ...user,
        mitra,
        mitraStatus: mitra?.status || '-',
        mitraTotalTransaksi: mitra?.total_transaction || 0,
        mitraTotalOmzet: mitra?.total_omzet || 0,
      };
    });
  }, [filteredUsers, getMitraByEmail]);

  const roleBadge = (role) => {
    const colors = {
      admin: 'bg-error-container text-error',
      owner: 'bg-primary-container text-on-primary-container',
      mitra: 'bg-secondary-container text-on-secondary-container',
      kasir: 'bg-tertiary-container text-on-tertiary-container',
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${colors[role] || 'bg-surface-container text-on-surface'}`}
      >
        {ROLE_LABELS[role] || role}
      </span>
    );
  };

  const statusBadge = (status) => {
    if (!status || status === '-') return <span className="text-on-surface-variant">-</span>;
    const isActive = status === 'Aktif';
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-label-md text-label-sm border ${
        isActive
          ? 'bg-tertiary-fixed/15 text-tertiary-container border-tertiary-fixed/30'
          : 'bg-[#fdf2d5] text-[#7a590c] border-[#ebd083]'
      }`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
        {status}
      </span>
    );
  };

  const rupiah = (value) => `Rp ${(Number(value) || 0).toLocaleString('id-ID')}`;

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="font-headline-lg text-headline-lg text-on-background">Manajemen Pengguna</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                Kelola akun Owner, Mitra, dan Kasir
              </p>
            </div>
            <button
              onClick={() => {
                setEditingUser(null);
                setFormData({ nama: '', email: '', password: '', role: 'kasir' });
                setPassword('');
                setConfirmPassword('');
                setShowForm(true);
              }}
              className="h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:bg-primary/90 transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined">person_add</span>
              Tambah Pengguna
            </button>
          </div>

          {/* Search & Filter */}
          <div className="rounded-xl bg-surface-container p-4 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Cari</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">search</span>
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari nama atau email..."
                    className="w-full h-10 pl-10 pr-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                  />
                </div>
              </div>
              <div className="w-full sm:w-48">
                <label className="block font-label-sm text-label-sm text-on-surface-variant mb-1">Filter Peran</label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="w-full h-10 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none"
                >
                  <option value="semua">Semua Peran</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                  <option value="mitra">Mitra</option>
                  <option value="kasir">Kasir</option>
                </select>
              </div>
            </div>
          </div>

          {users.length === 0 && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <span className="material-symbols-outlined text-6xl text-on-surface-variant">people</span>
              <p className="mt-4 font-body-md text-body-md text-on-surface-variant">
                {search || roleFilter !== 'semua'
                  ? 'Tidak ada pengguna yang cocok'
                  : 'Belum ada pengguna terdaftar'}
              </p>
              {!search && roleFilter === 'semua' && (
                <button
                  onClick={() => setShowForm(true)}
                  className="mt-4 h-10 px-4 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:bg-primary/90 transition-colors"
                >
                  Tambah Pengguna Pertama
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-outline-variant bg-surface">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-outline-variant">
                      <th className="px-6 py-3 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Nama</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Email</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Peran</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Status Mitra</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">Transaksi</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">Omzet</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Dibuat</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {usersWithMitra.map((user) => (
                      <tr key={user.id} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface">{user.nama}</td>
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface">{user.email}</td>
                        <td className="px-6 py-4">{roleBadge(user.role)}</td>
                        <td className="px-6 py-4">{statusBadge(user.mitraStatus)}</td>
                        <td className="px-6 py-4 text-right font-mono text-body-sm text-on-surface">
                          {user.mitraTotalTransaksi.toLocaleString('id-ID')}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-body-sm text-on-surface">
                          {rupiah(user.mitraTotalOmzet)}
                        </td>
                        <td className="px-6 py-4 font-body-sm text-body-sm text-on-surface-variant">
                          {new Date(user.created_at).toLocaleDateString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleEdit(user)}
                              className="h-8 px-3 rounded-lg bg-secondary-container text-on-secondary-container font-label-sm text-label-sm hover:bg-secondary-container/80 transition-colors"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                              Edit
                            </button>
                            {user.role === 'mitra' && user.mitra && (
                              <button
                                onClick={() => handleResetMitraPassword(user)}
                                className="h-8 px-3 rounded-lg bg-primary-container text-on-primary-container font-label-sm text-label-sm hover:bg-primary-container/80 transition-colors"
                                title="Reset password ke default (mitra123)"
                              >
                                <span className="material-symbols-outlined text-sm">key</span>
                                Reset PW
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setDeletingId(user.id);
                                setConfirmDelete(true);
                              }}
                              className="h-8 px-3 rounded-lg bg-error-container/20 text-error font-label-sm text-label-sm hover:bg-error-container/30 transition-colors"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Add/Edit Form Modal */}
          {showForm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="w-full max-w-md bg-surface-container rounded-2xl shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-headline-md text-headline-md text-on-background">
                    {editingUser ? 'Edit Pengguna' : 'Tambah Pengguna'}
                  </h3>
                  <button
                    onClick={handleCancel}
                    className="p-2 rounded-full hover:bg-surface-container transition-colors"
                    aria-label="Tutup"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="block font-label-sm text-label-sm text-on-surface mb-1">Nama Lengkap</label>
                    <input
                      type="text"
                      value={formData.nama}
                      onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                      placeholder="Nama lengkap"
                      className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-label-sm text-label-sm text-on-surface mb-1">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="email@contoh.com"
                      className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-label-sm text-label-sm text-on-surface mb-1">Peran</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md appearance-none"
                      required
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <p className="font-body-xs text-body-xs text-on-surface-variant mt-1">
                      {formData.role === 'mitra' 
                        ? '⚠ Akan membuat/sinkronkan akun Mitra. Password default: mitra123' 
                        : editingUser?.role === 'mitra' 
                        ? '⚠ Mengubah peran dari Mitra akan menonaktifkan data Mitra' 
                        : ''}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block font-label-sm text-label-sm text-on-surface mb-1">
                      Kata Sandi {editingUser ? '(kosongkan jika tidak diubah)' : ''}
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={editingUser ? 'Kosongkan jika tidak diubah' : 'Minimal 6 karakter'}
                      className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      required={!editingUser}
                      minLength={6}
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block font-label-sm text-label-sm text-on-surface mb-1">
                      Konfirmasi Kata Sandi
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Ulangi kata sandi"
                      className="w-full h-10 px-3 rounded-lg border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-body-md text-body-md"
                      required={!editingUser}
                      minLength={6}
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="flex-1 h-11 rounded-xl border border-outline bg-surface-container-low text-on-surface font-label-md text-label-md hover:bg-surface-container transition-colors"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="flex-1 h-11 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-fixed transition-colors"
                    >
                      {editingUser ? 'Simpan Perubahan' : 'Tambah Pengguna'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
            )}

            {/* Delete Confirmation Modal */}
            {confirmDelete && deletingId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                <div className="w-full max-w-md bg-surface-container rounded-2xl shadow-xl p-6 space-y-4">
                  <h3 className="font-headline-md text-headline-md text-on-background">Hapus Pengguna</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant">
                    Apakah Anda yakin ingin menghapus pengguna ini? Tindakan ini tidak dapat dibatalkan.
                  </p>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={handleCancelDelete}
                      className="flex-1 h-11 rounded-xl border border-outline bg-surface-container-low text-on-surface font-label-md text-label-md hover:bg-surface-container transition-colors"
                    >
                      Batal
                    </button>
                    <button
                      onClick={() => handleDelete(deletingId)}
                      className="flex-1 h-11 rounded-xl bg-error text-on-error font-label-md text-label-md hover:bg-error/90 transition-colors"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      <footer>
        <div className="flex-1 overflow-y-auto pb-24 md:pb-8">
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          </div>
        </div>
      </footer>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm flex items-center gap-2 animate-bounce ${
          toast.type === 'error'
            ? 'bg-error-container text-error border-error/30'
            : 'bg-success-container text-success border-success/30'
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