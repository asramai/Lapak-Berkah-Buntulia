import { useState } from 'react';
import { authService } from '../lib/services';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const user = await authService.login(normalizedEmail, password);
      onLogin(user.role, user);
    } catch (err) {
      setError(err.message || 'Login gagal. Periksa kembali kredensial Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background blobs */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden opacity-10">
        <div className="absolute -top-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-primary blur-[100px]" />
        <div className="absolute top-[60%] -right-[10%] w-[40vw] h-[40vw] rounded-full bg-secondary blur-[100px]" />
      </div>

      <div className="w-full max-w-md bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant/30 overflow-hidden relative z-10">
        {/* Top gradient bar */}
        <div className="h-2 w-full bg-gradient-to-r from-primary to-secondary" />

        <div className="p-8 flex flex-col items-center">
          {/* Logo */}
          <div className="w-32 h-32 mb-6 rounded-full overflow-hidden shadow-sm border border-surface-variant flex items-center justify-center bg-surface">
            <img
              alt="Lapak Berkah Buntulia Logo"
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuB49vG9Vi3qbccoLZTXOLCqShe83hxitKq-wO3Iud7yeRH4bnZt2z0KcWxLd05BsiXOGCsKYwMKMXivhLKmYbr5fjtWgLkZixOEhtdAXQMZFIsO098CSV5idKs-jD4BvjZ4O9yC5r0GgwI95lKuy2oX4MFkNyI0hV-fY2GQnKYnBnyKDMJHPpOFzE66yL9OywVNAdvHQb1dvhuWq4bYsPLpVExHIszD98fWP0RqV2EVmKnMEPCPM_8WEaD-B1rebwVHSrA"
            />
          </div>

          {/* Header */}
          <div className="text-center mb-8 w-full">
            <h1 className="font-headline-md text-headline-md text-primary mb-1">Selamat Datang Kembali</h1>
            <p className="font-body-md text-body-md text-on-surface-variant">Masuk ke akun Lapak Berkah Anda</p>
          </div>

          {/* Login Form */}
          <form className="w-full space-y-4" onSubmit={handleSubmit}>
            {/* Email Input */}
            <div className="relative">
              <label className="sr-only" htmlFor="email">Alamat Email</label>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-outline">
                <span className="material-symbols-outlined">mail</span>
              </div>
              <input
                className="w-full h-12 pl-10 pr-4 bg-surface-container-low border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all placeholder:text-outline/70"
                id="email"
                name="email"
                placeholder="Alamat Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {/* Password Input */}
            <div className="relative">
              <label className="sr-only" htmlFor="password">Kata Sandi</label>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-outline">
                <span className="material-symbols-outlined">lock</span>
              </div>
              <input
                className="w-full h-12 pl-10 pr-10 bg-surface-container-low border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all placeholder:text-outline/70"
                id="password"
                name="password"
                placeholder="Kata Sandi"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-outline hover:text-primary transition-colors focus:outline-none"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              >
                <span className="material-symbols-outlined">{showPassword ? 'visibility' : 'visibility_off'}</span>
              </button>
            </div>

            {/* Remember me & Forgot password */}
            <div className="flex items-center justify-between mt-2 mb-4">
              <label className="flex items-center cursor-pointer">
                <input className="form-checkbox h-4 w-4 text-primary rounded border-outline-variant focus:ring-primary focus:ring-2" type="checkbox" />
                <span className="ml-2 font-label-sm text-label-sm text-on-surface-variant">Ingat saya</span>
              </label>
              <a className="font-label-sm text-label-sm text-primary hover:text-primary-fixed-dim transition-colors" href="#">Lupa Kata Sandi?</a>
            </div>

            {/* Login Button */}
            <button
              className="w-full h-12 bg-primary text-on-primary rounded-lg font-label-md text-label-md shadow-sm hover:bg-primary-fixed-variant transition-colors active:scale-95 flex items-center justify-center gap-2 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-on-primary"></span>
              ) : (
                <>
                  <span>Masuk</span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </>
              )}
            </button>
            {error && (
              <div className="mt-3 p-3 bg-error-container/15 border border-error-container/30 rounded-lg">
                <p className="font-body-sm text-body-sm text-error text-center">{error}</p>
              </div>
            )}
          </form>

          {/* Role Redirection Info */}
          <div className="mt-8 pt-6 border-t border-outline-variant/30 w-full">
            <h3 className="font-label-sm text-label-sm text-outline text-center mb-2 uppercase tracking-wider">Informasi Pengalihan Peran</h3>
            <ul className="space-y-1 text-center font-body-md text-body-md text-on-surface-variant/80">
              <li className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-primary">admin_panel_settings</span>
                Admin/Owner → <span className="font-medium text-on-surface">Laporan</span>
              </li>
              <li className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-secondary">handshake</span>
                Mitra → <span className="font-medium text-on-surface">Mitra Dashboard</span>
              </li>
              <li className="flex items-center justify-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-tertiary-container">point_of_sale</span>
                Kasir → <span className="font-medium text-on-surface">POS</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
