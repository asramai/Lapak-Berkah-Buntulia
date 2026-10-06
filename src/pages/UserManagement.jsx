import { useState, useEffect, useMemo } from 'react';
import { userService } from '../lib/services';
import { showToast } from '../utils/toast';

const ROLE_LABELS = {
  owner: 'Owner',
  mitra: 'Mitra',
  kasir: 'Kasir',
};

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner' },
  { value: 'mitra', label: 'Mitra' },
  { value: 'kasir', label: 'Kasir' },
];

export default function UserManagement() {
  const [users, setUsers] = useState([]);
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

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await userService.getAll();
      setUsers(data || []);
    } catch (err) {
      showToast('Gagal memuat daftar pengguna: ' + err?.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

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
      setShowForm(false);
      setFormData({ nama: '', email: '', password: '', role: 'kasir' });
      setPassword('');
      setConfirmPassword('');
      setEditingUser(null);
      loadUsers();
    } catch (err) {
      showToast('Gagal menyimpan: ' + err?.message, 'error');
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

    try {
      await userService.delete(id);
      showToast('Pengguna berhasil dihapus', 'success');
      loadUsers();
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

  const roleBadge = (role) => {
    const colors = {
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
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider">Dibuat</th>
                      <th className="px-6 py-4 font-label-md text-label-md text-on-surface-variant uppercase tracking-wider text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface">{user.nama}</td>
                        <td className="px-6 py-4 font-body-md text-body-md text-on-surface">{user.email}</td>
                        <td className="px-6 py-4">{roleBadge(user.role)}</td>
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
                      onChange={(e) => setConfirmPassword(e.target.value))
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
          </>
        </div>
      </main>
      <footer>
        <div className="flex-1 overflow-y-auto pb-24 md:pb-8">
          <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6">
          </div>
        </footer>
      </div>
    </div>
  );
}

export default UserManagement;