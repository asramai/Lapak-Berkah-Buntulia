const navItems = [
  { icon: 'dashboard', label: 'Dashboard', page: 'dashboard', roles: ['admin', 'owner', 'kasir', 'mitra'] },
  { icon: 'point_of_sale', label: 'POS Cashier', page: 'pos-desktop', roles: ['admin', 'owner', 'kasir'] },
  { icon: 'inventory_2', label: 'Inventory', page: 'inventory', roles: ['admin', 'owner', 'kasir'] },
  { icon: 'handshake', label: 'Mitra Dashboard', page: 'mitra', roles: ['admin', 'owner', 'mitra'] },
  { icon: 'receipt_long', label: 'Nota Penjualan Mitra', page: 'mitra-settlement', roles: ['admin', 'owner'] },
  { icon: 'assessment', label: 'Laporan Penjualan', page: 'sales-recap', roles: ['admin', 'owner'] },
  { icon: 'history', label: 'Riwayat Transaksi', page: 'transaction-history', roles: ['admin', 'owner', 'kasir'] },
  { icon: 'inventory', label: 'Product Management', page: 'product', roles: ['admin', 'owner'] },
  { icon: 'swap_vert', label: 'Manajemen Stok', page: 'stock-management', roles: ['admin', 'owner', 'kasir'] },
  { icon: 'payments', label: 'Financial Reports', page: 'financial', roles: ['admin', 'owner'] },
  { icon: 'history_toggle_off', label: 'Audit Log', page: 'audit-log', roles: ['admin'] },
  { icon: 'manage_accounts', label: 'Manajemen Pengguna', page: 'user-management', roles: ['admin'] },
];

function NavDrawer({ activePage, onNavigate, onLogout, role }) {
  // Owner: semua kecuali audit-log dan user-management
  // Admin: semua
  // Kasir/Mitra: sesuai roles di navItems
  const accessibleItems = navItems.filter((item) => {
    if (!role) return true;
    if (role === 'owner') {
      return item.roles.includes('owner') || item.roles.includes('admin');
    }
    return item.roles.includes(role);
  });

  const displayRole = role === 'admin' ? 'Admin' : role === 'owner' ? 'Owner' : role === 'kasir' ? 'Kasir' : 'Mitra';

  return (
    <nav className="fixed inset-y-0 left-0 z-50 hidden md:flex flex-col h-full w-72 rounded-r-xl border-r border-outline-variant shadow-lg bg-surface-container-low mt-16 pb-16 overflow-y-auto">
      <div className="p-6">
        <h2 className="font-headline-md text-headline-md text-primary">Lapak Berkah Buntulia</h2>
        {role && (
          <span className="inline-block mt-2 px-3 py-1 rounded-full font-label-sm text-label-sm bg-surface-container border border-outline-variant text-on-surface-variant capitalize">
            {displayRole}
          </span>
        )}
      </div>
      <ul className="flex-1 px-2 space-y-1">
        {accessibleItems.map((item) => (
          <li key={item.label}>
            <button
              onClick={() => onNavigate(item.page)}
              className={`flex items-center gap-3 mx-2 my-1 px-4 py-3 transition-all scale-98 transition-transform duration-150 h-[48px] rounded-full w-full text-left ${
                activePage === item.page
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined" data-icon={item.icon}>
                {item.icon}
              </span>
              <span className="font-label-md text-label-md">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {onLogout && (
        <div className="p-4 border-t border-outline-variant">
          <button
            onClick={onLogout}
            className="flex items-center gap-3 mx-2 my-1 px-4 py-3 text-error hover:bg-error-container/50 rounded-full transition-all w-full"
          >
            <span className="material-symbols-outlined" data-icon="logout">logout</span>
            <span className="font-label-md text-label-md">Logout</span>
          </button>
        </div>
      )}
    </nav>
  );
}

export default NavDrawer;
