const PRINTER_NAME = 'RPP02N';
const SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

const ESC = 0x1b;
const _GS = 0x1d;
const LF = 0x0a;

function bytesToUint8Array(bytes) {
  if (typeof bytes === 'string') {
    const encoder = new TextEncoder();
    const lineBytes = encoder.encode(bytes);
    const result = new Uint8Array(lineBytes.length + 1);
    result.set(lineBytes);
    result[lineBytes.length] = LF;
    return result;
  }
  return new Uint8Array(bytes);
}

export function buildReceiptPayload(transaction) {
  const total = transaction.items.reduce((sum, item) => sum + item.sellingPrice * item.qty, 0);
  const now = new Date().toLocaleString('id-ID');
  const payload = [];

  // Reset printer (tanpa Line Feed tambahan di awal)
  payload.push([ESC, 0x40]);
  
  // Header Center - Langsung cetak judul di baris paling atas
  payload.push([ESC, 0x61, 0x01]);
  payload.push('Lapak Berkah Buntulia');
  payload.push('Struk Pembelian');
  
  // Align Left
  payload.push([ESC, 0x61, 0x00]);
  payload.push(`No. Transaksi: #${transaction.id.toString().slice(-2)}`);
  payload.push(`Tanggal: ${transaction.completedAt || now}`);
  payload.push(`Metode: ${transaction.paymentMethod || 'Tunai'}`);
  payload.push('--------------------');

  // Items
  for (const item of transaction.items) {
    const itemTotal = item.sellingPrice * item.qty;
    payload.push(item.name);
    payload.push(`${item.qty} x ${item.sellingPrice.toLocaleString('id-ID')} = Rp ${itemTotal.toLocaleString('id-ID')}`);
  }

  payload.push('--------------------');
  payload.push(`Total: Rp ${total.toLocaleString('id-ID')}`);

  if (transaction.paid > 0) {
    payload.push(`Bayar: Rp ${transaction.paid.toLocaleString('id-ID')}`);
    payload.push(`Kembali: Rp ${transaction.change.toLocaleString('id-ID')}`);
  }

  // Footer
  payload.push('--------------------');
  payload.push('Terima kasih');

  // Feed 2 baris setelah "Terima kasih" agar kertas terdorong tepat untuk disobek
  payload.push([ESC, 0x64, 0x02]);

  const bytes = [];
  for (const line of payload) {
    bytes.push(...bytesToUint8Array(line));
  }

  return bytesToUint8Array(bytes);
}

export function buildReturnReceiptPayload(transaction, returnReason) {
  const payload = [];

  // Reset printer
  payload.push([ESC, 0x40]);
  
  // Header Center
  payload.push([ESC, 0x61, 0x01]);
  payload.push('Struk Retur');
  
  // Align Left
  payload.push([ESC, 0x61, 0x00]);
  payload.push(`No. Transaksi: #${transaction.transactionId}`);
  payload.push(`Tanggal: ${transaction.date}`);
  payload.push(`Mitra: ${transaction.mitraName}`);
  payload.push(`Metode: ${transaction.paymentMethod}`);
  payload.push('--------------------');

  for (const item of transaction.rawItems || []) {
    payload.push(item.product?.nama_produk || 'Produk');
    payload.push(`Qty: ${item.quantity}`);
    payload.push('--------------------');
  }

  payload.push(`Total Retur: ${transaction.total.toLocaleString('id-ID')}`);

  if (returnReason) {
    payload.push(`Alasan: ${returnReason}`);
  }

  payload.push('Terima kasih');
  
  // Feed 2 baris setelah "Terima kasih"
  payload.push([ESC, 0x64, 0x02]);

  const bytes = [];
  for (const line of payload) {
    bytes.push(...bytesToUint8Array(line));
  }

  return bytesToUint8Array(bytes);
}

export function buildSettlementPayload(settlement) {
  const totalModal = (settlement.items || []).reduce(
    (sum, item) => sum + ((item.cost_price || 0) * (item.quantity || 0)), 0
  );
  const now = new Date().toLocaleString('id-ID');
  const payload = [];

  // Lebar kolom tabel. Pakai Font B (ESC M) agar muat di kertas
  // thermal 58mm (~42 karakter per baris).
  const PRODUK_W = 13;
  const QTY_W = 3;
  const HARGA_W = 7;
  const SUBTOTAL_W = 9;
  const GAP = '   ';
  const HEADER_GAP = ' | ';

  const padRight = (str, len) => {
    str = String(str ?? '');
    return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
  };
  const padLeft = (str, len) => {
    str = String(str ?? '');
    return str.length >= len ? str.slice(-len) : ' '.repeat(len - str.length) + str;
  };

  // Bungkus nama produk agar tetap berada di kolom Produk:
  // nama yang panjang pindah ke baris baru di dalam kolom,
  // sementara Qty/Harga/Subtotal tetap sejajar di kolomnya.
  // Kata yang lebih panjang dari kolom dipotong per karakter.
  const wrapText = (text, width) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    for (const word of words) {
      let rest = word;
      while (rest.length > width) {
        if (current.length > 0) {
          lines.push(current);
          current = '';
        }
        lines.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (current.length === 0) {
        current = rest;
      } else if (current.length + 1 + rest.length <= width) {
        current += ' ' + rest;
      } else {
        lines.push(current);
        current = rest;
      }
    }
    if (current.length > 0) lines.push(current);
    return lines.length > 0 ? lines : [''];
  };

  // Level akun pembuat invoice (Admin atau Kasir)
  const roleLabels = { admin: 'Admin', owner: 'Owner', kasir: 'Kasir', mitra: 'Mitra' };
  const role = settlement.user?.role || settlement.role || 'kasir';
  const roleLabel = roleLabels[role] || 'Kasir';

  // Reset printer
  payload.push([ESC, 0x40]);

  // KOP (Font A)
  payload.push([ESC, 0x61, 0x01]);
  payload.push('LAPAK BERKAH BUNTULIA');
  payload.push('Nota Penjualan Mitra');

  payload.push([ESC, 0x61, 0x00]);
  payload.push(`No. Invoice: ${settlement.invoice_number || '-'}`);
  payload.push(`Tanggal: ${settlement.date || '-'}`);
  payload.push('______________________');

  // Font B agar kolom tabel muat di kertas struk
  payload.push([ESC, 0x4d, 0x01]);

  // Header tabel
  payload.push(
    padRight('Produk', PRODUK_W) + HEADER_GAP
    + padLeft('Qty', QTY_W) + HEADER_GAP
    + padLeft('Harga', HARGA_W) + HEADER_GAP
    + padLeft('Subtotal', SUBTOTAL_W)
  );

  // Item
  for (const item of settlement.items || []) {
    const subtotal = (item.selling_price || 0) * (item.quantity || 0);
    const nameLines = wrapText(item.product_name || 'Produk', PRODUK_W);

    // Baris pertama: nama (kolom Produk) + angka di kolomnya
    payload.push(
      padRight(nameLines[0], PRODUK_W) + GAP
      + padLeft(String(item.quantity || 0), QTY_W) + GAP
      + padLeft((item.selling_price || 0).toLocaleString('id-ID'), HARGA_W) + GAP
      + padLeft(subtotal.toLocaleString('id-ID'), SUBTOTAL_W)
    );

    // Lanjutan nama produk: tetap di kolom Produk
    for (let i = 1; i < nameLines.length; i++) {
      payload.push(nameLines[i]);
    }
  }
  payload.push('______________________');

  payload.push('');
  payload.push(`Total Jual: Rp. ${(settlement.total_amount || 0).toLocaleString('id-ID')}`);
  payload.push(`Total Modal: Rp. ${totalModal.toLocaleString('id-ID')}`);
  payload.push('');

  // Tanda tangan: Mitra (kiri) & Level Akun (kanan)
  payload.push(padRight('Mitra', 22) + roleLabel);
  payload.push('');
  payload.push('');
  payload.push('');
  const mitraName = settlement.mitra?.full_name || '-';
  const userName = settlement.user?.nama || settlement.user?.email || '-';
  payload.push(padRight(`(${mitraName})`, 24) + `(${userName})`);
  payload.push('____________________________');

  // Footer
  payload.push('');
  payload.push('Dokumen ini dicetak secara otomatis oleh sistem');
  payload.push('Lapak Berkah Buntulia');
  payload.push(now);

  // Kembali ke Font A
  payload.push([ESC, 0x4d, 0x00]);

  // Feed 2 baris agar kertas terdorong tepat untuk disobek
  payload.push([ESC, 0x64, 0x02]);

  const bytes = [];
  for (const line of payload) {
    bytes.push(...bytesToUint8Array(line));
  }

  return bytesToUint8Array(bytes);
}

export async function printSettlementBluetooth(settlement) {
  const payload = buildSettlementPayload(settlement);

  try {
    const { characteristic } = await connectPrinter();

    const CHUNK_SIZE = 50;
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const chunk = payload.slice(i, i + CHUNK_SIZE);

      if (!cachedDevice?.gatt?.connected) {
        throw new Error('Koneksi Bluetooth terputus');
      }

      await characteristic.writeValue(chunk);
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    return { success: true, method: 'bluetooth' };
  } catch (error) {
    cachedDevice = null;
    cachedCharacteristic = null;
    return { success: false, method: 'bluetooth', error: error.message };
  }
}

let cachedDevice = null;
let cachedCharacteristic = null;

export function clearPrinterCache() {
  cachedDevice = null;
  cachedCharacteristic = null;
}

export async function connectPrinter() {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth tidak didukung di browser ini.');
  }

  if (cachedCharacteristic) {
    try {
      await cachedCharacteristic.writeValue(new Uint8Array([]));
      return { device: cachedDevice, characteristic: cachedCharacteristic };
    } catch {
      cachedDevice = null;
      cachedCharacteristic = null;
    }
  }

  console.log('Requesting Bluetooth device:', PRINTER_NAME);
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: PRINTER_NAME }],
    optionalServices: [SERVICE_UUID],
  });
  console.log('Device selected:', device.name);

  const server = await device.gatt.connect();
  console.log('GATT connected');
  
  if (device.gatt?.requestMTU) {
    try {
      await device.gatt.requestMTU(517);
      console.log('MTU negotiated');
    } catch {
      console.log('MTU negotiation skipped');
    }
  }
  
  const service = await server.getPrimaryService(SERVICE_UUID);
  console.log('Service found');
  const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
  console.log('Characteristic found');

  cachedDevice = device;
  cachedCharacteristic = characteristic;

  return { device, characteristic };
}

export async function printReceiptBluetooth(transaction) {
  const payload = buildReceiptPayload(transaction);

  try {
    console.log('Attempting Bluetooth print...');
    const { characteristic } = await connectPrinter();
    console.log('Writing payload:', payload.length, 'bytes');

    const CHUNK_SIZE = 50;
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const chunk = payload.slice(i, i + CHUNK_SIZE);
      
      if (!cachedDevice?.gatt?.connected) {
        throw new Error('Koneksi Bluetooth terputus');
      }
      
      await characteristic.writeValue(chunk);
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    console.log('Print success');
    return { success: true, method: 'bluetooth' };
  } catch (error) {
    console.error('Bluetooth print failed:', error);
    cachedDevice = null;
    cachedCharacteristic = null;
    return { success: false, method: 'bluetooth', error: error.message };
  }
}

export async function printReturnReceiptBluetooth(transaction, returnReason) {
  const payload = buildReturnReceiptPayload(transaction, returnReason);

  try {
    const { characteristic } = await connectPrinter();
    
    const CHUNK_SIZE = 50;
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const chunk = payload.slice(i, i + CHUNK_SIZE);
      
      if (!cachedDevice?.gatt?.connected) {
        throw new Error('Koneksi Bluetooth terputus');
      }
      
      await characteristic.writeValue(chunk);
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    return { success: true, method: 'bluetooth' };
  } catch (error) {
    console.error('Bluetooth return print failed:', error);
    cachedDevice = null;
    cachedCharacteristic = null;
    return { success: false, method: 'bluetooth', error: error.message };
  }
}

export async function printReceipt(transaction) {
  const bluetoothResult = await printReceiptBluetooth(transaction);
  if (bluetoothResult.success) {
    return bluetoothResult;
  }

  return printReceiptFallback(transaction);
}

export function printReceiptFallback(transaction) {
  try {
    const printWindow = window.open('', '_blank', 'width=320,height=600');
    if (!printWindow) {
      return { success: false, method: 'fallback', error: 'Pop-up diblokir' };
    }

    const total = transaction.items.reduce((sum, item) => sum + item.sellingPrice * item.qty, 0);
    const now = new Date().toLocaleString('id-ID');

    printWindow.document.write(`
      <html>
        <head>
          <title>Struk #${transaction.id.toString().slice(-2)}</title>
          <style>
            @page { size: 58mm auto; margin: 0; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              padding: 0mm 2mm 3mm 2mm;
              font-family: Arial, sans-serif;
              font-size: 11px;
              color: #000;
              background: #fff;
              width: 58mm;
            }
            table { width: 100%; border-collapse: collapse; }
            td, th { padding: 1px; font-size: 11px; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .font-bold { font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="text-center" style="margin-top: 0px;">
            <div style="font-weight: bold; font-size: 12px;">Lapak Berkah Buntulia</div>
            <div style="font-size: 10px; color: #666;">Struk Pembelian</div>
          </div>
          <div style="margin-top: 4px;">
            <div>No. Transaksi: #${transaction.id.toString().slice(-2)}</div>
            <div>Tanggal: ${transaction.completedAt || now}</div>
            <div>Metode: ${transaction.paymentMethod || 'Tunai'}</div>
          </div>
          <div style="margin-top: 4px; border-top: 1px dashed #ccc; padding-top: 4px;">
            ${transaction.items.map(item => `
              <div style="font-size: 10px; margin-bottom: 2px;">${item.name}</div>
              <div style="font-size: 10px; margin-bottom: 2px;">${item.qty} x ${item.sellingPrice.toLocaleString('id-ID')} = Rp ${(item.sellingPrice * item.qty).toLocaleString('id-ID')}</div>
            `).join('')}
          </div>
          <div style="margin-top: 4px; border-top: 1px dashed #ccc; padding-top: 4px;">
            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 11px;">
              <span>Total</span>
              <span>Rp ${total.toLocaleString('id-ID')}</span>
            </div>
            ${transaction.paid > 0 ? `
              <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px;">
                <span>Bayar</span>
                <span>Rp ${transaction.paid.toLocaleString('id-ID')}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 10px; margin-top: 2px;">
                <span>Kembali</span>
                <span>Rp ${transaction.change.toLocaleString('id-ID')}</span>
              </div>
            ` : ''}
          </div>
          <div style="margin-top: 4px; border-top: 1px dashed #ccc; padding-top: 4px; text-align: center; font-size: 10px; color: #666;">
            Terima kasih
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };

    return { success: true, method: 'fallback' };
  } catch (error) {
    return { success: false, method: 'fallback', error: error.message };
  }
}