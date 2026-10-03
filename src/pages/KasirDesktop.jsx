import { useState, useRef, useEffect, useMemo } from 'react';
import { productService, transactionService, transactionItemService, stockMovementService, mitraService, heldTransactionService, paymentService } from '../lib/services';
import { printReceipt } from '../lib/bluetoothPrinter';
import { adapterUntuk } from '../lib/paymentGateway';

// Batas menunggu pembayaran QRIS. Setelah lewat, pesanan dibatalkan dan stoknya
// dikembalikan supaya barang tidak tertahan karena pelanggan tidak membayar.
const QRIS_EXPIRY_MS = 15 * 60 * 1000;

// Transfer bank manual dibuang. Alasannya tidak bisa diverifikasi otomatis,
// jadi tetap membuka jalan untuk mencatat pembayaran yang tidak pernah terjadi.
const METODE_PEMBAYARAN = ['Tunai', 'QRIS'];

function createEmptyTransaction(id) {
  return {
    id,
    items: [],
    status: 'active',
    createdAt: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
  };
}

const initialTransactions = [
  createEmptyTransaction(1),
  createEmptyTransaction(2),
  createEmptyTransaction(3),
];

function KasirDesktop({ onNavigate }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('Semua');
  const [barcode, setBarcode] = useState('');
  const [flash, setFlash] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [printerConnected, setPrinterConnected] = useState(false);
  const barcodeRef = useRef(null);
  // Kalau kolom cost_price belum ada, penjualan tetap jalan tapi laba Owner
  // tidak bisa dihitung tepat. Banner ini sengaja persisten, bukan toast,
  // karena toast langsung tertimpa pesan "pembayaran berhasil".
  const [peringatanSnapshot, setPeringatanSnapshot] = useState(null);

  const handleConnectPrinter = async () => {
    try {
      const { connectPrinter } = await import('../lib/bluetoothPrinter');
      await connectPrinter();
      setPrinterConnected(true);
    } catch {
      setPrinterConnected(false);
    }
  };

  const handleDisconnectPrinter = async () => {
    try {
      const { clearPrinterCache } = await import('../lib/bluetoothPrinter');
      clearPrinterCache();
      setPrinterConnected(false);
    } catch {}
  };

  const loadProducts = async () => {
    try {
      const data = await productService.getAll();
      const mapped = data.map((p) => ({
        id: p.id,
        name: p.nama_produk,
        sku: p.sku,
        category: p.category ? { name: p.category.name } : null,
        type: p.type ? { name: p.type.name } : null,
        mitra: p.mitra ? { full_name: p.mitra.full_name } : null,
        mitraId: p.mitra_id,
        mitraPrice: p.mitra_price,
        sellingPrice: p.selling_price,
        stock: p.stock,
        unit: p.unit,
        photo: p.photo,
        barcodeId: p.barcode_id,
        description: p.description,
      }));
      setProducts(mapped);
    } catch {
      // silent catch
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const updatedProducts = e.detail?.products;
      if (Array.isArray(updatedProducts)) {
        setProducts((prev) => {
          const map = new Map(prev.map((p) => [p.id, p]));
          for (const p of updatedProducts) {
            map.set(p.id, p);
          }
          return Array.from(map.values());
        });
      } else {
        loadProducts();
      }
    };
    window.addEventListener('kasir:stock-updated', handler);
    return () => window.removeEventListener('kasir:stock-updated', handler);
  }, []);

  // Optimasi Memoization Kategori & Produk
  const categories = useMemo(() => ['Semua', ...new Set(products.map((p) => p.category?.name).filter(Boolean))], [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => selectedCategory === 'Semua' || product.category?.name === selectedCategory);
  }, [products, selectedCategory]);

  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    const trimmed = barcode.trim();
    if (!trimmed) return;
    const product = products.find((p) => p.barcodeId === trimmed || p.sku === trimmed);
    if (product) {
      setFlash(product.id);
      setTimeout(() => setFlash(null), 600);
      window.dispatchEvent(new CustomEvent('kasir:add-product', { detail: { productId: product.id, product } }));
    }
    setBarcode('');
    barcodeRef.current?.focus();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-surface-container-lowest relative xl:pr-[380px]">
      {peringatanSnapshot && (
        <div className="flex items-start gap-3 px-4 py-3 bg-error-container text-on-error-container border-b border-error/30 shrink-0">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="font-body-sm text-body-sm flex-1">{peringatanSnapshot}</span>
          <button
            onClick={() => setPeringatanSnapshot(null)}
            className="material-symbols-outlined text-lg hover:opacity-70"
            aria-label="Tutup peringatan"
          >
            close
          </button>
        </div>
      )}
      {/* Header */}
      <header className="h-16 bg-surface border-b border-outline-variant flex items-center justify-between px-4 md:px-6 z-10 shrink-0 gap-4">
        <div className="flex items-center gap-3 flex-1">
          <button
            onClick={() => setMenuOpen(true)}
            className="h-10 w-10 rounded-lg bg-surface-container border border-outline-variant flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors"
            aria-label="Menu"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <button
            onClick={printerConnected ? handleDisconnectPrinter : handleConnectPrinter}
            className={`h-10 px-3 rounded-lg border flex items-center gap-2 text-label-sm font-label-sm transition-colors ${
              printerConnected
                ? 'bg-tertiary-fixed/15 text-tertiary-container border-tertiary-fixed/30'
                : 'bg-surface-container border-outline-variant text-on-surface hover:bg-surface-container-high'
            }`}
            aria-label={printerConnected ? 'Printer terhubung' : 'Hubungkan printer'}
          >
            <span className="material-symbols-outlined text-[18px]">{printerConnected ? 'print' : 'print_disabled'}</span>
            <span className="hidden sm:inline">{printerConnected ? 'Printer OK' : 'Connect Printer'}</span>
          </button>
          <form onSubmit={handleBarcodeSubmit} className="flex-1 max-w-xl">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">barcode_scanner</span>
              <input
                ref={barcodeRef}
                className={`w-full h-10 pl-10 pr-4 rounded-xl border-2 bg-surface-container-lowest font-body-md text-body-md outline-none transition-colors ${flash ? 'border-primary' : 'border-outline-variant focus:border-primary focus:ring-0'}`}
                placeholder="Scan barcode atau ketik SKU/Barcode ID..."
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </div>
          </form>
        </div>
        <div className="text-right hidden sm:block">
          <div className="font-label-sm text-label-sm text-on-surface-variant">Tanggal Aktif</div>
          <div className="font-label-md text-label-md text-on-surface">{new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
      </header>

      {/* Menu Overlay */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-[60]" onClick={() => setMenuOpen(false)} />
          <div className="fixed top-0 left-0 h-full w-72 bg-surface border-r border-outline-variant shadow-lg z-[70] flex flex-col">
            <div className="p-6 border-b border-outline-variant/50 flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-primary">Lapak Berkah</h2>
              <button onClick={() => setMenuOpen(false)} aria-label="Tutup menu" className="w-8 h-8 rounded-full hover:bg-surface-container flex items-center justify-center text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {[
                { icon: 'dashboard', label: 'Dashboard', page: 'dashboard' },
                { icon: 'point_of_sale', label: 'POS Cashier', page: 'pos-desktop' },
                { icon: 'inventory_2', label: 'Inventory', page: 'inventory' },
                { icon: 'handshake', label: 'Mitra Dashboard', page: 'mitra' },
                { icon: 'receipt_long', label: 'Nota Penjualan Mitra', page: 'mitra-settlement' },
                { icon: 'assessment', label: 'Laporan Penjualan', page: 'sales-recap' },
                { icon: 'history', label: 'Riwayat Transaksi', page: 'transaction-history' },
                { icon: 'inventory', label: 'Product Management', page: 'product' },
                { icon: 'swap_vert', label: 'Manajemen Stok', page: 'stock-management' },
                { icon: 'payments', label: 'Financial Reports', page: 'financial' },
              ].map((item) => (
                <button
                  key={item.page}
                  onClick={() => {
                    onNavigate?.(item.page);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-surface-container text-on-surface"
                >
                  <span className="material-symbols-outlined text-[22px]">{item.icon}</span>
                  <span className="font-label-md text-label-md">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Filter Tabs */}
      <div className="px-4 md:px-6 py-2 flex gap-2 overflow-x-auto shrink-0 hide-scrollbar border-b border-outline-variant bg-surface">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`h-8 px-4 rounded-full font-label-sm text-label-sm whitespace-nowrap transition-colors ${
              selectedCategory === cat ? 'bg-primary text-on-primary' : 'bg-surface-container border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="flex-1 overflow-y-auto p-4 md:p-5">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="font-body-md text-body-md text-on-surface-variant">Memuat produk...</p>
          </div>
        ) : (
          <>
            {products.filter((p) => p.stock > 0 && p.stock <= 10).length > 0 && (
              <div className="mb-3 p-2.5 bg-[#fdf2d5] border border-[#ebd083] rounded-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-[#7a590c] text-[20px]">warning</span>
                <div className="flex-1">
                  <p className="font-label-sm text-label-sm text-[#7a590c]">
                    {products.filter((p) => p.stock > 0 && p.stock <= 10).length} produk stok menipis
                  </p>
                </div>
              </div>
            )}

            {/* Grid Kompak */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    setFlash(product.id);
                    setTimeout(() => setFlash(null), 600);
                    window.dispatchEvent(new CustomEvent('kasir:add-product', { detail: { productId: product.id, product } }));
                  }}
                  className={`bg-surface border rounded-xl p-2.5 flex flex-col gap-1.5 hover:shadow-md transition-all text-left relative overflow-hidden ${
                    product.stock === 0 ? 'border-error-container opacity-75 cursor-not-allowed' : 'border-outline-variant cursor-pointer active:scale-95'
                  } ${flash === product.id ? 'ring-2 ring-primary' : ''}`}
                  disabled={product.stock === 0}
                >
                  <div className="h-28 sm:h-32 w-full rounded-lg bg-surface-container overflow-hidden relative">
                    {product.photo ? (
                      <img
                        className="w-full h-full object-cover"
                        alt={product.name}
                        loading="lazy"
                        decoding="async"
                        src={product.photo}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-3xl text-outline">image</span>
                      </div>
                    )}
                    <div
                      className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded font-label-sm text-[10px] border ${
                        product.stock === 0
                          ? 'bg-error-container text-on-error-container border-error/20 font-bold'
                          : product.stock <= 5
                            ? 'bg-[#fdf2d5] text-[#7a590c] border-[#ebd083]'
                            : 'bg-[#d1f4e0] text-[#0d592a] border-[#93d8b5]'
                      }`}
                    >
                      {product.stock === 0 ? 'Habis' : product.stock <= 5 ? `Sisa ${product.stock}` : `Stok: ${product.stock}`}
                    </div>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-label-md text-label-md text-on-surface line-clamp-1 leading-snug" title={product.name}>
                      {product.name}
                    </h3>
                    <p className={`font-numeric-data text-label-md font-semibold ${product.stock === 0 ? 'text-on-surface-variant line-through' : 'text-primary'}`}>
                      Rp {product.sellingPrice.toLocaleString('id-ID')}
                    </p>
                    <p className="font-label-sm text-[11px] text-on-surface-variant">{product.barcodeId}</p>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KasirDesktopCart({ user, isPosDesktop }) {
  const [transactions, setTransactions] = useState(initialTransactions);
  const [activeTransactionId, setActiveTransactionId] = useState(initialTransactions[0].id);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Tunai');
  const [toast, setToast] = useState(null);
  const [_completedTransactions, setCompletedTransactions] = useState([]);
  const [checkingOut, setCheckingOut] = useState(false);
  // Pesanan QRIS yang pembayarannya belum masuk. Selama isinya ada, keranjang
  // tidak dikosongkan dan struk tidak dicetak.
  const [qrisPending, setQrisPending] = useState(null);
  const [sisaDetikQris, setSisaDetikQris] = useState(0);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const activeTransaction = transactions.find((t) => t.id === activeTransactionId) || transactions[0];

  // Pesanan QRIS yang lewat batasnya dibatalkan dan stoknya dikembalikan.
  // Dijalankan saat halaman kasir dibuka, jadi tidak butuh cron di server.
  useEffect(() => {
    paymentService.bersihkanKedaluwarsa().catch(() => {});
  }, []);

  // Hitung mundur pesanan QRIS yang sedang menunggu.
  useEffect(() => {
    if (!qrisPending) {
      setSisaDetikQris(0);
      return undefined;
    }
    const tick = () => {
      const sisa = Math.max(0, Math.round((qrisPending.mulai + QRIS_EXPIRY_MS - Date.now()) / 1000));
      setSisaDetikQris(sisa);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [qrisPending]);

  // Tutup pesanan QRIS yang sudah lewat batasnya.
  useEffect(() => {
    if (!qrisPending || sisaDetikQris > 0) return;
    paymentService.batalkan(qrisPending.transactionId, 'Kedaluwarsa tanpa pembayaran')
      .then(async () => {
        setQrisPending(null);
        setToast({ message: 'Pesanan QRIS kedaluwarsa, stok dikembalikan', type: 'error' });
        window.dispatchEvent(new CustomEvent('kasir:stock-updated'));
        await loadProducts();
      })
      .catch((err) => setToast({ message: 'Gagal membatalkan pesanan: ' + (err?.message || ''), type: 'error' }));
  }, [qrisPending, sisaDetikQris]);

  useEffect(() => {
    const loadHeldTransactions = async () => {
      if (!user?.id) return;
      try {
        const held = await heldTransactionService.getAllByUser(user.id);
        if (held.length > 0) {
          const heldTransactions = held.map((h) => ({
            id: h.local_id,
            items: h.items || [],
            status: 'held',
            createdAt: new Date(h.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            heldDbId: h.id,
          }));
          setTransactions((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const newTransactions = heldTransactions.filter((t) => !existingIds.has(t.id));
            return [...prev, ...newTransactions];
          });
        }
      } catch {
        showToast('Gagal memuat transaksi sementara', 'error');
      }
    };

    loadHeldTransactions();
  }, [user]);

  const updateQty = (transactionId, productId, delta) => {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== transactionId) return t;
        const updatedItems = t.items
          .map((item) => {
            if (item.productId !== productId) return item;
            const newQty = item.qty + delta;
            if (newQty > (item.currentStock || 99)) {
              setToast({ message: 'Jumlah melebihi stok tersedia', type: 'error' });
              return item;
            }
            return { ...item, qty: Math.max(0, newQty) };
          })
          .filter((item) => item.qty > 0);
        return { ...t, items: updatedItems };
      }),
    );
  };

  const removeItem = (transactionId, productId) => {
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== transactionId) return t;
        return { ...t, items: t.items.filter((item) => item.productId !== productId) };
      }),
    );
  };

  const addProductToTransaction = ({ productId, product }) => {
    if (!product) return;
    if ((product.stock || 0) <= 0) {
      setToast({ message: 'Stok habis, tidak dapat menambahkan', type: 'error' });
      return;
    }

    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id !== activeTransactionId) return t;
        const existing = t.items.find((item) => item.productId === productId);
        if (existing && existing.qty >= (existing.currentStock || 99)) {
          setToast({ message: 'Stok tidak cukup untuk menambahkan lagi', type: 'error' });
          return t;
        }
        const updatedItems = existing
          ? t.items.map((item) => (item.productId === productId ? { ...item, qty: item.qty + 1 } : item))
          : [
              ...t.items,
              {
                productId: product.id,
                name: product.name,
                sku: product.sku,
                barcodeId: product.barcodeId,
                sellingPrice: product.sellingPrice,
                mitraPrice: product.mitraPrice,
                unit: product.unit,
                mitraId: product.mitraId,
                currentStock: product.stock,
                qty: 1,
              },
            ];
        return { ...t, items: updatedItems };
      }),
    );
  };

  const holdTransaction = async () => {
    if (activeTransaction.items.length === 0) return;
    const newTransaction = createEmptyTransaction(Date.now());
    const updatedTransactions = [...transactions, newTransaction];
    setTransactions(updatedTransactions);
    setActiveTransactionId(newTransaction.id);
    setPaymentAmount('');

    try {
      const heldRecord = await heldTransactionService.create({
        user_id: user?.id || null,
        local_id: newTransaction.id,
        items: newTransaction.items,
        payment_method: paymentMethod,
        status: 'held',
      });
      setTransactions((prev) =>
        prev.map((t) => (t.id === newTransaction.id ? { ...t, heldDbId: heldRecord.id } : t)),
      );
    } catch {
      showToast('Gagal menyimpan transaksi sementara', 'error');
    }
  };

  const resumeTransaction = async (id) => {
    setActiveTransactionId(id);
    setPaymentAmount('');
  };

  const deleteTransaction = async (id, e) => {
    e.stopPropagation();
    const transaction = transactions.find((t) => t.id === id);
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    if (activeTransactionId === id) {
      const remaining = transactions.filter((t) => t.id !== id);
      setActiveTransactionId(remaining[0]?.id || null);
    }

    try {
      if (transaction?.heldDbId) {
        await heldTransactionService.delete(transaction.heldDbId);
      } else {
        await heldTransactionService.deleteByLocalId(id);
      }
    } catch {
      showToast('Gagal menghapus transaksi sementara', 'error');
    }
  };

  const handleCheckout = async () => {
    if (checkingOut) return;
    const total = activeTransaction.items.reduce((sum, item) => sum + item.sellingPrice * item.qty, 0);
    const paid = Number(paymentAmount);
    const adapter = adapterUntuk(paymentMethod);
    if (!paymentMethod || total <= 0) return;
    if (paymentMethod === 'Tunai' && (isNaN(paid) || paid < total)) {
      setToast({ message: 'Jumlah pembayaran kurang', type: 'error' });
      return;
    }

    setCheckingOut(true);
    try {
      const mitraId = activeTransaction.items.find((item) => item.mitraId)?.mitraId || null;
      // status, paid, dan change sengaja TIDAK dikirim. Trigger di database
      // memaksa setiap transaksi lahir sebagai 'Pending' dengan paid 0, jadi
      // tidak ada cara membuat transaksi yang langsung berstatus lunas dari
      // peramban. Penyelesaiannya nanti lewat paymentService.
      const transactionData = {
        user_id: user?.id || null,
        mitra_id: mitraId,
        total,
        metode_pembayaran: paymentMethod,
        // QRIS punya batas waktu. Lewat dari itu pesanan dibatalkan dan stoknya
        // dikembalikan, supaya barang tidak tertahan selamanya karena pelanggan
        // tidak pernah membayar.
        ...(paymentMethod === 'QRIS'
          ? { payment_expires_at: new Date(Date.now() + QRIS_EXPIRY_MS).toISOString() }
          : {}),
      };

      const createdTransaction = await transactionService.create(transactionData);

      const items = activeTransaction.items.map((item) => ({
        transaction_id: createdTransaction.id,
        product_id: item.productId,
        quantity: item.qty,
        harga_satuan: item.sellingPrice,
        // Snapshot harga mitra saat penjualan. Tanpa ini, laporan laba untuk
        // bulan lalu akan ikut berubah begitu harga mitra diedit.
        cost_price: Number(item.mitraPrice) || 0,
        subtotal: item.sellingPrice * item.qty,
      }));

      // Kalau migration add-transaction-item-cost-price.sql belum dijalankan,
      // kolom cost_price tidak ada dan insert ini gagal. Karena header transaksi
      // sudah terlanjur tertulis, kegagalan tanpa penanganan menyisakan transaksi
      // tanpa item. Jadi coba ulang tanpa snapshot, tetap izinkan penjualan
      // terjadi, dan tampilkan banner.
      let snapshotModalTercatat = true;
      try {
        await transactionItemService.createBatch(items);
      } catch (itemErr) {
        const pesan = itemErr?.message || '';
        if (!/cost_price|42703|column .* does not exist/i.test(pesan)) throw itemErr;
        snapshotModalTercatat = false;
        const tanpaSnapshot = items.map(({ cost_price: _modal, ...sisa }) => sisa);
        await transactionItemService.createBatch(tanpaSnapshot);
      }

      if (!snapshotModalTercatat) {
        setPeringatanSnapshot(
          'Kolom cost_price belum ada di database, jadi snapshot harga mitra tidak tersimpan dan '
          + 'laba Owner pada penjualan ini belum bisa dihitung tepat. Jalankan '
          + 'scripts/run-pending-migrations.sql di Supabase SQL Editor.'
        );
      }

      const stockUpdates = activeTransaction.items.map(async (item) => {
        await stockMovementService.create({
          type: 'out',
          product_id: item.productId,
          quantity: item.qty,
          note: `Transaksi #${createdTransaction.id.toString().slice(-2)}`,
          mitra_id: item.mitraId || null,
        });

        const success = await productService.decrementStock(item.productId, item.qty);
        if (!success) {
          throw new Error(`Stok tidak cukup untuk ${item.name}`);
        }
      });

      await Promise.all(stockUpdates);

      if (mitraId) {
        try {
          const currentMitra = await mitraService.getById(mitraId);
          if (currentMitra) {
            await mitraService.update(mitraId, {
              total_transaction: (currentMitra.total_transaction || 0) + 1,
              total_omzet: (currentMitra.total_omzet || 0) + total,
            });
          }
        } catch {
          // silently continue
        }
      }

      window.dispatchEvent(new CustomEvent('kasir:stock-updated'));

      // QRIS tidak bisa langsung diselesaikan di sini: pembayarannya belum
      // masuk. Transaksinya dibiarkan Pending, keranjang tidak dikosongkan, dan
      // struk belum dicetak. Struk baru boleh keluar setelah webhook gateway
      // mengonfirmasi pembayaran.
      if (paymentMethod === 'QRIS') {
        const pesanan = await adapter.mulai({ total, transactionId: createdTransaction.id });
        setQrisPending({
          transactionId: createdTransaction.id,
          total,
          mulai: Date.now(),
          gatewayTerpasang: pesanan.gatewayTerpasang !== false,
          qrPayload: pesanan.qrPayload || null,
          pesan: pesanan.pesan || null,
        });
        setToast({ message: 'Pesanan QRIS dibuat, menunggu pembayaran', type: 'success' });
        return;
      }

      // Tunai: selesaikan lewat database, change dihitung di sana.
      const hasil = await paymentService.completeTunai(createdTransaction.id, paid);
      await finalisasiLunas({
        total,
        paid: Number(paid),
        change: Number(hasil?.change || 0),
        paymentMethod,
      });
    } catch (error) {
      setToast({ message: 'Gagal memproses pembayaran: ' + (error?.message || ''), type: 'error' });
    } finally {
      setCheckingOut(false);
    }
  };

  // Dipanggil setelah transaksi benar-benar lunas, baik Tunai maupun QRIS yang
  // sudah dikonfirmasi webhook. Semua penandaan "sudah selesai" dikumpulkan di
  // sini supaya tidak ada jalur yang bisa mencetak struk tanpa pembayaran.
  const finalisasiLunas = async ({ total, paid, change, paymentMethod }) => {
    const source = transactions.find((t) => t.id === activeTransactionId);
    const completed = {
      ...(source || activeTransaction),
      total,
      paid,
      change,
      paymentMethod,
      completedAt: new Date().toLocaleString('id-ID'),
    };

    setCompletedTransactions((prev) => [completed, ...prev]);
    if (activeTransaction.heldDbId) {
      heldTransactionService.delete(activeTransaction.heldDbId).catch(() => {});
    }
    setToast({ message: `Pembayaran ${paymentMethod} berhasil`, type: 'success' });
    setPaymentAmount('');
    setQrisPending(null);
    setTransactions((prev) => prev.filter((t) => t.id !== activeTransactionId));
    const remaining = transactions.filter((t) => t.id !== activeTransactionId);
    setActiveTransactionId(remaining[0]?.id || null);

    printReceipt(completed).then((result) => {
      if (result && result.method === 'bluetooth') {
        setToast({ message: 'Struk dikirim ke printer', type: 'success' });
      } else if (result && result.error) {
        setToast({ message: 'Gagal print Bluetooth: ' + result.error + '. Gunakan print browser.', type: 'error' });
      }
    }).catch(() => {
      setToast({ message: 'Gagal print struk', type: 'error' });
    });
  };

  const subtotal = activeTransaction.items.reduce((sum, item) => sum + item.sellingPrice * item.qty, 0);
  const tax = 0;
  const total = subtotal - tax;
  const change = paymentMethod === 'Tunai' ? Number(paymentAmount || 0) - total : 0;

  useEffect(() => {
    const handler = (e) => {
      addProductToTransaction(e.detail);
    };
    window.addEventListener('kasir:add-product', handler);
    return () => window.removeEventListener('kasir:add-product', handler);
  }, [activeTransactionId]);

  return (
    <aside className={`fixed right-0 ${isPosDesktop ? 'top-0 h-screen' : 'top-16 h-[calc(100vh-4rem)]'} w-[380px] bg-surface-container-lowest border-l border-outline-variant shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.05)] flex flex-col z-30`}>
      {/* Transaction Tabs */}
      <div className="border-b border-outline-variant bg-surface px-3 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-label-sm text-label-sm text-on-surface-variant">Transaksi Aktif</span>
          <span className="font-label-sm text-label-sm text-on-surface-variant">{transactions.length}/3</span>
        </div>
        <div className="flex gap-2 overflow-x-auto hide-scrollbar">
          {transactions.map((t) => (
            <button
              key={t.id}
              onClick={() => resumeTransaction(t.id)}
              className={`flex items-center gap-2 h-10 px-3 rounded-lg border text-label-sm font-label-sm whitespace-nowrap transition-colors ${
                activeTransactionId === t.id
                  ? 'bg-secondary-container border-secondary text-on-secondary-container shadow-sm'
                  : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span>#{t.id.toString().slice(-2)}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTransactionId === t.id ? 'bg-on-secondary-container/20 text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'}`}>
                {t.items.reduce((sum, item) => sum + item.qty, 0)}
              </span>
              <span
                onClick={(e) => deleteTransaction(t.id, e)}
                className="material-symbols-outlined text-[16px] hover:text-error cursor-pointer"
              >
                close
              </span>
            </button>
          ))}
          <button
            onClick={holdTransaction}
            className="h-10 px-4 rounded-lg border-2 border-dashed border-outline-variant text-label-sm font-label-sm text-on-surface-variant hover:border-primary hover:text-primary whitespace-nowrap transition-colors"
          >
            + Tab
          </button>
        </div>
      </div>

      {/* Cart Header */}
      <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between bg-surface">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface">Transaksi #{activeTransactionId.toString().slice(-2)}</h2>
          <p className="font-label-sm text-label-sm text-on-surface-variant">{activeTransaction.createdAt}</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTransaction.items.length > 0 && (
            <button
              onClick={() => printReceipt(activeTransaction)}
              className="text-primary hover:bg-primary-container p-2 rounded-full transition-colors"
              title="Cetak Struk"
              aria-label="Cetak struk"
            >
              <span className="material-symbols-outlined">print</span>
            </button>
          )}
          <button
            onClick={() => {
              setTransactions((prev) => prev.filter((t) => t.id !== activeTransactionId));
              const remaining = transactions.filter((t) => t.id !== activeTransactionId);
              setActiveTransactionId(remaining[0]?.id || null);
            }}
            className="text-error hover:bg-error-container p-2 rounded-full transition-colors"
            title="Tutup transaksi"
            aria-label="Tutup transaksi"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 hide-scrollbar">
        {activeTransaction.items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-on-surface-variant gap-2">
            <span className="material-symbols-outlined text-4xl">shopping_cart</span>
            <p className="font-body-md text-body-md">Belum ada produk</p>
            <p className="font-label-sm text-label-sm">Scan barcode atau pilih produk</p>
          </div>
        ) : (
          activeTransaction.items.map((item) => (
            <div key={item.productId} className="flex gap-3 p-3 bg-surface rounded-xl border border-outline-variant">
              <div className="w-16 h-16 rounded-lg bg-surface-container-highest flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-outline text-2xl">image</span>
              </div>
              <div className="flex-1 flex flex-col justify-between">
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <h4 className="font-label-md text-label-md text-on-surface line-clamp-2 leading-tight">{item.name}</h4>
                    <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">{item.sku} · {item.barcodeId}</p>
                  </div>
                  <button onClick={() => removeItem(activeTransaction.id, item.productId)} aria-label="Hapus item" className="text-on-surface-variant hover:text-error p-1 -mr-1 -mt-1">
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <p className="font-numeric-data text-numeric-data text-primary text-sm">Rp {item.sellingPrice.toLocaleString('id-ID')}</p>
                  <div className="flex items-center gap-2 bg-surface-container-highest rounded-lg h-8">
                    <button onClick={() => updateQty(activeTransaction.id, item.productId, -1)} className="w-8 h-8 flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors">-</button>
                    <span className="font-numeric-data text-label-md w-8 text-center">{item.qty}</span>
                    <button onClick={() => updateQty(activeTransaction.id, item.productId, 1)} className="w-8 h-8 flex items-center justify-center text-on-surface-variant hover:text-primary transition-colors">+</button>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="font-label-sm text-label-sm text-on-surface-variant">Total</span>
                  <span className="font-numeric-data text-numeric-data text-on-surface font-semibold">Rp {(item.sellingPrice * item.qty).toLocaleString('id-ID')}</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Totals & Actions */}
      {activeTransaction.items.length > 0 && (
        <div className="border-t border-outline-variant bg-surface p-4 flex flex-col gap-3">
          <div className="flex justify-between items-center text-on-surface-variant font-body-md text-body-md">
            <span>Subtotal ({activeTransaction.items.reduce((sum, item) => sum + item.qty, 0)} item)</span>
            <span className="font-numeric-data">Rp {subtotal.toLocaleString('id-ID')}</span>
          </div>
          {tax > 0 && (
            <div className="flex justify-between items-center text-on-surface-variant font-body-md text-body-md">
              <span>Pajak</span>
              <span className="font-numeric-data">Rp {tax.toLocaleString('id-ID')}</span>
            </div>
          )}
          <div className="h-px w-full bg-outline-variant/50" />
          <div className="flex justify-between items-center">
            <span className="font-headline-sm text-headline-sm text-on-surface">Total</span>
            <span className="font-display-lg text-display-lg text-primary">Rp {total.toLocaleString('id-ID')}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={holdTransaction} disabled={Boolean(qrisPending)} className="h-11 rounded-xl bg-surface-container-lowest border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container transition-colors disabled:opacity-50">
              Tahan
            </button>
            {METODE_PEMBAYARAN.map((metode) => (
              <button
                key={metode}
                onClick={() => setPaymentMethod(metode)}
                disabled={Boolean(qrisPending)}
                className={`h-11 rounded-xl border font-label-md text-label-md transition-colors disabled:opacity-50 ${
                  paymentMethod === metode
                    ? 'bg-primary text-on-primary border-primary'
                    : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                {metode}
              </button>
            ))}
          </div>
          {qrisPending && (
            <div className="space-y-3 rounded-2xl bg-surface-container p-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">hourglass_top</span>
                <span className="font-label-lg text-label-lg text-on-surface">Menunggu pembayaran QRIS</span>
              </div>

              {qrisPending.gatewayTerpasang ? (
                qrisPending.qrPayload ? (
                  <div className="flex flex-col items-center gap-3">
                    {qrisPending.qrPayload}
                    <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
                      Minta pelanggan memindai QR ini dari aplikasi e-wallet atau mobile banking-nya.
                    </p>
                  </div>
                ) : (
                  <p className="font-body-sm text-body-sm text-on-surface-variant text-center py-6">
                    Menunggu kode QR dari payment gateway...
                  </p>
                )
              ) : (
                <div className="flex items-start gap-2 rounded-xl bg-error-container text-on-error-container p-3">
                  <span className="material-symbols-outlined text-lg">warning</span>
                  <span className="font-body-sm text-body-sm">
                    {qrisPending.pesan || 'QRIS belum terhubung ke payment gateway.'}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between font-body-sm text-body-sm text-on-surface-variant">
                <span>Total tagihan</span>
                <span className="font-numeric-data text-numeric-data text-on-surface">
                  Rp {Number(qrisPending.total).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex items-center justify-between font-body-sm text-body-sm text-on-surface-variant">
                <span>Batas pembayaran</span>
                <span className="font-numeric-data text-numeric-data text-on-surface">
                  {Math.floor(sisaDetikQris / 60)}:{String(sisaDetikQris % 60).padStart(2, '0')}
                </span>
              </div>
              <p className="font-body-xs text-body-xs text-on-surface-variant">
                Transaksi baru berstatus Selesai dan struk boleh keluar setelah payment gateway
                mengonfirmasi pembayaran. Kalau dibatalkan, stok otomatis dikembalikan.
              </p>
              <button
                onClick={() => {
                  paymentService.batalkan(qrisPending.transactionId, 'Dibatalkan kasir')
                    .then(async () => {
                      setQrisPending(null);
                      setToast({ message: 'Pesanan dibatalkan, stok dikembalikan', type: 'success' });
                      window.dispatchEvent(new CustomEvent('kasir:stock-updated'));
                      await loadProducts();
                    })
                    .catch((err) => setToast({ message: 'Gagal membatalkan: ' + (err?.message || ''), type: 'error' }));
                }}
                className="w-full h-10 rounded-xl border border-outline text-on-surface font-label-md text-label-md hover:bg-surface-container"
              >
                Batalkan Pesanan
              </button>
            </div>
          )}

          {paymentMethod === 'Tunai' && !qrisPending && (
            <div className="space-y-2">
              <label className="block font-label-md text-label-md text-on-surface">Jumlah Bayar</label>
              <input
                className="w-full h-12 px-4 rounded-xl border border-outline bg-surface-container-low focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none font-numeric-data text-numeric-data text-body-md"
                type="number"
                placeholder="0"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
              <div className="grid grid-cols-4 gap-2">
                {[50000, 100000, 200000, 500000].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setPaymentAmount(String(amount))}
                    className="h-9 rounded-lg border border-outline bg-surface-container-low hover:bg-surface-container-high font-label-sm text-label-sm text-on-surface-variant transition-colors"
                  >
                    {amount >= 1000 ? `${(amount / 1000)}K` : amount}
                  </button>
                ))}
              </div>
              {Number(paymentAmount) >= total && (
                <div className="flex justify-between items-center text-body-md font-body-md">
                  <span className="text-on-surface-variant">Kembali</span>
                  <span className="font-numeric-data text-numeric-data text-tertiary-container font-semibold">Rp {change.toLocaleString('id-ID')}</span>
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleCheckout}
            disabled={checkingOut || activeTransaction.items.length === 0 || (paymentMethod === 'Tunai' && (Number(paymentAmount) < total || Number(paymentAmount) === 0))}
            className="w-full h-12 bg-secondary-container hover:bg-[#f4a7b9] text-on-secondary-container font-headline-sm text-headline-sm rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkingOut ? (
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined">point_of_sale</span>
            )}
            {checkingOut ? 'Memproses...' : 'Bayar'}
          </button>
        </div>
      )}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3 ${toast.type === 'success' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-error-container text-on-error-container'}`}>
          <span className="material-symbols-outlined">{toast.type === 'success' ? 'check_circle' : 'error'}</span>
          <span className="font-label-md text-label-md">{toast.message}</span>
        </div>
      )}
    </aside>
  );
}

export { KasirDesktop, KasirDesktopCart };