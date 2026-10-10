import { useState } from 'react';
import ProfileModal from './ProfileModal';

function TopAppBar({ title = 'Lapak Berkah', showNotifications = false, onLogout, user, onUpdateProfile }) {
  const [showMenu, setShowMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const initial = user?.nama ? String(user.nama).trim().charAt(0).toUpperCase() : '';

  return (
    <header className="flex justify-between items-center h-16 px-4 w-full z-50 bg-primary dark:bg-primary-container docked full-width top-0 shadow-sm sticky">
      <div className="flex items-center gap-4">
        <button aria-label="Menu" className="md:hidden text-on-primary/70 hover:bg-primary-fixed-dim/20 transition-colors duration-200 p-2 rounded-full h-[48px] w-[48px] flex items-center justify-center">
          <span className="material-symbols-outlined" data-icon="menu">menu</span>
        </button>
        <h1 className="font-headline-md text-headline-md-mobile font-bold text-secondary-fixed">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {showNotifications && (
          <button aria-label="Notifications" className="p-2 rounded-full hover:bg-primary-fixed-dim/20 transition-colors hidden md:flex">
            <span className="material-symbols-outlined" data-icon="notifications">notifications</span>
          </button>
        )}
        {onLogout && (
          <button onClick={onLogout} aria-label="Keluar" title="Keluar" className="text-on-primary/70 hover:bg-primary-fixed-dim/20 transition-colors duration-200 p-2 rounded-full h-[48px] w-[48px] flex items-center justify-center">
            <span className="material-symbols-outlined" data-icon="logout">logout</span>
          </button>
        )}
        {user ? (
          <div className="relative">
            <button
              onClick={() => setShowMenu((v) => !v)}
              aria-label="Menu pengguna"
              aria-expanded={showMenu}
              className="text-on-primary/70 hover:bg-primary-fixed-dim/20 transition-colors duration-200 p-1 rounded-full h-[48px] w-[48px] flex items-center justify-center"
            >
              {user.photo ? (
                <img
                  src={user.photo}
                  alt={user.nama || 'Pengguna'}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <span className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold text-sm">
                  {initial || <span className="material-symbols-outlined text-sm" data-icon="person">person</span>}
                </span>
              )}
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-12 z-50 w-48 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg py-2">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowProfile(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left font-body-md text-body-md text-on-surface hover:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-[20px]">person</span>
                    Ubah Profil
                  </button>
                  {onLogout && (
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onLogout();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left font-body-md text-body-md text-error hover:bg-error-container/20 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[20px]">logout</span>
                      Keluar
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center font-bold md:hidden">
            <span className="material-symbols-outlined text-sm" data-icon="person">person</span>
          </div>
        )}
      </div>
      {showProfile && (
        <ProfileModal
          user={user}
          onClose={() => setShowProfile(false)}
          onUpdate={onUpdateProfile}
        />
      )}
    </header>
  );
}

export default TopAppBar;
