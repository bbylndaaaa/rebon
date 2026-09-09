const API_URL = "https://script.google.com/macros/s/AKfycbx6Rq5IJEWOS1EQ05710xeG6ye2Kj7r2_DZ2rbAsqjH2B8BOP0yMXwA_Vgq17Fpl_Vi/exec";

const HIST_API_URLS = {
  "2022": "https://script.google.com/macros/s/AKfycbz5jJUHprjhNkEfMWRxLZI3OXFbND8NchoNGQkJpCBipToaRA1oAKGxJmZyWB4preZo/exec",
  "2023": "https://script.google.com/macros/s/AKfycbys-oSkXXuDGuVrsG4i97oZ7P30cqSVY-v2AoE-XcngZuJo9_jziZS2tN7E6MppKSjTsQ/exec",
  "2024": "https://script.google.com/macros/s/AKfycbzeprMlLPrXhBX-zBIzLw069972Omnms0cZ5UqlZof_QweWffyQ1it7joo15uM0PME/exec" ,
  "2025": "https://script.google.com/macros/s/AKfycbxsGhyLihrw022ZN4Hv1aDtZ07ABhxGmIdT9yYCHVEkhS-1FFJTV4GZcWgBZgCI3xDB/exec"
};

const COLUMN_MAP = {
  "no.": "no",
  "no": "no",
  "unit": "unit",
  "no anggaran": "noAnggaran",
  "uraian anggaran": "uraianAnggaran",
  "prk/pos": "prkPos",
  "uraian prk/pos": "uraianPrkPos",
  "pagu (rp.)": "pagu",
  "pagu": "pagu",
  "disburse (rp.)": "disburse",
  "disburse": "disburse",
  "usulan (rp.)": "usulan",
  "usulan": "usulan",
  "ai terkontrak (rp.)": "aiTerkontrak",
  "ai terkontrak": "aiTerkontrak",
  "aki terkontrak (rp.)": "akiTerkontrak",
  "aki terkontrak": "akiTerkontrak",
  "tertagih (rp.)": "tertagih",
  "tertagih": "tertagih",
  "terbayar (rp.)": "terbayar",
  "terbayar": "terbayar",
  "pagu tersedia (rp.)": "paguTersedia",
  "pagu tersedia": "paguTersedia",
  "disburse tersedia (rp.)": "disburseTersedia",
  "disburse tersedia": "disburseTersedia",
  "tahun": "tahun",
  "bulan": "bulan",
  "status": "status",
  "kategori": "kategori",
  "jenis anggaran": "kategori",
  "jenis": "kategori",
  "kategori anggaran": "kategori",
  "tipe anggaran": "kategori"
};

const NUMERIC_KEYS = [
  "no", "pagu", "disburse", "usulan", "aiTerkontrak", "akiTerkontrak",
  "tertagih", "terbayar", "paguTersedia", "disburseTersedia"
];

const PROGRESS_SHEET_NAMES = {
  terkontrak: "AI TERKONTRAK",
  tertagih: "TERTAGIH",
  terbayar: "TERBAYAR"
};

const MAIN_SHEET_NAME = "MONITORING ANGGARAN SKKI";
// Tahun mengikuti sumber tabel anggaran, bukan tahun program pada uraian.
// Jadi pekerjaan lanjutan program 2025 yang berada di tabel utama 2026
// tetap termasuk Data Berjalan 2026.
const MAIN_DATA_YEAR = "2026";

// Snapshot bulanan untuk grafik penyerapan. Setiap sheet diharapkan memiliki
// header "AI Terkontrak" dan "Terbayar" seperti Monitoring Data. Jika nama
// sheet yang dibuat berbeda, cukup ubah nilai di konfigurasi ini.
const MONTHLY_PROGRESS_SHEETS = [
  { key: "JAN", name: "JAN" },
  { key: "FEB", name: "FEB" },
  { key: "MAR", name: "MAR" },
  { key: "APR", name: "APR" },
  { key: "MAY", name: "MEI" },
  { key: "JUN", name: "JUN" },
  { key: "JUL", name: "JUL" },
  { key: "AUG", name: "AGT" },
  { key: "SEP", name: "SEP" },
  { key: "OCT", name: "OKT" },
  { key: "NOV", name: "NOV" },
  { key: "DEC", name: "DES" }
];

// Google Apps Script Web App sering butuh "cold start" (terutama kalau baru
// dibuka lagi setelah idle), yang bisa memakan waktu lebih dari 15 detik.
// Timeout dinaikkan ke 30 detik supaya request pertama tidak keburu di-abort
// selagi Apps Script masih "bangun", dan ditambah 1x retry otomatis jika
// percobaan pertama timeout/gagal.
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRY_COUNT = 1;

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS, retriesLeft = FETCH_RETRY_COUNT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error) {
    if (retriesLeft > 0) {
      console.warn(`[api.js] Percobaan gagal (${error.message || error}), mencoba ulang: ${url}`);
      return fetchWithTimeout(url, timeoutMs, retriesLeft - 1);
    }
    if (error.name === "AbortError") {
      throw new Error(`Timeout > ${timeoutMs / 1000}s saat mengambil ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return isFinite(value) ? value : 0;

  const raw = String(value).trim();
  if (raw === "") return 0;

  const str = raw.replace(/[^0-9,.-]/g, "");
  const hasComma = str.includes(",");
  const hasDot = str.includes(".");

  let normalized;
  if (hasComma && hasDot) {
    // Pemisah desimal = simbol yang muncul PALING TERAKHIR di string.
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      normalized = str.replace(/\./g, "").replace(",", "."); // gaya ID: "1.234.567,89"
    } else {
      normalized = str.replace(/,/g, ""); // gaya US: "1,234,567.89"
    }
  } else if (hasComma) {
    // Cuma koma. Kalau tiap grup setelah koma persis 3 digit → itu ribuan (umum utk Rupiah tanpa desimal).
    const parts = str.split(",");
    const looksLikeThousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    normalized = looksLikeThousands ? parts.join("") : str.replace(",", ".");
  } else if (hasDot) {
    normalized = str.replace(/\.(?=\d{3}(?:\D|$))/g, ""); // hapus titik ribuan gaya ID
  } else {
    normalized = str;
  }

  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

function normalizeRow(rawRow) {
  const result = {};

  Object.keys(rawRow).forEach((rawKey) => {
    const key = String(rawKey).trim().toLowerCase();
    const mappedKey = COLUMN_MAP[key] || toCamelCase(rawKey);
    let value = rawRow[rawKey];

    if (NUMERIC_KEYS.includes(mappedKey)) {
      value = parseNumber(value);
    } else if (typeof value === "string") {
      value = value.trim();
    }

    result[mappedKey] = value;
  });

  return enrichRow(result);
}

function toCamelCase(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
}

function enrichRow(row) {
  
  if (row.kategori) {
    const kat = String(row.kategori).trim().toLowerCase();
    if (kat.indexOf("lanjut") !== -1) row.kategori = "Lanjutan";
    else if (kat.indexOf("murni") !== -1) row.kategori = "Murni";
    else row.kategori = String(row.kategori).trim();
  } else {
    const teks = `${row.uraianAnggaran || ""} ${row.uraianPrkPos || ""} ${row.prkPos || ""} ${row.noAnggaran || ""}`.toLowerCase();
    if (teks.indexOf("lanjutan") !== -1) row.kategori = "Lanjutan";
    else if (teks.indexOf("murni") !== -1) row.kategori = "Murni";
    // Jangan mengarang kategori. Jika sumber tidak menyebut Murni/Lanjutan,
    // tampilkan sebagai tidak diketahui agar masalah datanya bisa diperiksa.
    else row.kategori = "Tidak Diketahui";
  }

 
  if (!row.tahun) {
    const teksUraian = `${row.uraianAnggaran || ""} ${row.uraianPrkPos || ""}`;
    const matchTahunKeyword = teksUraian.match(/tahun\s*(20\d{2})/i);
    const matchPrkPrefix = String(row.prkPos || "").match(/^(20\d{2})\./);
    const sourceLain = `${row.uraianAnggaran || ""} ${row.prkPos || ""} ${row.noAnggaran || ""}`;
    const matchGeneric = sourceLain.match(/20\d{2}/);

    if (matchTahunKeyword) row.tahun = matchTahunKeyword[1];
    else if (matchPrkPrefix) row.tahun = matchPrkPrefix[1];
    else if (matchGeneric) row.tahun = matchGeneric[0];
    else row.tahun = "";
  } else {
    row.tahun = String(row.tahun);
  }

  if (!row.status) {
    const terkontrak = row.aiTerkontrak || 0;
    const terbayar = row.terbayar || 0;
    if (terbayar > 0) row.status = "Selesai";
    else if (terkontrak > 0) row.status = "Dalam Proses";
    else row.status = "Belum Terkontrak";
  }

  return row;
}

const PROGRESS_COLUMN_MAP = {
  "bulan": "bulan",
  "bln": "bulan",
  // Code.gs memberi nama otomatis `col_1` karena header kolom bulan pada
  // sheet Progress AI kosong. Tetap petakan secara eksplisit agar grafik
  // bulanan tidak hanya bergantung pada fallback pembacaan isi sel.
  "col_1": "bulan",
  "prk/pos": "prkPos",
  "prk / pos": "prkPos",
  "kode prk": "prkPos",
  "kode prk/pos": "prkPos",
  "kode": "prkPos",
  "no anggaran": "prkPos",
  // Header kolom kode PRK di sheet ini PERSIS SAMA dengan nama sheetnya sendiri
  // (contoh: kolom "TERTAGIH" di sheet TERTAGIH isinya kode PRK, BUKAN nilai Rp).
  "terkontrak": "prkPos",
  "ai terkontrak": "prkPos",
  "tertagih": "prkPos",
  "terbayar": "prkPos",
  // Nilai bulanan ada di kolom TOTAL (penjumlahan kolom "1"/"2"/dst di sheet asal).
  "total": "nilai",
  "jumlah": "nilai",
  "nilai": "nilai",
  "nilai bulan ini": "nilai",
  "realisasi": "nilai",
  "realisasi bulan ini": "nilai",
  "kumulatif": "kumulatif",
  "kumulatif s.d. bulan ini": "kumulatif",
  "kumulatif bulan ini": "kumulatif",
  "s.d. bulan ini": "kumulatif",
  "sd bulan ini": "kumulatif"
};

const PROGRESS_MONTH_SET = new Set(["JAN", "FEB", "MAR", "APR", "MEI", "MAY", "JUN", "JUL", "AGT", "AUG", "SEP", "OKT", "OCT", "NOV", "DES", "DEC"]);
const PROGRESS_CODE_PATTERN = /^\d{4}\.[A-Za-z]+\.\d+\.\d+/; // contoh: 2026.DJBB.1.001

function normalizeProgressRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const mapped = rows.map((r) => {
    const out = { bulan: "", prkPos: "", nilai: 0, kumulatif: 0 };

    Object.keys(r).forEach((rawKey) => {
      const mappedKey = PROGRESS_COLUMN_MAP[String(rawKey).trim().toLowerCase()];
      const value = r[rawKey];
      if (mappedKey === "bulan") out.bulan = String(value || "").trim().toUpperCase();
      else if (mappedKey === "prkPos") out.prkPos = String(value || "").trim();
      else if (mappedKey === "nilai") out.nilai = parseNumber(value);
      else if (mappedKey === "kumulatif") out.kumulatif = parseNumber(value);
    });

    // Fallback: kalau header tidak dikenali, tebak dari isi sel.
    if (!out.bulan || !out.prkPos) {
      Object.values(r).forEach((value) => {
        const text = String(value == null ? "" : value).trim().toUpperCase();
        if (!out.bulan && PROGRESS_MONTH_SET.has(text)) out.bulan = text;
        if (!out.prkPos && PROGRESS_CODE_PATTERN.test(text)) out.prkPos = String(value).trim();
      });
    }

    // Samakan variasi singkatan bulan Indonesia/Inggris dengan urutan yang
    // dipakai grafik Progress AI.
    const monthAliases = { MEI: "MAY", AGT: "AUG", AGU: "AUG", OKT: "OCT", DES: "DEC" };
    out.bulan = monthAliases[out.bulan] || out.bulan;
    return out;
  });

  // Forward-fill kode PRK (sel kode di sheet asal biasanya merge cell, cuma terisi di baris JAN).
  let lastCode = "";
  mapped.forEach((row) => {
    if (row.prkPos) lastCode = row.prkPos;
    else row.prkPos = lastCode;
  });

  const anyFieldFound = mapped.some((m) => m.bulan || m.prkPos || m.nilai || m.kumulatif);
  if (!anyFieldFound) {
    console.warn(
      "[api.js] Kolom pada sheet AI TERKONTRAK/TERTAGIH/TERBAYAR tidak terbaca. " +
      "Header asli yang ditemukan pada baris pertama:", Object.keys(rows[0] || {}),
      "— sesuaikan PROGRESS_COLUMN_MAP di api.js supaya cocok."
    );
  }

  return mapped;
}

async function getHistoricalData() {
  const years = Object.keys(HIST_API_URLS).filter((y) => HIST_API_URLS[y]);
  if (years.length === 0) return [];

  const results = await Promise.all(
    years.map(async (year) => {
      const url = HIST_API_URLS[year];
      try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
          throw new Error(`Gagal mengambil data historis ${year} (status ${response.status})`);
        }
        const json = await response.json();
        const monitoringRaw = Array.isArray(json) ? json : (Array.isArray(json.monitoring) ? json.monitoring : (json.data || []));
        return monitoringRaw
          .map((rawRow) => {
            const row = normalizeRow(rawRow);
            // Setiap endpoint historis mewakili satu tabel tahun tertentu.
            row.tahun = String(year);
            return row;
          })
          // Abaikan baris kosong dan footer TOTAL seperti pada tabel utama.
          .filter((row) => row.no || row.unit || row.noAnggaran || row.prkPos || row.uraianAnggaran || row.uraianPrkPos)
          .filter((row) => String(row.prkPos || "").trim().toUpperCase() !== "TOTAL");
      } catch (error) {
        console.error(`[api.js] Gagal mengambil data historis tahun ${year}:`, error.message || error);
        return [];
      }
    })
  );

  return results.flat();
}

async function fetchSheetRows(sheetName) {
  const url = `${API_URL}?sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Gagal mengambil sheet "${sheetName}" (status ${response.status})`);
  }
  const json = await response.json();
  if (json.success === false) {
    throw new Error(`Code.gs menolak sheet "${sheetName}": ${json.error || "unknown error"}`);
  }
  return Array.isArray(json.data) ? json.data : [];
}

async function getProgressAI() {
  const empty = { terkontrak: [], tertagih: [], terbayar: [] };
  try {
    const response = await fetchWithTimeout(`${API_URL}?action=progress`);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const json = await response.json();
    if (json.success === false || !json.data) throw new Error(json.error || "Respons Progress AI tidak valid");
    const normalized = {
      terkontrak: normalizeProgressRows(Array.isArray(json.data.terkontrak) ? json.data.terkontrak : []),
      tertagih: normalizeProgressRows(Array.isArray(json.data.tertagih) ? json.data.tertagih : []),
      terbayar: normalizeProgressRows(Array.isArray(json.data.terbayar) ? json.data.terbayar : [])
    };
    // Respons HTTP sukses belum tentu berarti struktur sheet berhasil dibaca.
    // Tanpa bulan yang dikenali, paksa fallback per sheet di bawah.
    const hasRecognizedMonth = Object.values(normalized).some((rows) => rows.some((row) => row.bulan));
    if (!hasRecognizedMonth) throw new Error("Kolom bulan Progress AI tidak terbaca");
    return normalized;
  } catch (error) {
    // Deployment Apps Script lama mungkin belum memiliki action=progress.
    // Dalam kondisi itu baca ketiga sheet secara langsung, tetap dari sumber
    // Google Sheets yang sama dan tanpa membuat data pengganti.
    console.warn("[api.js] Endpoint Progress AI gabungan gagal; mencoba per sheet:", error.message || error);
    const entries = await Promise.all(Object.entries(PROGRESS_SHEET_NAMES).map(async ([key, sheetName]) => {
      try {
        return [key, normalizeProgressRows(await fetchSheetRows(sheetName))];
      } catch (sheetError) {
        console.error(`[api.js] Sheet ${sheetName} gagal dibaca:`, sheetError.message || sheetError);
        return [key, []];
      }
    }));
    return Object.assign(empty, Object.fromEntries(entries));
  }
}

async function getMonthlyProgress() {
  const promoteEmbeddedHeaders = (rawRows) => {
    if (!Array.isArray(rawRows) || rawRows.length === 0) return [];
    const headerIndex = rawRows.findIndex((row) => {
      const values = Object.values(row).map((value) => String(value || "").trim().toLowerCase());
      return values.some((value) => value.indexOf("ai terkontrak") !== -1) &&
        values.some((value) => value.indexOf("terbayar") !== -1) &&
        values.some((value) => value.indexOf("pagu") !== -1);
    });
    if (headerIndex < 0) return rawRows;

    const rawKeys = Object.keys(rawRows[headerIndex]);
    const promotedHeaders = rawKeys.map((key) => String(rawRows[headerIndex][key] || "").trim());
    return rawRows.slice(headerIndex + 1).map((row) => {
      const out = {};
      rawKeys.forEach((key, index) => {
        if (promotedHeaders[index]) out[promotedHeaders[index]] = row[key];
      });
      return out;
    });
  };

  const summarizeMonth = ({ key, name }, rawRows) => {
    const rows = promoteEmbeddedHeaders(rawRows)
      .map(normalizeRow)
      // Abaikan header ganda, footer TOTAL, dan baris tanpa identitas anggaran.
      .filter((row) => row.no || row.unit || row.noAnggaran || row.prkPos || row.uraianAnggaran || row.uraianPrkPos)
      .filter((row) => String(row.prkPos || "").trim().toUpperCase() !== "TOTAL");
    if (rows.length === 0) return null;

    const sumFor = (filteredRows, field) => filteredRows.reduce((sum, row) => sum + (row[field] || 0), 0);
    const summarizeRows = (filteredRows) => ({
      pagu: sumFor(filteredRows, "pagu"),
      terkontrak: sumFor(filteredRows, "aiTerkontrak"),
      terbayar: sumFor(filteredRows, "terbayar")
    });
    const murniRows = rows.filter((row) => row.kategori === "Murni");
    const lanjutanRows = rows.filter((row) => row.kategori === "Lanjutan");
    return {
      bulan: key,
      sheet: name,
      ...summarizeRows(rows),
      kategori: {
        Murni: summarizeRows(murniRows),
        Lanjutan: summarizeRows(lanjutanRows)
      },
      rowCount: rows.length
    };
  };

  try {
    const response = await fetchWithTimeout(`${API_URL}?action=monthly`);
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const json = await response.json();
    if (json.success === false || !json.data || Array.isArray(json.data)) {
      throw new Error(json.error || "Respons sheet bulanan tidak valid");
    }

    return MONTHLY_PROGRESS_SHEETS
      .map((config) => summarizeMonth(config, Array.isArray(json.data[config.name]) ? json.data[config.name] : []))
      .filter(Boolean);
  } catch (error) {
    console.warn("[api.js] Endpoint bulanan gabungan belum tersedia; memakai fallback per sheet.");
    const results = await Promise.all(MONTHLY_PROGRESS_SHEETS.map(async (config) => {
      try {
        return summarizeMonth(config, await fetchSheetRows(config.name));
      } catch (sheetError) {
        console.info(`[api.js] Sheet ${config.name} belum tersedia atau gagal dibaca.`);
        return null;
      }
    }));
    return results.filter(Boolean);
  }
}

async function fetchMainMonitoring() {
  const response = await fetchWithTimeout(`${API_URL}?sheet=${encodeURIComponent(MAIN_SHEET_NAME)}`);
  if (!response.ok) {
    throw new Error(`Gagal mengambil data (status ${response.status})`);
  }
  const json = await response.json();

  let monitoringRaw;
  let meta = null;

  if (Array.isArray(json)) {
    // Format lama: array langsung
    monitoringRaw = json;
  } else {
    // Format Code.gs saat ini: { success, sheet, data: [...] }. Juga jaga kompatibilitas
    // kalau suatu saat backend berubah mengembalikan { monitoring: [...] }.
    monitoringRaw = Array.isArray(json.monitoring) ? json.monitoring : (Array.isArray(json.data) ? json.data : []);
    meta = json.meta || { sheet: json.sheet, rowCount: json.rowCount, lastUpdated: json.lastUpdated };
  }

  const monitoring = monitoringRaw
    .map((rawRow) => {
      const row = normalizeRow(rawRow);
      row.tahun = MAIN_DATA_YEAR;
      return row;
    })
    // Baris TOTAL/footer tidak boleh ikut dihitung sebagai item anggaran.
    .filter((row) => row.no || row.unit || row.noAnggaran || row.prkPos || row.uraianAnggaran || row.uraianPrkPos)
    .filter((row) => String(row.prkPos || "").trim().toUpperCase() !== "TOTAL");
  return { monitoring, meta };
}

async function getData() {
  const empty = { ok: false, meta: null, monitoring: [], progressAI: { terkontrak: [], tertagih: [], terbayar: [] }, monthlyProgress: [] };

  if (!API_URL) {
    console.warn("[api.js] API_URL belum diisi. Menampilkan aplikasi tanpa data (empty state).");
    return empty;
  }

  try {
    // Data utama, arsip tahun lama, dan Progress AI diambil BERSAMAAN (bukan berurutan)
    // supaya total waktu loading = request paling lambat, bukan jumlah semuanya.
    const [main, historicalRows, progressAI, monthlyProgress] = await Promise.all([
      fetchMainMonitoring(),
      getHistoricalData(),
      getProgressAI(),
      getMonthlyProgress()
    ]);

    const monitoring = main.monitoring.concat(historicalRows);
    const meta = main.meta;
    if (meta) {
      meta.rowCounts = meta.rowCounts || {};
      meta.rowCounts.historis = historicalRows.length;
    }

    return { ok: true, meta, monitoring, progressAI, monthlyProgress };
  } catch (error) {
    console.error("[api.js] Gagal mengambil data dari Google Sheets:", error.message || error);
    return empty;
  }
}