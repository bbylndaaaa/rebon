

const CONFIG = {
  SHEET_ULP: ["CRB", "KTA", "KNG", "SBR", "CLD", "CLM"],
  SHEET_PENGUSAHAAN: "DATA PENGUSAHAAN",
  SHEET_PERSPEKTIF: "PER PERSPEKTIF",
  SHEET_SCOREBOARD: "scoreboard",
  SHEET_RANGE_BONUS: "Sheet2",
  SHEET_OUTLOOK: "outlook",
  SHEET_MOVEMENT: "movement",
  CACHE_TTL_SECONDS: 600,

  // --- Kolom pada sheet ULP (KTA/KNG/SBR/CLD/CLM/CRB), 1-indexed ---
  ULP_COL: {
    NO: 2, NAME: 3, SATUAN: 6, BOBOT: 7,
    TARGET_BULAN_INI: 9, REALISASI_BULAN_INI: 10, PCT: 11, NILAI: 12,
    KETERANGAN: 13, GAIN_LOSS: 15, PIC: 16,
    TARGET_2026_START: 17,      // 12 kolom: Jan..Dec
    REALISASI_2026_START: 30,   // 12 kolom
    PROSENTASE_2026_START: 43,  // 12 kolom
    REALISASI_2025_START: 69,
    REALISASI_2024_START: 82,
    REALISASI_2023_START: 95,
    REALISASI_2022_START: 108,
    REALISASI_2021_START: 121,
    REALISASI_2020_START: 134,
    REALISASI_2019_START: 147
  },
  // Baris 4-5 adalah header. Jumlah baris KPI tidak sama: CRB sampai ±196,
  // sedangkan setiap ULP sampai ±139. Batas akhir sengaja ditentukan dinamis.
  ULP_ROW_START: 6,
  ULP_PERIODE_CELL: "L3", // nilai dropdown periode aktual pada sheet ULP

  // --- DATA PENGUSAHAAN: blok bulanan 2026 (kolom D..O) ---
  // Mulai dari baris judul bagian agar setiap baris data mendapat nilai
  // `bagian` dan tidak habis tersaring di tabel ringkas frontend.
  PENGUSAHAAN_ROW_START: 4,
  PENGUSAHAAN_ROW_END: 270,
  PENGUSAHAAN_COL_LABEL: 2,
  PENGUSAHAAN_COL_SATUAN: 3,
  PENGUSAHAAN_MONTHLY_START: 4, // 12 kolom, Jan..Dec 2026
  // blok tahunan 2020-2026(Des), kolom U..AA (20..26)
  PENGUSAHAAN_YEARLY_START_COL: 20,
  PENGUSAHAAN_YEARLY_YEARS: ["2020", "2021", "2022", "2023", "2024", "2025", "2026"],

  // --- PER PERSPEKTIF ---
  PERSPEKTIF_PERIODE_CELL: "C1",
  PERSPEKTIF_STATUS_ROWS: { HIJAU: 5, KUNING: 6, MERAH: 7, HITAM: 8 },
  PERSPEKTIF_STATUS_COLS: { KTA: 4, KNG: 5, SBR: 6, CLD: 7, CLM: 8, CRB: 9 },
  // Cari otomatis baris "UNIT" untuk tabel ranking NKO (lihat findRankingTable_)

  // --- scoreboard (dropdown-driven) ---
  // Berdasarkan screenshot sheet 'scoreboard': dropdown Periode ada di baris 1
  // (merge B1:D1, isinya "JUNI"), dropdown Area/ULP ada di baris 3 (merge B3:D3,
  // isinya "CRB"). WAJIB DICEK ULANG: klik langsung sel dropdown-nya di Google
  // Sheet, lalu lihat "Name Box" di pojok kiri-atas (di samping fx) — itu alamat
  // sel yang sebenarnya (mis. "B1" atau "D1"), lalu isi di sini.
  SCOREBOARD_PERIODE_CELL: "B1", // isi dgn nama bulan, misal "JUNI"
  SCOREBOARD_AREA_CELL: "E1",    // nama legacy; sebenarnya dropdown mode REAL/PROGNOSA

  // --- outlook / movement (WAJIB diisi setelah inspectDropdownDrivenSheets_ dijalankan) ---
  // Jangan menebak alamat dropdown: isi dari Name Box sheet asli. Kolom tabel
  // dibaca otomatis dari header. Properti *_COL di bawah adalah usulan tempat
  // konfigurasi eksplisit bila frontend nantinya membutuhkan objek ter-normalisasi;
  // biarkan null sampai header/kolom sheet asli telah diverifikasi.
  OUTLOOK_PERIODE_CELL: "J1",
  OUTLOOK_TABLE_HEADER_ROW: 1,
  OUTLOOK_COL_INDIKATOR: null,
  OUTLOOK_COL_ULP: null,
  OUTLOOK_COL_TARGET: null,
  OUTLOOK_COL_REALISASI: null,
  MOVEMENT_PERIODE_CELL: ["F1", "P1"], // periode sisi ULP dan sisi UP3
  MOVEMENT_TABLE_HEADER_ROW: 1,
  MOVEMENT_COL_ULP: null,
  MOVEMENT_COL_NKO: null,
  MOVEMENT_COL_RANKING: null
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_ID_FULL = ["JANUARI","FEBRUARI","MARET","APRIL","MEI","JUNI","JULI","AGUSTUS","SEPTEMBER","OKTOBER","NOVEMBER","DESEMBER"];
const RANGE_INDICATORS = [
  "Pengendalian Penggunaan Anggaran Investasi sesuai RKAP",
  "Tindak Lanjut LBKB (Laporan Bulanan Kelainan Baca Meter)"
];
let rangeBonusLookupMemo_;

// Arah indikator (naik/turun) dibaca dari kolom D sheet ULP (⬆️/⬇️/🔛), dipakai
// FE (kpi.js) untuk menghitung ulang pencapaian saat filter bulan bukan snapshot asli.
// Endpoint ini mengirim arahnya sekali per indikator (diambil dari sheet CRB) supaya
// FE tidak perlu menebak.
function getIndicatorDirections_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("CRB");
  const out = {};
  if (!sh) return out;
  const values = sh.getRange(CONFIG.ULP_ROW_START, 3, sh.getLastRow() - CONFIG.ULP_ROW_START + 1, 3).getValues(); // C nama, D simbol, E kode arah
  values.forEach((row) => {
    const name = row[0];
    const arrow = row[1];
    if (!name) return;
    let dir = "up";
    const a = String(arrow || "");
    if (a.indexOf("⬇") >= 0) dir = "down";
    else if (a.indexOf("🔛") >= 0) dir = "range";
    const directionCode = Number(row[2]);
    const directionLabel = String(row[2] || "").trim();
    if (directionCode === 1) dir = "down";
    else if (directionCode === 2 || directionLabel === "><") dir = "range";
    else if (directionCode === 3) dir = "up";
    out[String(name).trim()] = dir;
  });
  return out;
}

function doGet(e) {
  // Kalau doGet dijalankan manual lewat tombol "Run" di editor Apps Script (bukan lewat
  // request web), Apps Script memanggil doGet() TANPA argumen sama sekali -> e = undefined
  // -> e.parameter meledak. Ini normal, bukan bug di logikanya. Guard di bawah supaya
  // tetap bisa di-"Run" manual untuk testing (defaultnya action=all).
  e = e || { parameter: {} };
  const action = String(e.parameter.action || "all").toLowerCase();
  let payload;
  try {
    if (action !== "health" && !validateAuthToken_(e.parameter.token)) {
      return jsonOutput_({ ok: false, error: "Unauthorized" });
    }
    validateRequest_(action, e.parameter);
    if (action === "all") payload = getAllData_();
    else if (action === "ulp") payload = getUlpData_();
    else if (action === "pengusahaan") payload = getPengusahaanData_();
    else if (action === "perspektif" || action === "overview") payload = getPerspektifData_(e.parameter.periode);
    else if (action === "scoreboard") payload = getScoreboard_(e.parameter.periode, e.parameter.area);
    else if (action === "outlook") payload = getOutlookData_(e.parameter.periode);
    else if (action === "movement") payload = getMovementData_(e.parameter.periode);
    else if (action === "health") payload = getHealth_();
    else payload = { error: "Unknown action" };
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    payload = { error: "Permintaan data tidak valid atau layanan sedang bermasalah." };
  }
  return jsonOutput_(payload);
}

function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(payload.action || "").toLowerCase();
    if (action === "login") return jsonOutput_(loginAdmin_(payload.identity, payload.password));
    if (action === "validate") return jsonOutput_(validateSessionResponse_(payload.token));
    if (action === "logout") return jsonOutput_(logoutAdmin_(payload.token));
    return jsonOutput_({ ok: false, error: "Permintaan tidak valid." });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return jsonOutput_({ ok: false, error: "Layanan autentikasi sedang bermasalah." });
  }
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function validateRequest_(action, params) {
  const actions = ["all", "ulp", "pengusahaan", "perspektif", "overview", "scoreboard", "outlook", "movement", "health"];
  if (actions.indexOf(action) < 0) throw new Error("Unknown action");
  const period = params.periode ? String(params.periode).toUpperCase() : "";
  if (period && MONTHS.indexOf(period) < 0 && MONTHS_ID_FULL.indexOf(period) < 0) throw new Error("Invalid period");
  const area = params.area ? String(params.area).toUpperCase() : "";
  if (area && ["REAL", "PROGNOSA"].indexOf(area) < 0) throw new Error("Invalid scoreboard mode");
}

function getHealth_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return { ok: true, sheets: ss.getSheets().map(function (sh) { return sh.getName(); }), generatedAt: new Date().toISOString() };
}

function getAllData_() {
  const ulp = getUlpData_();
  const availableMonths = getAvailableMonths_(ulp);
  const defaultMonth = availableMonths[availableMonths.length - 1] || MONTHS[0];
  // PENTING (perbaikan performa): cukup hitung perspektif untuk SATU periode
  // (default). Sebelumnya getPerspektifSeries_(availableMonths) menghitung semua
  // bulan berurutan (setValue dropdown + flush + baca sheet PER PERSPEKTIF utk
  // tiap bulan) sehingga request "action=all" bisa makan waktu >30 detik --
  // itulah kenapa dashboard terlihat "loading terus / data tidak muncul".
  // Bulan-bulan lain tetap tersedia: frontend mem-fetch on-demand lewat
  // action=perspektif&periode=XXX (sudah didukung refreshOverviewForPeriod).
  const perspektif = getPerspektifData_(defaultMonth) || emptyPerspektif_();
  const perspektifByPeriod = {};
  perspektifByPeriod[defaultMonth] = perspektif;
  return {
    meta: {
      ulpList: CONFIG.SHEET_ULP,
      months: MONTHS,
      monthsID: MONTHS_ID_FULL,
      availableMonths: availableMonths,
      ulpLabel: { CRB: "UP3 Cirebon", KTA: "ULP KTA", KNG: "ULP KNG", SBR: "ULP SBR", CLD: "ULP CLD", CLM: "ULP CLM" },
      years2019_2026: ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"],
      indicatorDirection: getIndicatorDirections_(),
      generatedAt: new Date().toISOString()
    },
    ulp: ulp,
    dataPengusahaan: getPengusahaanData_(),
    perspektif: perspektif,
    perspektifByPeriod: perspektifByPeriod
  };
}

function num_(v) {
  if (v === "" || v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  let text = String(v).trim().replace(/[%\s]/g, "");
  // Nilai string dari Spreadsheet Indonesia umumnya "1.234,56". Jika
  // hanya ada titik, titik dipertahankan karena bisa merupakan desimal.
  if (text.indexOf(",") >= 0) text = text.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(text);
  return isNaN(n) ? null : n;
}

function isRangeText_(v) {
  if (typeof v !== "string") return false;
  const text = v.trim();
  // Hanya terima bentuk "95-105" / "95 - 105%"; angka tunggal dan minus tidak ikut.
  return /^\s*\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*%?\s*$/.test(text);
}

function normalizeIndicatorName_(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isRangeIndicator_(name) {
  const normalized = normalizeIndicatorName_(name);
  return RANGE_INDICATORS.some(function (indicator) { return normalizeIndicatorName_(indicator) === normalized; });
}

function cacheKey_(prefix, parts) {
  return prefix + "_" + parts.map(function (part) {
    return String(part || "CURRENT").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  }).join("_");
}

function getCachedJson_(key) {
  const raw = CacheService.getScriptCache().get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}

function putCachedJson_(key, value) {
  // CacheService menerima string maksimal 100 KB. Jangan gagal hanya karena payload besar.
  const raw = JSON.stringify(value);
  if (raw.length <= 100000) CacheService.getScriptCache().put(key, raw, CONFIG.CACHE_TTL_SECONDS);
}

function getAvailableMonths_(ulp) {
  const crb = ulp.CRB || {};
  const indicators = (crb.indicators || []).filter(function (item) { return !item.isGroup && item.realisasi2026; });
  return MONTHS.filter(function (_, monthIndex) {
    return indicators.some(function (item) { return item.realisasi2026[monthIndex] !== null && item.realisasi2026[monthIndex] !== undefined; });
  });
}

// Sheet2 hanya dianggap lookup bonus bila memiliki header pencapaian dan skor/bonus
// pada dua kolom berbeda, lalu sedikitnya dua pasangan angka. Ini sengaja ketat agar
// daftar angka tanpa sumbu (mis. kode/bulan) tidak diinterpretasikan sebagai rumus.
function getRangeBonusLookup_() {
  if (rangeBonusLookupMemo_ !== undefined) return rangeBonusLookupMemo_;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_RANGE_BONUS);
  if (!sh) return rangeBonusLookupMemo_ = { valid: false, reason: "sheet not found" };
  const data = sh.getDataRange().getValues();
  let achievementCol = -1;
  let scoreCol = -1;
  let headerRow = -1;
  for (let r = 0; r < data.length && headerRow < 0; r++) {
    for (let c = 0; c < data[r].length; c++) {
      const header = String(data[r][c] || "").trim().toLowerCase();
      if (/(pencapaian|achievement|rentang|range|persen|%)/.test(header)) achievementCol = c;
      if (/(bonus|skor|score|nilai)/.test(header)) scoreCol = c;
    }
    if (achievementCol >= 0 && scoreCol >= 0 && achievementCol !== scoreCol) headerRow = r;
    else { achievementCol = -1; scoreCol = -1; }
  }
  if (headerRow < 0) {
    Logger.log("Sheet2 bukan lookup bonus tervalidasi: header pencapaian dan bonus/skor tidak ditemukan. Struktur: " + JSON.stringify(data.slice(0, 15)));
    return rangeBonusLookupMemo_ = { valid: false, reason: "missing paired lookup headers" };
  }
  const points = [];
  for (let r = headerRow + 1; r < data.length; r++) {
    const x = num_(data[r][achievementCol]);
    const y = num_(data[r][scoreCol]);
    if (x !== null && y !== null) points.push({ x: x, y: y });
  }
  points.sort(function (a, b) { return a.x - b.x; });
  if (points.length < 2) return rangeBonusLookupMemo_ = { valid: false, reason: "fewer than two numeric lookup pairs" };
  return rangeBonusLookupMemo_ = { valid: true, points: points };
}

function getRangeBonusScore_(pencapaianRentangPct) {
  const x = num_(pencapaianRentangPct);
  if (x === null) return null;
  const lookup = getRangeBonusLookup_();
  if (!lookup.valid) return null;
  const points = lookup.points;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].x) {
      const a = points[i - 1];
      const b = points[i];
      return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return null;
}

function rangeAchievementPct_(targetRange, realisasi) {
  if (!isRangeText_(targetRange)) return null;
  const values = String(targetRange).replace("%", "").split("-").map(num_);
  const actual = num_(realisasi);
  if (values.length !== 2 || values[0] === null || values[1] === null || actual === null) return null;
  const low = Math.min(values[0], values[1]);
  const high = Math.max(values[0], values[1]);
  if (actual >= low && actual <= high) return 100;
  // Di luar rentang, nilai dibandingkan ke batas terdekat; tepat pada batas = 100.
  return actual < low ? (low ? actual / low * 100 : null) : (actual ? high / actual * 100 : null);
}

function getUlpData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = {};
  CONFIG.SHEET_ULP.forEach((code) => {
    const sh = ss.getSheetByName(code);
    if (!sh) { out[code] = { code: code, indicators: [], error: "sheet not found" }; return; }
    const c = CONFIG.ULP_COL;
    // Jangan gunakan batas baris statis: struktur asli CRB dan ULP berbeda.
    // Kolom dibatasi hingga histori 2019 yang dipakai dashboard, agar respons
    // tetap ringan walaupun sheet memiliki blok prognosa tambahan di kanan.
    const lastCol = CONFIG.ULP_COL.REALISASI_2019_START + 11;
    const rowCount = Math.max(0, sh.getLastRow() - CONFIG.ULP_ROW_START + 1);
    const range = rowCount ? sh.getRange(CONFIG.ULP_ROW_START, 1, rowCount, lastCol).getValues() : [];
    const indicators = [];
    range.forEach((row, i) => {
      const r = CONFIG.ULP_ROW_START + i;
      const name = row[c.NAME - 1];
      if (!name) return;
      const satuan = row[c.SATUAN - 1];
      const isGroup = satuan === "" || satuan === null;
      const item = { row: r, no: row[c.NO - 1], name: String(name).trim(), satuan: isGroup ? null : String(satuan), isGroup: isGroup };
      if (!isGroup) {
        item.bobot = num_(row[c.BOBOT - 1]);
        item.targetBulanIni = num_(row[c.TARGET_BULAN_INI - 1]);
        item.realisasiBulanIni = num_(row[c.REALISASI_BULAN_INI - 1]);
        item.pencapaianPct = num_(row[c.PCT - 1]);
        item.nilai = num_(row[c.NILAI - 1]);
        item.keterangan = row[c.KETERANGAN - 1];
        item.gainLoss = row[c.GAIN_LOSS - 1];
        item.pic = row[c.PIC - 1];
        const blocks = {
          target2026: c.TARGET_2026_START, realisasi2026: c.REALISASI_2026_START, prosentase2026: c.PROSENTASE_2026_START,
          realisasi2025: c.REALISASI_2025_START, realisasi2024: c.REALISASI_2024_START, realisasi2023: c.REALISASI_2023_START,
          realisasi2022: c.REALISASI_2022_START, realisasi2021: c.REALISASI_2021_START, realisasi2020: c.REALISASI_2020_START,
          realisasi2019: c.REALISASI_2019_START
        };
        Object.keys(blocks).forEach((key) => {
          const start = blocks[key];
          const arr = [];
          for (let m = 0; m < 12; m++) arr.push(num_(row[start - 1 + m]));
          if (arr.some((v) => v !== null)) item[key] = arr;
        });
        const targetRange = row[c.TARGET_BULAN_INI - 1];
        const target2026Range = [];
        for (let m = 0; m < 12; m++) {
          const rawTarget = row[c.TARGET_2026_START - 1 + m];
          target2026Range.push(isRangeText_(rawTarget) ? String(rawTarget).trim() : null);
        }
        if (isRangeText_(targetRange)) item.targetBulanIniRange = String(targetRange).trim();
        if (target2026Range.some(function (v) { return v !== null; })) item.target2026Range = target2026Range;
        if (isRangeIndicator_(item.name)) {
          const bonus = [];
          for (let m = 0; m < 12; m++) {
            const achievement = rangeAchievementPct_(target2026Range[m], row[c.REALISASI_2026_START - 1 + m]);
            bonus.push(getRangeBonusScore_(achievement));
          }
          item.pencapaianRangeBonus = bonus;
        }
      }
      indicators.push(item);
    });
    out[code] = { code: code, label: code, periodeLabel: sh.getRange(CONFIG.ULP_PERIODE_CELL).getValue(), indicators: indicators };
  });
  return out;
}

function getPengusahaanData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_PENGUSAHAAN);
  if (!sh) return [];
  const rows = sh.getRange(CONFIG.PENGUSAHAAN_ROW_START, 1, CONFIG.PENGUSAHAAN_ROW_END - CONFIG.PENGUSAHAAN_ROW_START + 1, 30).getValues();
  const out = [];
  let bagian = null;
  let unit = "UP3 Cirebon";
  let tahun = "2026";
  rows.forEach((row, i) => {
    const sourceRow = CONFIG.PENGUSAHAAN_ROW_START + i;
    const marker = row[0];
    const label = row[CONFIG.PENGUSAHAAN_COL_LABEL - 1];
    const satuan = row[CONFIG.PENGUSAHAAN_COL_SATUAN - 1];
    // Blok ULP ditandai oleh nama unit di kolom A, kemudian tahun pada
    // baris berikutnya. Simpan konteks tersebut pada setiap baris data.
    if (typeof marker === "string" && /^ULP\s+/i.test(marker.trim()) && !label) {
      unit = marker.trim();
      bagian = "DATA PENGUSAHAAN ULP";
      return;
    }
    if (typeof marker === "number" && marker >= 2000 && marker <= 2100 && !label) {
      tahun = String(marker);
      return;
    }
    if (!label) return;
    if (String(label).trim().toUpperCase() === "KOMPONEN") return;
    if (!satuan && !row[CONFIG.PENGUSAHAAN_MONTHLY_START - 1]) { bagian = String(label).trim(); return; }
    const monthly2026 = [];
    for (let m = 0; m < 12; m++) monthly2026.push(num_(row[CONFIG.PENGUSAHAAN_MONTHLY_START - 1 + m]));
    const yearly = {};
    CONFIG.PENGUSAHAAN_YEARLY_YEARS.forEach((yr, idx) => {
      yearly[yr] = num_(row[CONFIG.PENGUSAHAAN_YEARLY_START_COL - 1 + idx]);
    });
    out.push({ sourceSheet: CONFIG.SHEET_PENGUSAHAAN, sourceRow: sourceRow, unit: unit, bagian: bagian, tahun: tahun, label: String(label).trim(), satuan: satuan ? String(satuan) : null, monthly2026: monthly2026, yearly: yearly });
  });
  return out;
}

function emptyPerspektif_() {
  return { periodeLabel: null, statusCount: {}, ranking: [] };
}

// Sheet PER PERSPEKTIF bersifat dropdown-driven. Penguncian memastikan dua
// request pengguna tidak saling menimpa periode ketika formula sedang dihitung.
function getPerspektifData_(periodeParam) {
  const cacheKey = cacheKey_("perspektif", [periodeParam]);
  const cached = getCachedJson_(cacheKey);
  if (cached) return cached;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CONFIG.SHEET_PERSPEKTIF);
    if (!sh) return emptyPerspektif_();

    // PERFORMA: set dropdown periode HANYA kalau nilainya berbeda dari yang
    // diminta. SpreadsheetApp.flush() memaksa SELURUH workbook menghitung ulang
    // semua formula (makan beberapa detik), jadi hindari kalau periode sudah
    // cocok -- cukup baca langsung. (Tanpa periodeParam tidak ada mutasi sama
    // sekali, jadi flush() tidak perlu dijalankan.)
    if (periodeParam &&
        String(sh.getRange(CONFIG.PERSPEKTIF_PERIODE_CELL).getValue() || "").trim().toUpperCase() !==
        String(periodeParam).toUpperCase()) {
      setPerspektifPeriod_(sh, periodeParam);
      SpreadsheetApp.flush();
    }

    const periodeLabel = sh.getRange(CONFIG.PERSPEKTIF_PERIODE_CELL).getDisplayValue();
    // PERFORMA: baca blok HIJAU..HITAM x KTA..CRB SEKALIGUS dalam satu
    // getRange().getValues() (1 round-trip ke Spreadsheet) -- sebelumnya tiap
    // sel dibaca dengan getRange().getValue() sendiri-sendiri (30 round-trip).
    const rowStart = Math.min.apply(null, Object.values(CONFIG.PERSPEKTIF_STATUS_ROWS));
    const rowEnd = Math.max.apply(null, Object.values(CONFIG.PERSPEKTIF_STATUS_ROWS));
    const colStart = Math.min.apply(null, Object.values(CONFIG.PERSPEKTIF_STATUS_COLS));
    const colEnd = Math.max.apply(null, Object.values(CONFIG.PERSPEKTIF_STATUS_COLS));
    const block = sh.getRange(rowStart, colStart, rowEnd - rowStart + 1, colEnd - colStart + 1).getValues();
    const statusCount = {};
    Object.keys(CONFIG.PERSPEKTIF_STATUS_ROWS).forEach((label) => {
      const rIdx = CONFIG.PERSPEKTIF_STATUS_ROWS[label] - rowStart;
      statusCount[label] = {};
      Object.keys(CONFIG.PERSPEKTIF_STATUS_COLS).forEach((ulp) => {
        const cIdx = CONFIG.PERSPEKTIF_STATUS_COLS[ulp] - colStart;
        statusCount[label][ulp] = num_(block[rIdx][cIdx]) || 0;
      });
    });
    const result = { periodeLabel: periodeLabel, statusCount: statusCount, ranking: findRankingTable_(sh) };
    putCachedJson_(cacheKey, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function setPerspektifPeriod_(sh, periodeParam) {
  const index = MONTHS.indexOf(String(periodeParam).toUpperCase());
  const value = index >= 0 ? MONTHS_ID_FULL[index] : periodeParam;
  sh.getRange(CONFIG.PERSPEKTIF_PERIODE_CELL).setValue(value);
}

function getPerspektifSeries_(months) {
  const out = {};
  (months || []).forEach(function (month) { out[month] = getPerspektifData_(month); });
  return out;
}

/* legacy implementation retained below for reference */
function getPerspektifDataLegacy_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_PERSPEKTIF);
  if (!sh) return { periodeLabel: null, statusCount: {}, ranking: [] };

  const periodeLabel = sh.getRange(CONFIG.PERSPEKTIF_PERIODE_CELL).getValue();
  const statusCount = {};
  Object.keys(CONFIG.PERSPEKTIF_STATUS_ROWS).forEach((label) => {
    const r = CONFIG.PERSPEKTIF_STATUS_ROWS[label];
    statusCount[label] = {};
    Object.keys(CONFIG.PERSPEKTIF_STATUS_COLS).forEach((ulp) => {
      const cIdx = CONFIG.PERSPEKTIF_STATUS_COLS[ulp];
      statusCount[label][ulp] = num_(sh.getRange(r, cIdx).getValue());
    });
  });

  const ranking = findRankingTable_(sh);
  return { periodeLabel: periodeLabel, statusCount: statusCount, ranking: ranking };
}

// Cari tabel "UNIT | NKO | RANKING" di sheet PER PERSPEKTIF (posisinya bisa geser
// tergantung jumlah indikator, jadi dicari otomatis per baris). Pada sheet asli,
// kolom NKO tidak selalu ada dan nilai RANKING sering #DIV/0! (formula rusak),
// sehingga NKO diisi dari baris "TOTAL BOBOT" (format sel "NKO / Gain-Loss").
function findRankingTable_(sh) {
  const data = sh.getDataRange().getValues();
  for (let r = 0; r < data.length; r++) {
    const unitColumn = data[r].findIndex(function (value) { return String(value).trim().toUpperCase() === "UNIT"; });
    if (unitColumn < 0) continue;
    const rankingColumn = data[r].findIndex(function (value) { return /^RANKING$/.test(String(value).trim().toUpperCase().replace(/\s+/g, "")); });
    if (rankingColumn < 0) continue;
    const out = [];
    for (let rr = r + 1; rr < data.length; rr++) {
      const unit = data[rr][unitColumn];
      if (!unit) break;
      out.push({ unit: String(unit).trim(), nko: null, ranking: num_(data[rr][rankingColumn]) });
    }
    // Fallback NKO dari baris "TOTAL BOBOT" tepat di bawah tabel ranking
    // (nilai sel format "100,39 / 3,38" = NKO / Gain-Loss per ULP).
    for (let rr = r + 1; rr < data.length; rr++) {
      if (String(data[rr][1] || "").trim().toUpperCase() !== "TOTAL BOBOT") continue;
      const colByUnit = {};
      Object.keys(CONFIG.PERSPEKTIF_STATUS_COLS).forEach(function (ulp) {
        colByUnit[ulp] = CONFIG.PERSPEKTIF_STATUS_COLS[ulp] - 1; // 1-indexed -> array index
      });
      out.forEach(function (item) {
        const col = colByUnit[item.unit];
        if (col === undefined) return;
        const raw = String(data[rr][col] || "");
        const nko = num_(raw.split("/")[0].trim());
        if (nko !== null) item.nko = nko;
      });
      break;
    }
    return out;
  }
  return [];
}

// Endpoint live untuk sheet 'scoreboard' yang digerakkan dropdown Periode & Area.
// PERINGATAN: ini MENGUBAH sel dropdown pada Spreadsheet (bukan hanya baca) supaya
// formula-formula di sheet lain ikut recalculate sesuai filter yang diminta dashboard.
// Pastikan tidak ada proses lain yang sedang mengedit sheet yang sama saat dipanggil.
//
// CATATAN LAYOUT (berdasarkan screenshot sheet 'scoreboard'):
// Sheet ini TIDAK berbentuk 1 baris = 1 indikator. Tiap indikator memakai BLOK 5 baris
// berurutan di kolom A (nama indikator diulang 5x), dengan label di kolom B: "T", "R",
// "%", "Gain/", "Loss", dan nilainya di kolom D. Kolom E biasanya berisi NILAI (skor)
// pada baris berlabel "T". Fungsi di bawah membaca per-blok (bukan per-baris tunggal)
// supaya tidak bergantung pada nomor kolom yang kaku.
function getScoreboard_(periodeParam, areaParam) {
  const cacheKey = cacheKey_("scoreboard", [periodeParam, areaParam]);
  const cached = getCachedJson_(cacheKey);
  if (cached) return cached;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_SCOREBOARD);
  if (!sh) return { error: "sheet scoreboard not found" };

  if (periodeParam) {
    const idx = MONTHS.indexOf(String(periodeParam).toUpperCase());
    const label = idx >= 0 ? MONTHS_ID_FULL[idx] : periodeParam;
    sh.getRange(CONFIG.SCOREBOARD_PERIODE_CELL).setValue(label);
  }
  if (areaParam) {
    sh.getRange(CONFIG.SCOREBOARD_AREA_CELL).setValue(areaParam);
  }
  SpreadsheetApp.flush(); // paksa recalculation sebelum dibaca

  const values = sh.getDataRange().getValues(); // 0-indexed: values[r][0] = kolom A, dst.
  const rows = [];
  let current = null;

  for (let r = 0; r < values.length; r++) {
    const name = values[r][0]; // kolom A
    const label = String(values[r][1] || "").trim().toUpperCase().replace(/[:\s]/g, ""); // kolom B: T/R/%/GAIN/LOSS
    const valD = values[r][3]; // kolom D
    const valE = values[r][4]; // kolom E

    if (!name) continue;
    const nm = String(name).trim();

    if (!current || current.indikator !== nm) {
      if (current) rows.push(current);
      current = { indikator: nm, target: null, realisasi: null, pencapaian: null, nilai: null, gain: null, loss: null };
    }

    if (label === "T") { current.target = num_(valD); if (valE !== "" && valE !== null) current.nilai = num_(valE); }
    else if (label === "R") current.realisasi = num_(valD);
    else if (label === "%") current.pencapaian = num_(valD); // bisa null kalau format sel jadi "######" (kolom kesempitan, bukan error data)
    else if (label === "GAIN") current.gain = num_(valD);
    else if (label === "LOSS") current.loss = num_(valD);
  }
  if (current) rows.push(current);

  const result = {
    periode: sh.getRange(CONFIG.SCOREBOARD_PERIODE_CELL).getValue(),
    area: sh.getRange(CONFIG.SCOREBOARD_AREA_CELL).getValue(),
    rows: rows
  };
  putCachedJson_(cacheKey, result);
  return result;
  } finally {
    lock.releaseLock();
  }
}

// Endpoint generik untuk dua sheet dropdown-driven yang layoutnya belum dapat
// diverifikasi dari file Code.gs. Setelah cell periode di CONFIG diisi, semua
// header dan data dikembalikan apa adanya agar frontend dapat memetakan kolomnya.
function getDropdownDrivenTableData_(sheetName, periodeCell, periodeParam, cachePrefix) {
  const cacheKey = cacheKey_(cachePrefix, [periodeParam]);
  const cached = getCachedJson_(cacheKey);
  if (cached) return cached;
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sh) return { error: "sheet " + sheetName + " not found" };
    if (periodeParam && !periodeCell) {
      return { error: "CONFIG " + cachePrefix.toUpperCase() + "_PERIODE_CELL belum diisi; jalankan inspectDropdownDrivenSheets_() dahulu." };
    }
    if (periodeParam) {
      const idx = MONTHS.indexOf(String(periodeParam).toUpperCase());
      const periodCells = Array.isArray(periodeCell) ? periodeCell : [periodeCell];
      periodCells.forEach(function (cell) { sh.getRange(cell).setValue(idx >= 0 ? MONTHS_ID_FULL[idx] : periodeParam); });
    }
    SpreadsheetApp.flush();
    const values = sh.getDataRange().getValues();
    const result = {
      periode: periodeCell ? sh.getRange(Array.isArray(periodeCell) ? periodeCell[0] : periodeCell).getDisplayValue() : null,
      headers: values.length ? values[0] : [],
      rows: values.length > 1 ? values.slice(1) : []
    };
    putCachedJson_(cacheKey, result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function getOutlookData_(periodeParam) {
  return getDropdownDrivenTableData_(CONFIG.SHEET_OUTLOOK, CONFIG.OUTLOOK_PERIODE_CELL, periodeParam, "outlook");
}

function getMovementData_(periodeParam) {
  return getDropdownDrivenTableData_(CONFIG.SHEET_MOVEMENT, CONFIG.MOVEMENT_PERIODE_CELL, periodeParam, "movement");
}

function describeConfiguredCell_(ss, sheetName, address, expected) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) { Logger.log("WARNING: sheet tidak ditemukan: " + sheetName); return; }
  if (!address) { Logger.log("WARNING: alamat CONFIG belum diisi untuk " + sheetName); return; }
  const addresses = Array.isArray(address) ? address : [address];
  addresses.forEach(function (cellAddress) {
  const range = sh.getRange(cellAddress);
  const merged = range.getMergedRanges();
  const value = range.getDisplayValue();
  Logger.log(sheetName + "!" + cellAddress + " = '" + value + "'; merge=" + (merged.length ? merged.map(function (r) { return r.getA1Notation(); }).join(",") : "tidak"));
  if (value === "") Logger.log("WARNING: " + sheetName + "!" + cellAddress + " kosong.");
  if (expected === "month" && value !== "" && !/[A-Za-z]/.test(value)) Logger.log("WARNING: " + sheetName + "!" + address + " seharusnya nama bulan, tetapi tampak numerik.");
  });
}

// Jalankan manual di Apps Script editor untuk memverifikasi semua cell dropdown.
function validateCellConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  describeConfiguredCell_(ss, CONFIG.SHEET_SCOREBOARD, CONFIG.SCOREBOARD_PERIODE_CELL, "month");
  describeConfiguredCell_(ss, CONFIG.SHEET_SCOREBOARD, CONFIG.SCOREBOARD_AREA_CELL, "area");
  describeConfiguredCell_(ss, CONFIG.SHEET_PERSPEKTIF, CONFIG.PERSPEKTIF_PERIODE_CELL, "month");
  CONFIG.SHEET_ULP.forEach(function (sheetName) { describeConfiguredCell_(ss, sheetName, CONFIG.ULP_PERIODE_CELL, "month"); });
  describeConfiguredCell_(ss, CONFIG.SHEET_OUTLOOK, CONFIG.OUTLOOK_PERIODE_CELL, "month");
  describeConfiguredCell_(ss, CONFIG.SHEET_MOVEMENT, CONFIG.MOVEMENT_PERIODE_CELL, "month");
}

// Log struktur asli outlook/movement (maks. 25 baris) sebelum mengisi CONFIG.
function inspectDropdownDrivenSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [CONFIG.SHEET_OUTLOOK, CONFIG.SHEET_MOVEMENT, CONFIG.SHEET_RANGE_BONUS].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    Logger.log(name + ": " + (sh ? JSON.stringify(sh.getDataRange().getValues().slice(0, 25)) : "sheet tidak ditemukan"));
  });
}

// --- Helper untuk testing manual di editor Apps Script (tombol "Run") ---
// doGet(e) butuh objek request asli yang cuma ada kalau dipanggil lewat URL web.
// Pakai fungsi-fungsi di bawah ini untuk tes langsung dari editor tanpa deploy dulu.
function testDoGet_All() {
  const res = doGet({ parameter: { action: "all" } });
  Logger.log(res.getContent());
}
function testDoGet_Scoreboard() {
  const res = doGet({ parameter: { action: "scoreboard", periode: "JUN", area: "REAL" } });
  Logger.log(res.getContent());
}
function testDoGet_Perspektif() {
  const res = doGet({ parameter: { action: "perspektif" } });
  Logger.log(res.getContent());
}
function testDoGet_Outlook() {
  const res = doGet({ parameter: { action: "outlook", periode: "JUN" } });
  Logger.log(res.getContent());
}
function testDoGet_Movement() {
  const res = doGet({ parameter: { action: "movement", periode: "JUN" } });
  Logger.log(res.getContent());
}
function testDoGet_ValidateConfig() {
  validateCellConfig_();
}

/* ========================================================================== 
 * AUTENTIKASI ADMIN
 * Credential disimpan di Script Properties, bukan di source code/Google Sheet.
 * ========================================================================== */

const AUTH_SESSION_SECONDS = 21600; // 6 jam; batas maksimum Script Cache
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_ATTEMPT_WINDOW_SECONDS = 900;

function loginAdmin_(identity, password) {
  identity = String(identity || "").trim().toLowerCase();
  password = String(password || "");
  if (!identity || identity.length > 120 || !password || password.length > 256) {
    return { ok: false, error: "Username/email atau password tidak sesuai." };
  }

  const props = PropertiesService.getScriptProperties();
  const attemptKey = "auth_attempt:" + digestText_(identity);
  const cache = CacheService.getScriptCache();
  const attempts = Number(cache.get(attemptKey) || 0);
  if (attempts >= AUTH_MAX_ATTEMPTS) {
    return { ok: false, error: "Terlalu banyak percobaan. Silakan coba lagi beberapa menit." };
  }

  const configuredIdentity = String(props.getProperty("ADMIN_USERNAME") || "").trim().toLowerCase();
  const salt = props.getProperty("ADMIN_PASSWORD_SALT") || "";
  const storedHash = props.getProperty("ADMIN_PASSWORD_HASH") || "";
  const valid = configuredIdentity && salt && storedHash &&
    constantTimeEqual_(configuredIdentity, identity) &&
    constantTimeEqual_(storedHash, hashPassword_(password, salt));

  if (!valid) {
    cache.put(attemptKey, String(attempts + 1), AUTH_ATTEMPT_WINDOW_SECONDS);
    return { ok: false, error: "Username/email atau password tidak sesuai." };
  }

  cache.remove(attemptKey);
  const token = Utilities.getUuid() + Utilities.getUuid();
  const expiresAt = Date.now() + AUTH_SESSION_SECONDS * 1000;
  const session = {
    name: props.getProperty("ADMIN_DISPLAY_NAME") || "Admin",
    role: "Admin",
    expiresAt: expiresAt
  };
  // CacheService bersifat best-effort dan entri dapat hilang sebelum masa
  // berlakunya habis. Sesi autentikasi harus persisten antar-eksekusi Web App,
  // jadi simpan di Script Properties.
  props.setProperty(sessionCacheKey_(token), JSON.stringify(session));
  return {
    ok: true,
    token: token,
    expiresAt: new Date(expiresAt).toISOString(),
    user: { name: session.name, role: session.role }
  };
}

function validateSessionResponse_(token) {
  const session = getAuthSession_(token);
  if (!session) return { ok: false, error: "Sesi tidak valid atau sudah berakhir." };
  return { ok: true, user: { name: session.name, role: session.role }, expiresAt: new Date(session.expiresAt).toISOString() };
}

function validateAuthToken_(token) {
  return !!getAuthSession_(token);
}

function getAuthSession_(token) {
  token = String(token || "");
  if (token.length < 40 || token.length > 160) return null;
  const props = PropertiesService.getScriptProperties();
  const key = sessionCacheKey_(token);
  const raw = props.getProperty(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.expiresAt || Date.now() >= Number(session.expiresAt)) {
      props.deleteProperty(key);
      return null;
    }
    return session;
  } catch (err) {
    props.deleteProperty(key);
    return null;
  }
}

function logoutAdmin_(token) {
  token = String(token || "");
  if (token) PropertiesService.getScriptProperties().deleteProperty(sessionCacheKey_(token));
  return { ok: true };
}

function sessionCacheKey_(token) {
  const secret = PropertiesService.getScriptProperties().getProperty("AUTH_TOKEN_SECRET") || "";
  return "auth_session:" + digestText_(secret + "\u0000" + String(token || ""));
}

function hashPassword_(password, salt) {
  let digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt) + "\u0000" + String(password),
    Utilities.Charset.UTF_8
  );
  for (let i = 0; i < 799; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest);
  }
  return Utilities.base64EncodeWebSafe(digest);
}

function digestText_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  )).replace(/=+$/, "");
}

function constantTimeEqual_(left, right) {
  left = String(left || "");
  right = String(right || "");
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) mismatch |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return mismatch === 0;
}

// SETUP SEKALI:
// 1) Isi ADMIN_USERNAME, ADMIN_INITIAL_PASSWORD, dan ADMIN_DISPLAY_NAME di
//    Project Settings > Script Properties.
// 2) Jalankan fungsi ini sekali dari editor Apps Script.
// 3) Password awal otomatis dihapus dan hanya hash+salt yang dipertahankan.
function setupAdminFromProperties() {
  const props = PropertiesService.getScriptProperties();
  const username = String(props.getProperty("ADMIN_USERNAME") || "").trim().toLowerCase();
  const initialPassword = props.getProperty("ADMIN_INITIAL_PASSWORD") || "";
  if (!username || !initialPassword) throw new Error("Isi ADMIN_USERNAME dan ADMIN_INITIAL_PASSWORD di Script Properties terlebih dahulu.");
  if (initialPassword.length < 10) throw new Error("Password Admin minimal 10 karakter.");

  const salt = Utilities.getUuid() + Utilities.getUuid();
  props.setProperties({
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD_SALT: salt,
    ADMIN_PASSWORD_HASH: hashPassword_(initialPassword, salt),
    AUTH_TOKEN_SECRET: props.getProperty("AUTH_TOKEN_SECRET") || Utilities.getUuid() + Utilities.getUuid()
  }, false);
  props.deleteProperty("ADMIN_INITIAL_PASSWORD");
  Logger.log("Akun Admin berhasil disiapkan. ADMIN_INITIAL_PASSWORD telah dihapus.");
}
