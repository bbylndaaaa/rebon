/* ==========================================================================
   KPI MONITORING UP3 CIREBON — MODULE
   File terpisah dari script.js (punya dashboard SKKI) supaya tidak
   bertabrakan. Terhubung ke Google Apps Script Web App sebagai database
   (lihat apps-script/Code.gs). Dashboard ini hanya memakai data Google Sheets
   melalui Web App; data demo/snapshot tidak digunakan sebagai fallback.
   ========================================================================== */

const KPI_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbwllGxzY1P17wGTYIMqmDCSoEGhywfMw2MI9jnI6gKtt48GQK96sdbPAraidb1EskOo/exec",
  USE_LIVE: true,
  CACHE_TTL_MS: 10 * 60 * 1000
};

const KPI = (function () {
  "use strict";

  let DATA = null;
  let pendingPage = null; // halaman yang di-render ulang otomatis begitu data siap
  let dataLoading = false; // true selama data KPI sedang diambil/refetch dari Web App
  const charts = {}; // registry canvasId -> Chart instance
  const responseCache = new Map();
  const inFlight = new Map();
  const requestControllers = new Map();

  /* --------------------------- overlay loading --------------------------- */
  function ensureLoadingOverlay(container) {
    let el = container.querySelector(":scope > .kpi-loading-overlay");
    if (!el) {
      el = document.createElement("div");
      el.className = "kpi-loading-overlay";
      el.innerHTML = `<div class="kpi-spinner"></div><div class="kpi-loading-text">Memuat data…</div>`;
      container.appendChild(el);
    }
    return el;
  }
  function showKpiLoading(pageKey) {
    const container = document.getElementById(`page-${pageKey}`);
    if (!container) return;
    const el = ensureLoadingOverlay(container);
    el.classList.add("show");
    const txt = el.querySelector(".kpi-loading-text");
    if (txt && !el.dataset.longTimer) {
      el.dataset.longTimer = "1";
      setTimeout(() => {
        if (el.classList.contains("show")) {
          txt.textContent = "Memuat data… Mohon tunggu.";
        }
        delete el.dataset.longTimer;
      }, 8000);
    }
  }
  function hideKpiLoading(pageKey) {
    const container = document.getElementById(`page-${pageKey}`);
    if (!container) return;
    const el = container.querySelector(":scope > .kpi-loading-overlay");
    if (el) el.classList.remove("show");
  }

  /* ---------- empty state: data belum terbaca dari Google Sheets ---------- */
  function dataEmpty() {
    return !DATA || !DATA.ulp || Object.keys(DATA.ulp).length === 0;
  }
  function showNoDataNotice(pageKey) {
    const container = document.getElementById(`page-${pageKey}`);
    if (!container) return;
    let el = container.querySelector(":scope > .kpi-nodata");
    if (!el) {
      el = document.createElement("div");
      el.className = "kpi-nodata";
      container.appendChild(el);
    }
    el.innerHTML = `
      <div class="kpi-nodata-icon">⚠️</div>
      <div>
        <div class="kpi-nodata-title">Data KPI belum dapat ditampilkan</div>
        <div class="kpi-nodata-sub">
          Belum ada data yang terbaca dari Google Sheets. Pastikan Web App Apps Script KPI sudah
          di-<i>deploy</i> dengan akses <b>Anyone</b>, alamat <code>KPI_CONFIG.API_URL</code> di
          <code>kpi.js</code> sudah diisi URL <code>…/exec</code>, dan struktur sheet sudah cocok
          dengan <code>CONFIG</code> di <code>apps-script/Code.gs</code> (jalankan
          <code>validateCellConfig_()</code> di editor Apps Script untuk mengecek posisi cell).
          Begitu terhubung, dashboard otomatis menampilkan datanya.
        </div>
      </div>`;
  }
  function removeNoDataNotice(pageKey) {
    const container = document.getElementById(`page-${pageKey}`);
    const el = container && container.querySelector(":scope > .kpi-nodata");
    if (el) el.remove();
  }

  const PALETTE = {
    primary: "#0b4da2",
    primaryDark: "#06294f",
    target: "#1b2430",
    realisasi: "#f5a524",
    success: "#16a34a",
    warning: "#d97706",
    danger: "#dc2626",
    black: "#3a3f47",
    grid: "#e3e7ee",
    years: ["#0b4da2", "#f5a524", "#16a34a", "#dc2626", "#8b5cf6", "#06b6d4", "#94a3b8", "#be185d"]
  };

  // Poles tampilan default SEMUA chart Chart.js di dashboard KPI supaya
  // lebih "enak dipandang" (garis melengkung halus, sudut bar membulat,
  // titik data proporsional, tooltip lebih lega) tanpa perlu mengubah tiap
  // konfigurasi chart satu-satu. Dipasang sekali saat modul dimuat.
  (function applyChartAesthetics() {
    if (typeof window.Chart !== "function") return;
    const Chart = window.Chart;
    Chart.defaults.elements.line.tension = 0.4;
    Chart.defaults.elements.line.cubicInterpolationMode = "monotone";
    Chart.defaults.elements.line.borderWidth = 2.5;
    Chart.defaults.elements.point.radius = 3;
    Chart.defaults.elements.point.hoverRadius = 5;
    Chart.defaults.elements.point.borderWidth = 2;
    Chart.defaults.elements.bar.borderRadius = 0;
    Chart.defaults.elements.bar.borderSkipped = false;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    Chart.defaults.plugins.tooltip.titleSpacing = 4;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    // Chart langsung tampil tanpa animasi "menggambar pelan-pelan" -- sesuai
    // permintaan: perpindahan halaman/tampilan data harus instan, bukan smooth.
    Chart.defaults.animation = false;
  })();

  // Koordinat kantor tiap ULP (geocoded dari alamat yang dikirim), dipakai untuk
  // menempatkan pin pada "Peta Sebaran ULP" di halaman Overview. CRB = kantor UP3.
  // Sumber koordinat: OSM/Nominatim sesuai alamat resmi tiap ULP.
  const ULP_GEO = {
    KTA: { lat: -6.7213710, lng: 108.5722887, alamat: "Jl. Yos Sudarso No.16, Lemahwungkuk, Kota Cirebon, Jawa Barat 45111" },
    KNG: { lat: -6.9821453, lng: 108.4768043, alamat: "Kuningan, Jawa Barat 45511 (pusat kota Kab. Kuningan)" },
    SBR: { lat: -6.7593496, lng: 108.4819888, alamat: "Jl. R. Dewi Sartika No.130, Sumber, Kab. Cirebon, Jawa Barat 45611" },
    CLD: { lat: -6.9001235, lng: 108.7498120, alamat: "Jl. Merdeka Utara, Ciledug Tengah, Kec. Ciledug, Kab. Cirebon, Jawa Barat 45188" },
    CLM: { lat: -6.8662920, lng: 108.4977775, alamat: "Jl. Raya Bojong No.97, Kec. Cilimus, Kab. Kuningan" },
    CRB: { lat: -6.7107309, lng: 108.5395149, alamat: "Jl. Tuparev No.100, Kedawung, Kota Cirebon (Kantor UP3 Cirebon)" }
  };

  // Indikator "kartu mini" per-ULP di peta (SAIDI/SAIFI/RPT/RCT/%WO/Rating).
  // PENTING: nama di sini HARUS SAMA PERSIS dengan kolom C sheet ULP (sudah
  // diverifikasi satu-satu dari Google Sheet live: KTA/KNG/SBR/CLD/CLM/CRB).
  // RCT & %WO Berulang sengaja tetap dicantumkan sesuai permintaan user; bila
  // indikator itu belum ada di data sheet, popup peta menampilkan "-" (jujur
  // terhadap data Google Sheets, bukan angka karangan).
  const MAP_CARD_INDICATORS = {
    saidi: "SAIDI (sesuai kewenangan)",
    saifi: "SAIFI (sesuai kewenangan)",
    rpt: "Response Time atas Gangguan (diluar Clear Tamper)",
    rct: "Recovery Time atas Gangguan",
    woBerulang: "%WO Berulang",
    ratingNegatif: "Feedback Rating Negatif pada PLN Mobile - Gangguan",
    susut: "Susut Distribusi Tanpa E-min (sesuai kewenangan)" // badge loss (TE) merah di kartu total
  };

  // Peta indikator -> BAGIAN (SAR PP / JAR / TE / REN / KU), diekstrak dari
  // sheet "scoreboard" (kolom F, sejajar tiap indikator KPI utama) pada file
  // Realisasi_KPI_2026_Cirebon_-_Versi_2.xlsx. Properti BAGIAN ini melekat pada
  // indikator itu sendiri (bukan pada periode/ULP), jadi aman dipetakan statis
  // di sini walau live datanya datang dari Google Sheet.
  // Item bertanda (*) tidak eksplisit ada di sheet scoreboard (sub-item dari
  // indikator induk yang sudah dikonfirmasi) — dikelompokkan mengikuti bagian
  // induknya. Yang tidak ketemu sama sekali -> "Lainnya".
  const BAGIAN_LABELS = {
    "SAR PP": "SAR & Pelayanan Pelanggan",
    JAR: "Jaringan",
    TE: "Transaksi Energi",
    REN: "Perencanaan",
    KU: "Keuangan & Umum",
    Lainnya: "Lainnya"
  };
  const BAGIAN_MAP = {
    "Delta Penjualan Tenaga Listrik": "SAR PP",
    "Jumlah Penambahan Pelanggan dan Penambahan Daya Tersambung": "SAR PP",
    "Penambahan Pelanggan": "SAR PP", // (*)
    "Penambahan Daya Tersambung": "SAR PP", // (*)
    "Pendapatan Biaya Penyambungan": "SAR PP",
    "Penambahan Jumlah Pelanggan Lisdes": "SAR PP",
    "Peningkatan kWh Penjualan dari Pelanggan Lisdes": "SAR PP",
    "Jumlah Kali Transaksi Keuangan melalui PLN Mobile": "SAR PP",
    "Kali Transaksi Keuangan PLN Mobile": "SAR PP", // (*)
    "Rupiah Transaksi PLN Mobile": "SAR PP", // (*)
    "Pencapaian Saldo Rata-Rata Akhir Bulan diluar Konsumen Instansi (Kementerian dan Lembaga) dan Konsumen TT": "SAR PP",
    "Pencapaian Pelunasan PRR, Ex-PRR, dan Piutang Prabayar": "SAR PP",
    "Usulan Penghapusan PRR": "SAR PP",

    "SAIDI (sesuai kewenangan)": "JAR",
    "SAIFI (sesuai kewenangan)": "JAR",
    "ENS (sesuai kewenangan)": "JAR",
    "Feedback Rating Negatif pada PLN Mobile - Gangguan": "JAR",
    "Response Time atas Gangguan (diluar Clear Tamper)": "JAR",
    "Success Rate Auto Dispatch Gangguan Individual (diluar Clear Tamper)": "JAR",
    "Gangguan TM (sesuai kewenangan)": "JAR",
    "Kerusakan Peralatan Distribusi (sesuai kewenangan)": "JAR",
    "MVOD (sesuai kewenangan)": "JAR",
    "OD_JTM": "JAR", // (*)
    "OD_GD": "JAR", // (*)
    "MTTR Siaga 1 TM (sesuai kewenangan)": "JAR",
    "Siaga1 SUTM": "JAR", // (*)
    "Siaga1 SKTM": "JAR", // (*)
    "Siaga1 PHBTM": "JAR", // (*)
    "Siaga1 Trafo": "JAR", // (*)
    "Efektivitas Pemeliharaan": "JAR",

    "Susut Distribusi Tanpa E-min (sesuai kewenangan)": "TE",
    "Perolehan kWh P2TL": "TE",
    "Penyelesaian Ganti Meter": "TE",
    "Tindak Lanjut LBKB (Laporan Bulanan Kelainan Baca Meter)": "TE",

    "Penambahan Aset RUPTL": "REN",
    "Penambahan Aset Penyelesaian Fisik Investasi": "REN",
    "Pengendalian Penggunaan Anggaran Investasi sesuai RKAP": "REN",
    "Pengembangan Aset Distribusi": "REN",

    "Usulan Penghapusan ATTB": "KU",
    "Pengendalian NAC (Non Allowable Cost)": "KU",
    "Kepatuhan, Maturity Level dan Tata Kelola Perusahaan": "KU" // (*)
  };
  function indicatorBagian(name) {
    return BAGIAN_MAP[name] || "Lainnya";
  }

  const state = {
    app: "skki", // "skki" | "kpi"
    bulan: "JUL", // bulan aktif global (kode 3 huruf, key array bulanan)
    ulp: "CRB", // ULP aktif untuk konten yang butuh 1 ULP (default: total UP3)
    indikator: "Delta Penjualan Tenaga Listrik",
    indikatorBulan: null, // bulan KHUSUS halaman "Per Indikator" -- independen dari `bulan` (filter bar global)
    ulpDetailBulan: null, // bulan KHUSUS halaman "Per ULP"
    bandingBulan: null, // bulan KHUSUS halaman "Perbandingan ULP"
    bandingIndikator: null, // indikator KHUSUS halaman "Perbandingan ULP"
    ulpDetail: "KTA",
    tahunA: "2026",
    tahunB: "2025",
    tema: "A", // tema aktif di grid "Semua Indikator per Tema": A/B/C/D/E
    pengusahaanUnit: "UP3 Cirebon",
    pengusahaanBagian: "BAGIAN SAR & PP",
    pengusahaanTahun: "2026",
    pengusahaanBulan: "",
    overviewLoading: false,
    // Menandai apakah user SUDAH secara eksplisit memilih bulan lewat dropdown
    // masing-masing (bukan cuma nilai default sistem). Selama belum dipilih,
    // dropdown menampilkan placeholder "Pilih Bulan" (bukan langsung nama
    // bulan) walau data yang ditampilkan tetap default ke bulan terbaru yang
    // tersedia -- supaya halaman tidak kosong sambil user belum memilih apa2.
    bulanChosen: { overview: false, indikator: false, ulpDetail: false, banding: false }
  };

  /* --------------------------- util umum --------------------------- */

  function monthIdx(code) {
    return DATA.meta.months.indexOf(code);
  }

  function fmt(v, d = 2) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    return Number(v).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtInt(v) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    return Math.round(Number(v)).toLocaleString("id-ID");
  }

  function fmtPct(v, d = 1) {
    if (v === null || v === undefined || isNaN(v)) return "-";
    return (Number(v) * 100).toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }) + "%";
  }

  // pct dalam bentuk rasio (1.0 = 100%)
  function pctStatus(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return { key: "na", label: "-", color: "#9aa5b1" };
    if (pct >= 1) return { key: "hijau", label: "Baik", color: PALETTE.success };
    if (pct >= 0.85) return { key: "kuning", label: "Hati-hati", color: PALETTE.warning };
    if (pct >= 0.65) return { key: "merah", label: "Awas", color: PALETTE.danger };
    return { key: "hitam", label: "Kritis", color: PALETTE.black };
  }

  // Arah indikator: "up" = makin besar makin baik (pct = real/target),
  // "down" = makin kecil makin baik (pct = 2-(real/target)), "range" = dianggap up sebagai pendekatan.
  function indicatorDirection(name) {
    const map = (DATA.meta && DATA.meta.indicatorDirection) || {};
    return map[name] || "up";
  }

  // Hitung pencapaian sesuai arah indikator. Dipakai saat pct tidak tersedia langsung
  // dari data (mis. bulan selain snapshot asli) sehingga dihitung ulang dari target & realisasi.
  function computePct(name, target, real) {
    // Rumus workbook tidak seragam: ada rasio biasa, arah turun, baseline
    // 60%, rentang, dan agregat berbobot. Jangan membuat angka pengganti di
    // browser ketika hasil formula sumber kosong/error.
    return null;
  }

  function scoreParts(bobot, pct) {
    const weight = Number(bobot);
    const achievement = Number(pct);
    if (!isFinite(weight) || !isFinite(achievement)) return { nilai: null, loss: null };
    const nilai = achievement <= 0 ? 0 : Math.min(achievement, 1.1) * weight;
    return { nilai, loss: Math.max(weight - nilai, 0) };
  }

  function destroy(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function makeChart(id, config) {
    destroy(id);
    const el = document.getElementById(id);
    if (!el || typeof window.Chart !== "function") return null;
    charts[id] = new Chart(el, config);
    return charts[id];
  }

  function baseGridOptions(extra) {
    return Object.assign(
      {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 }, usePointStyle: true } },
          tooltip: { titleFont: { size: 11 }, bodyFont: { size: 11 } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { color: PALETTE.grid }, ticks: { font: { size: 10 } } }
        }
      },
      extra || {}
    );
  }

  /* --------------------------- data layer --------------------------- */

  // Web App Apps Script sering butuh "cold start" (terutama saat baru dibuka
  // lagi setelah idle) yang bisa memakan waktu. Tanpa timeout, request yang
  // macet akan membuat halaman spinner selamanya; tanpa retry, cold start
  // pertama sering gagal/kelewatan. Dipakai timeout panjang (90 detik) dan
  // retry 1x supaya data tetap berhasil masuk lalu langsung tampil.
  async function fetchWithTimeout(url, timeoutMs = 90000, retriesLeft = 1, controller) {
    controller = controller || new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (retriesLeft > 0) {
        console.warn("[kpi.js] Fetch gagal (" + (error.message || error) + "), mencoba ulang…");
        return fetchWithTimeout(url, timeoutMs, retriesLeft - 1, controller);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchLive(action, params, options) {
    options = options || {};
    const token = typeof window.getAuthToken === "function" ? window.getAuthToken() : "";
    const qs = new URLSearchParams(Object.assign({ action, token }, params || {})).toString();
    const key = qs;
    const now = Date.now();
    const cached = responseCache.get(key);
    if (!options.force && cached && now - cached.storedAt < KPI_CONFIG.CACHE_TTL_MS) return cached.value;
    if (!options.force && inFlight.has(key)) return inFlight.get(key);

    if (options.cancelGroup) {
      const previous = requestControllers.get(options.cancelGroup);
      if (previous) previous.abort();
    }
    const controller = new AbortController();
    if (options.cancelGroup) requestControllers.set(options.cancelGroup, controller);
    const request = fetchWithTimeout(`${KPI_CONFIG.API_URL}?${qs}`, 90000, 1, controller)
      .then((value) => {
        responseCache.set(key, { value, storedAt: Date.now() });
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
        if (options.cancelGroup && requestControllers.get(options.cancelGroup) === controller) {
          requestControllers.delete(options.cancelGroup);
        }
      });
    inFlight.set(key, request);
    return request;
  }

  function debounceAsync(fn, delay) {
    let timer;
    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Google Bulan default (dipakai fallback kalau meta.monthsID tidak ada,
  // misal saat data datang dari Apps Script live yang formatnya beda
  // sedikit berbeda dari format standar API).
  const MONTHS_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const MONTHS_ID_DEFAULT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  // Struktur data kosong tapi valid, dipakai kalau live fetch gagal/tidak ada,
  // supaya kode lain (leafIndicators, dst) tidak meledak dengan
  // "Cannot read properties of undefined". Periode bulan tetap diisi default
  // supaya dropdown periode & label periode tetap tampil meski belum ada data.
  const EMPTY_DATA = {
    meta: {
      ulpList: [],
      ulpLabel: {},
      months: MONTHS_EN,
      monthsID: MONTHS_ID_DEFAULT,
      years2019_2026: ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"],
      indicatorDirection: {},
      directionNote: ""
    },
    ulp: {},
    dataPengusahaan: [],
    perspektif: { periodeLabel: "", statusCount: {}, ranking: [] }
  };

  // Isi field meta yang mungkin belum tersedia dari backend agar antarmuka
  // tetap aman saat struktur respons Apps Script ditingkatkan.
  function normalizeData(data) {
    if (!data || typeof data !== "object") return data;
    data.meta = data.meta || {};
    if (!Array.isArray(data.meta.months) || data.meta.months.length === 0) {
      data.meta.months = MONTHS_EN;
    }
    if (!Array.isArray(data.meta.monthsID) || data.meta.monthsID.length !== data.meta.months.length) {
      data.meta.monthsID = data.meta.months.map((m, i) => MONTHS_ID_DEFAULT[i] || m);
    }
    if (!Array.isArray(data.meta.ulpList) || data.meta.ulpList.length === 0) {
      data.meta.ulpList = Object.keys(data.ulp || {});
    }
    data.meta.ulpLabel = data.meta.ulpLabel || {};
    data.meta.ulpList.forEach((u) => {
      if (!data.meta.ulpLabel[u]) data.meta.ulpLabel[u] = (data.ulp && data.ulp[u] && data.ulp[u].label) || u;
    });
    data.meta.indicatorDirection = data.meta.indicatorDirection || {};
    if (!Array.isArray(data.meta.years2019_2026) || data.meta.years2019_2026.length === 0) {
      // Code.gs (backend live) belum mengirim field ini -- daftar tahun ini statis
      // (2019-2026 sesuai kolom historis di tiap sheet ULP), jadi aman dibuat di FE.
      data.meta.years2019_2026 = ["2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
    }
    data.ulp = data.ulp || {};
    data.dataPengusahaan = Array.isArray(data.dataPengusahaan) ? data.dataPengusahaan : [];
    data.perspektif = data.perspektif || { periodeLabel: "", statusCount: {}, ranking: [] };
    // Normalisasi ranking NKO (isi urutan ranking dari NKO bila sheet memberi #DIV/0!).
    data.perspektif = normalizePerspektif(data.perspektif);
    if (data.perspektifByPeriod && typeof data.perspektifByPeriod === "object") {
      Object.keys(data.perspektifByPeriod).forEach((m) => {
        data.perspektifByPeriod[m] = normalizePerspektif(data.perspektifByPeriod[m]);
      });
    }
    return data;
  }

  // Ranking NKO dari sheet PER PERSPEKTIF kadang berisi #DIV/0! (formula rusak)
  // sehingga nilai ranking-nya null — INI TERMASUK baris "CRB" (UP3 total),
  // yang sheet aslinya memang sering tidak punya rumus ranking sendiri (cuma
  // 5 ULP yang diranking satu sama lain). Sebelumnya kalau SEBAGIAN baris
  // (mis. 5 ULP) sudah punya angka ranking dari sheet, baris CRB yang null
  // dibiarkan null selamanya -> makanya NKO UP3 & Ranking NKO UP3 tidak
  // pernah muncul di kartu ringkasan. Diperbaiki: hitung fallback ranking
  // dari urutan NKO (terbesar = #1) untuk SETIAP baris yang ranking-nya
  // masih kosong, sambil tetap mempertahankan angka ranking asli dari sheet
  // untuk baris yang memang sudah punya nilai valid.
  function normalizePerspektif(p) {
    if (!p || !Array.isArray(p.ranking) || p.ranking.length === 0) return p;
    const ranking = p.ranking.slice();
    // Sheet kadang mengirim NKO sebagai teks ("92,45") atau error formula
    // ("#DIV/0!") — dikonversi dulu supaya nilainya (termasuk punya UP3/CRB)
    // tetap bisa ditampilkan kalau sebenarnya valid, bukan cuma "-" terus.
    // PENTING: UP3 CRB di sheet aslinya memang diberi label TEKS "K-1" (bukan
    // angka 1) pada kolom RANKING (lihat baris 26 sheet PER PERSPEKTIF) —
    // label ini disimpan apa adanya di `rankingLabel` SEBELUM dikonversi ke
    // angka, supaya tampil persis "K-1" dan tidak dipaksa jadi angka.
    ranking.forEach((r) => {
      if (typeof r.nko !== "number") r.nko = coerceNumber(r.nko);
      if (typeof r.ranking !== "number") {
        const raw = typeof r.ranking === "string" ? r.ranking.trim() : "";
        const isFormulaError = /^#/.test(raw); // #DIV/0!, #N/A, #REF!, dst -> BUKAN label valid
        r.rankingLabel = raw && !isFormulaError ? raw : null;
        r.ranking = coerceNumber(r.ranking);
      } else {
        r.rankingLabel = null;
      }
    });
    const ulpRows = ranking.filter((r) => r.unit !== "CRB");
    const crbRow = ranking.find((r) => r.unit === "CRB");
    const needsFallback = ulpRows.some((r) => typeof r.ranking !== "number" && !r.rankingLabel && typeof r.nko === "number");
    if (needsFallback) {
      const byNko = ulpRows.slice().sort((a, b) => {
        const an = typeof a.nko === "number" ? a.nko : -Infinity;
        const bn = typeof b.nko === "number" ? b.nko : -Infinity;
        return bn - an;
      });
      const fallbackRank = {};
      byNko.forEach((r, i) => { fallbackRank[r.unit] = i + 1; });
      ulpRows.forEach((r) => {
        if (typeof r.ranking !== "number" && !r.rankingLabel && typeof r.nko === "number") r.ranking = fallbackRank[r.unit];
      });
    }
    if (crbRow && typeof crbRow.ranking !== "number" && !crbRow.rankingLabel) crbRow.ranking = 1;
    return Object.assign({}, p, { ranking });
  }

  // Teks ranking yang ditampilkan ke user: pakai label asli dari sheet kalau
  // ada (mis. "K-1" utk UP3 CRB), kalau tidak pakai angka ranking biasa.
  function rankingText(r, withHash) {
    if (!r) return "-";
    if (r.rankingLabel) return r.rankingLabel;
    if (typeof r.ranking === "number") return (withHash ? "#" : "") + r.ranking;
    return "-";
  }

  // Sheet kadang mengembalikan angka sebagai teks ("92,45") atau error
  // formula ("#DIV/0!", "#N/A", "#REF!") alih-alih number murni. Dipakai
  // supaya NKO UP3 tetap tampil kalau nilainya sebenarnya ada tapi berupa
  // teks, dan tetap jujur tampil "-" kalau memang error/kosong.
  function coerceNumber(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v !== "string") return null;
    const s = v.trim();
    if (!s || /^#/.test(s)) return null; // "#DIV/0!", "#N/A", "#REF!", dsb.
    const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }

  async function init() {
    // PENTING: bind tombol App Switcher & nav dulu, SEBELUM apa pun yang
    // bergantung pada data dijalankan. Kalau bagian data di bawah error,
    // tombol-tombol ini tetap harus bisa diklik (ini akar masalah kenapa
    // dashboard KPI sebelumnya jadi "tidak bisa diklik": satu error di
    // tengah init() menghentikan sisa fungsi, termasuk bindAppSwitcher()).
    bindAppSwitcher();
    dataLoading = true;
    try {
      if (!KPI_CONFIG.USE_LIVE || !KPI_CONFIG.API_URL) throw new Error("URL Web App KPI belum dikonfigurasi.");
      DATA = normalizeData(await fetchLive("all", {}));
      if (DATA.error) throw new Error(DATA.error);
      setKpiConnBadge(true);

      // Default selalu periode terbaru yang benar-benar tersedia di data live.
      if (Array.isArray(DATA.meta.availableMonths) && DATA.meta.availableMonths.length) {
        state.bulan = DATA.meta.availableMonths[DATA.meta.availableMonths.length - 1];
      } else if (DATA.ulp.CRB) {
        const label = (DATA.ulp.CRB.periodeLabel || "").toString().toUpperCase();
        const map = { JANUARI: "JAN", FEBRUARI: "FEB", MARET: "MAR", APRIL: "APR", MEI: "MAY", JUNI: "JUN", JULI: "JUL", AGUSTUS: "AUG", SEPTEMBER: "SEP", OKTOBER: "OCT", NOVEMBER: "NOV", DESEMBER: "DEC" };
        if (map[label]) state.bulan = map[label];
      }

      populateGlobalFilterOptions();
      bindGlobalFilters();
    } catch (err) {
      console.error("[kpi.js] Gagal memuat data KPI live:", err);
      DATA = EMPTY_DATA;
      // Tetap isi dropdown periode (bulan) supaya label periode tidak hilang
      // walau belum ada data -- isi data akan muncul begitu koneksi pulih.
      populateGlobalFilterOptions();
      bindGlobalFilters();
      setKpiConnBadge(false, "Data live tidak tersedia");
    } finally {
      dataLoading = false;
    }

    // Kalau user sempat klik halaman KPI SEBELUM data selesai dimuat, halaman
    // itu tadinya cuma nampilin overlay loading -- begitu data (berhasil atau
    // fallback) sudah siap, render ulang otomatis halaman yang sama supaya
    // datanya langsung tampil tanpa perlu klik ulang. Setelah render selesai,
    // overlay loading di page tsb ikut di-hide oleh renderPage().
    if (pendingPage) {
      const toRender = pendingPage;
      pendingPage = null;
      renderPage(toRender);
    }
  }

  function setKpiConnBadge(live, message) {
    const b = document.getElementById("kpiConnBadge");
    if (b) {
      b.classList.toggle("kpi-live", live);
      b.classList.toggle("kpi-demo", !live);
      const generatedAt = DATA && DATA.meta && DATA.meta.generatedAt ? new Date(DATA.meta.generatedAt) : null;
      const stamp = generatedAt && !isNaN(generatedAt) ? generatedAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : null;
      b.querySelector(".kpi-conn-text").textContent = message || (live ? `Live · terakhir update ${stamp || "baru saja"}` : "Gagal terhubung · data live tidak tersedia");
    }
    // Badge gabungan di navbar atas ("Terhubung ke Google Sheets") hanya
    // boleh hijau kalau SKKI *dan* KPI dua-duanya live -- laporkan status
    // KPI ke situ juga, bukan cuma badge lokal di filter bar KPI.
    window.APP_CONN_STATUS = window.APP_CONN_STATUS || { skki: false, kpi: false };
    window.APP_CONN_STATUS.kpi = !!live;
    if (typeof window.renderGlobalConnectionBadge === "function") window.renderGlobalConnectionBadge();
  }

  function leafIndicators(ulpCode) {
    const ulp = DATA && DATA.ulp ? DATA.ulp[ulpCode || "CRB"] : null;
    return ((ulp && ulp.indicators) || []).filter((i) => !i.isGroup);
  }

  function findIndicator(ulpCode, name) {
    return leafIndicators(ulpCode).find((i) => i.name === name);
  }

  /* --------------------------- filter global --------------------------- */

  function populateGlobalFilterOptions() {
    const bulanSel = document.getElementById("kpiFilterBulan");
    const indSel = document.getElementById("kpiFilterIndikator");
    const ulpDetailSel = document.getElementById("kpiFilterUlpDetail");
    const indBulanSel = document.getElementById("kpiIndikatorBulan");
    const ulpDetailBulanSel = document.getElementById("kpiUlpDetailBulan");
    const bandingBulanSel = document.getElementById("kpiBandingBulan");
    const bandingIndSel = document.getElementById("kpiBandingIndikator");

    const available = Array.isArray(DATA.meta.availableMonths) && DATA.meta.availableMonths.length ? DATA.meta.availableMonths : DATA.meta.months;
    // Placeholder "Pilih Bulan" SELALU jadi opsi pertama -- dropdown tidak
    // langsung menampilkan nama bulan sampai user benar-benar memilih.
    const placeholderOpt = `<option value="" disabled>Pilih Bulan</option>`;
    const monthOptionsHtml = placeholderOpt + available.map((m) => `<option value="${m}">${DATA.meta.monthsID[DATA.meta.months.indexOf(m)] || m}</option>`).join("");
    const indOptionsHtml = leafIndicators("CRB")
      .map((i) => `<option value="${escAttr(i.name)}">${i.name}${i.satuan ? " (" + i.satuan + ")" : ""}</option>`)
      .join("");

    if (bulanSel) {
      bulanSel.innerHTML = monthOptionsHtml;
      if (!available.includes(state.bulan)) state.bulan = available[available.length - 1] || DATA.meta.months[0];
      // Kalau user belum pernah memilih bulan secara eksplisit di dropdown
      // ini, biarkan tampil placeholder "Pilih Bulan" -- data di halaman
      // tetap pakai state.bulan (default bulan terbaru) di belakang layar.
      bulanSel.value = state.bulanChosen.overview ? state.bulan : "";
    }
    // Dropdown ULP di filter bar Overview sudah dihapus (lihat index.html) --
    // state.ulp dibiarkan tetap "CRB" (UP3 total) selamanya untuk halaman ini.
    if (indSel) {
      indSel.innerHTML = indOptionsHtml;
      indSel.value = state.indikator;
    }
    if (ulpDetailSel) {
      ulpDetailSel.innerHTML = DATA.meta.ulpList.map((u) => `<option value="${u}">${DATA.meta.ulpLabel[u]}</option>`).join("");
      ulpDetailSel.value = state.ulpDetail;
    }
    // Dropdown bulan khusus tiap halaman -- sengaja terpisah dari kpiFilterBulan
    // (filter bar global, kini hanya untuk halaman Overview) supaya tiap
    // halaman punya satu sumber "bulan aktif" sendiri yang jelas. Sama juga
    // mulai dengan placeholder "Pilih Bulan" sampai user memilih sendiri.
    [
      [indBulanSel, "indikatorBulan", "indikator"],
      [ulpDetailBulanSel, "ulpDetailBulan", "ulpDetail"],
      [bandingBulanSel, "bandingBulan", "banding"]
    ].forEach(([sel, key, chosenKey]) => {
      if (!sel) return;
      sel.innerHTML = monthOptionsHtml;
      if (!state[key] || !available.includes(state[key])) state[key] = available[available.length - 1] || DATA.meta.months[0];
      sel.value = state.bulanChosen[chosenKey] ? state[key] : "";
    });
    if (bandingIndSel) {
      bandingIndSel.innerHTML = indOptionsHtml;
      if (!state.bandingIndikator) state.bandingIndikator = state.indikator;
      bandingIndSel.value = state.bandingIndikator;
    }

    // Dropdown Tahun A/B untuk panel "Semua Indikator per Tema" (tema E & F).
    // Sebelumnya state.tahunA/tahunB cuma nilai default di kode ("2026"/"2025")
    // TANPA kontrol UI apapun -- jadi pengguna tidak bisa ganti ke 2022 vs 2023
    // dst. Sekarang diisi dari daftar tahun yang tersedia (2019-2026).
    const temaTahunASel = document.getElementById("kpiTemaTahunA");
    const temaTahunBSel = document.getElementById("kpiTemaTahunB");
    const yearOptionsHtml = (DATA.meta.years2019_2026 || []).map((y) => `<option value="${y}">${y}</option>`).join("");
    if (temaTahunASel) { temaTahunASel.innerHTML = yearOptionsHtml; temaTahunASel.value = state.tahunA || "2026"; }
    if (temaTahunBSel) { temaTahunBSel.innerHTML = yearOptionsHtml; temaTahunBSel.value = state.tahunB || "2025"; }
  }

  function escAttr(s) {
    return String(s).replace(/"/g, "&quot;");
  }

  function bindGlobalFilters() {
    const bulanSel = document.getElementById("kpiFilterBulan");
    const indSel = document.getElementById("kpiFilterIndikator");
    const ulpDetailSel = document.getElementById("kpiFilterUlpDetail");
    const indBulanSel = document.getElementById("kpiIndikatorBulan");
    const ulpDetailBulanSel = document.getElementById("kpiUlpDetailBulan");
    const bandingBulanSel = document.getElementById("kpiBandingBulan");
    const bandingIndSel = document.getElementById("kpiBandingIndikator");

    // Filter bar global -- HANYA dipakai halaman Overview sekarang.
    if (bulanSel) bulanSel.addEventListener("change", debounceAsync(async () => {
      if (!bulanSel.value) return; // opsi placeholder "Pilih Bulan" (disabled, harusnya tidak kepilih, jaga2 saja)
      state.bulan = bulanSel.value;
      state.bulanChosen.overview = true;
      await refreshOverviewForPeriod();
      rerenderActive();
    }, 250));

    // Dropdown lokal per halaman -- masing-masing cuma me-render ulang
    // halamannya sendiri, tidak menyentuh state.bulan/state.ulp global.
    if (indSel) indSel.addEventListener("change", () => { state.indikator = indSel.value; renderIndikator(); });
    if (indBulanSel) indBulanSel.addEventListener("change", () => {
      if (!indBulanSel.value) return;
      state.indikatorBulan = indBulanSel.value;
      state.bulanChosen.indikator = true;
      renderIndikator();
      renderTemaGrafik();
    });

    if (ulpDetailSel) ulpDetailSel.addEventListener("change", () => { state.ulpDetail = ulpDetailSel.value; renderUlpDetail(); });
    if (ulpDetailBulanSel) ulpDetailBulanSel.addEventListener("change", () => {
      if (!ulpDetailBulanSel.value) return;
      state.ulpDetailBulan = ulpDetailBulanSel.value;
      state.bulanChosen.ulpDetail = true;
      renderUlpDetail();
    });

    if (bandingIndSel) bandingIndSel.addEventListener("change", () => { state.bandingIndikator = bandingIndSel.value; renderBanding(); });
    if (bandingBulanSel) bandingBulanSel.addEventListener("change", () => {
      if (!bandingBulanSel.value) return;
      state.bandingBulan = bandingBulanSel.value;
      state.bulanChosen.banding = true;
      renderBanding();
    });

    const temaSel = document.getElementById("kpiFilterTema");
    if (temaSel) {
      temaSel.value = state.tema || "A";
      temaSel.addEventListener("change", () => { state.tema = temaSel.value; renderTemaGrafik(); });
    }
    const temaTahunASel = document.getElementById("kpiTemaTahunA");
    const temaTahunBSel = document.getElementById("kpiTemaTahunB");
    if (temaTahunASel) temaTahunASel.addEventListener("change", () => { state.tahunA = temaTahunASel.value; renderTemaGrafik(); });
    if (temaTahunBSel) temaTahunBSel.addEventListener("change", () => { state.tahunB = temaTahunBSel.value; renderTemaGrafik(); });
  }

  function rerenderActive() {
    const activeBtn = document.querySelector('.nav-item.active[data-page^="kpi-"]');
    const key = activeBtn ? activeBtn.dataset.page : "kpi-overview";
    renderPage(key);
  }

  // NKO dan kategori perspektif berasal dari sheet yang dropdown-driven.
  // Karena itu data ini dimuat ulang dari Apps Script setiap periode berubah.
  async function refreshOverviewForPeriod() {
    if (!DATA || !KPI_CONFIG.API_URL || state.overviewLoading) return;
    state.overviewLoading = true;
    try {
      // "perspektif" sudah didukung deployment lama; Code.gs terbaru juga
      // meneruskan parameter periode ke dropdown PER PERSPEKTIF.
      const requestedMonth = state.bulan;
      const overview = await fetchLive("perspektif", { periode: requestedMonth }, { cancelGroup: "overview" });
      if (requestedMonth !== state.bulan) return;
      if (overview && overview.error) throw new Error(overview.error);
      if (overview) {
        DATA.perspektif = normalizePerspektif(overview);
        DATA.perspektifByPeriod = DATA.perspektifByPeriod || {};
        DATA.perspektifByPeriod[requestedMonth] = normalizePerspektif(overview);
        setKpiConnBadge(true);
      }
    } catch (err) {
      if (err.name === "AbortError" || requestedMonth !== state.bulan) return;
      console.warn("Gagal memperbarui NKO periode terpilih:", err);
      setKpiConnBadge(false, "Gagal memuat periode");
    } finally {
      state.overviewLoading = false;
    }
  }

  async function reload() {
    if (!KPI_CONFIG.API_URL) return;
    dataLoading = true;
    try {
      responseCache.clear();
      const fresh = normalizeData(await fetchLive("all", {}, { force: true, cancelGroup: "all" }));
      if (fresh.error) throw new Error(fresh.error);
      if (fresh.perspektifByPeriod && fresh.perspektifByPeriod[state.bulan]) fresh.perspektif = fresh.perspektifByPeriod[state.bulan];
      DATA = fresh;
      populateGlobalFilterOptions();
      setKpiConnBadge(true);
      rerenderActive();
    } catch (err) {
      console.error("[kpi.js] Muat ulang KPI gagal:", err);
      setKpiConnBadge(false, "Gagal memuat ulang data");
    } finally {
      dataLoading = false;
    }
  }

  /* --------------------------- app switcher (SKKI <-> KPI) --------------------------- */

  function bindAppSwitcher() {
    const backBtn = document.getElementById("portalBackBtn");
    const requestedApp = new URLSearchParams(window.location.search).get("app");
    const app = requestedApp === "kpi" ? "kpi" : "skki";
    switchApp(app, false);
    if (backBtn) backBtn.addEventListener("click", () => window.location.assign("portal.html"));
  }

  function switchApp(app, silent) {
    state.app = app;

    const kpiFooterStatus = document.getElementById("kpiConnBadge");
    if (kpiFooterStatus) kpiFooterStatus.hidden = app !== "kpi";

    document.querySelectorAll(".app-nav-group").forEach((g) => {
      g.style.display = g.dataset.app === app ? "" : "none";
    });
    document.querySelectorAll(".page").forEach((p) => {
      const belongsTo = p.dataset.app || "skki";
      if (belongsTo !== app) p.classList.remove("active");
    });
    // filter bar diatur per-halaman lewat renderPage(); di sini cukup pastikan
    // langsung disembunyikan saat pindah ke app SKKI.
    if (app !== "kpi") {
      const bar = document.getElementById("kpiFilterBar");
      if (bar) bar.style.display = "none";
    }

    document.querySelectorAll(".app-switch-card").forEach((c) => c.classList.toggle("active", c.dataset.app === app));
    const label = document.getElementById("currentAppLabel");
    const fullLabel = app === "kpi" ? "KPI Monitoring UP3 Cirebon" : "SKKI — Anggaran & Realisasi";
    if (label) {
      label.textContent = fullLabel;
      // teks dipotong (ellipsis) karena lebar sidebar terbatas -- title
      // membuat nama lengkap muncul sebagai tooltip saat hover, tanpa
      // perlu melebarkan sidebar.
      label.title = fullLabel;
    }

    // aktifkan halaman pertama pada app tsb
    const firstNav = document.querySelector(`.app-nav-group[data-app="${app}"] .nav-item`);
    if (firstNav && !silent) {
      // Tampilkan overlay loading langsung begitu user memilih Dashboard KPI,
      // selama data dari Google Sheets belum siap (otomatis hilang saat
      // renderPage() selesai me-render dengan data yang masuk).
      if (app === "kpi" && !DATA) showKpiLoading(firstNav.dataset.page);
      firstNav.click();
    }
    else if (firstNav && silent) {
      // set active class tanpa trigger render dulu, DOM sudah default dashboard aktif
      document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
      firstNav.classList.add("active");
      document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
      const pg = document.getElementById(`page-${firstNav.dataset.page}`);
      if (pg) pg.classList.add("active");
    }
  }

  /* ============================================================
     ROUTER (dipanggil dari script.js pada klik nav-item kpi-*)
     ============================================================ */
  function renderPage(pageKey) {
    // Selagi data masih diambil dari Google Sheets (atau sedang refetch),
    // tampilkan overlay loading di halaman KPI aktif.
    if (!DATA || dataLoading) {
      pendingPage = pageKey;
      showKpiLoading(pageKey);
      return;
    }
    hideKpiLoading(pageKey);

    // Data sudah selesai diambil, tapi hasilnya kosong / gagal termuat ->
    // tampilkan pesan yang jelas (bukan dashboard penuh "-" yang membingungkan).
    // Dropdown periode di Overview tetap ditampilkan supaya pilihan bulan
    // tetap terlihat walau isi datanya belum masuk.
    if (dataEmpty()) {
      const bar = document.getElementById("kpiFilterBar");
      if (bar) bar.style.display = pageKey === "kpi-overview" ? "" : "none";
      showNoDataNotice(pageKey);
      return;
    }
    removeNoDataNotice(pageKey);

    // Filter bar global (Bulan + ULP) sekarang HANYA untuk halaman Overview --
    // halaman KPI lainnya masing-masing punya dropdown periode sendiri supaya
    // tidak membingungkan (tidak ada 2 sumber "bulan aktif" yang tumpang tindih).
    const bar = document.getElementById("kpiFilterBar");
    if (bar) bar.style.display = pageKey === "kpi-overview" ? "" : "none";
    if (pageKey === "kpi-overview") renderOverview();
    if (pageKey === "kpi-indikator") { renderIndikator(); renderBagianTable(); renderTemaGrafik(); }
    if (pageKey === "kpi-ulp") renderUlpDetail();
    if (pageKey === "kpi-banding") renderBanding();
    if (pageKey === "kpi-pengusahaan") renderPengusahaan();
  }

  /* ============================================================
     HALAMAN 1 — OVERVIEW
     ============================================================ */
  function renderOverview() {
    if (!DATA || !DATA.ulp || !DATA.perspektif) return;
    const ranking = (DATA.perspektif.ranking || []).slice().sort((a, b) => {
      const ar = typeof a.ranking === "number" ? a.ranking : 999;
      const br = typeof b.ranking === "number" ? b.ranking : 999;
      return ar - br;
    });
    const crbRow = ranking.find((r) => r.unit === "CRB");

    setText("kpiOverviewNkoUp3", crbRow ? fmt(crbRow.nko, 2) : "-");
    setText("kpiOverviewPeriode", `Periode data: ${DATA.meta.monthsID[monthIdx(state.bulan)] || state.bulan} 2026`);

    // ranking table
    const tbody = document.getElementById("kpiRankingBody");
    if (tbody) {
      tbody.innerHTML = ranking
        .filter((r) => r.unit !== "CRB")
        .map(
          (r) => `<tr class="kpi-row-clickable" data-ulp="${r.unit}" title="Klik untuk lihat detail ULP ini">
            <td><strong>${rankingText(r, false)}</strong></td>
            <td>${DATA.meta.ulpLabel[r.unit] || r.unit}</td>
            <td>${fmt(r.nko, 2)}</td>
            <td>${nkoBadge(r.nko)}</td>
          </tr>`
        )
        .join("");
    }

    // skor total per ULP (stacked bar hijau/kuning/merah/hitam)
    const sc = DATA.perspektif.statusCount || {};
    const ulps = ["KTA", "KNG", "SBR", "CLD", "CLM", "CRB"];
    makeChart("kpiChartSkorUlp", {
      type: "bar",
      data: {
        labels: ulps.map((u) => DATA.meta.ulpLabel[u].replace("ULP ", "").replace("UP3 Cirebon (Total)", "UP3 CRB")),
        datasets: [
          { label: "Hijau", data: ulps.map((u) => (sc.HIJAU || {})[u] ?? 0), backgroundColor: PALETTE.success, borderRadius: 4, borderSkipped: false, barPercentage: .72, categoryPercentage: .72 },
          { label: "Kuning", data: ulps.map((u) => (sc.KUNING || {})[u] ?? 0), backgroundColor: PALETTE.warning, borderRadius: 4, borderSkipped: false, barPercentage: .72, categoryPercentage: .72 },
          { label: "Merah", data: ulps.map((u) => (sc.MERAH || {})[u] ?? 0), backgroundColor: PALETTE.danger, borderRadius: 4, borderSkipped: false, barPercentage: .72, categoryPercentage: .72 },
          { label: "Hitam", data: ulps.map((u) => (sc.HITAM || {})[u] ?? 0), backgroundColor: PALETTE.black, borderRadius: 4, borderSkipped: false, barPercentage: .72, categoryPercentage: .72 }
        ]
      },
      options: baseGridOptions({
        onClick: (evt, elements, chart) => {
          const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
          if (points.length) goToUlpDetail(ulps[points[0].index]);
        },
        onHover: (evt, elements, chart) => { chart.canvas.style.cursor = elements.length ? "pointer" : "default"; },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { stacked: true, grid: { color: PALETTE.grid }, ticks: { font: { size: 10 } } }
        }
      })
    });

    renderOverviewMap(crbRow);
  }

  // Ambil realisasi bulan aktif (state.bulan) untuk 1 indikator di 1 ULP,
  // dibulatkan sesuai satuan (menit / kali / %).
  function mapCardValue(ulpCode, indName) {
    const ind = findIndicator(ulpCode, indName);
    if (!ind || !ind.realisasi2026) return { txt: "-", raw: null, satuan: "" };
    const mi = monthIdx(state.bulan);
    const raw = ind.realisasi2026[mi];
    if (raw === null || raw === undefined || isNaN(raw)) return { txt: "-", raw: null, satuan: ind.satuan || "" };
    const isPercentSatuan = /%/.test(ind.satuan || "");
    const txt = isPercentSatuan ? `${fmt(raw, 2)}%` : fmt(raw, 2);
    return { txt, raw, satuan: ind.satuan || "" };
  }

  /* ------------------------------------------------------------
     Peta Sebaran ULP — peta SVG bergaya skematik (bukan citra satelit/tile
     asli), pin ditempatkan berdasarkan lat/lng kantor (ULP_GEO) yang
     dikonversi ke posisi persentase di dalam kanvas. Tidak lagi memakai
     Leaflet/tile OpenStreetMap supaya tidak tergantung akses CDN peta —
     titik tetap interaktif (hover/klik = popup) seperti sebelumnya.
     ------------------------------------------------------------ */

  // Angka & warna pin peta SEKARANG ikut Ranking NKO resmi dari sheet
  // "PER PERSPEKTIF" (persis sama dengan tabel "Ranking NKO" di Overview),
  // BUKAN proxy SAIDI/SAIFI/Susut lagi -- supaya tidak ada 2 angka ranking
  // berbeda untuk ULP yang sama di 1 halaman (ini akar masalah sebelumnya:
  // pin peta pakai proxy bulanan, tabel di bawah pakai NKO resmi). Data ini
  // sudah otomatis mengikuti filter Bulan karena refreshOverviewForPeriod()
  // (dipanggil tiap ganti dropdown Bulan) meminta ulang endpoint "perspektif"
  // dengan parameter periode yang sesuai ke Apps Script / Google Sheet.
  function officialUlpInfo(code) {
    const ranking = (DATA.perspektif && DATA.perspektif.ranking) || [];
    const row = ranking.find((r) => r.unit === code);
    if (!row) return { nko: null, ranking: null, rankingLabel: null };
    return { nko: typeof row.nko === "number" ? row.nko : null, ranking: row.ranking, rankingLabel: row.rankingLabel || null };
  }

  // Kumpulan info resmi (NKO + ranking) utk beberapa ULP sekaligus -- dipakai
  // render pin peta. Nilai kosong (data belum tersedia utk bulan itu di
  // sheet) tetap ditampilkan jujur sebagai "-", tidak diisi angka karangan.
  function officialUlpRanking(codes) {
    const score = {};
    const rank = {};
    const rankLabel = {};
    codes.forEach((code) => {
      const info = officialUlpInfo(code);
      score[code] = info.nko === null ? null : info.nko / 100; // rasio, 1.0 = 100%, dipakai utk pctStatus/warna
      rank[code] = info.ranking;
      rankLabel[code] = info.rankingLabel;
    });
    return { score, rank, rankLabel };
  }

  function monthDelta(indName, code) {
    const ind = findIndicator(code, indName);
    const mi = monthIdx(state.bulan);
    if (!ind || !ind.realisasi2026 || mi <= 0) return null;
    const cur = ind.realisasi2026[mi];
    const prev = ind.realisasi2026[mi - 1];
    if (cur === null || cur === undefined || prev === null || prev === undefined || !prev) return null;
    const change = (cur - prev) / Math.abs(prev);
    const dir = indicatorDirection(indName);
    const good = dir === "down" ? change < 0 : change > 0; // turun utk SAIDI/SAIFI/Susut = membaik
    return { change, good };
  }

  function deltaBadgeHtml(indName, code) {
    const d = monthDelta(indName, code);
    if (!d || d.change === 0) return `<span class="kpi-map-delta kpi-map-delta-flat">±0% bln lalu</span>`;
    const arrow = d.change > 0 ? "▲" : "▼";
    const cls = d.good ? "kpi-map-delta-up" : "kpi-map-delta-down";
    return `<span class="kpi-map-delta ${cls}">${arrow} ${fmt(Math.abs(d.change) * 100, 1)}% bln lalu</span>`;
  }

  // Link Google Maps dibuat dari alamat kantor ULP (geo.alamat) -- dipakai
  // supaya klik pada baris alamat di popup langsung membuka lokasi di Google
  // Maps, bukan berpindah ke halaman data internal.
  function gmapsUrl(geo) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(geo.alamat)}`;
  }

  function ulpPopupHtml(code, label, geo) {
    // Grid 6 kartu ringkasan: SAIDI, SAIFI, RPT, RCT, %WO Berulang, Rating
    // Negatif -- nilainya SELALU diambil langsung dari sheet ULP/UP3 masing2
    // (mapCardValue -> findIndicator), sama sekali tidak berubah oleh
    // penyesuaian ranking NKO di atas. Kalau indikator belum ada di data
    // sheet ULP itu, tampilkan "-" (jujur sesuai data aslinya). Setiap item
    // tetap bisa diklik -> buka drilldown perhitungan indikator itu.
    const cardRows = [
      { label: "SAIDI", ind: MAP_CARD_INDICATORS.saidi },
      { label: "SAIFI", ind: MAP_CARD_INDICATORS.saifi },
      { label: "RPT", ind: MAP_CARD_INDICATORS.rpt },
      { label: "RCT", ind: MAP_CARD_INDICATORS.rct },
      { label: "%WO Berulang", ind: MAP_CARD_INDICATORS.woBerulang },
      { label: "Rating Negatif", ind: MAP_CARD_INDICATORS.ratingNegatif }
    ];
    const cells = cardRows.map((row) => {
      const v = mapCardValue(code, row.ind);
      const txt = v.raw === null || v.raw === undefined ? "-" : v.txt;
      return `<div class="kpi-map-pop-item" data-ulp="${code}" data-indicator="${escAttr(row.ind)}" title="Klik untuk lihat perhitungan">
        <span>${row.label}</span><b>${txt}</b>
      </div>`;
    });
    // Skor & badge judul popup SEKARANG pakai NKO resmi (sama dgn tabel
    // Ranking NKO), bukan proxy SAIDI/SAIFI/Susut lagi.
    const info = officialUlpInfo(code);
    const st = pctStatus(info.nko === null ? null : info.nko / 100);
    const scoreTxt = info.nko === null ? "-" : `${fmt(info.nko, 1)}%`;
    const rankTxt = rankingText(info, true);
    return `
      <div class="kpi-map-pop-title">${label} <span class="kpi-map-pop-score" style="background:${st.color}">${scoreTxt}</span></div>
      <div class="kpi-map-pop-grid">${cells.join("")}</div>
      <div class="kpi-map-pop-foot"><span>NKO bulan ${DATA.meta.monthsID[monthIdx(state.bulan)] || state.bulan}${rankTxt !== "-" ? " · Ranking " + rankTxt : ""}</span><span>${st.label}</span></div>
      <a class="kpi-map-pop-addr" href="${gmapsUrl(geo)}" target="_blank" rel="noopener noreferrer" title="Buka lokasi di Google Maps">📍 ${geo.alamat}</a>`;
  }

  // Titik posisi pin (dalam % terhadap gambar peta) — dikalibrasi manual dari
  // piksel pin biru bernomor pada gambar "Peta Wilayah Kerja PLN UP3 Cirebon"
  // (assets/peta-wilayah-up3-cirebon.png, 1536×1024px). Peta ini ilustrasi
  // poster (bukan proyeksi lat/lng linear), jadi posisinya TIDAK dihitung dari
  // ULP_GEO lat/lng lagi — dipetakan langsung ke koordinat gambar supaya pas
  // persis di atas pin nomor 1–5 yang sudah ada di gambar.
  const MAP_IMAGE_SRC = "assets/peta-wilayah-up3-cirebon.png";
  const MAP_IMAGE_POS = {
    SBR: { x: 36.7, y: 43.9 }, // pin 1 - ULP Sumber
    KNG: { x: 61.0, y: 75.1 }, // pin 2 - ULP Kuningan
    CLM: { x: 46.2, y: 65.8 }, // pin 3 - ULP Cilimus
    CLD: { x: 63.6, y: 53.3 }, // pin 4 - ULP Ciledug
    KTA: { x: 65.9, y: 30.1 }  // pin 5 - ULP Cirebon Kota
  };

  // Posisi pin (x%) dipakai juga utk menentukan arah popup supaya TIDAK
  // kepotong di tepi kanvas: pin di area kiri -> popup rata kiri (melebar ke
  // kanan), pin di area kanan -> popup rata kanan (melebar ke kiri), tengah
  // -> tetap center seperti sebelumnya. Posisi y% dipakai utk pin di baris
  // bawah kanvas -> popup dibuka ke ATAS pin, bukan ke bawah (supaya tidak
  // kepotong batas bawah kanvas / ketutup kartu total di sebelahnya).
  function popAlignClass(pos) {
    if (pos.x <= 34) return "kpi-map-pin-align-left";
    if (pos.x >= 66) return "kpi-map-pin-align-right";
    return "";
  }
  function popFlipClass(pos) {
    return pos.y >= 60 ? "kpi-map-pin-flip-top" : "";
  }

  function renderOverviewMapImage(canvas, codes) {
    const official = officialUlpRanking(codes);

    const pinsHtml = codes
      .map((code) => {
        const geo = ULP_GEO[code];
        const pos = MAP_IMAGE_POS[code];
        if (!pos) return "";
        const label = (DATA.meta.ulpLabel[code] || code).replace("ULP ", "");
        const score = official.score[code];
        const rank = official.rank[code];
        const rankLabel = official.rankLabel[code];
        const rankTxt = rankLabel || (rank ? rank : "-");
        const color = pctStatus(score).color;
        const posClasses = [popAlignClass(pos), popFlipClass(pos)].filter(Boolean).join(" ");
        // Pin milik kita sendiri (bukan pin nomor bawaan gambar): "mask" putih
        // menutupi pin statis di foto, lalu di atasnya digambar pin teardrop
        // kita sendiri berwarna status + angka RANKING NKO RESMI (sama dgn
        // tabel Ranking NKO di bawah) bulan aktif ULP ini — jadi ikut berubah
        // tiap ganti filter Bulan. Tidak ada chip nama terpisah di sini
        // supaya TIDAK menutupi/dobel dengan tulisan nama ULP yang sudah
        // tercetak di gambar peta aslinya (mask sengaja dibuat kecil & hanya
        // menutupi area ikon pin lama, bukan area teks nama di bawahnya).
        return `
        <div class="kpi-map-pin ${posClasses}" style="left:${pos.x}%; top:${pos.y}%;" tabindex="0" role="button"
             data-ulp="${code}" title="${label} — ${geo.alamat}">
          <span class="kpi-map-pin-mask"></span>
          <span class="kpi-map-pin-marker" style="--pin-color:${color}">
            <span class="kpi-map-pin-rank">${rankTxt}</span>
          </span>
          <div class="kpi-map-popcard">
            ${ulpPopupHtml(code, label, geo)}
          </div>
        </div>`;
      })
      .join("");

    canvas.innerHTML =
      `<div class="kpi-map-bg-wrap"><img class="kpi-map-bg-img" src="${MAP_IMAGE_SRC}" alt="Peta Wilayah Kerja PLN UP3 Cirebon" onerror="this.closest('.kpi-map-bg-wrap').innerHTML='<div class=&quot;kpi-map-img-missing&quot;>Gambar peta tidak ditemukan — pastikan file <code>${MAP_IMAGE_SRC}</code> ada di folder project.</div>'"></div>` +
      pinsHtml;
  }

  function renderOverviewMap(crbRow) {
    const totalWrap = document.getElementById("kpiOverviewMapTotal");
    const canvas = document.getElementById("kpiOverviewMapCanvas");
    if (!totalWrap && !canvas) return;

    // --- Kartu ringkasan UP3 Cirebon, gaya panel "SULMAPANA" (SBI DALOP ODM):
    // UP3 Cirebon murni distribusi (tidak punya KIT/pembangkitan & TRANS/
    // transmisi seperti unit induk wilayah), jadi cukup SAIDI, SAIFI, dan
    // Susut (loss) — sesuai permintaan user, tanpa kotak KIT/TRANS/DIST. ---
    if (totalWrap) {
      const mi = monthIdx(state.bulan);
      const nko = crbRow ? crbRow.nko : null;
      const susut = mapCardValue("CRB", MAP_CARD_INDICATORS.susut);
      const susutInd = findIndicator("CRB", MAP_CARD_INDICATORS.susut);
      const susutTarget = susutInd && susutInd.target2026 ? susutInd.target2026[mi] : null;
      const saidiVal = mapCardValue("CRB", MAP_CARD_INDICATORS.saidi);
      const saifiVal = mapCardValue("CRB", MAP_CARD_INDICATORS.saifi);
      totalWrap.innerHTML = `
        <div class="kpi-map-total-card">
          <div class="kpi-map-total-label">UP3 Cirebon</div>
          <div class="kpi-map-total-sub">Periode: ${DATA.meta.monthsID[mi] || state.bulan} 2026</div>
          <div class="kpi-map-total-row"><span>NKO</span><b>${nko === null || nko === undefined ? "-" : fmt(nko, 2)}</b></div>
          <div class="kpi-map-total-row"><span>Ranking NKO</span><b>${rankingText(crbRow, true)}</b></div>

          <div class="kpi-map-metric-box">
            <div class="kpi-map-metric-label">SAIDI <span>(sesuai kewenangan)</span></div>
            <div class="kpi-map-metric-value">${saidiVal.txt} <span>${saidiVal.satuan}</span></div>
            ${deltaBadgeHtml(MAP_CARD_INDICATORS.saidi, "CRB")}
          </div>
          <div class="kpi-map-metric-box">
            <div class="kpi-map-metric-label">SAIFI <span>(sesuai kewenangan)</span></div>
            <div class="kpi-map-metric-value">${saifiVal.txt} <span>${saifiVal.satuan}</span></div>
            ${deltaBadgeHtml(MAP_CARD_INDICATORS.saifi, "CRB")}
          </div>

          <div class="kpi-map-badge-loss">
            <span>Susut / TE (loss)</span>
            <b>${susut.txt}${susutTarget != null ? ` <span style="opacity:.8;font-weight:500">/ target ${fmt(susutTarget, 2)}</span>` : ""}</b>
          </div>
        </div>`;
    }

    if (!canvas) return;
    const codes = ["KTA", "KNG", "SBR", "CLD", "CLM"];
    renderOverviewMapImage(canvas, codes);
  }

  // Pindah ke halaman "Per ULP" dengan ULP (dan opsional bulan) terpilih.
  // Dipakai supaya klik pin peta / grafik / baris ranking langsung membawa
  // user ke data detail yang dituju, bukan cuma menampilkan popup pasif.
  function goToUlpDetail(code, month) {
    if (!code) return;
    state.ulpDetail = code;
    if (month) state.ulpDetailBulan = month;
    const nav = document.querySelector('.nav-item[data-page="kpi-ulp"]');
    if (nav) nav.click();
  }

  // Klik pin ULP di peta:
  // - klik item indikator di dalam popup ("SAIDI", dst.) -> drilldown item itu (tidak diubah)
  // - klik baris alamat (📍) di popup -> buka lokasi di Google Maps (tab baru), BUKAN ke halaman data internal
  // - klik langsung badge/pin-nya (bukan isi popup) -> buka halaman "Per ULP" penuh untuk unit itu
  document.addEventListener("click", (ev) => {
    const item = ev.target.closest(".kpi-map-pop-item");
    if (item) {
      const ulpCode = item.getAttribute("data-ulp");
      const indName = item.getAttribute("data-indicator");
      if (ulpCode && indName) openDrilldown(ulpCode, indName, state.bulan);
      return;
    }
    // Baris alamat (<a class="kpi-map-pop-addr">) sengaja TIDAK di-intercept
    // di sini -- biarkan link <a> bawaan browser yang membuka Google Maps.
    if (ev.target.closest(".kpi-map-pop-addr")) return;
    const marker = ev.target.closest(".kpi-map-pin-marker, .kpi-map-pin-mask");
    if (marker) {
      const pin = marker.closest(".kpi-map-pin");
      if (pin) goToUlpDetail(pin.getAttribute("data-ulp"));
    }
  });
  // Aksesibilitas keyboard: Enter/Space saat pin sedang fokus (tab) -> buka halaman Per ULP.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const pin = document.activeElement && document.activeElement.closest && document.activeElement.closest(".kpi-map-pin");
    if (!pin || ev.target.closest(".kpi-map-pop-item, .kpi-map-pop-addr")) return;
    ev.preventDefault();
    goToUlpDetail(pin.getAttribute("data-ulp"));
  });

  // Klik baris tabel Ranking NKO (Overview) -> langsung ke halaman "Per ULP" unit itu.
  document.addEventListener("click", (ev) => {
    const row = ev.target.closest("#kpiRankingBody tr[data-ulp]");
    if (row) goToUlpDetail(row.getAttribute("data-ulp"));
  });

  // Klik baris tabel ranking cepat di halaman "Perbandingan ULP" -> buka
  // drilldown perhitungan indikator tsb untuk ULP yang diklik.
  document.addEventListener("click", (ev) => {
    const row = ev.target.closest("#kpiBandingBody tr[data-ulp]");
    if (row) openDrilldown(row.getAttribute("data-ulp"), row.getAttribute("data-indicator"), state.bandingBulan || state.bulan);
  });

  // Klik kartu ringkas indikator utama di Overview -> buka drilldown
  // perhitungan indikator itu (target/realisasi/capaian 12 bulan).
  document.addEventListener("click", (ev) => {
    const card = ev.target.closest(".kpi-mini-card[data-indicator]");
    if (card) openDrilldown(state.ulp, card.getAttribute("data-indicator"), state.bulan);
  });

  function nkoBadge(nko) {
    if (nko === null || nko === undefined) return `<span class="kpi-badge kpi-badge-na">-</span>`;
    const st = pctStatus(nko / 100);
    return `<span class="kpi-badge" style="background:${st.color}1a;color:${st.color}">${st.label}</span>`;
  }

  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  /* ============================================================
     DETAIL PERHITUNGAN (drill-down)
     Klik angka/grafik KPI -> modal menampilkan data dasar perhitungan
     (target, realisasi, capaian, nilai, bobot) langsung dari data
     Google Sheets yang sudah dimuat (DATA.ulp), bukan angka karangan.
     ============================================================ */
  let kpiModal = null;

  function ensureKpiModal() {
    if (kpiModal) return kpiModal;
    kpiModal = document.createElement("div");
    kpiModal.className = "detail-modal kpi-drill-modal";
    kpiModal.innerHTML = `
      <div class="detail-modal-backdrop" data-kpi-close></div>
      <div class="detail-modal-panel">
        <div class="detail-modal-header">
          <div>
            <h3 id="kpiDrillTitle"></h3>
            <div class="detail-modal-sub" id="kpiDrillSub"></div>
          </div>
          <button class="detail-modal-close" data-kpi-close aria-label="Tutup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="detail-modal-body" id="kpiDrillBody"></div>
      </div>`;
    kpiModal.querySelectorAll("[data-kpi-close]").forEach((el) =>
      el.addEventListener("click", closeKpiModal)
    );
    document.body.appendChild(kpiModal);
    return kpiModal;
  }

  function openKpiModal(title, sub, bodyHtml) {
    const modal = ensureKpiModal();
    modal.querySelector("#kpiDrillTitle").textContent = title;
    modal.querySelector("#kpiDrillSub").textContent = sub;
    modal.querySelector("#kpiDrillBody").innerHTML = bodyHtml;
    modal.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeKpiModal() {
    if (!kpiModal) return;
    kpiModal.classList.remove("show");
    document.body.style.overflow = "";
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeKpiModal();
  });

  // Ringkasan bulan aktif untuk 1 indikator (target/realisasi/capaian/nilai/bobot).
  function indicatorSnapshot(ind, mi) {
    const target = ind.target2026 ? ind.target2026[mi] : null;
    const real = ind.realisasi2026 ? ind.realisasi2026[mi] : null;
    let pct = ind.prosentase2026 && ind.prosentase2026[mi] !== undefined ? ind.prosentase2026[mi] : null;
    if ((pct === null || pct === undefined) && target != null && target !== 0 && real != null && !isNaN(real)) {
      pct = computePct(ind.name, target, real);
    }
    return { target, real, pct, nilai: ind.nilai ?? null, bobot: ind.bobot ?? null };
  }

  // Modal utama: detail perhitungan 1 indikator di 1 ULP untuk 1 bulan.
  function openDrilldown(ulpCode, indicatorName, month) {
    if (!DATA || !DATA.ulp) return;
    const ulp = DATA.ulp[ulpCode];
    const ind = findIndicator(ulpCode, indicatorName);
    if (!ulp || !ind) {
      openKpiModal(indicatorName, "Data tidak ditemukan",
        `<p class="kpi-drill-empty">Indikator tidak ada pada data Google Sheets untuk unit ini.</p>`);
      return;
    }
    const mi = Math.max(0, monthIdx(month));
    const snap = indicatorSnapshot(ind, mi);
    const dir = indicatorDirection(ind.name);
    const dirText = dir === "down" ? "Semakin kecil semakin baik" : dir === "range" ? "Realisasi dalam rentang target" : "Semakin besar semakin baik";
    const st = pctStatus(snap.pct);
    const ulpLabel = DATA.meta.ulpLabel[ulpCode] || ulpCode;
    const bulanLabel = DATA.meta.monthsID[mi] || month;

    const targetTxt = (i) => {
      if (ind.target2026 && ind.target2026[i] !== null && ind.target2026[i] !== undefined) return fmt(ind.target2026[i], 2);
      if (ind.target2026Range && ind.target2026Range[i]) return ind.target2026Range[i] + "%";
      return "-";
    };

    const summary = [
      { label: "BOBOT", value: snap.bobot !== null && snap.bobot !== undefined ? fmt(snap.bobot, 2) : "-" },
      { label: "TARGET", value: snap.target !== null ? fmt(snap.target, 2) : (ind.target2026Range && ind.target2026Range[mi] ? ind.target2026Range[mi] + "%" : "-") },
      { label: "REALISASI", value: snap.real !== null ? fmt(snap.real, 2) : "-" },
      { label: "CAPAIAN", value: fmtPct(snap.pct), color: st.color },
      { label: "NILAI", value: snap.nilai !== null ? fmt(snap.nilai, 2) : "-" }
    ].map((c) => `<div class="kpi-drill-stat"><span>${c.label}</span><b${c.color ? ` style="color:${c.color}"` : ""}>${c.value}</b></div>`).join("");

    const months = DATA.meta.monthsID;
    const rows = months.map((m, i) => {
      const t = ind.target2026 ? ind.target2026[i] : null;
      const r = ind.realisasi2026 ? ind.realisasi2026[i] : null;
      let p = ind.prosentase2026 && ind.prosentase2026[i] !== undefined ? ind.prosentase2026[i] : null;
      if ((p === null || p === undefined) && t != null && t !== 0 && r != null) p = computePct(ind.name, t, r);
      const pst = pctStatus(p);
      return `<tr${i === mi ? ' class="kpi-drill-active"' : ""}>
        <td>${m} 2026</td>
        <td class="num">${targetTxt(i)}</td>
        <td class="num">${r !== null ? fmt(r, 2) : "-"}</td>
        <td class="num"><b style="color:${pst.color}">${fmtPct(p)}</b></td>
      </tr>`;
    }).join("");

    openKpiModal(
      indicatorName,
      `${ulpLabel} · ${bulanLabel} 2026 · Satuan: ${ind.satuan ? ind.satuan : "-"} · ${dirText}`,
      `<div class="kpi-drill-src">Data asli dari Google Sheets — sheet <code>${ulpCode}</code>, periode ${bulanLabel} 2026. Baris aktif (▼) = bulan yang sedang dipilih di dashboard.</div>
       <div class="kpi-drill-stats">${summary}</div>
       <div class="kpi-drill-table-title">Target vs Realisasi vs Capaian — 12 bulan 2026</div>
       <div class="table-wrap"><table class="kpi-drill-table">
         <thead><tr><th>Bulan</th><th class="num">Target</th><th class="num">Realisasi</th><th class="num">Capaian</th></tr></thead>
         <tbody>${rows}</tbody>
       </table></div>`
    );
  }

  /* ============================================================
     HALAMAN 2 — PER INDIKATOR KPI  (grid 5-panel gaya sheet "Grafik")
     ============================================================ */
  function renderIndikator() {
    const name = state.indikator;
    const indSel = document.getElementById("kpiFilterIndikator");
    if (indSel) indSel.value = name;

    const indUp3 = findIndicator("CRB", name);
    if (!indUp3) return;
    setText("kpiIndikatorSatuan", indUp3.satuan || "");
    const dir = indicatorDirection(name);
    const dirText = dir === "down" ? "↓ Semakin kecil semakin baik" : dir === "range" ? "↔ Realisasi dalam rentang" : "↑ Semakin besar semakin baik";
    setText("kpiIndikatorJudul", `${name}  ·  ${dirText}`);

    const mi = monthIdx(state.indikatorBulan || state.bulan);
    const bulanLabel = DATA.meta.monthsID[mi] || state.indikatorBulan;
    setText("kpiPanelDPctSub", `${bulanLabel} 2026 · UP3 dan lima ULP`);
    setText("kpiPanelDRealSub", `${bulanLabel} 2026 · UP3 dan lima ULP`);

    const ulpCodes = ["CRB", "KTA", "KNG", "SBR", "CLD", "CLM"];
    const target = ulpCodes.map((u) => { const it = findIndicator(u, name); return it && it.target2026 ? it.target2026[mi] : null; });
    const real = ulpCodes.map((u) => { const it = findIndicator(u, name); return it && it.realisasi2026 ? it.realisasi2026[mi] : null; });
    const pct = ulpCodes.map((u) => {
      const it = findIndicator(u, name);
      if (!it) return null;
      const p = it.prosentase2026 ? it.prosentase2026[mi] : computePct(name, it.target2026 ? it.target2026[mi] : null, it.realisasi2026 ? it.realisasi2026[mi] : null);
      return p === null || p === undefined ? null : p * 100;
    });
    const barColors = pct.map((p) => pctStatus(p === null ? null : p / 100).color);
    const ulpLabels = ulpCodes.map((u) => u === "CRB" ? "UP3" : (DATA.meta.ulpLabel[u] || u).replace("ULP ", ""));

    // PANEL 1 — Prosentase Pencapaian per ULP
    makeChart("kpiPanelDPct", {
      type: "bar",
      data: { labels: ulpLabels, datasets: [{ label: "Pencapaian (%)", data: pct, backgroundColor: barColors, borderRadius: 4, barPercentage: .6, categoryPercentage: .7 }] },
      options: baseGridOptions({
        onClick: (evt, elements, chart) => {
          const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
          if (points.length) openDrilldown(ulpCodes[points[0].index], name, state.indikatorBulan || state.bulan);
        },
        onHover: (evt, elements, chart) => { chart.canvas.style.cursor = elements.length ? "pointer" : "default"; },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `Pencapaian: ${fmt(c.raw, 1)}%` } }
        },
        scales: { y: { grid: { color: PALETTE.grid }, ticks: { font: { size: 10 }, callback: (v) => v + "%" } } }
      })
    });

    // PANEL 2 — Pencapaian Realisasi per ULP (Target vs Realisasi)
    makeChart("kpiPanelDReal", {
      data: {
        labels: ulpLabels,
        datasets: [
          { type: "bar", label: "Target", data: target, backgroundColor: "#c8d3e0", borderRadius: 4, order: 2, barPercentage: .6, categoryPercentage: .7 },
          { type: "bar", label: "Realisasi", data: real, backgroundColor: PALETTE.primary, borderRadius: 4, order: 2, barPercentage: .6, categoryPercentage: .7 }
        ]
      },
      options: baseGridOptions({
        onClick: (evt, elements, chart) => {
          const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
          if (points.length) openDrilldown(ulpCodes[points[0].index], name, state.indikatorBulan || state.bulan);
        },
        onHover: (evt, elements, chart) => { chart.canvas.style.cursor = elements.length ? "pointer" : "default"; },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { color: PALETTE.grid }, ticks: { font: { size: 10 } } }
        }
      })
    });
  }

  /* ============================================================
     TABEL "Per Indikator KPI" DIKELOMPOKKAN PER BAGIAN + GRAFIK PER BAGIAN
     ============================================================ */
  const BAGIAN_ORDER = ["SAR PP", "JAR", "TE", "REN", "KU", "Lainnya"];

  function renderBagianTable() {
    const tbody = document.getElementById("kpiBagianTableBody");
    const sub = document.getElementById("kpiBagianTableSub");
    if (!tbody || !DATA) return;

    const ulpCode = state.ulpDetail || state.ulp || "CRB";
    const mi = monthIdx(state.indikatorBulan || state.bulan);
    const bulanLabel = DATA.meta.monthsID[mi] || state.bulan;
    if (sub) sub.textContent = `${DATA.meta.ulpLabel[ulpCode] || ulpCode} · ${bulanLabel} 2026`;

    const indicators = leafIndicators(ulpCode);
    const groups = {};
    indicators.forEach((ind) => {
      const bag = indicatorBagian(ind.name);
      (groups[bag] = groups[bag] || []).push(ind);
    });

    let rows = "";
    BAGIAN_ORDER.forEach((bagCode) => {
      const list = groups[bagCode];
      if (!list || !list.length) return;
      rows += `<tr class="kpi-bagian-header"><td colspan="6">${BAGIAN_LABELS[bagCode]}</td></tr>`;
      list.forEach((ind) => {
        const target = ind.target2026 ? ind.target2026[mi] : null;
        const real = ind.realisasi2026 ? ind.realisasi2026[mi] : null;
        const pct = ind.prosentase2026 && ind.prosentase2026[mi] !== undefined ? ind.prosentase2026[mi] : computePct(ind.name, target, real);
        const st = pctStatus(pct);
        const dir = indicatorDirection(ind.name);
        const dirIcon = dir === "down" ? "↓" : dir === "range" ? "↔" : "↑";
        rows += `<tr>
          <td>${dirIcon} ${ind.name}</td>
          <td>${ind.satuan || "-"}</td>
          <td>${typeof target === "string" ? target : fmt(target, 2)}</td>
          <td>${fmt(real, 2)}</td>
          <td><b style="color:${st.color}">${fmtPct(pct)}</b></td>
          <td>${nkoBadge(pct === null || pct === undefined ? null : pct * 100)}</td>
        </tr>`;
      });
    });
    tbody.innerHTML = rows || `<tr><td colspan="6">Tidak ada data indikator untuk ULP/bulan ini.</td></tr>`;

    // --- Grafik per bagian: rata-rata capaian (%) tiap bagian, dibandingkan antar ULP ---
    const ulpCodes = ["KTA", "KNG", "SBR", "CLD", "CLM"];
    const bagCodesWithData = BAGIAN_ORDER.filter((b) => b !== "Lainnya" && groups[b] && groups[b].length);
    const datasets = ulpCodes.map((u, idx) => {
      const data = bagCodesWithData.map((bagCode) => {
        const names = Object.keys(BAGIAN_MAP).filter((n) => BAGIAN_MAP[n] === bagCode);
        const pcts = names
          .map((n) => {
            const it = findIndicator(u, n);
            if (!it) return null;
            const t = it.target2026 ? it.target2026[mi] : null;
            const r = it.realisasi2026 ? it.realisasi2026[mi] : null;
            const p = it.prosentase2026 && it.prosentase2026[mi] !== undefined ? it.prosentase2026[mi] : computePct(n, t, r);
            return p === null || p === undefined || isNaN(p) ? null : p * 100;
          })
          .filter((v) => v !== null);
        if (!pcts.length) return null;
        return pcts.reduce((a, b) => a + b, 0) / pcts.length;
      });
      return {
        label: (DATA.meta.ulpLabel[u] || u).replace("ULP ", ""),
        data,
        backgroundColor: PALETTE.years[idx],
        borderRadius: 4,
        barPercentage: .78,
        categoryPercentage: .82
      };
    });
    makeChart("kpiChartPerBagian", {
      type: "bar",
      data: { labels: bagCodesWithData.map((b) => BAGIAN_LABELS[b]), datasets },
      options: baseGridOptions({
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw, 1)}%` } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { color: PALETTE.grid }, ticks: { font: { size: 10 }, callback: (v) => v + "%" } }
        }
      })
    });
  }

  /* ============================================================
     "Semua Indikator per Tema" — gaya sheet Grafik asli: 1 tema dipilih,
     grafik tema itu digambar untuk SETIAP indikator (bukan cuma 1 indikator
     seperti di 5 panel atas). Canvas dibuat dinamis karena jumlah indikator
     bervariasi per ULP/sumber data.
     ============================================================ */
  const TEMA_LABELS = {
    A: "Realisasi Kinerja UP3 Cirebon Tahun 2019 s/d 2026",
    B: "Realisasi Kumulatif Target vs Realisasi 2026",
    C: "Trend Bulanan UP3 Cirebon",
    D: "Realisasi Kinerja per ULP Tahun 2026",
    E: "Realisasi Kumulatif Kinerja Tahun A vs Tahun B UP3 Cirebon",
    F: "Realisasi Bulanan Kinerja Tahun A vs Tahun B UP3 Cirebon",
    G: "Realisasi Kinerja Tahun 2019 s/d 2023 UP3 Cirebon",
    H: "Realisasi Kinerja Tahun 2019 s/d 2023 per ULP (KTA, KNG, SBR, CLD, CLM)"
  };
  // Tahun yang dipakai tema G & H — sengaja dibatasi 2019-2023 sesuai sheet
  // "Grafik" asli (blok kolom CB/CJ/... di situ hanya berisi histori s/d 2023,
  // beda dengan tema A yang datanya sampai 2026).
  const TAHUN_2019_2023 = ["2019", "2020", "2021", "2022", "2023"];

  // Grid "Semua Indikator per Tema" bisa berisi ~50 mini chart sekaligus --
  // kalau semuanya dibuat SERENTAK tiap kali halaman ini dibuka/di-render
  // ulang (Chart.js cukup berat per instance), perpindahan halaman terasa
  // lambat/macet sesaat. Diperbaiki dengan LAZY RENDER: canvas dibuat
  // langsung (murah, cuma DOM), tapi chart Chart.js-nya baru benar-benar
  // digambar saat panel itu masuk ke area layar (IntersectionObserver),
  // jadi beban awal cuma sejumlah panel yang langsung terlihat, bukan semua.
  let temaObserver = null;
  function renderTemaGrafik() {
    const grid = document.getElementById("kpiTemaGrid");
    if (!grid || !DATA || !DATA.ulp) return;

    const tema = state.tema || "A";
    const mi = monthIdx(state.indikatorBulan || state.bulan);
    const indicators = leafIndicators("CRB"); // daftar indikator diambil dari UP3 CRB (total)

    // Bersihkan chart lama sebelum bikin canvas baru, supaya tidak leak memory.
    indicators.forEach((_, i) => destroy(`kpiTema_${i}`));
    if (temaObserver) { temaObserver.disconnect(); temaObserver = null; }
    grid.innerHTML = indicators.map((ind, i) => `
      <div class="panel kpi-mini-panel" data-tema-idx="${i}">
        <div class="kpi-mini-panel-title">${ind.name}</div>
        <div class="chart-canvas-wrap" style="height:200px;"><canvas id="kpiTema_${i}"></canvas></div>
      </div>
    `).join("");

    const drawOne = (i) => {
      const ind = indicators[i];
      if (!ind) return;
      const id = `kpiTema_${i}`;
      if (tema === "A") {
        const years = DATA.meta.years2019_2026;
        const vals = years.map((y) => {
          if (y === "2026") return ind.realisasi2026 ? ind.realisasi2026[mi] : null;
          const arr = ind["realisasi" + y];
          return arr ? arr[mi] : null;
        });
        makeChart(id, {
          type: "bar",
          data: { labels: years, datasets: [{ label: `Realisasi bulan ${DATA.meta.monthsID[mi]}`, data: vals, backgroundColor: PALETTE.primary, borderRadius: 4 }] },
          options: baseGridOptions({ plugins: { legend: { display: false } } })
        });
      } else if (tema === "B") {
        const tgtArr = state.tahunA === "2026" ? ind.target2026 : null;
        const realArr = (state.tahunA === "2026" ? ind.realisasi2026 : ind["realisasi" + state.tahunA]) || new Array(12).fill(null);
        const pctArr = realArr.map((r, mIdx) => (tgtArr && tgtArr[mIdx] ? r / tgtArr[mIdx] : null));
        makeChart(id, {
          data: {
            labels: DATA.meta.monthsID,
            datasets: [
              ...(tgtArr ? [{ type: "bar", label: `Target ${state.tahunA}`, data: tgtArr, backgroundColor: "#c8d3e0", order: 2 }] : []),
              { type: "bar", label: `Realisasi ${state.tahunA}`, data: realArr, backgroundColor: PALETTE.realisasi, order: 2 },
              { type: "line", label: "Pencapaian (%)", data: pctArr.map((v) => (v === null ? null : v * 100)), borderColor: PALETTE.primaryDark, yAxisID: "y1", tension: 0.3, order: 1 }
            ]
          },
          options: baseGridOptions({
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 } } },
              y: { grid: { color: PALETTE.grid }, ticks: { font: { size: 9 } } },
              y1: { position: "right", grid: { display: false }, ticks: { font: { size: 9 }, callback: (v) => v + "%" } }
            }
          })
        });
      } else if (tema === "C") {
        const realArr = state.tahunA === "2026" ? ind.realisasi2026 : ind["realisasi" + state.tahunA];
        makeChart(id, {
          type: "line",
          data: { labels: DATA.meta.monthsID, datasets: [{ label: `Realisasi ${state.tahunA}`, data: realArr || [], borderColor: PALETTE.danger, backgroundColor: PALETTE.danger, tension: 0.35, pointRadius: 3, fill: false }] },
          options: baseGridOptions({ plugins: { legend: { display: false } } })
        });
      } else if (tema === "D") {
        const ulpCodes = ["KTA", "KNG", "SBR", "CLD", "CLM"];
        const realD = ulpCodes.map((u) => { const it = findIndicator(u, ind.name); return it && it.realisasi2026 ? it.realisasi2026[mi] : null; });
        const pctD = ulpCodes.map((u) => { const it = findIndicator(u, ind.name); return it && it.prosentase2026 ? it.prosentase2026[mi] * 100 : null; });
        makeChart(id, {
          data: {
            labels: ulpCodes,
            datasets: [
              { type: "bar", label: DATA.meta.monthsID[mi], data: realD, backgroundColor: PALETTE.primary, order: 2 },
              { type: "line", label: "Pencapaian (%)", data: pctD, borderColor: PALETTE.danger, yAxisID: "y1", order: 1 }
            ]
          },
          options: baseGridOptions({
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 } } },
              y: { grid: { color: PALETTE.grid }, ticks: { font: { size: 9 } } },
              y1: { position: "right", grid: { display: false }, ticks: { font: { size: 9 }, callback: (v) => v + "%" } }
            }
          })
        });
      } else if (tema === "E") {
        // Kumulatif: setiap bulan = akumulasi realisasi dari Januari s.d. bulan itu.
        const cumulate = (arr) => {
          if (!arr) return null;
          let running = 0;
          return arr.map((v) => { running += Number(v) || 0; return running; });
        };
        const realA = cumulate((state.tahunA === "2026" ? ind.realisasi2026 : ind["realisasi" + state.tahunA]) || null);
        const realB = cumulate((state.tahunB === "2026" ? ind.realisasi2026 : ind["realisasi" + state.tahunB]) || null);
        makeChart(id, {
          type: "line",
          data: {
            labels: DATA.meta.monthsID,
            datasets: [
              { label: `Kumulatif ${state.tahunA}`, data: realA || [], borderColor: PALETTE.years[0], backgroundColor: PALETTE.years[0], tension: 0.3, fill: false },
              { label: `Kumulatif ${state.tahunB}`, data: realB || [], borderColor: PALETTE.years[1], backgroundColor: PALETTE.years[1], tension: 0.3, fill: false }
            ]
          },
          options: baseGridOptions()
        });
      } else if (tema === "F") {
        const realA = (state.tahunA === "2026" ? ind.realisasi2026 : ind["realisasi" + state.tahunA]) || [];
        const realB = (state.tahunB === "2026" ? ind.realisasi2026 : ind["realisasi" + state.tahunB]) || [];
        makeChart(id, {
          type: "bar",
          data: {
            labels: DATA.meta.monthsID,
            datasets: [
              { label: state.tahunA, data: realA, backgroundColor: PALETTE.years[0] },
              { label: state.tahunB, data: realB, backgroundColor: PALETTE.years[1] }
            ]
          },
          options: baseGridOptions()
        });
      } else if (tema === "G") {
        const vals = TAHUN_2019_2023.map((y) => {
          const arr = y === "2026" ? ind.realisasi2026 : ind["realisasi" + y];
          return arr ? arr[mi] : null;
        });
        makeChart(id, {
          type: "bar",
          data: { labels: TAHUN_2019_2023, datasets: [{ label: `Realisasi bulan ${DATA.meta.monthsID[mi]}`, data: vals, backgroundColor: PALETTE.primary, borderRadius: 4 }] },
          options: baseGridOptions({ plugins: { legend: { display: false } } })
        });
      } else if (tema === "H") {
        const ulpCodes = ["KTA", "KNG", "SBR", "CLD", "CLM"];
        makeChart(id, {
          type: "line",
          data: {
            labels: TAHUN_2019_2023,
            datasets: ulpCodes.map((u, uIdx) => {
              const it = findIndicator(u, ind.name);
              const vals = TAHUN_2019_2023.map((y) => {
                const arr = it ? (y === "2026" ? it.realisasi2026 : it["realisasi" + y]) : null;
                return arr ? arr[mi] : null;
              });
              const color = PALETTE.years[uIdx % PALETTE.years.length];
              return { label: u, data: vals, borderColor: color, backgroundColor: color, tension: 0.3, fill: false };
            })
          },
          options: baseGridOptions()
        });
      }
    };

    // Render langsung ~6 panel pertama (biasanya sudah cukup mengisi layar
    // atas) supaya halaman tidak terasa kosong, sisanya baru digambar saat
    // panelnya benar-benar discroll ke area layar.
    const eagerCount = Math.min(6, indicators.length);
    for (let i = 0; i < eagerCount; i++) drawOne(i);

    if (indicators.length > eagerCount && typeof IntersectionObserver === "function") {
      temaObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const idx = Number(entry.target.getAttribute("data-tema-idx"));
            drawOne(idx);
            temaObserver.unobserve(entry.target);
          });
        },
        { root: null, rootMargin: "200px 0px", threshold: 0.01 }
      );
      Array.from(grid.children)
        .slice(eagerCount)
        .forEach((panel) => temaObserver.observe(panel));
    } else if (indicators.length > eagerCount) {
      // Fallback browser lama tanpa IntersectionObserver: tetap gambar semua.
      for (let i = eagerCount; i < indicators.length; i++) drawOne(i);
    }
  }

  /* ============================================================
     HALAMAN 3 — PER ULP (drilldown tabel, filter periode)
     ============================================================ */
  function renderUlpDetail() {
    const ulpSel = document.getElementById("kpiFilterUlpDetail");
    if (ulpSel) ulpSel.value = state.ulpDetail;
    const bulanSel = document.getElementById("kpiUlpDetailBulan");
    if (bulanSel) bulanSel.value = state.ulpDetailBulan;

    const ulp = DATA.ulp[state.ulpDetail];
    const mi = monthIdx(state.ulpDetailBulan || state.bulan);
    setText("kpiUlpDetailTitle", `Realisasi Kinerja ${ulp.label}`);
    setText("kpiUlpDetailSub", `Bulan: ${DATA.meta.monthsID[mi]} 2026`);

    const tbody = document.getElementById("kpiUlpDetailBody");
    if (!tbody) return;

    let rows = "";
    ulp.indicators.forEach((it) => {
      if (it.isGroup) {
        rows += `<tr class="kpi-group-row"><td colspan="10">${it.no ? it.no + ". " : ""}${it.name}</td></tr>`;
        return;
      }
      const target = it.target2026 ? it.target2026[mi] : null;
      const real = it.realisasi2026 ? it.realisasi2026[mi] : null;
      const pct = it.prosentase2026 ? it.prosentase2026[mi] : computePct(it.name, target, real);
      const st = pctStatus(pct);
      const score = scoreParts(it.bobot, pct);
      const dir = indicatorDirection(it.name);
      const dirIcon = dir === "down" ? "↓" : dir === "range" ? "↔" : "↑";
      const targetDisplay = target !== null ? fmt(target, 2) : (it.target2026Range && it.target2026Range[mi] ? it.target2026Range[mi] + "%" : (it.targetBulanIniRange ? it.targetBulanIniRange + "%" : "-"));
      rows += `<tr>
        <td>${it.no || ""}</td>
        <td><span class="kpi-dir-icon" title="${dir === "down" ? "Semakin kecil semakin baik" : dir === "range" ? "Realisasi harus dalam rentang" : "Semakin besar semakin baik"}">${dirIcon}</span> ${it.name}</td>
        <td>${it.satuan || ""}</td>
        <td class="num">${targetDisplay}</td>
        <td class="num">${fmt(real, 2)}</td>
        <td class="num">${fmtPct(pct)}</td>
        <td><span class="kpi-badge" style="background:${st.color}1a;color:${st.color}">${st.label}</span></td>
        <td>${it.bobot ?? "-"}</td>
        <td class="num">${fmt(score.nilai, 2)}</td>
        <td class="num kpi-loss-value">${fmt(score.loss, 2)}</td>
      </tr>`;
    });
    tbody.innerHTML = rows;
    renderUlpLegendBox(ulp);
  }

  // Kotak "Keterangan" (arah indikator ⬆️/⬇️/🔛 + kategori 🟢 Baik / 🟡 Hati-hati
  // / 🔴 Awas) — datanya dari ulp.legend, dikirim TERPISAH oleh getUlpData_()
  // (bukan lagi dibaca sebagai baris "group" di ulp.indicators). Kalau backend
  // belum di-redeploy dengan patch terbaru, ulp.legend akan kosong/undefined
  // dan kotak ini otomatis disembunyikan (fallback lama masih tampil di tabel).
  function renderUlpLegendBox(ulp) {
    const box = document.getElementById("kpiUlpLegendBox");
    if (!box) return;
    const legend = (ulp && ulp.legend) || [];
    if (!legend.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const total = ulp.totalBobot;
    box.hidden = false;
    box.innerHTML = `
      <div class="kpi-legend-title">Keterangan</div>
      ${total && (total.bobot !== null || total.nilai !== null)
        ? `<div class="kpi-legend-total">Total Bobot: <strong>${total.bobot ?? "-"}</strong> &nbsp;·&nbsp; Nilai: <strong>${fmt(total.nilai, 2)}</strong></div>`
        : ""}
      <div class="kpi-legend-list">
        ${legend
          .map(
            (l) =>
              `<div class="kpi-legend-item"><span class="kpi-legend-icon">${l.icon || ""}</span><span>${l.text}</span></div>`
          )
          .join("")}
      </div>
    `;
  }

  /* ============================================================
     HALAMAN 4 — PERBANDINGAN ULP
     ============================================================ */
  function renderBanding() {
    const indSel = document.getElementById("kpiBandingIndikator");
    if (indSel) indSel.value = state.bandingIndikator;
    const bulanSel = document.getElementById("kpiBandingBulan");
    if (bulanSel) bulanSel.value = state.bandingBulan;

    const name = state.bandingIndikator || state.indikator;
    const mi = monthIdx(state.bandingBulan || state.bulan);
    const ulpCodes = ["KTA", "KNG", "SBR", "CLD", "CLM"];
    const chartCodes = ["CRB"].concat(ulpCodes);
    setText("kpiBandingJudul", `${name} — ${DATA.meta.monthsID[mi]} 2026`);

    const chartTarget = chartCodes.map((u) => { const i = findIndicator(u, name); return i && i.target2026 ? i.target2026[mi] : null; });
    const chartReal = chartCodes.map((u) => { const i = findIndicator(u, name); return i && i.realisasi2026 ? i.realisasi2026[mi] : null; });
    const chartPct = chartCodes.map((u) => { const i = findIndicator(u, name); return i && i.prosentase2026 ? i.prosentase2026[mi] : null; });
    const real = chartReal.slice(1);
    const pct = chartPct.slice(1);

    makeChart("kpiBandingChart", {
      data: {
        labels: chartCodes.map((u) => u === "CRB" ? "UP3" : u),
        datasets: [
          { type: "bar", label: "Target", data: chartTarget, backgroundColor: chartCodes.map((u) => u === "CRB" ? "#f5a524" : "#c8d3e0"), order: 2 },
          { type: "bar", label: "Realisasi", data: chartReal, backgroundColor: chartCodes.map((u) => u === "CRB" ? "#06294f" : PALETTE.primary), order: 2 },
          { type: "line", label: "Pencapaian (%)", data: chartPct.map((v) => (v === null ? null : v * 100)), borderColor: PALETTE.danger, yAxisID: "y1", order: 1 }
        ]
      },
      options: baseGridOptions({
        onClick: (evt, elements, chart) => {
          const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
          if (points.length) openDrilldown(chartCodes[points[0].index], name, state.bandingBulan || state.bulan);
        },
        onHover: (evt, elements, chart) => { chart.canvas.style.cursor = elements.length ? "pointer" : "default"; },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { color: PALETTE.grid }, ticks: { font: { size: 10 } } },
          y1: { position: "right", grid: { display: false }, ticks: { font: { size: 10 }, callback: (v) => v + "%" } }
        }
      })
    });

    // tabel ranking cepat untuk indikator ini — klik baris -> drilldown detail
    const tbody = document.getElementById("kpiBandingBody");
    if (tbody) {
      const rowsData = ulpCodes
        .map((u, i) => ({ u, real: real[i], pct: pct[i] }))
        .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
      tbody.innerHTML = rowsData
        .map((r, idx) => {
          const st = pctStatus(r.pct);
          return `<tr class="kpi-row-clickable" data-ulp="${r.u}" data-indicator="${escAttr(name)}" title="Klik untuk lihat detail perhitungan">
            <td>${idx + 1}</td>
            <td>${DATA.meta.ulpLabel[r.u]}</td>
            <td class="num">${fmt(r.real, 2)}</td>
            <td class="num">${fmtPct(r.pct)}</td>
            <td><span class="kpi-badge" style="background:${st.color}1a;color:${st.color}">${st.label}</span></td>
          </tr>`;
        })
        .join("");
    }
  }

  /* ============================================================
     HALAMAN 5 — DATA PENGUSAHAAN (pelanggan & daya tersambung)
     ============================================================ */
  function renderPengusahaan() {
    const rows = DATA.dataPengusahaan;
    const fallbackUnit = "UP3 Cirebon";
    const fallbackBagian = "BAGIAN SAR & PP";
    const years = DATA.meta.years2019_2026.filter((y) => y !== "2019");
    const units = Array.from(new Set(rows.map((r) => r.unit || fallbackUnit)));
    const hasUlpData = units.some((u) => /^ULP\s+/i.test(u));
    if (!units.includes(state.pengusahaanUnit)) state.pengusahaanUnit = units[0] || fallbackUnit;

    const unitRows = rows.filter((r) => (r.unit || fallbackUnit) === state.pengusahaanUnit);
    const isUlp = /^ULP\s+/i.test(state.pengusahaanUnit);
    const bagianList = Array.from(new Set(unitRows.map((r) => r.bagian || fallbackBagian)));
    if (!bagianList.includes(state.pengusahaanBagian)) state.pengusahaanBagian = bagianList[0] || "";
    const availableYears = isUlp
      ? Array.from(new Set(unitRows.map((r) => r.tahun).filter(Boolean)))
      : years;
    if (!availableYears.includes(state.pengusahaanTahun)) state.pengusahaanTahun = availableYears[availableYears.length - 1] || "";
    const monthCodes = DATA.meta.months || MONTHS_EN;
    const monthlySource = isUlp ? unitRows : rows.filter((r) => /^ULP\s+/i.test(r.unit || ""));
    let latestMonthIndex = -1;
    monthlySource.forEach((r) => (r.monthly2026 || []).forEach((v, i) => {
      if (v !== null && v !== undefined && !isNaN(v)) latestMonthIndex = Math.max(latestMonthIndex, i);
    }));
    if (!monthCodes.includes(state.pengusahaanBulan)) {
      state.pengusahaanBulan = monthCodes[latestMonthIndex >= 0 ? latestMonthIndex : monthCodes.length - 1];
    }
    const monthIndex = monthCodes.indexOf(state.pengusahaanBulan);
    const periodLabel = isUlp ? `${DATA.meta.monthsID[monthIndex] || state.pengusahaanBulan} ${state.pengusahaanTahun}` : state.pengusahaanTahun;

    const bindSelect = (id, options, value, onChange, disabled) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = options.map((o) => `<option value="${escAttr(o.value)}">${o.label}</option>`).join("");
      el.value = value;
      el.disabled = !!disabled;
      if (!el.dataset.bound) {
        el.dataset.bound = "1";
        el.addEventListener("change", () => onChange(el.value));
      }
    };
    bindSelect("kpiPengusahaanUnit", units.map((u) => ({ value: u, label: u })), state.pengusahaanUnit, (v) => {
      state.pengusahaanUnit = v;
      state.pengusahaanBagian = "";
      renderPengusahaan();
    });
    bindSelect("kpiPengusahaanBagian", bagianList.map((b) => ({ value: b, label: b })), state.pengusahaanBagian, (v) => {
      state.pengusahaanBagian = v;
      renderPengusahaan();
    }, bagianList.length <= 1);
    bindSelect("kpiPengusahaanTahun", availableYears.map((y) => ({ value: y, label: `Tahun ${y}` })), state.pengusahaanTahun, (v) => {
      state.pengusahaanTahun = v;
      renderPengusahaan();
    }, availableYears.length <= 1);
    bindSelect("kpiPengusahaanBulan", monthCodes.map((m, i) => ({ value: m, label: DATA.meta.monthsID[i] || m })), state.pengusahaanBulan, (v) => {
      state.pengusahaanBulan = v;
      renderPengusahaan();
    }, !isUlp);

    const reset = document.getElementById("kpiPengusahaanReset");
    if (reset && !reset.dataset.bound) {
      reset.dataset.bound = "1";
      reset.addEventListener("click", () => {
        state.pengusahaanUnit = fallbackUnit;
        state.pengusahaanBagian = fallbackBagian;
        state.pengusahaanTahun = "2026";
        state.pengusahaanBulan = "";
        renderPengusahaan();
      });
    }

    const normalizedLabel = (value) => String(value || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
    const metric = (source, name, satuan) => source.find((r) => normalizedLabel(r.label) === name && (!satuan || String(r.satuan || "").toLowerCase() === satuan.toLowerCase()));
    const pelanggan = metric(unitRows, "jumlah pelanggan");
    const daya = metric(unitRows, "daya tersambung", "MVA");
    const penjualan = metric(unitRows, "penjualan");
    const pendapatan = metric(unitRows, "pendapatan");
    const selectedValue = (r, offset = 0) => {
      if (!r) return null;
      if (isUlp) {
        const idx = monthIndex + offset;
        return idx >= 0 && r.monthly2026 ? r.monthly2026[idx] : null;
      }
      const idx = years.indexOf(state.pengusahaanTahun) + offset;
      return idx >= 0 && r.yearly ? r.yearly[years[idx]] : null;
    };
    const excelColumn = (number) => {
      let result = "";
      for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
      return result;
    };
    const sourceRef = (r, periodIndex, monthly = isUlp) => {
      if (!r || !r.sourceRow) return "DATA PENGUSAHAAN · referensi sel menunggu pembaruan API";
      const column = monthly ? 4 + periodIndex : 20 + periodIndex;
      return `${r.sourceSheet || "DATA PENGUSAHAAN"}!${excelColumn(column)}${r.sourceRow}`;
    };
    const metricText = (r, value) => value === null || value === undefined || isNaN(value) ? "-" : `${fmt(value, /plg/i.test(r.satuan || "") ? 0 : 2)}${r.satuan ? " " + r.satuan : ""}`;
    if (!document.body.dataset.pengusahaanSourceBound) {
      document.body.dataset.pengusahaanSourceBound = "1";
      document.addEventListener("click", (event) => {
        const target = event.target.closest(".pengusahaan-source-click");
        if (!target) return;
        const cell = target.closest("td");
        const source = target.dataset.source || cell?.querySelector(".source-ref, .source-code")?.textContent || cell?.nextElementSibling?.querySelector(".source-code")?.textContent || "Referensi sel belum tersedia";
        window.alert(`Asal nilai\nNilai: ${target.textContent.trim()}\nSumber: ${source}\n\nPerhitungan: nilai dibaca langsung dari sel sumber dan tidak diubah oleh dashboard.`);
      });
      document.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && event.target.classList?.contains("pengusahaan-source-click")) {
          event.preventDefault();
          event.target.click();
        }
      });
    }
    const setMetricCard = (valueId, deltaId, r) => {
      const current = selectedValue(r);
      const previous = selectedValue(r, -1);
      setText(valueId, metricText(r || {}, current));
      const valueEl = document.getElementById(valueId);
      const sourceIndex = isUlp ? monthIndex : years.indexOf(state.pengusahaanTahun);
      if (valueEl) {
        valueEl.classList.add("pengusahaan-source-click");
        valueEl.dataset.source = sourceRef(r, sourceIndex);
        valueEl.setAttribute("role", "button");
        valueEl.setAttribute("tabindex", "0");
        valueEl.setAttribute("title", "Klik untuk melihat asal nilai");
      }
      const deltaEl = document.getElementById(deltaId);
      if (!deltaEl) return;
      if (current === null || current === undefined || previous === null || previous === undefined || !previous) {
        const sourceIndex = isUlp ? monthIndex : years.indexOf(state.pengusahaanTahun);
        deltaEl.textContent = `Periode ${periodLabel} · pembanding tidak tersedia · Sumber: ${sourceRef(r, sourceIndex)}`;
        deltaEl.className = "";
      } else {
        const change = ((current - previous) / Math.abs(previous)) * 100;
        const sourceIndex = isUlp ? monthIndex : years.indexOf(state.pengusahaanTahun);
        deltaEl.textContent = `${change > 0 ? "↑" : change < 0 ? "↓" : "±"} ${fmt(Math.abs(change), 1)}% dari periode sebelumnya · Sumber: ${sourceRef(r, sourceIndex)} vs ${sourceRef(r, sourceIndex - 1)}`;
        deltaEl.className = change > 0 ? "pengusahaan-delta-up" : change < 0 ? "pengusahaan-delta-down" : "";
      }
    };
    setMetricCard("kpiPengusahaanStatPelanggan", "kpiPengusahaanDeltaPelanggan", pelanggan);
    setMetricCard("kpiPengusahaanStatDaya", "kpiPengusahaanDeltaDaya", daya);
    setMetricCard("kpiPengusahaanStatPenjualan", "kpiPengusahaanDeltaPenjualan", penjualan);
    setMetricCard("kpiPengusahaanStatPendapatan", "kpiPengusahaanDeltaPendapatan", pendapatan);

    ["kpiPengusahaanDeltaPelanggan", "kpiPengusahaanDeltaDaya", "kpiPengusahaanDeltaPenjualan", "kpiPengusahaanDeltaPendapatan"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.textContent.includes("Sumber:")) el.textContent = el.textContent.split(" · Sumber:")[0];
    });

    const trendLabels = isUlp ? DATA.meta.monthsID : years;
    const trendValues = (r) => !r ? trendLabels.map(() => null) : isUlp ? r.monthly2026 : years.map((y) => r.yearly[y]);
    makeChart("kpiPengusahaanPelangganDaya", {
      type: "line",
      data: { labels: trendLabels, datasets: [
        { label: "Jumlah Pelanggan", data: trendValues(pelanggan), sourceRow: pelanggan, borderColor: PALETTE.primary, backgroundColor: PALETTE.primary, yAxisID: "y", tension: .3 },
        { label: "Daya Tersambung (MVA)", data: trendValues(daya), sourceRow: daya, borderColor: PALETTE.realisasi, backgroundColor: PALETTE.realisasi, yAxisID: "y1", tension: .3 }
      ] },
      options: baseGridOptions({ scales: { y: { position: "left", grid: { color: PALETTE.grid } }, y1: { position: "right", grid: { drawOnChartArea: false } }, x: { grid: { display: false } } } })
    });
    makeChart("kpiPengusahaanKomersial", {
      type: "line",
      data: { labels: trendLabels, datasets: [
        { label: "Penjualan", data: trendValues(penjualan), sourceRow: penjualan, borderColor: PALETTE.success, backgroundColor: PALETTE.success, yAxisID: "y", tension: .3 },
        { label: "Pendapatan", data: trendValues(pendapatan), sourceRow: pendapatan, borderColor: PALETTE.danger, backgroundColor: PALETTE.danger, yAxisID: "y1", tension: .3 }
      ] },
      options: baseGridOptions({ scales: { y: { position: "left", grid: { color: PALETTE.grid } }, y1: { position: "right", grid: { drawOnChartArea: false } }, x: { grid: { display: false } } } })
    });
    setText("kpiPengusahaanTrendCustomerSub", `${state.pengusahaanUnit} · ${isUlp ? "Bulanan " + state.pengusahaanTahun : "Tahunan 2020–2026"}`);
    setText("kpiPengusahaanTrendCommercialSub", `${state.pengusahaanUnit} · nilai sesuai satuan pada sheet`);
    setText("kpiPengusahaanContext", `${state.pengusahaanUnit} · ${state.pengusahaanBagian} · ${periodLabel}${hasUlpData ? "" : " · Data ULP menunggu pembaruan API"}`);

    const comparisonBody = document.getElementById("kpiPengusahaanComparisonBody");
    const ulpUnits = units.filter((u) => /^ULP\s+/i.test(u));
    if (comparisonBody) comparisonBody.innerHTML = ulpUnits.map((unit) => {
      const source = rows.filter((r) => (r.unit || fallbackUnit) === unit);
      const get = (name, satuan) => metric(source, name, satuan);
      const val = (r) => r && r.monthly2026 ? r.monthly2026[monthIndex] : null;
      const year = source.find((r) => r.tahun)?.tahun || "-";
      const sourceValue = (r) => `<span class="source-value">${metricText(r, val(r))}</span><small class="source-ref">${sourceRef(r, monthIndex, true)}</small>`;
      return `<tr><td><strong>${unit}</strong></td><td>${DATA.meta.monthsID[monthIndex] || state.pengusahaanBulan} ${year}</td>
        <td class="num">${sourceValue(get("jumlah pelanggan"))}</td>
        <td class="num">${sourceValue(get("daya tersambung", "MVA"))}</td>
        <td class="num">${sourceValue(get("penjualan"))}</td>
        <td class="num">${sourceValue(get("pendapatan"))}</td></tr>`;
    }).join("") || `<tr><td colspan="6" class="empty-table-cell">Data per ULP belum tersedia dari API.</td></tr>`;
    setText("kpiPengusahaanComparisonSub", `Perbandingan ${DATA.meta.monthsID[monthIndex] || state.pengusahaanBulan} · periode mengikuti blok ULP pada sheet`);

    const detailRows = unitRows.filter((r) => (r.bagian || fallbackBagian) === state.pengusahaanBagian);
    const tbody = document.getElementById("kpiPengusahaanBody");
    const thead = document.getElementById("kpiPengusahaanHead");
    if (thead) thead.innerHTML = `<tr><th>Unit</th><th>Bagian</th><th>Komponen</th><th>Satuan</th><th>Periode</th><th>Nilai</th><th>Sumber</th></tr>`;
    if (tbody) tbody.innerHTML = detailRows.map((r) => {
      const raw = selectedValue(r);
      const sourceIndex = isUlp ? monthIndex : years.indexOf(state.pengusahaanTahun);
      return `<tr><td>${r.unit || fallbackUnit}</td><td>${r.bagian || fallbackBagian}</td><td>${r.label}</td><td>${r.satuan || "-"}</td><td>${periodLabel}</td><td class="num">${r.satuan === "%" ? fmtPct(raw) : fmt(raw, 2)}</td><td><code class="source-code">${sourceRef(r, sourceIndex)}</code></td></tr>`;
    }).join("") || `<tr><td colspan="7" class="empty-table-cell">Tidak ada data untuk filter yang dipilih.</td></tr>`;
    setText("kpiPengusahaanTableSub", `${state.pengusahaanUnit} · ${state.pengusahaanBagian} · ${periodLabel}`);
    document.querySelectorAll("#kpiPengusahaanComparisonBody .source-value, #kpiPengusahaanBody td.num").forEach((el) => {
      el.classList.add("pengusahaan-source-click");
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("title", "Klik untuk melihat asal nilai");
    });
  }

  return { init, reload, renderPage, state, get DATA() { return DATA; } };
})();

// Ekspos KPI ke global supaya script.js (router nav & tombol refresh) bisa
// memanggil KPI.renderPage() / KPI.reload(). Tanpa ini, nav KPI tidak akan
// me-render halaman apa pun sehingga dashboard tampak "kosong / tidak tampil".
window.KPI = KPI;

document.addEventListener("DOMContentLoaded", () => {
  KPI.init();
});
