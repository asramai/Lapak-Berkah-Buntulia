import { useState } from 'react';

const primaryItems = [
  { icon: 'dashboard', label: 'Dashboard', page: 'dashboard', roles: ['admin', 'owner', 'kasir', 'mitra'] },
  { icon: 'point_of_sale', label: 'POS', page: 'pos-desktop', roles: ['admin', 'owner', 'kasir'] },
  { icon: 'handshake', label: 'Mitra', page: 'mitra', roles: ['admin', 'owner', 'mitra'] },
  { icon: 'inventory_2', label: 'Inventory', page: 'inventory', roles: ['admin', 'owner', 'kasir'] },
];

const moreItems = [
  { icon: 'assessment', label: 'Laporan', page: 'sales-recap', roles: ['admin', 'owner'] },
  { icon: 'history', label: 'Riwayat', page: 'transaction-history', roles: ['admin', 'owner', 'kasir'] },
  { icon: 'swap_vert', label: 'Stok', page: 'stock-management', roles: ['admin', 'owner', 'kasir'] },
  { icon: 'shopping_bag', label: 'Produk', page: 'product', roles: ['admin', 'owner'] },
  { icon: 'admin_panel_settings', label: 'Admin', page: 'financial', roles: ['admin', 'owner'] },
  { icon: 'receipt_long', label: 'Nota Mitra', page: 'mitra-settlement', roles: ['admin', 'owner'] },
  { icon: 'history_toggle_off', label: 'Audit Log', page: 'audit-log', roles: ['admin'] },
  { icon: 'manage_accounts', label: 'Manajemen Pengguna', page: 'user-management', roles: ['admin'] },
];

function BottomNav({ activePage, onNavigate, role, lowStockCount = 0 }) {
  // Owner: semua kecuali audit-log dan user-management
  // Admin: semua
  // Kasir/Mitra: sesuai roles di items
  const filterByRole = (items) => items.filter((item) => {
    if (!role) return true;
    if (role === 'owner') {
      return item.roles.includes('owner') || item.roles.includes('admin');
    }
    return item.roles.includes(role);
  });

  const accessiblePrimary = filterByRole(primaryItems);
  const accessibleMore = filterByRole(moreItems);
  const hasMore = accessibleMore.length > 0;
  const [showMore, setShowMore] = useState(false);

  return (
    <>
      <nav className="fixed bottom-0 left-0 w-full z-50 flex md:hidden justify-around items-center px-1 pb-safe h-16 bg-surface border-t border-outline-variant/50">
        {accessiblePrimary.map((item) => (
          <button
            key={item.page}
            onClick={() => onNavigate(item.page)}
            className={`flex flex-col items-center justify-center transition-all min-h-[44px] flex-1 py-1.5 ${
              activePage === item.page
                ? 'text-primary'
                : 'text-on-surface-variant active:text-primary'
            }`}
          >
            <span
              className="material-symbols-outlined text-[22px]"
              data-icon={item.icon}
              data-weight={item.icon === 'admin_panel_settings' ? 'fill' : undefined}
            >
              {item.icon}
            </span>
            <span className="font-label-sm text-label-sm mt-0.5 leading-tight">{item.label}</span>
          </button>
        ))}

        {hasMore && (
          <button
            onClick={() => setShowMore(true)}
            className={`flex flex-col items-center justify-center transition-all min-h-[44px] flex-1 py-1.5 ${
              showMore ? 'text-primary' : 'text-on-surface-variant active:text-primary'
            }`}
          >
            <span className="material-symbols-outlined text-[22px]">more_horiz</span>
            <span className="font-label-sm text-label-sm mt-0.5 leading-tight">More</span>
          </button>
        )}
      </nav>

      {showMore && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[60] md:hidden" onClick={() => setShowMore(false)} />
          <div className="fixed bottom-0 left-0 w-full bg-surface rounded-t-2xl z-[70] md:hidden">
            <div className="flex items-center justify-between p-4 border-b border-outline-variant/50">
              <h3 className="font-headline-sm text-headline-sm text-on-background">Menu Lainnya</h3>
              <button onClick={() => setShowMore(false)} aria-label="Tutup menu" className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-2 pb-6">
              {accessibleMore.map((item) => (
                <button
                  key={item.page}
                  onClick={() => {
                    onNavigate(item.page);
                    setShowMore(false);
                  }}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-colors ${
                    activePage === item.page ? 'bg-primary/10 text-primary' : 'hover:bg-surface-container text-on-surface'
                  }`}
                >
                  <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
                   <span className="font-body-md text-body-md flex-1 text-left">{item.label}</span>
                   {item.page === 'stock-management' && lowStockCount > 0 && (
                     <span className="min-w-[20px] h-5 px-1.5 bg-error text-on-error text-xs font-bold rounded-full flex items-center justify-center">
                       {lowStockCount}
                     </span>
                   )}
                   {activePage === item.page && <span className="material-symbols-outlined text-[18px]">check</span>}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default BottomNav;
