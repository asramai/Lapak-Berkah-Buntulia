const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatRupiah = (value) => `Rp ${(Number(value) || 0).toLocaleString('id-ID')}`;

const isNumericValue = (value) => typeof value === 'number' && Number.isFinite(value);

const buildCell = (value, { bold, money, align } = {}) => {
  if (isNumericValue(value) || money) {
    const numeric = isNumericValue(value) ? value : 0;
    const styleId = bold ? 'boldMoney' : 'money';
    return `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${numeric}</Data></Cell>`;
  }

  const styleId = align === 'right' ? 'boldRight' : (bold ? 'bold' : '');
  const styleAttr = styleId ? ` ss:StyleID="${styleId}"` : '';
  return `<Cell${styleAttr}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
};

export function buildSpreadsheetXml({ sheetName = 'Laporan', title, subtitle, headers, rows, summary }) {
  const headerCells = headers.map((h) => buildCell(h, { bold: true })).join('');

  const bodyRows = rows
    .map((row) => {
      const cells = row.map((cell) => {
        if (cell && typeof cell === 'object' && 'value' in cell) {
          return buildCell(cell.value, { bold: cell.bold, money: cell.money, align: cell.align });
        }
        return buildCell(cell, { align: typeof cell === 'number' ? 'right' : 'left' });
      }).join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  const summaryRows = (summary || [])
    .map((row) => {
      const cells = row
        .map((cell) => buildCell(cell && typeof cell === 'object' ? cell.value : cell, {
          bold: true,
          money: Boolean(cell && typeof cell === 'object' && cell.money),
        }))
        .join('');
      return `<Row ss:StyleID="total">${cells}</Row>`;
    })
    .join('');

  const titleRow = title
    ? `<Row ss:StyleID="title"><Cell ss:StyleID="bold"><Data ss:Type="String">${escapeXml(title)}</Data></Cell></Row>`
    : '';
  const subtitleRow = subtitle
    ? `<Row><Cell><Data ss:Type="String">${escapeXml(subtitle)}</Data></Cell></Row>`
    : '';
  const blankRow = '<Row/>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Bottom"/>
      <Font ss:FontName="Calibri" ss:Size="11"/>
    </Style>
    <Style ss:ID="bold">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
    </Style>
    <Style ss:ID="title">
      <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1"/>
    </Style>
    <Style ss:ID="money">
      <NumberFormat ss:Format="#,##0"/>
    </Style>
    <Style ss:ID="boldMoney">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
      <NumberFormat ss:Format="#,##0"/>
    </Style>
    <Style ss:ID="boldRight">
      <Alignment ss:Horizontal="Right"/>
    </Style>
    <Style ss:ID="total">
      <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
      <Borders><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="${escapeXml(sheetName)}">
    <Table>
      ${titleRow}
      ${subtitleRow}
      ${blankRow}
      <Row>${headerCells}</Row>
      ${bodyRows}
      ${blankRow}
      ${summaryRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

export function downloadSpreadsheet({ fileName, ...config }) {
  const xml = buildSpreadsheetXml(config);
  const blob = new Blob(['\uFEFF' + xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.xls') ? fileName : `${fileName}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function openPrintableReport({ title, subtitle, sections }) {
  const body = sections.map((section) => {
    const head = section.heading
      ? `<h2>${escapeHtml(section.heading)}</h2>`
      : '';
    const note = section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : '';

    const cards = section.cards?.length
      ? `<div class="cards">${section.cards.map((card) => `
          <div class="card${card.hero ? ' hero' : ''}">
            <span class="card-label">${escapeHtml(card.label)}</span>
            <span class="card-value">${escapeHtml(formatRupiah(card.value))}</span>
            ${card.caption ? `<span class="card-caption">${escapeHtml(card.caption)}</span>` : ''}
          </div>`).join('')}</div>`
      : '';

    let table = '';
    if (section.headers?.length) {
      const headCells = section.headers.map((h) => `<th class="${h.align === 'right' ? 'right' : ''}">${escapeHtml(h.label ?? h)}</th>`).join('');
      const bodyCells = (section.rows || []).map((row) => `<tr>${row.map((cell) => {
        if (cell && typeof cell === 'object') {
          const text = cell.money ? formatRupiah(cell.value) : escapeHtml(cell.value);
          return `<td class="${cell.align === 'right' ? 'right' : ''} ${cell.emphasis ? 'emphasis' : ''}">${text}</td>`;
        }
        return `<td class="${typeof cell === 'number' ? 'right' : ''}">${escapeHtml(cell)}</td>`;
      }).join('')}</tr>`).join('');
      const totalRow = section.total
        ? `<tr class="total"><td colspan="${section.total.length - 1}">Total</td><td class="right">${escapeHtml(section.total[section.total.length - 1])}</td></tr>`
        : '';
      table = `<table><thead><tr>${headCells}</tr></thead><tbody>${bodyCells || '<tr><td colspan="' + section.headers.length + '" class="empty">Tidak ada data</td></tr>'}${totalRow}</tbody></table>`;
    }

    return `<section>${head}${note}${cards}${table}</section>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 20px; color: #111; background: #fff; }
    .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 12px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 4px 0; font-size: 18px; }
    .header p { margin: 0; font-size: 12px; color: #555; }
    section { margin-bottom: 22px; }
    h2 { font-size: 14px; margin: 0 0 4px 0; }
    .note { font-size: 11px; color: #666; margin: 0 0 8px 0; }
    .cards { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
    .card { flex: 1 1 160px; border: 1px solid #ccc; border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 3px; }
    .card.hero { background: #f0f4f8; border-color: #999; }
    .card-label { font-size: 11px; color: #555; }
    .card-value { font-size: 15px; font-weight: bold; }
    .card-caption { font-size: 10px; color: #777; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
    th, td { border: 1px solid #ddd; padding: 5px 6px; text-align: left; }
    th { background: #f5f5f5; font-weight: bold; }
    td.right, th.right { text-align: right; }
    td.emphasis { font-weight: bold; }
    tr.total td { font-weight: bold; background: #f7f7f7; }
    td.empty { text-align: center; color: #888; padding: 14px; }
    .footer { margin-top: 18px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 10px; color: #777; text-align: center; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>LAPAK BERKAH BUNTULIA</h1>
    <p>${escapeHtml(title)}</p>
    <p>${escapeHtml(subtitle)}</p>
  </div>
  ${body}
  <div class="footer">
    <p>Dokumen ini dicetak otomatis oleh sistem Lapak Berkah Buntulia</p>
    <p>${new Date().toLocaleString('id-ID')}</p>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, '_blank', 'width=900,height=700');
  if (!printWindow) {
    URL.revokeObjectURL(url);
    return { ok: false, reason: 'popup' };
  }
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
      setTimeout(() => {
        printWindow.close();
        URL.revokeObjectURL(url);
      }, 300);
    }, 400);
  };
  return { ok: true };
}
