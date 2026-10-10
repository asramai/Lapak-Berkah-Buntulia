import { useState } from 'react';
import { authService, userService } from '../lib/services';
import compressImage from '../utils/compressImage';

function ProfileModal({ user, onClose, onUpdate }) {
  const [nama, setNama] = useState(user?.nama || '');
  const [photo, setPhoto] = useState(user?.photo || null);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [loading, setLoading] = useState(false);

  const initial = nama?.trim()?.charAt(0).toUpperCase() || '';

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhotoError('');
      // Avatar cukup 256px; base64-nya kecil sehingga muat
      // di kolom TEXT tanpa membengkakkan tabel users.
      const { dataUrl, sizeKB } = await compressImage(file, {
        maxWidth: 256,
        maxHeight: 256,
        quality: 0.8,
      });
      if (sizeKB > 500) {
        setPhotoError('Foto terlalu besar, pilih gambar lain');
        return;
      }
      setPhoto(dataUrl);
    } catch {
      setPhotoError('File bukan gambar');
    }
    e.target.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!nama.trim()) {
      setError('Nama tidak boleh kosong');
      return;
    }

    // Password hanya diubah kalau ada yang mengisi kolomnya.
    const changingPassword = Boolean(oldPassword || newPassword || confirmPassword);
    if (changingPassword) {
      if (!oldPassword) {
        setError('Password lama diperlukan untuk mengganti password');
        return;
      }
      if (newPassword.length < 6) {
        setError('Password baru minimal 6 karakter');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('Konfirmasi password baru tidak cocok');
        return;
      }
    }

    setLoading(true);
    try {
      if (changingPassword) {
        // Verifikasi password lama lewat RPC login. Kalau gagal,
        // update tidak pernah dikirim ke database.
        await authService.login(user.email, oldPassword);
      }

      await userService.updateProfile(user.id, {
        nama: nama.trim(),
        photo,
        password: changingPassword ? newPassword : null,
      });

      onUpdate({ ...user, nama: nama.trim(), photo });
      onClose();
    } catch (err) {
      if (changingPassword && /kata sandi|password|salah/i.test(err.message)) {
        setError('Password lama salah');
      } else {
        setError(err.message || 'Gagal memperbarui profil');
      }
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full h-12 px-4 bg-surface-container-low border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all placeholder:text-outline/70';

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Ubah Profil">
      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/30 overflow-hidden">
        <div className="h-2 w-full bg-gradient-to-r from-primary to-secondary" />

        <div className="p-6 flex items-center justify-between">
          <div>
            <h2 className="font-headline-md text-headline-md text-primary">Ubah Profil</h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
              Nama, foto, dan kata sandi akun
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="w-10 h-10 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form className="px-6 pb-6 space-y-4" onSubmit={handleSubmit}>
          {/* Preview avatar */}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full overflow-hidden shadow-sm border border-outline-variant flex items-center justify-center bg-surface-container-high shrink-0">
              {photo ? (
                <img src={photo} alt="Foto profil" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-on-surface-variant">{initial}</span>
              )}
            </div>
            <div className="space-y-2">
              <label className="h-10 px-4 bg-surface border border-outline text-on-surface rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors cursor-pointer flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">photo_camera</span>
                Pilih Foto
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
              {photo && (
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="h-8 px-3 text-error font-label-sm text-label-sm hover:bg-error-container/20 rounded-lg transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  Hapus foto
                </button>
              )}
            </div>
          </div>
          {photoError && (
            <p className="font-body-sm text-body-sm text-error">{photoError}</p>
          )}

          <div>
            <label className="block font-label-md text-label-md text-on-surface font-medium mb-2" htmlFor="profile-nama">Nama</label>
            <input
              id="profile-nama"
              className={inputClass}
              type="text"
              value={nama}
              onChange={(e) => setNama(e.target.value)}
              placeholder="Nama lengkap"
              maxLength={100}
            />
          </div>

          <div className="bg-surface-container rounded-lg p-4 space-y-3">
            <p className="font-label-md text-label-md text-on-surface font-medium">Ganti Kata Sandi</p>
            <p className="font-label-sm text-label-sm text-on-surface-variant -mt-2">
              Kosongkan ketiga kolom ini kalau tidak ingin mengganti password
            </p>
            <input
              className={inputClass}
              type={showPasswords ? 'text' : 'password'}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="Password lama"
              aria-label="Password lama"
            />
            <input
              className={inputClass}
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Password baru (min. 6 karakter)"
              aria-label="Password baru"
            />
            <input
              className={inputClass}
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Ulangi password baru"
              aria-label="Ulangi password baru"
            />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showPasswords}
                onChange={(e) => setShowPasswords(e.target.checked)}
                className="h-4 w-4 text-primary rounded border-outline-variant"
              />
              <span className="font-label-sm text-label-sm text-on-surface-variant">Tampilkan password</span>
            </label>
          </div>

          {error && (
            <div className="p-3 bg-error-container/15 border border-error-container/30 rounded-lg">
              <p className="font-body-sm text-body-sm text-error text-center">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 bg-surface border border-outline-variant text-on-surface rounded-lg font-label-md text-label-md hover:bg-surface-container transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-12 bg-primary text-on-primary rounded-lg font-label-md text-label-md shadow-sm hover:bg-primary-fixed-variant transition-colors active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-on-primary" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">check</span>
                  Simpan
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProfileModal;
