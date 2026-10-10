import { supabase } from './supabase';
import { buildProfitRows, summarizeProfit, getLocalDate } from './profitReport';

export const authService = {
  async login(email, password) {
    const normalizedEmail = (email || '').trim().toLowerCase();

    const { data, error } = await supabase
      .rpc('login_user', {
        p_email: normalizedEmail,
        p_password: password,
      });

    if (error) {
      throw new Error(error.message || 'Login gagal');
    }

    if (!data || data.length === 0) {
      throw new Error('Email atau kata sandi salah');
    }

    return data[0];
  },
};

export const userService = {
  async create(user) {
    const { error } = await supabase.rpc('create_user', {
      p_nama: user.nama,
      p_email: user.email,
      p_password: user.password,
      p_role: user.role,
    });
    if (error) throw error;
    return true;
  },

  async getAll() {
    const { data, error } = await supabase.rpc('get_all_users', {});
    if (error) throw error;
    return data || [];
  },

  async update(id, updates) {
    const { error } = await supabase.rpc('update_user', {
      p_id: id,
      p_nama: updates.nama,
      p_email: updates.email,
      p_role: updates.role,
      p_password: updates.password ?? null,
    });
    if (error) throw error;
    return true;
  },

  // Update profil sendiri (nama, foto, password opsional).
  // Password lama diverifikasi pemanggil lewat authService.login
  // sebelum RPC ini dipanggil.
  async updateProfile(id, { nama, photo, password }) {
    const { error } = await supabase.rpc('update_my_profile', {
      p_id: id,
      p_nama: nama,
      p_photo: photo,
      p_password: password || null,
    });
    if (error) throw error;
    return true;
  },

  async delete(id) {
    const { error } = await supabase.rpc('delete_user', { p_id: id });
    if (error) throw error;
    return true;
  },

  async toggleStatus(id, newRole) {
    return this.update(id, { role: newRole });
  },
};

export const productService = {
  async getAll(filters = {}, { limit, offset, includeDeleted = false } = {}) {
    let query = supabase
      .from('products')
      .select(`
        *,
        mitra:mitra_id (full_name),
        category:category_id (name),
        type:type_id (name),
        kelompok:group_id (name)
      `)
      .order('created_at', { ascending: false });

    if (!includeDeleted) query = query.is('deleted_at', null);
    if (filters.includeDeleted) query = query.not('deleted_at', 'is', null);

    if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
    if (filters.search) {
      query = query.or(`nama_produk.ilike.%${filters.search}%,sku.ilike.%${filters.search}%,barcode_id.ilike.%${filters.search}%`);
    }

    if (limit !== undefined) {
      query = query.limit(limit);
      if (offset !== undefined) {
        query = query.range(offset, offset + limit - 1);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    if (limit !== undefined) {
      let countQuery = supabase
        .from('products')
        .select('*', { count: 'exact', head: true });

      if (!includeDeleted) countQuery = countQuery.is('deleted_at', null);
      if (filters.includeDeleted) countQuery = countQuery.not('deleted_at', 'is', null);
      if (filters.categoryId) countQuery = countQuery.eq('category_id', filters.categoryId);
      if (filters.search) {
        countQuery = countQuery.or(`nama_produk.ilike.%${filters.search}%,sku.ilike.%${filters.search}%,barcode_id.ilike.%${filters.search}%`);
      }

      const { count } = await countQuery;
      return { data: data || [], count: count || 0 };
    }

    return data || [];
  },

  async getLowStock(threshold = 10) {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        mitra:mitra_id (full_name),
        category:category_id (name),
        type:type_id (name),
        kelompok:group_id (name)
      `)
      .is('deleted_at', null)
      .gt('stock', 0)
      .lte('stock', threshold)
      .order('stock', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async getOutOfStock() {
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        mitra:mitra_id (full_name),
        category:category_id (name),
        type:type_id (name),
        kelompok:group_id (name)
      `)
      .is('deleted_at', null)
      .eq('stock', 0)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async create(product) {
    const { data, error } = await supabase
      .from('products')
      .insert([product])
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data;
  },

  async update(id, product) {
    const { data, error } = await supabase
      .from('products')
      .update(product)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data;
  },

  async decrementStock(id, qty) {
    const { data, error } = await supabase
      .rpc('decrement_product_stock', { p_product_id: id, p_qty: qty });

    if (error) {
      throw error;
    }
    return data;
  },

  async incrementStock(id, qty) {
    const { data, error } = await supabase
      .rpc('increment_product_stock', { p_product_id: id, p_qty: qty });

    if (error) {
      throw error;
    }
    return data;
  },

  // Sengaja tidak menyaring deleted_at. Fungsi ini mengecek stok untuk
  // transaksi yang sudah masuk keranjang, termasuk keranjang yang disimpan
  // (held) sebelum produk dihapus. Kalau produknya tidak ditemukan, stoknya
  // dianggap 0 dan penjualan ditolak, bukan ERROR.
  async getStockByIds(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const { data, error } = await supabase
      .from('products')
      .select('id, stock, nama_produk, unit')
      .in('id', uniqueIds);

    if (error) throw error;
    return data || [];
  },

  // Soft delete: baris ditandai, tidak dihapus. Baris ini masih dirujuk
  // transaksi lama, jadi menghapusnya permanen akan merusak laporan.
  async delete(id) {
    const { error } = await supabase
      .from('products')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;
  },

  async restore(id) {
    const { error } = await supabase
      .from('products')
      .update({ deleted_at: null })
      .eq('id', id);

    if (error) throw error;
  },
};

export const categoryService = {
  async getAll() {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .is('deleted_at', null)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async create(name) {
    const { data, error } = await supabase
      .from('categories')
      .insert([{ name }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id, name) {
    const { data, error } = await supabase
      .from('categories')
      .update({ name })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('categories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;
  },

  async restore(id) {
    const { error } = await supabase
      .from('categories')
      .update({ deleted_at: null })
      .eq('id', id);

    if (error) throw error;
  },
};

export const productTypeService = {
  async getAll() {
    const { data, error } = await supabase
      .from('product_types')
      .select('*')
      .is('deleted_at', null)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async create(name) {
    const { data, error } = await supabase
      .from('product_types')
      .insert([{ name }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id, name) {
    const { data, error } = await supabase
      .from('product_types')
      .update({ name })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('product_types')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;
  },

  async restore(id) {
    const { error } = await supabase
      .from('product_types')
      .update({ deleted_at: null })
      .eq('id', id);

    if (error) throw error;
  },
};

export const productGroupService = {
  async getAll() {
    const { data, error } = await supabase
      .from('product_groups')
      .select('*')
      .is('deleted_at', null)
      .order('name');

    if (error) throw error;
    return data || [];
  },

  async create(name) {
    const { data, error } = await supabase
      .from('product_groups')
      .insert([{ name }])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase
      .from('product_groups')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;
  },

  async restore(id) {
    const { error } = await supabase
      .from('product_groups')
      .update({ deleted_at: null })
      .eq('id', id);

    if (error) throw error;
  },
};

export const mitraService = {
  async getAll({ limit, offset, search, includeDeleted = false } = {}) {
    let query = supabase
      .from('mitra')
      .select('*')
      .order('full_name');

    if (includeDeleted) query = query.not('deleted_at', 'is', null);
    else query = query.is('deleted_at', null);

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    if (limit !== undefined) {
      query = query.limit(limit);
      if (offset !== undefined) {
        query = query.range(offset, offset + limit - 1);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    if (limit !== undefined) {
      let countQuery = supabase
        .from('mitra')
        .select('*', { count: 'exact', head: true });

      if (includeDeleted) countQuery = countQuery.not('deleted_at', 'is', null);
      else countQuery = countQuery.is('deleted_at', null);

      if (search) {
        countQuery = countQuery.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
      }

      const { count } = await countQuery;
      return { data: data || [], count: count || 0 };
    }

    return data || [];
  },

  async create(mitra) {
    const { data, error } = await supabase
      .from('mitra')
      .insert([mitra])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id, mitra) {
    const { data, error } = await supabase
      .from('mitra')
      .update(mitra)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('mitra')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return data;
  },

  // Soft delete. Mitra masih dirujuk produk, transaksi, dan invoice, jadi
  // menghapusnya permanen akan merusak riwayat.
  async delete(id) {
    const { error } = await supabase
      .from('mitra')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;
  },

  async restore(id) {
    const { error } = await supabase
      .from('mitra')
      .update({ deleted_at: null })
      .eq('id', id);

    if (error) throw error;
  },
};

export const transactionService = {
  // Satu panggilan untuk seluruh penyimpanan penjualan. Dulu ini dilakukan
  // dalam empat langkah terpisah dari peramban, sehingga langkah yang gagal
  // meninggalkan transaksi menggantung tanpa item. Sekarang database
  // mengaturnya dalam satu transaksi, dan stok produk dikunci dengan FOR UPDATE
  // supaya dua kasir tidak bisa sama-sama menjual produk terakhir.
  async createPosTransaction(header, items) {
    const { data, error } = await supabase.rpc('create_pos_transaction', {
      p_header: header,
      p_items: items,
    });

    if (error) throw error;
    return data;
  },

  async create(transaction) {
    const { data, error } = await supabase
      .from('transactions')
      .insert([transaction])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getHistory(filters = {}, { limit, offset } = {}) {
    let query = supabase
      .from('transactions')
      .select(`
        *,
        mitra:mitra_id (full_name),
        items:transaction_items (
          *,
          product:product_id (
            nama_produk, sku, barcode_id, unit, mitra_id,
            mitra:mitra_id (full_name)
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (filters.startDate) query = query.gte('created_at', filters.startDate);
    if (filters.endDate) query = query.lte('created_at', filters.endDate + 'T23:59:59');
    if (filters.mitraId) query = query.eq('mitra_id', filters.mitraId);
    if (filters.paymentMethod) query = query.eq('metode_pembayaran', filters.paymentMethod);

    if (limit !== undefined) {
      query = query.limit(limit);
      if (offset !== undefined) {
        query = query.range(offset, offset + limit - 1);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    if (limit !== undefined) {
      let countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });

      if (filters.startDate) countQuery = countQuery.gte('created_at', filters.startDate);
      if (filters.endDate) countQuery = countQuery.lte('created_at', filters.endDate + 'T23:59:59');
      if (filters.mitraId) countQuery = countQuery.eq('mitra_id', filters.mitraId);
      if (filters.paymentMethod) countQuery = countQuery.eq('metode_pembayaran', filters.paymentMethod);

      const { count } = await countQuery;
      return { data: data || [], count: count || 0 };
    }

    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('transactions')
      .select(`
        *,
        mitra:mitra_id (full_name),
        items:transaction_items (
          *,
          product:product_id (nama_produk, sku, barcode_id, unit)
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },
};

export const returnService = {
  async create(returnData) {
    const { data, error } = await supabase
      .from('returns')
      .insert([returnData])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getByTransaction(transactionId) {
    const { data, error } = await supabase
      .from('returns')
      .select(`
        *,
        product:product_id (nama_produk, sku, unit)
      `)
      .eq('transaction_id', transactionId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getAll() {
    const { data, error } = await supabase
      .from('returns')
      .select(`
        id,
        transaction_id,
        transaction_item_id,
        product_id,
        quantity,
        reason,
        user_id,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },
};

export const heldTransactionService = {
  async create(heldData) {
    const { data, error } = await supabase
      .from('held_transactions')
      .insert([heldData])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getAllByUser(userId) {
    const { data, error } = await supabase
      .from('held_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'held')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async delete(id) {
    const { error } = await supabase
      .from('held_transactions')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },

  async deleteByLocalId(localId) {
    const { error } = await supabase
      .from('held_transactions')
      .delete()
      .eq('local_id', localId);

    if (error) throw error;
  },
};

export const transactionItemService = {
  async create(item) {
    const { data, error } = await supabase
      .from('transaction_items')
      .insert([item])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async createBatch(items) {
    const { data, error } = await supabase
      .from('transaction_items')
      .insert(items)
      .select();

    if (error) throw error;
    return data || [];
  },
};

export const stockMovementService = {
  // Stok masuk dan pencatatan pergerakannya dalam satu transaksi database.
  // Dulu keduanya dua permintaan terpisah: pergerakan ditulis dulu, baru stok
  // diubah. Kalau stok kurang saat keluar, pergerakannya sudah terlanjur
  // tersimpan padahal stoknya tidak pernah berkurang.
  async catat({ productId, type, quantity, note = null, mitraId = null, reason = null, userId = null }) {
    const { data, error } = await supabase.rpc('record_stock_movement', {
      p_product_id: productId,
      p_type: type,
      p_qty: Number(quantity),
      p_note: note,
      p_mitra_id: mitraId,
      p_reason: reason,
      p_user_id: userId,
    });

    if (error) throw error;
    return data?.[0] || null;
  },

  async create(movement) {
    const { data, error } = await supabase
      .from('stock_movements')
      .insert([movement])
      .select('id, product_id, type, quantity, note, mitra_id, created_at')
      .single();

    if (error) {
      throw error;
    }
    return data;
  },

  async getAll(filters = {}, { limit, offset } = {}) {
    let query = supabase
      .from('stock_movements')
      .select('id, product_id, type, quantity, note, mitra_id, reason, created_at, product:product_id (nama_produk, unit), mitra:mitra_id (full_name)')
      .order('created_at', { ascending: false });

    if (filters.type) query = query.eq('type', filters.type);
    if (filters.productId) query = query.eq('product_id', filters.productId);
    if (filters.mitraId) query = query.eq('mitra_id', filters.mitraId);
    if (filters.startDate) query = query.gte('created_at', filters.startDate);
    if (filters.endDate) query = query.lte('created_at', filters.endDate + 'T23:59:59');

    if (limit !== undefined) {
      query = query.limit(limit);
      if (offset !== undefined) {
        query = query.range(offset, offset + limit - 1);
      }
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    if (limit !== undefined) {
      let countQuery = supabase
        .from('stock_movements')
        .select('*', { count: 'exact', head: true });

      if (filters.type) countQuery = countQuery.eq('type', filters.type);
      if (filters.productId) countQuery = countQuery.eq('product_id', filters.productId);
      if (filters.mitraId) countQuery = countQuery.eq('mitra_id', filters.mitraId);
      if (filters.startDate) countQuery = countQuery.gte('created_at', filters.startDate);
      if (filters.endDate) countQuery = countQuery.lte('created_at', filters.endDate + 'T23:59:59');

      const { count } = await countQuery;
      return { data: data || [], count: count || 0 };
    }

    return data || [];
  },
};

export const pendingStockValidationService = {
async create(validation) {
  const { data, error } = await supabase
    .from('pending_stock_validations')
    .insert([validation])
    .select()
    .single();

  if (error) throw error;
  return data;
  },

  // Menolak pengajuan. Untuk pengajuan barang ditarik, stok tidak disentuh sama
  // sekali karena barangnya memang tidak masuk ke gudang.
  async reject(validationId) {
  const { error } = await supabase
  .from('pending_stock_validations')
  .update({ status: 'rejected' })
  .eq('id', validationId)
  .eq('status', 'pending');

  if (error) throw error;
  },

  async getAll(filters = {}, { limit, offset } = {}) {
    let query = supabase
      .from('pending_stock_validations')
      .select(`
        *,
        mitra:mitra_id (full_name),
        product:product_id (nama_produk, unit)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (filters.mitraId) query = query.eq('mitra_id', filters.mitraId);
    if (filters.startDate) query = query.gte('date', filters.startDate);
    if (filters.endDate) query = query.lte('date', filters.endDate);

    if (limit !== undefined) {
      query = query.limit(limit);
      if (offset !== undefined) {
        query = query.range(offset, offset + limit - 1);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    if (limit !== undefined) {
      let countQuery = supabase
        .from('pending_stock_validations')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (filters.mitraId) countQuery = countQuery.eq('mitra_id', filters.mitraId);
      if (filters.startDate) countQuery = countQuery.gte('date', filters.startDate);
      if (filters.endDate) countQuery = countQuery.lte('date', filters.endDate);

      const { count } = await countQuery;
      return { data: data || [], count: count || 0 };
    }

    return data || [];
  },

  async getAllHistory(filters = {}, { limit, offset } = {}) {
    let query = supabase
      .from('pending_stock_validations')
      .select(`
        *,
        mitra:mitra_id (full_name),
        product:product_id (nama_produk, unit)
      `)
      .order('created_at', { ascending: false });

    if (filters.mitraId) query = query.eq('mitra_id', filters.mitraId);
    if (filters.startDate) query = query.gte('date', filters.startDate);
    if (filters.endDate) query = query.lte('date', filters.endDate);
    if (filters.status) query = query.eq('status', filters.status);

    if (limit !== undefined) {
      query = query.limit(limit);
      if (offset !== undefined) {
        query = query.range(offset, offset + limit - 1);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    if (limit !== undefined) {
      let countQuery = supabase
        .from('pending_stock_validations')
        .select('*', { count: 'exact', head: true });

      if (filters.mitraId) countQuery = countQuery.eq('mitra_id', filters.mitraId);
      if (filters.startDate) countQuery = countQuery.gte('date', filters.startDate);
      if (filters.endDate) countQuery = countQuery.lte('date', filters.endDate);
      if (filters.status) countQuery = countQuery.eq('status', filters.status);

      const { count } = await countQuery;
      return { data: data || [], count: count || 0 };
    }

    return data || [];
  },

  async validate(id) {
    const { data, error } = await supabase
      .from('pending_stock_validations')
      .update({ status: 'validated' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },
};

export const dashboardService = {
  // Angka dashboard WAJIB lewat modul kalkulasi yang sama dengan laporan,
  // supaya tidak ada perbedaan omzet antara dashboard dan laporan.
  //
  // mitraId diisi untuk akun mitra: hanya penjualan produk milik
  // mitra itu yang dihitung. Atribusi mengikuti mitra PRODUK, bukan
  // mitra di header transaksi, supaya keranjang campur tetap benar.
  async getTodayStats(mitraId = null) {
    // Tanggal lokal, bukan UTC. Dulu pakai toISOString() yang memakai tanggal
    // UTC, sehingga setelah pukul 00:00 WIB dashboard masih menampilkan
    // angka kemarin.
    const today = getLocalDate(new Date());

    const queries = [
      transactionService.getHistory(),
      returnService.getAll(),
      productService.getAll(),
    ];
    if (!mitraId) {
      queries.push(
        supabase
          .from('mitra')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'Aktif')
          .is('deleted_at', null)
      );
    }

    const [transactionData, returnData, productData, mitraCountResult] = await Promise.all(queries);

    if (mitraCountResult?.error) throw mitraCountResult.error;

    let rows = buildProfitRows({
      transactions: transactionData || [],
      returns: returnData || [],
      products: productData || [],
      startDate: today,
      endDate: today,
    });

    if (mitraId) {
      rows = rows.filter((row) => String(row.mitraId) === String(mitraId));
    }

    const summary = summarizeProfit(rows);

    return {
      totalTransactions: summary.totalTransaksi,
      totalSales: summary.totalPenjualan,
      totalItems: summary.totalQty,
      totalReturned: summary.totalRetur,
      untukMitra: summary.untukMitra,
      untukOwner: summary.untukOwner,
      // Untuk akun mitra, kartu keempat menampilkan jumlah produk
      // miliknya yang terdaftar, bukan jumlah mitra toko.
      activeMitra: mitraId
        ? (productData || []).filter((p) => String(p.mitra_id) === String(mitraId)).length
        : (mitraCountResult.count || 0),
      date: today,
    };
  },
};

export const mitraSettlementService = {
  async getAll(filters = {}) {
    let query = supabase
      .from('mitra_settlements')
      .select(`
        *,
        mitra:mitra_id (full_name),
        user:user_id (nama, email, role)
      `)
      .order('date', { ascending: false });

    if (filters.includeDeleted) query = query.not('deleted_at', 'is', null);
    else query = query.is('deleted_at', null);

    if (filters.mitraId) query = query.eq('mitra_id', filters.mitraId);
    if (filters.startDate) query = query.gte('date', filters.startDate);
    if (filters.endDate) query = query.lte('date', filters.endDate);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('mitra_settlements')
      .select(`
        *,
        mitra:mitra_id (full_name),
        user:user_id (nama, email, role),
        items:mitra_settlement_items (*)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return data;
  },

  async create(settlement) {
    const { data, error } = await supabase
      .from('mitra_settlements')
      .insert([settlement])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id, settlement) {
    const { data, error } = await supabase
      .from('mitra_settlements')
      .update(settlement)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Soft delete. Invoice yang sudah dibayar ke mitra tidak boleh hilang
  // permanen, jadi hanya ditandai dan bisa dipulihkan.
  async delete(id) {
    const { error } = await supabase
      .from('mitra_settlements')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;
  },

  async restore(id) {
    const { error } = await supabase
      .from('mitra_settlements')
      .update({ deleted_at: null })
      .eq('id', id);

    if (error) throw error;
  },
};

// Penyelesaian pembayaran. Semua status melewati fungsi di database, bukan
// update langsung, karena status 'Selesai' tidak boleh bisa disetel dari
// browser. Lihat scripts/secure-payment-and-qris.sql.
export const paymentService = {
  // Dipanggil kasir setelah uang tunai benar-benar diterima.
  // Change dihitung database supaya tidak bisa dimanipulasi dari peramban.
  async completeTunai(transactionId, paid) {
    const { data, error } = await supabase.rpc('complete_cash_payment', {
      p_transaction_id: transactionId,
      p_paid: Number(paid),
    });

    if (error) throw error;
    return data?.[0] || null;
  },

  // Kasir memanggil ini setelah memastikan uang QRIS benar-benar masuk.
  // Pelaku dan waktu konfirmasi dicatat database, bukan dikirim dari peramban.
  async konfirmasiQris(transactionId, paid) {
    const { data, error } = await supabase.rpc('confirm_qris_payment', {
      p_transaction_id: transactionId,
      p_paid: Number(paid),
    });

    if (error) throw error;
    return data?.[0] || null;
  },

  async batalkan(transactionId, reason = null) {
    const { data, error } = await supabase.rpc('cancel_pending_transaction', {
      p_transaction_id: transactionId,
      p_reason: reason,
    });

    if (error) throw error;
    return data?.[0] || null;
  },

  // Dipanggil saat halaman kasir dibuka. Transaksi QRIS yang pembayarannya
  // tidak pernah datang akan dibatalkan dan stoknya dikembalikan, tanpa
  // perlu cron di server.
  async bersihkanKedaluwarsa() {
    const { data, error } = await supabase.rpc('release_expired_payments');
    if (error) throw error;
    return data || 0;
  },
};

// Jejak audit. Ditulis trigger di database, jadi aplikasi hanya perlu
// membaca. Hak UPDATE dan DELETE dicabut di SQL migration, jadi catatan
// yang sudah ada tidak bisa dirapikan atau dihapus dari sisi aplikasi.
export const auditLogService = {
  async getAll({ limit = 100, tabel = null, aksi = null, entitasId = null } = {}) {
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (tabel) query = query.eq('tabel', tabel);
    if (aksi) query = query.eq('aksi', aksi);
    if (entitasId) query = query.eq('entitas_id', entitasId);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async count({ tabel = null, aksi = null } = {}) {
    let query = supabase
      .from('audit_log')
      .select('*', { count: 'exact', head: true });

    if (tabel) query = query.eq('tabel', tabel);
    if (aksi) query = query.eq('aksi', aksi);

    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  },
};
