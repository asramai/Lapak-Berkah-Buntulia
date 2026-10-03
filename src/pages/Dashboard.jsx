import { useState, useEffect, useCallback } from 'react';
import { dashboardService, transactionService, productService } from '../lib/services';

function Dashboard({ setLowStockCount }) {
  const [stats, setStats] = useState({ totalTransactions: 0, totalSales: 0, totalItems: 0, activeMitra: 0 });
  const [todayTransactions, setTodayTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lowStockProducts, setLowStockProducts] = useState([]);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const loadDashboardData = useCallback(async () => {
    try {
      const [statsData, transactionsData, lowStockData] = await Promise.all([
        dashboardService.getTodayStats(),
        transactionService.getHistory(),
        productService.getLowStock(10),
      ]);

      setStats({
        totalTransactions: 0,
        totalSales: 0,
        totalItems: 0,
        activeMitra: 0,
        ...statsData,
      });
      // Hanya transaksi selesai yang ditampilkan. Dulu transaksi Dibatalkan
      // ikut muncul di daftar terakhir walau tidak masuk hitungan omzet.
      setTodayTransactions(
        (transactionsData || [])
          .filter((t) => t.status === 'Selesai')
          .slice(0, 10)
          .map((t) => ({
            id: t.id,
            time: new Date(t.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            productName: t.items?.[0]?.product?.nama_produk || '-',
            qty: t.items?.reduce((sum, item) => sum + item.quantity, 0) || 0,
            total: t.total,
            paymentMethod: t.metode_pembayaran || '-',
            mitraName: t.mitra?.full_name || '-',
          }))
      );
      setLowStockProducts(lowStockData);
      if (setLowStockCount) {
        setLowStockCount(lowStockData.length);
      }
    } catch {
      showToast('Gagal memuat data dashboard', 'error');
    } finally {
      setLoading(false);
    }
  }, [setLowStockCount]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  return (
    /* Perbaikan di sini: Pastikan flex-1 mengisi sisa ruang secara otomatis tanpa paksaan margin md:ml-72 yang sering bikin geser */
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50 h-full">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 space-y-6 w-full">
          
          {/* Page Header Desktop */}
          <header className="hidden md:flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
              <p className="text-sm text-slate-500 mt-1">
                Ringkasan transaksi hari ini
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">Tanggal Aktif</div>
              <div className="text-sm font-semibold text-slate-700">
                {new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            </div>
          </header>

          {/* Mobile Header */}
          <div className="md:hidden flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Dashboard</h2>
              <p className="text-xs text-slate-500 mt-0.5">Ringkasan hari ini</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 font-medium">
                {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <span className="material-symbols-outlined">receipt_long</span>
                </div>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full font-medium">Hari Ini</span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Total Transaksi</p>
                <p className="text-2xl font-bold text-slate-900 tracking-tight">{loading ? '-' : stats.totalTransactions}</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                  <span className="material-symbols-outlined">shopping_cart</span>
                </div>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full font-medium">Item</span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Total Item</p>
                <p className="text-2xl font-bold text-slate-900 tracking-tight">{loading ? '-' : stats.totalItems}</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                  <span className="material-symbols-outlined">payments</span>
                </div>
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full font-medium">Omzet</span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Total Penjualan</p>
                <p className="text-2xl font-bold text-slate-900 tracking-tight">Rp {loading ? '-' : stats.totalSales.toLocaleString('id-ID')}</p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200">
              <div className="flex justify-between items-start mb-3">
                <div className="w-11 h-11 rounded-xl bg-[#d1f4e0] flex items-center justify-center text-[#0d592a]">
                  <span className="material-symbols-outlined">people</span>
                </div>
                <span className="text-xs text-[#0d592a] bg-[#d1f4e0]/50 px-2 py-1 rounded-full font-medium">Mitra</span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Mitra Aktif</p>
                <p className="text-2xl font-bold text-slate-900 tracking-tight">{loading ? '-' : stats.activeMitra}</p>
              </div>
            </div>
          </div>

          {/* Pembagian Mitra / Owner - angka sama persis dengan Laporan Pembagian Keuntungan */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 mb-1">Untuk Mitra (harga mitra)</p>
              <p className="text-xl font-bold text-slate-700 tracking-tight">
                Rp {loading ? '-' : (stats.untukMitra || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">Harga yang ditetapkan mitra × qty</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 mb-1">Untuk Owner (selisih)</p>
              <p className="text-xl font-bold text-blue-600 tracking-tight">
                Rp {loading ? '-' : (stats.untukOwner || 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">Harga jual dikurangi harga mitra</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 mb-1">Barang diretur hari ini</p>
              <p className="text-xl font-bold text-slate-700 tracking-tight">
                {loading ? '-' : (stats.totalReturned || 0)}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">Sudah dipotong dari omzet di atas</p>
            </div>
          </div>

          {lowStockProducts.length > 0 && (
            <div className="bg-error-container/10 border border-error/30 rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b border-error/20 bg-error-container/20">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-error">warning</span>
                  <h3 className="font-headline-sm text-headline-sm text-error">Stok Menipis</h3>
                  <span className="ml-auto px-2 py-0.5 bg-error text-on-error text-xs font-bold rounded-full">
                    {lowStockProducts.length}
                  </span>
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                  Produk dengan stok &le; 10 yang perlu segera di-restock
                </p>
              </div>
              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {lowStockProducts.slice(0, 6).map((product) => (
                    <div key={product.id} className="flex items-center gap-3 p-3 bg-surface rounded-lg border border-outline-variant/50">
                      <div className="flex-1 min-w-0">
                        <p className="font-body-md text-body-md text-on-surface truncate">{product.nama_produk}</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant">
                          Stok: <span className="font-semibold text-error">{product.stock}</span> {product.unit}
                        </p>
                      </div>
                      <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                        product.stock === 0 
                          ? 'bg-error-container text-error' 
                          : 'bg-[#fdf2d5] text-[#7a590c]'
                      }`}>
                        {product.stock === 0 ? 'Habis' : 'Rendah'}
                      </div>
                    </div>
                  ))}
                </div>
                {lowStockProducts.length > 6 && (
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-3 text-center">
                    +{lowStockProducts.length - 6} produk lainnya
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Today's Transactions Table */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 bg-white">
              <h3 className="text-lg font-bold text-slate-900">Transaksi Hari Ini</h3>
              <p className="text-xs text-slate-500 mt-0.5">Daftar transaksi yang terjadi hari ini</p>
            </div>

            {todayTransactions.length === 0 ? (
              <div className="p-12 text-center">
                <span className="material-symbols-outlined text-6xl text-slate-300 mb-3">receipt_long</span>
                <p className="text-sm text-slate-500">Belum ada transaksi hari ini</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider">
                      <th className="px-6 py-4 font-semibold">Waktu</th>
                      <th className="px-6 py-4 font-semibold">Produk</th>
                      <th className="px-6 py-4 font-semibold">Mitra</th>
                      <th className="px-6 py-4 font-semibold text-right">Qty</th>
                      <th className="px-6 py-4 font-semibold text-right">Total</th>
                      <th className="px-6 py-4 font-semibold">Metode</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-slate-100 text-slate-700">
                    {todayTransactions.map((transaction, idx) => (
                      <tr
                        key={transaction.id}
                        className={`hover:bg-slate-50 transition-colors duration-150 ${idx % 2 === 1 ? 'bg-slate-50/50' : ''}`}
                      >
                        <td className="px-6 py-4 text-slate-600 font-medium">{transaction.time}</td>
                        <td className="px-6 py-4 text-slate-900 font-medium">{transaction.productName}</td>
                        <td className="px-6 py-4 text-slate-600">{transaction.mitraName}</td>
                        <td className="px-6 py-4 text-right font-medium text-slate-900">{transaction.qty}</td>
                        <td className="px-6 py-4 text-right font-bold text-blue-600">Rp {transaction.total.toLocaleString('id-ID')}</td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                            {transaction.paymentMethod}
                          </span>
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

export default Dashboard;