const SHEET_CONFIG = {
  'MONITORING ANGGARAN SKKI': { headerRow: 5, dataStartRow: 6 },
  'REKAP 1': { headerRow: 1, dataStartRow: 2 },
  'AI TERKONTRAK': { headerRow: 1, dataStartRow: 2 },
  'TERTAGIH': { headerRow: 1, dataStartRow: 2 },
  'TERBAYAR': { headerRow: 1, dataStartRow: 2 },
  'CHARTS': { headerRow: 1, dataStartRow: 2 },
  'DATA ANGGARAN (PIVOT)': { headerRow: 3, dataStartRow: 4 },
  'DASHBOARD MONITORING ANGGARAN S': { headerRow: 1, dataStartRow: 2 },
  'Sheet6': { headerRow: 1, dataStartRow: 2 },
  'Sheet10': { headerRow: 1, dataStartRow: 2 },
  'Sheet11': { headerRow: 1, dataStartRow: 2 },
  'Sheet12': { headerRow: 1, dataStartRow: 2 },
  'Sheet13': { headerRow: 1, dataStartRow: 2 },
  'Sheet14': { headerRow: 1, dataStartRow: 2 },
  'Sheet15': { headerRow: 1, dataStartRow: 2 },
  'Sheet16': { headerRow: 1, dataStartRow: 2 },
  'Sheet17': { headerRow: 1, dataStartRow: 2 },
  'Sheet18': { headerRow: 1, dataStartRow: 2 },
};

// Sheet snapshot per bulan memiliki susunan yang sama dengan Monitoring Data:
// judul di atas, header pada baris 5, dan data mulai baris 6.
const MONTHLY_SHEETS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN',
  'JUL', 'AGT', 'SEP', 'OKT', 'NOV', 'DES'
];

MONTHLY_SHEETS.forEach(function (sheetName) {
  SHEET_CONFIG[sheetName] = { headerRow: 5, dataStartRow: 6 };
});

const DEFAULT_SHEET = 'MONITORING ANGGARAN SKKI';

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action;

    if (action === 'list') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return jsonResponse({
        success: true,
        // Ambil langsung dari workbook supaya sheet baru juga otomatis muncul.
        sheets: ss.getSheets().map(function (sheet) {
          return sheet.getName();
        }),
      });
    }

    // Ambil seluruh snapshot bulan dalam satu request agar frontend tidak perlu
    // melakukan 12 request terpisah ke Apps Script.
    if (action === 'monthly') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const monthlyData = {};
      MONTHLY_SHEETS.forEach(function (sheetName) {
        if (!ss.getSheetByName(sheetName)) return;
        monthlyData[sheetName] = readSheetData(sheetName, 'json');
      });
      return jsonResponse({
        success: true,
        lastUpdated: new Date().toISOString(),
        data: monthlyData,
      });
    }

    if (action === 'progress') {
      return jsonResponse({
        success: true,
        lastUpdated: new Date().toISOString(),
        data: {
          terkontrak: readSheetData('AI TERKONTRAK', 'json'),
          tertagih: readSheetData('TERTAGIH', 'json'),
          terbayar: readSheetData('TERBAYAR', 'json'),
        },
      });
    }

    const sheetName = params.sheet || DEFAULT_SHEET;
    const format = params.format || 'json'; 

    const result = readSheetData(sheetName, format);

    return jsonResponse({
      success: true,
      sheet: sheetName,
      lastUpdated: new Date().toISOString(), 
      rowCount: result.length,
      data: result,
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      error: err.message,
    });
  }
}

function readSheetData(sheetName, format) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Sheet "' + sheetName + '" tidak ditemukan.');
  }

  // Konfigurasi eksplisit tetap menjadi prioritas. Untuk sheet baru yang belum
  // didaftarkan, coba temukan header tabel secara otomatis; jika tidak ketemu,
  // pertahankan perilaku lama (header baris 1, data mulai baris 2).
  const config = SHEET_CONFIG[sheetName] || detectSheetConfig(sheet);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < config.dataStartRow) {
    return []; 
  }

  const headerValues = sheet
    .getRange(config.headerRow, 1, 1, lastCol)
    .getValues()[0];

  const headers = headerValues.map(function (h, idx) {
    const name = (h === '' || h === null) ? 'col_' + (idx + 1) : String(h).trim();
    return name;
  });

  const numDataRows = lastRow - config.dataStartRow + 1;
  const values = sheet
    .getRange(config.dataStartRow, 1, numDataRows, lastCol)
    .getValues();

  if (format === 'array') {
    return values;
  }

  const result = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const isEmptyRow = row.every(function (cell) {
      return cell === '' || cell === null;
    });
    if (isEmptyRow) continue;

    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      let val = row[c];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      }
      obj[headers[c]] = val;
    }
    result.push(obj);
  }

  return result;
}

function detectSheetConfig(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return { headerRow: 1, dataStartRow: 2 };
  }

  const scanRows = Math.min(lastRow, 10);
  const values = sheet.getRange(1, 1, scanRows, lastCol).getDisplayValues();
  const expectedHeaders = [
    'no.', 'no', 'unit', 'no anggaran', 'pagu', 'pagu (rp.)',
    'ai terkontrak', 'ai terkontrak (rp.)', 'aki terkontrak',
    'tertagih', 'terbayar'
  ];

  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const normalized = values[rowIndex].map(function (value) {
      return String(value || '').trim().toLowerCase();
    });
    const matchCount = normalized.filter(function (value) {
      return expectedHeaders.indexOf(value) !== -1;
    }).length;

    // Minimal dua header dikenal agar judul biasa tidak salah dianggap header.
    if (matchCount >= 2) {
      const headerRow = rowIndex + 1;
      return { headerRow: headerRow, dataStartRow: headerRow + 1 };
    }
  }

  return { headerRow: 1, dataStartRow: 2 };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}
