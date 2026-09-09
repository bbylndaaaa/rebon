// Definisi kolom tabel: mengikuti persis struktur sheet
// "MONITORING ANGGARAN SKKI" pada file Excel yang diunggah.
const COLUMNS = [
  { key: "no", label: "No.", type: "number" },
  { key: "unit", label: "Unit", type: "text" },
  { key: "noAnggaran", label: "No Anggaran", type: "text" },
  { key: "uraianAnggaran", label: "Uraian Anggaran", type: "text" },
  { key: "prkPos", label: "PRK/POS", type: "text" },
  { key: "uraianPrkPos", label: "Uraian PRK/POS", type: "text" },
  { key: "pagu", label: "Pagu (Rp.)", type: "currency" },
  { key: "disburse", label: "Disburse (Rp.)", type: "currency" },
  { key: "usulan", label: "Usulan (Rp.)", type: "currency" },
  { key: "aiTerkontrak", label: "AI Terkontrak (Rp.)", type: "currency" },
  { key: "akiTerkontrak", label: "AKI Terkontrak (Rp.)", type: "currency" },
  { key: "tertagih", label: "Tertagih (Rp.)", type: "currency" },
  { key: "terbayar", label: "Terbayar (Rp.)", type: "currency" },
  { key: "paguTersedia", label: "Sisa Pagu (Rp.)", type: "currency" },
  { key: "disburseTersedia", label: "Disburse Tersedia (Rp.)", type: "currency" },
  { key: "tahun", label: "Tahun", type: "text" },
  { key: "status", label: "Status", type: "status" }
];

const MONTH_ORDER = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];

// Urutan bulan untuk data "Progress AI" (sheet AI TERKONTRAK/TERTAGIH/TERBAYAR
// memakai singkatan bahasa Inggris, berbeda dari MONTH_ORDER di atas).
const PROGRESS_MONTH_ORDER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const PROGRESS_TABS = {
  terkontrak: { label: "AI Terkontrak", color: "primary" },
  tertagih: { label: "Tertagih", color: "info" },
  terbayar: { label: "Terbayar", color: "success" }
};

const PROGRAM_GROUP_KEYWORDS = {
  Pemasaran: [
    "penyambungan pelanggan",
    "stasiun pengisian",
    "pengisian listrik",
    "pemasaran",
    "pasang baru",
    "tambah daya"
  ],
  Efisiensi: [
    "manajemen trafo",
    "peremajaan kwh meter",
    "kwh meter",
    "rehab dan perluasan jtr",
    "perluasan jtr",
    "rehab jtr",
    "efisiensi",
    "susut",
    "gardu",
    "jaringan tegangan"
  ]
};

function classifyProgramGroup(label) {
  const text = String(label || "").toLowerCase();
  if (PROGRAM_GROUP_KEYWORDS.Pemasaran.some((kw) => text.includes(kw))) return "Pemasaran";
  if (PROGRAM_GROUP_KEYWORDS.Efisiensi.some((kw) => text.includes(kw))) return "Efisiensi";
  return "Lainnya";
}

function filterByProgramGroup(data, group) {
  return data.filter((r) => classifyProgramGroup(r.uraianAnggaran) === group);
}

function prkPosLabel(r) {
  const kode = (r.prkPos || "").toString().trim();
  const uraian = (r.uraianPrkPos || "").toString().trim();
  if (kode && uraian) return `${kode} — ${uraian}`;
  return kode || uraian || "Tidak Diketahui";
}

// State global aplikasi
const state = {
  rawData: [],        // seluruh data dari Google Sheets (tanpa filter)
  filteredData: [],    // data setelah search + filter (untuk halaman Monitoring)
  progressAI: { terkontrak: [], tertagih: [], terbayar: [] }, // data sheet AI TERKONTRAK/TERTAGIH/TERBAYAR
  monthlyProgress: [], // total AI Terkontrak dan Terbayar dari sheet JANUARI..DESEMBER
  activeProgressTab: "terkontrak",
  meta: null,          // { lastSync, rowCounts } dari Code.gs
  isLoading: true,
  isConnected: false,
  sort: { key: null, dir: null }, // dir: 'asc' | 'desc' | null
  filters: { search: "", tahun: "", bulan: "", unit: "", status: "" },
  grafikTahun: "", // kosong = semua tahun yang berhasil dimuat dari URL sumber
  homeKategoriFilter: "", // "" = semua, "Murni", atau "Lanjutan" — khusus filter Dashboard Home
  homeProporsiGroupBy: { efisiensi: "program", pemasaran: "program", perbandingan: "program" }, // "program" (Uraian Anggaran) atau "prkpos" (PRK/POS)
  laporanFilters: { cakupan: "realtime", tahun: "", kategori: "", unit: "", status: "" },
  pagination: { page: 1, pageSize: 25 },
  charts: {} // menyimpan instance Chart.js agar bisa di-destroy sebelum render ulang
};

function formatRupiah(value) {
  const num = Number(value) || 0;
  return "Rp " + Math.round(num).toLocaleString("id-ID");
}

function formatNumber(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("id-ID");
}

function formatPercent(value) {
  const num = Number(value) || 0;
  return num.toFixed(1).replace(".0", "") + "%";
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function statusClass(status) {
  if (status === "Selesai") return "status-selesai";
  if (status === "Dalam Proses") return "status-proses";
  return "status-belum";
}

const PAGE_META = {
  dashboard: { title: "Dashboard SKKI", subtitle: "Ringkasan monitoring anggaran SKKI" },
  "dashboard-murni": { title: "Dashboard Murni", subtitle: "Ringkasan realisasi anggaran kategori Murni, per tahun" },
  "dashboard-lanjutan": { title: "Dashboard Lanjutan", subtitle: "Ringkasan realisasi anggaran kategori Lanjutan, per tahun" },
  arsip: { title: "Arsip", subtitle: "Rekap historis anggaran tahun 2022–2024" },
  monitoring: { title: "Monitoring Data", subtitle: "Cari, filter, dan urutkan data anggaran" },
  "progress-ai": { title: "Progress AI", subtitle: "Progres AI Terkontrak, Tertagih, dan Terbayar per bulan" },
  "rekap-unit": { title: "Rekap Unit", subtitle: "Rekapitulasi anggaran per Unit" },
  "rekap-program": { title: "Rekap Program", subtitle: "Rekapitulasi anggaran per Program" },
  grafik: { title: "Grafik", subtitle: "Visualisasi realisasi anggaran" },
  laporan: { title: "Laporan", subtitle: "Ekspor dan cetak laporan anggaran" },
  "kpi-overview": { title: "Overview KPI", subtitle: "" },
  "kpi-indikator": { title: "Per Indikator KPI", subtitle: "" },
  "kpi-ulp": { title: "Per Unit (UP3 & ULP)", subtitle: "Drilldown target, realisasi, nilai, dan loss point UP3 maupun ULP" },
  "kpi-banding": { title: "Perbandingan UP3 dan ULP", subtitle: "Bandingkan realisasi dan pencapaian UP3 dengan lima ULP" },
  "kpi-pengusahaan": { title: "Data Pengusahaan", subtitle: "Tren pelanggan dan pertumbuhan daya tersambung" }
};

function setupNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const pageKey = item.dataset.page;
      navItems.forEach((el) => el.classList.remove("active"));
      item.classList.add("active");

      document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
      document.getElementById(`page-${pageKey}`).classList.add("active");

      document.getElementById("pageTitle").textContent = PAGE_META[pageKey].title;
      const pageSubtitle = document.getElementById("pageSubtitle");
      pageSubtitle.textContent = PAGE_META[pageKey].subtitle;
      pageSubtitle.hidden = !PAGE_META[pageKey].subtitle;

      // Navigasi Dashboard memakai snapshot lengkap terakhir yang sudah berhasil
      // dimuat. Tidak perlu menunggu request baru hanya untuk berpindah halaman.
      if (pageKey === "dashboard" && state.rawData.length > 0) renderDashboardHome();
      if (pageKey === "grafik") renderCharts("full");
      if (pageKey === "laporan") renderLaporan();
      if (pageKey === "progress-ai") renderProgressAI();
      if (pageKey === "rekap-unit") renderRekapUnit();
      if (pageKey === "rekap-program") renderRekapProgram();
      if (pageKey === "dashboard-murni") renderKategoriDashboard("Murni");
      if (pageKey === "dashboard-lanjutan") renderKategoriDashboard("Lanjutan");
      if (pageKey === "arsip") renderArsipDashboard();
      if (pageKey.startsWith("kpi-") && window.KPI) window.KPI.renderPage(pageKey);

      // Tutup sidebar di mode mobile setelah memilih menu
      document.getElementById("appShell").classList.remove("sidebar-open");
      document.getElementById("sidebarBackdrop").classList.remove("show");
    });
  });
}

function setupDashboardSubmenuToggle() {
  const toggle = document.getElementById("toggleDashboardSubmenu");
  const submenu = document.getElementById("dashboardSubmenu");
  if (!toggle || !submenu) return;

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggle.classList.toggle("open");
    submenu.classList.toggle("open");
  });
}

function setupHomeKategoriFilter() {
  const el = document.getElementById("filterKategoriHome");
  if (!el) return;
  el.addEventListener("change", () => {
    state.homeKategoriFilter = el.value;
    renderSummary(getHomeData());
    renderCharts("home");
    renderChartProgresPersenHome();
    renderTop10();
    updateHomeBadgeLabel();
  });
}

function setupProporsiGroupToggle() {
  document.querySelectorAll(".proporsi-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.dataset.group; // "efisiensi" | "pemasaran" | "perbandingan"
      const mode = btn.dataset.mode; // "program" | "prkpos"
      if (state.homeProporsiGroupBy[group] === mode) return;
      state.homeProporsiGroupBy[group] = mode;

      document.querySelectorAll(`.proporsi-toggle-btn[data-group="${group}"]`).forEach((b) => {
        b.classList.toggle("active", b === btn);
      });

      const keyFn = mode === "prkpos" ? prkPosLabel : undefined;

      if (group === "perbandingan") {
        renderPerbandinganPersenPrkChart("chartPerbandinganPersenPrkHome", "wrapChartPerbandinganPersenPrkHome", getHomeData(), { keyFn });
        return;
      }

      const groupLabel = group === "efisiensi" ? "Efisiensi" : "Pemasaran";
      const canvasId = group === "efisiensi" ? "chartProgramProporsiEfisiensiHome" : "chartProgramProporsiPemasaranHome";
      const wrapId = group === "efisiensi" ? "wrapChartProgramProporsiEfisiensiHome" : "wrapChartProgramProporsiPemasaranHome";

      renderProgramProporsiChart(canvasId, wrapId, filterByProgramGroup(getHomeData(), groupLabel), { keyFn });
    });
  });
}

function setupSidebarToggle() {
  const shell = document.getElementById("appShell");
  const toggle = document.getElementById("sidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");

  toggle.addEventListener("click", () => {
    if (window.innerWidth <= 900) {
      shell.classList.toggle("sidebar-open");
      backdrop.classList.toggle("show");
    } else {
      shell.classList.toggle("sidebar-collapsed");
    }
  });

  backdrop.addEventListener("click", () => {
    shell.classList.remove("sidebar-open");
    backdrop.classList.remove("show");
  });
}

async function loadData(showToast = false) {
  const hasCachedData = state.rawData.length > 0;
  state.isLoading = true;
  setSkkiLoadingStatus(hasCachedData ? "refreshing" : "loading");
  // Saat refresh, pertahankan data valid terakhir di layar. Skeleton hanya
  // digunakan pada pemuatan pertama ketika belum ada snapshot sama sekali.
  if (!hasCachedData) renderLoadingState();
  setConnectionBadge("loading");

  try {
    const data = await getData(); // getData() didefinisikan di api.js
    state.rawData = Array.isArray(data.monitoring) ? data.monitoring : [];
    state.progressAI = data.progressAI || { terkontrak: [], tertagih: [], terbayar: [] };
    state.monthlyProgress = Array.isArray(data.monthlyProgress) ? data.monthlyProgress : [];
    state.meta = data.meta || null;
    state.isConnected = !!data.ok;
    state.isLoading = false;

    populateFilterOptions();
    applyFilters();          // otomatis merender tabel & pagination
    renderDashboardHome();
    setSkkiLoadingStatus(state.rawData.length > 0 ? "ready" : "empty");

    // Render ulang halaman aktif jika sedang membuka salah satu halaman ini
    const activePage = document.querySelector(".nav-item.active");
    const activeKey = activePage ? activePage.dataset.page : "dashboard";
    if (activeKey === "grafik") renderCharts("full");
    if (activeKey === "progress-ai") renderProgressAI();
    if (activeKey === "rekap-unit") renderRekapUnit();
    if (activeKey === "rekap-program") renderRekapProgram();
    if (activeKey === "laporan") renderLaporan();
    if (activeKey === "dashboard-murni") renderKategoriDashboard("Murni");
    if (activeKey === "dashboard-lanjutan") renderKategoriDashboard("Lanjutan");
    if (activeKey === "arsip") renderArsipDashboard();

    setConnectionBadge(state.isConnected ? "connected" : "disconnected");

    if (showToast) {
      if (!API_URL) {
        showToastMsg("API_URL belum diisi — menampilkan tampilan kosong.", "error");
      } else if (state.isConnected) {
        showToastMsg(
          state.rawData.length > 0
            ? "Data berhasil dimuat ulang dari Google Sheets."
            : "Terhubung ke API, tapi 0 baris data ditemukan. Cek nama sheet & format header pada Code.gs.",
          state.rawData.length > 0 ? "success" : "error"
        );
      } else {
        showToastMsg("Gagal terhubung ke Google Apps Script. Cek URL dan pengaturan deployment.", "error");
      }
    }
  } catch (error) {
    console.error("Gagal memuat data:", error);
    state.isLoading = false;
    setConnectionBadge("disconnected");
    setSkkiLoadingStatus("error");
    showToastMsg("Terjadi kesalahan saat memuat data.", "error");
  }
}

function setSkkiLoadingStatus(mode) {
  const notice = document.getElementById("skkiLoadingNotice");
  const text = document.getElementById("skkiLoadingText");
  if (!notice || !text) return;

  notice.classList.remove("is-error", "is-empty");
  notice.hidden = false;
  if (mode === "loading") text.textContent = "Memuat data…";
  else if (mode === "refreshing") text.textContent = "Memuat data…";
  else if (mode === "empty") {
    notice.classList.add("is-empty");
    text.textContent = "Data anggaran belum tersedia dari sumber.";
  } else if (mode === "error") {
    notice.classList.add("is-error");
    text.textContent = "Data anggaran gagal dimuat. Silakan tekan Refresh untuk mencoba lagi.";
  } else {
    notice.hidden = true;
  }
}

function renderDashboardHome() {
  renderSummary(getHomeData());
  renderCharts("home");
  renderChartProgresPersenHome();
  renderTop10();
  updateHomeBadgeLabel();
  renderRiwayatUpdate();
}

// Status koneksi gabungan SKKI + KPI. Badge di navbar atas ("Terhubung ke
// Google Sheets") HANYA akan menunjukkan "Terhubung" kalau KEDUA sumber data
// (SKKI & KPI) sama-sama berhasil konek live -- bukan salah satu saja.
window.APP_CONN_STATUS = window.APP_CONN_STATUS || { skki: false, kpi: false };

function renderGlobalConnectionBadge() {
  const badge = document.getElementById("connectionBadge");
  const text = document.getElementById("connectionText");
  if (!badge || !text) return;
  const s = window.APP_CONN_STATUS;
  const bothConnected = s.skki && s.kpi;
  badge.classList.toggle("connected", bothConnected);
  if (bothConnected) {
    text.textContent = "Terhubung ke Google Sheets";
  } else if (s.skki || s.kpi) {
    text.textContent = `Sebagian Terhubung (${!s.skki ? "SKKI" : "KPI"} belum)`;
  } else {
    text.textContent = "Belum Terhubung";
  }
}
window.renderGlobalConnectionBadge = renderGlobalConnectionBadge;

function setConnectionBadge(mode) {
  const badge = document.getElementById("connectionBadge");
  const text = document.getElementById("connectionText");
  if (!badge || !text) return;

  if (mode === "loading") {
    badge.classList.remove("connected");
    text.textContent = "Memuat...";
    return;
  }

  window.APP_CONN_STATUS.skki = mode === "connected";
  renderGlobalConnectionBadge();
}

function renderLoadingState() {
  // Skeleton pada card summary
  document.querySelectorAll(".summary-card-value").forEach((el) => {
    el.innerHTML = '<span class="skeleton skeleton-value" style="display:block;"></span>';
  });

  // Skeleton pada tabel
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = Array.from({ length: 6 })
    .map(
      () => `<tr class="skeleton-row">${COLUMNS.map(() => `<td><span class="skeleton skeleton-text"></span></td>`).join("")}</tr>`
    )
    .join("");
}

function getSisaPagu(row) {
  // Definisi Sisa Pagu pada seluruh dashboard:
  // Pagu dikurangi AI Terkontrak (Usulan tidak mengurangi Sisa Pagu).
  return (row.pagu || 0) - (row.aiTerkontrak || 0);
}

function computeSummary(data) {
  const totalPagu = data.reduce((sum, r) => sum + (r.pagu || 0), 0);
  const totalKontrak = data.reduce((sum, r) => sum + (r.aiTerkontrak || 0), 0);
  const totalRealisasi = data.reduce((sum, r) => sum + (r.terbayar || 0), 0);
  const totalSisa = data.reduce((sum, r) => sum + getSisaPagu(r), 0);
  const persenRealisasi = totalPagu > 0 ? (totalRealisasi / totalPagu) * 100 : 0;

  return {
    totalPagu,
    totalRealisasi,
    totalSisa,
    persenRealisasi,
    jumlahData: data.length
  };
}

function computeSummaryFull(data) {
  const totalPagu = data.reduce((sum, r) => sum + (r.pagu || 0), 0);
  const totalKontrak = data.reduce((sum, r) => sum + (r.aiTerkontrak || 0), 0);
  const totalUsulan = data.reduce((sum, r) => sum + (r.usulan || 0), 0);
  const totalTertagih = data.reduce((sum, r) => sum + (r.tertagih || 0), 0);
  const totalTerbayar = data.reduce((sum, r) => sum + (r.terbayar || 0), 0);
  const totalSisa = data.reduce((sum, r) => sum + getSisaPagu(r), 0);
  const persenRealisasi = totalPagu > 0 ? (totalTerbayar / totalPagu) * 100 : 0;
  const persenKontrak = totalPagu > 0 ? (totalKontrak / totalPagu) * 100 : 0;
  const persenSisa = totalPagu > 0 ? (totalSisa / totalPagu) * 100 : 0;

  return { totalPagu, totalKontrak, totalUsulan, totalTertagih, totalTerbayar, totalSisa, persenRealisasi, persenKontrak, persenSisa, jumlahData: data.length };
}

function renderSummary(data) {
  const summary = computeSummaryFull(data);

  document.getElementById("statTotalPagu").textContent = formatRupiah(summary.totalPagu);
  document.getElementById("statTotalKontrak").textContent = formatRupiah(summary.totalKontrak);
  document.getElementById("statPersenKontrak").textContent = formatPercent(summary.persenKontrak);
  document.getElementById("statTotalTertagih").textContent = formatRupiah(summary.totalUsulan);
  document.getElementById("statTotalRealisasi").textContent = formatRupiah(summary.totalTerbayar);
  document.getElementById("statSisaAnggaran").textContent = formatRupiah(summary.totalSisa);
  document.getElementById("statPersenSisa").textContent = formatPercent(summary.persenSisa);
  document.getElementById("statJumlahData").textContent = formatNumber(summary.jumlahData);

  // Progress ring
  const ring = document.getElementById("ringFg");
  const circumference = 2 * Math.PI * 54;
  const pct = Math.min(Math.max(summary.persenRealisasi, 0), 100);
  ring.style.strokeDasharray = circumference.toFixed(2);
  ring.style.strokeDashoffset = (circumference * (1 - pct / 100)).toFixed(2);
  document.getElementById("ringPercentLabel").textContent = formatPercent(summary.persenRealisasi);

  document.getElementById("legendPagu").textContent = formatRupiah(summary.totalPagu);
  document.getElementById("legendRealisasi").textContent = formatRupiah(summary.totalTerbayar);
  document.getElementById("legendSisa").textContent = formatRupiah(summary.totalSisa);

  return summary;
}

function renderRiwayatUpdate() {
  const el = document.getElementById("riwayatUpdateBody");
  if (!el) return;

  const lastSync = state.meta && state.meta.lastSync ? new Date(state.meta.lastSync) : new Date();
  const tanggal = lastSync.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const jam = lastSync.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const jumlahRealtime = getRealtimeData().length;
  const jumlahArsip = state.rawData.length - jumlahRealtime;

  el.innerHTML = `
    <div class="riwayat-row">
      <span class="riwayat-label">Terakhir Sinkronisasi</span>
      <span class="riwayat-value">${tanggal}, ${jam}</span>
    </div>
    <div class="riwayat-row">
      <span class="riwayat-label">Data Berjalan (${getBerjalanLabel()})</span>
      <span class="riwayat-value">${formatNumber(jumlahRealtime)} baris</span>
    </div>
    <div class="riwayat-row">
      <span class="riwayat-label">Data Arsip (${getArsipLabel()})</span>
      <span class="riwayat-value">${formatNumber(jumlahArsip)} baris</span>
    </div>
    <div class="riwayat-row">
      <span class="riwayat-label">Status API</span>
      <span class="riwayat-value">
        <span class="status-badge ${state.isConnected ? "status-selesai" : "status-belum"}">
          <span class="dot"></span>${state.isConnected ? "Terhubung" : "Tidak Terhubung"}
        </span>
      </span>
    </div>
  `;
}

function renderTop10() {
  const wrapRealisasi = document.getElementById("top10RealisasiList");
  const wrapSisa = document.getElementById("top10SisaList");
  if (!wrapRealisasi || !wrapSisa) return;

  const sourceData = getHomeData();

  if (sourceData.length === 0) {
    const emptyHtml = `<div class="empty-state empty-state-mini">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
      <h4>Belum ada data</h4><p>Daftar akan tampil setelah data terhubung.</p>
    </div>`;
    wrapRealisasi.innerHTML = emptyHtml;
    wrapSisa.innerHTML = emptyHtml;
    return;
  }

  const byRealisasi = [...sourceData].sort((a, b) => (b.terbayar || 0) - (a.terbayar || 0)).slice(0, 5);
  const sisaData = sourceData
    .map((r) => ({ ...r, __sisa: getSisaPagu(r) }))
    .filter((r) => r.__sisa > 0);
  const bySisa = sisaData.sort((a, b) => b.__sisa - a.__sisa).slice(0, 5);

  wrapRealisasi.innerHTML = byRealisasi
    .map(
      (r, i) => `
    <div class="top10-item" data-no="${r.no}">
      <span class="top10-rank">${i + 1}</span>
      <div class="top10-info">
        <span class="top10-title">${r.uraianPrkPos || r.uraianAnggaran || "-"}</span>
        <span class="top10-sub">${r.unit || "-"}</span>
      </div>
      <span class="top10-value">${formatRupiahShort(r.terbayar)}</span>
    </div>`
    )
    .join("");

  wrapSisa.innerHTML = bySisa.length === 0
    ? `<div class="empty-state empty-state-mini"><h4>Semua pagu sudah terkontrak</h4><p>Tidak ada sisa pagu yang belum terealisasi kontrak.</p></div>`
    : bySisa.map(
      (r, i) => `
    <div class="top10-item" data-no="${r.no}">
      <span class="top10-rank">${i + 1}</span>
      <div class="top10-info">
        <span class="top10-title">${r.uraianPrkPos || r.uraianAnggaran || "-"}</span>
        <span class="top10-sub">${r.unit || "-"}</span>
      </div>
      <span class="top10-value">${formatRupiahShort(r.__sisa)}</span>
    </div>`
    ).join("");

  document.querySelectorAll("#top10RealisasiList .top10-item, #top10SisaList .top10-item").forEach((el) => {
    el.addEventListener("click", () => {
      const row = sourceData.find((r) => String(r.no) === el.dataset.no);
      if (row) openDetailModal(row);
    });
  });
}

function populateFilterOptions() {
  const availableYears = uniqueValues(state.rawData, "tahun");
  if (state.grafikTahun && !availableYears.includes(state.grafikTahun)) state.grafikTahun = "";
  fillSelect("filterTahun", "Semua Tahun", availableYears);
  fillSelect("filterBulan", "Semua Bulan", uniqueValues(state.rawData, "bulan", MONTH_ORDER));
  fillSelect("filterUnit", "Semua Unit", uniqueValues(state.rawData, "unit"));
  fillSelect("filterStatus", "Semua Status", uniqueValues(state.rawData, "status"));

  fillSelect("filterTahunRekapProgram", "Semua Tahun", availableYears);
  fillSelect("filterTahunGrafik", "Semua Tahun", availableYears);
  document.getElementById("filterTahunGrafik").value = state.grafikTahun;
  fillSelect("filterTahunMurni", "Semua Tahun", uniqueValues(filterByKategori(state.rawData, "Murni"), "tahun"));
  fillSelect("filterTahunLanjutan", "Semua Tahun", uniqueValues(filterByKategori(state.rawData, "Lanjutan"), "tahun"));
  fillSelect("filterTahunArsip", `Semua Tahun (${getArsipLabel()})`, uniqueValues(filterByTahunArsip(state.rawData), "tahun"));
  populateLaporanFilterOptions();
  updateDynamicYearLabels();
}

// Data Berjalan hanya berasal dari tabel utama tahun 2026. Data dari endpoint
// khusus 2025 dan tahun-tahun sebelumnya ditampilkan sebagai Arsip.
const BERJALAN_TAHUN = ["2026"];

function isArsipTahun(tahun) {
  return !BERJALAN_TAHUN.includes(String(tahun));
}

function filterByTahunArsip(data) {
  return data.filter((r) => isArsipTahun(r.tahun));
}

function getRealtimeData() {
  return state.rawData.filter((r) => !isArsipTahun(r.tahun));
}

function getHomeData() {
  const base = getRealtimeData();
  if (!state.homeKategoriFilter) return base;
  return filterByKategori(base, state.homeKategoriFilter);
}

function updateHomeBadgeLabel() {
  const badge = document.getElementById("berjalanHeaderBadge");
  if (!badge) return;
  const base = `${getBerjalanLabel()} · Berjalan`;
  badge.textContent = state.homeKategoriFilter ? `${base} · ${state.homeKategoriFilter}` : base;
}

function yearRangeLabel(years, fallback = "-") {
  const clean = Array.from(new Set((years || []).map((y) => String(y).trim()).filter(Boolean)));
  if (clean.length === 0) return fallback;
  const sorted = clean.slice().sort((a, b) => Number(a) - Number(b));
  return sorted.length === 1 ? sorted[0] : `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

function getBerjalanLabel() {
  return yearRangeLabel(BERJALAN_TAHUN, BERJALAN_TAHUN.join("–"));
}

function getArsipLabel() {
  const tahunArsip = uniqueValues(filterByTahunArsip(state.rawData), "tahun");
  return yearRangeLabel(tahunArsip, "-");
}

function updateDynamicYearLabels() {
  const berjalanLabel = getBerjalanLabel();
  const arsipLabel = getArsipLabel();

  const berjalanBadge = document.getElementById("berjalanHeaderBadge");
  if (berjalanBadge) berjalanBadge.textContent = `${berjalanLabel} · Berjalan`;

  const arsipBadge = document.getElementById("arsipHeaderBadge");
  if (arsipBadge) arsipBadge.textContent = arsipLabel;

  const navArsipLabel = document.getElementById("navArsipLabel");
  if (navArsipLabel) navArsipLabel.textContent = "Arsip";

  const optRealtime = document.getElementById("optCakupanRealtime");
  if (optRealtime) optRealtime.textContent = `Hanya Data Berjalan (${berjalanLabel})`;

  const optArsip = document.getElementById("optCakupanArsip");
  if (optArsip) optArsip.textContent = `Hanya Arsip (${arsipLabel})`;

  PAGE_META.arsip.subtitle = `Rekap historis anggaran tahun ${arsipLabel}`;

  const activePage = document.querySelector(".nav-item.active");
  const activeKey = activePage ? activePage.dataset.page : null;
  if (activeKey && PAGE_META[activeKey]) {
    const subtitleEl = document.getElementById("pageSubtitle");
    if (subtitleEl) subtitleEl.textContent = PAGE_META[activeKey].subtitle;
  }
}

function filterByKategori(data, kategori) {
  const target = String(kategori).toLowerCase();
  return data.filter((r) => String(r.kategori || "murni").toLowerCase() === target);
}

function uniqueValues(data, key, preferredOrder) {
  const values = Array.from(new Set(data.map((r) => r[key]).filter((v) => v !== undefined && v !== null && v !== "")));
  if (preferredOrder) {
    return values.sort((a, b) => preferredOrder.indexOf(a) - preferredOrder.indexOf(b));
  }
  return values.sort((a, b) => String(a).localeCompare(String(b), "id"));
}

function fillSelect(id, placeholder, values) {
  const select = document.getElementById(id);
  const currentValue = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>` + values.map((v) => `<option value="${v}">${v}</option>`).join("");
  if (values.includes(currentValue)) select.value = currentValue;
}

function setupFilters() {
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener(
    "input",
    debounce((e) => {
      state.filters.search = e.target.value.trim().toLowerCase();
      state.pagination.page = 1;
      applyFilters();
    }, 250)
  );

  ["filterTahun", "filterBulan", "filterUnit", "filterStatus"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (e) => {
      const key = id.replace("filter", "").toLowerCase();
      state.filters[key] = e.target.value;
      state.pagination.page = 1;
      applyFilters();
    });
  });

  document.getElementById("btnResetFilter").addEventListener("click", () => {
    state.filters = { search: "", tahun: "", bulan: "", unit: "", status: "" };
    document.getElementById("searchInput").value = "";
    ["filterTahun", "filterBulan", "filterUnit", "filterStatus"].forEach((id) => (document.getElementById(id).value = ""));
    state.pagination.page = 1;
    applyFilters();
  });

  document.getElementById("pageSizeSelect").addEventListener("change", (e) => {
    state.pagination.pageSize = parseInt(e.target.value, 10);
    state.pagination.page = 1;
    renderTable();
  });
}

function applyFilters() {
  const f = state.filters;

  state.filteredData = state.rawData.filter((row) => {
    if (f.tahun && String(row.tahun) !== String(f.tahun)) return false;
    if (f.bulan && String(row.bulan) !== String(f.bulan)) return false;
    if (f.unit && row.unit !== f.unit) return false;
    if (f.status && row.status !== f.status) return false;

    if (f.search) {
      const haystack = [row.unit, row.noAnggaran, row.uraianAnggaran, row.prkPos, row.uraianPrkPos]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(f.search)) return false;
    }
    return true;
  });

  applySort();
  renderTable();
}

function setupSorting() {
  document.getElementById("tableHeadRow").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;
    const key = th.dataset.key;

    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === "asc" ? "desc" : state.sort.dir === "desc" ? null : "asc";
      if (state.sort.dir === null) state.sort.key = null;
    } else {
      state.sort.key = key;
      state.sort.dir = "asc";
    }
    applySort();
    renderTable();
  });
}

function applySort() {
  const { key, dir } = state.sort;
  if (!key || !dir) return;

  state.filteredData.sort((a, b) => {
    let va = key === "paguTersedia" ? getSisaPagu(a) : a[key];
    let vb = key === "paguTersedia" ? getSisaPagu(b) : b[key];
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va === undefined || va === null) va = "";
    if (vb === undefined || vb === null) vb = "";

    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });
}

function renderTableHeader() {
  const headRow = document.getElementById("tableHeadRow");
  headRow.innerHTML = COLUMNS.map((col) => {
    let sortClass = "";
    if (state.sort.key === col.key) sortClass = state.sort.dir === "asc" ? "sorted-asc" : state.sort.dir === "desc" ? "sorted-desc" : "";
    return `<th data-key="${col.key}" class="${sortClass} ${["number", "currency"].includes(col.type) || col.key === "tahun" ? "heading-number" : "heading-text"}">
      <span class="th-inner">${col.label}
        <svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>
      </span>
    </th>`;
  }).join("");
}

function renderTable() {
  renderTableHeader();

  const tbody = document.getElementById("tableBody");
  const { page, pageSize } = state.pagination;
  const total = state.filteredData.length;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  if (state.pagination.page > totalPages) state.pagination.page = totalPages;

  const start = (state.pagination.page - 1) * pageSize;
  const pageRows = state.filteredData.slice(start, start + pageSize);

  if (!state.isLoading && total === 0) {
    tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}">
      <div class="empty-state empty-state-mini">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>
        <h4>${state.rawData.length === 0 ? "Belum ada data" : "Tidak ada hasil yang cocok"}</h4>
        <p>${state.rawData.length === 0 ? "Hubungkan Google Sheets pada api.js untuk menampilkan data." : "Coba ubah kata kunci pencarian atau filter yang digunakan."}</p>
      </div>
    </td></tr>`;
  } else {
    tbody.innerHTML = pageRows
      .map((row, index) => {
        return `<tr data-no="${row.no}" class="row-clickable">${COLUMNS.map((col) => renderCell(col.key === "no" ? { ...row, no: start + index + 1 } : row, col)).join("")}</tr>`;
      })
      .join("");
  }

  renderPagination(total, totalPages);
}

function renderCell(row, col) {
  // Kolom sumber tetap bernama paguTersedia, tetapi setiap tampilan Sisa Pagu
  // harus menggunakan rumus dashboard yang sama: Pagu - AI Terkontrak.
  const value = col.key === "paguTersedia" ? getSisaPagu(row) : row[col.key];
  if (col.type === "currency") return `<td class="cell-num">${formatRupiah(value)}</td>`;
  if (col.type === "number") return `<td class="cell-num cell-muted">${value ?? "-"}</td>`;
  if (col.type === "status") return `<td><span class="status-badge ${statusClass(value)}"><span class="dot"></span>${value || "-"}</span></td>`;
  return `<td>${value !== undefined && value !== null && value !== "" ? value : "-"}</td>`;
}

function renderPagination(total, totalPages) {
  const { page, pageSize } = state.pagination;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  document.getElementById("paginationInfo").textContent = `Menampilkan ${formatNumber(from)}–${formatNumber(to)} dari ${formatNumber(total)} data`;

  const controls = document.getElementById("paginationControls");
  let html = `<button class="page-btn" id="pgPrev" ${page === 1 ? "disabled" : ""} aria-label="Sebelumnya">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>
  </button>`;

  const pagesToShow = getPageRange(page, totalPages);
  pagesToShow.forEach((p) => {
    if (p === "...") {
      html += `<span class="page-btn" style="border:none;">…</span>`;
    } else {
      html += `<button class="page-btn ${p === page ? "active" : ""}" data-page="${p}">${p}</button>`;
    }
  });

  html += `<button class="page-btn" id="pgNext" ${page === totalPages ? "disabled" : ""} aria-label="Berikutnya">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg>
  </button>`;

  controls.innerHTML = html;

  controls.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pagination.page = parseInt(btn.dataset.page, 10);
      renderTable();
    });
  });
  const prevBtn = document.getElementById("pgPrev");
  const nextBtn = document.getElementById("pgNext");
  if (prevBtn) prevBtn.addEventListener("click", () => { state.pagination.page--; renderTable(); });
  if (nextBtn) nextBtn.addEventListener("click", () => { state.pagination.page++; renderTable(); });
}

function getPageRange(current, total) {
  const delta = 1;
  const range = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
      range.push(i);
    } else if (range[range.length - 1] !== "...") {
      range.push("...");
    }
  }
  return range;
}

const DETAIL_FIELDS = [
  { key: "noAnggaran", label: "Nomor Anggaran" },
  { key: "uraianAnggaran", label: "Program / Uraian Anggaran" },
  { key: "unit", label: "Unit" },
  { key: "prkPos", label: "PRK/POS" },
  { key: "uraianPrkPos", label: "Uraian PRK/POS" },
  { key: "pagu", label: "Pagu (Rp.)", currency: true },
  { key: "disburse", label: "Disburse (Rp.)", currency: true },
  { key: "usulan", label: "Usulan (Rp.)", currency: true },
  { key: "aiTerkontrak", label: "Nilai AI Terkontrak (Rp.)", currency: true },
  { key: "akiTerkontrak", label: "AKI Terkontrak (Rp.)", currency: true },
  { key: "tertagih", label: "Nilai Tertagih (Rp.)", currency: true },
  { key: "terbayar", label: "Nilai Terbayar / Realisasi (Rp.)", currency: true },
  { key: "paguTersedia", label: "Sisa Pagu (Rp.)", currency: true },
  { key: "tahun", label: "Tahun" },
  { key: "bulan", label: "Bulan" },
  { key: "status", label: "Status" },
  { key: "keterangan", label: "Keterangan" }
];

function setupRowClick() {
  document.getElementById("tableBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-no]");
    if (!tr) return;
    const row = state.filteredData.find((r) => String(r.no) === tr.dataset.no) || state.rawData.find((r) => String(r.no) === tr.dataset.no);
    if (row) openDetailModal(row);
  });

  document.getElementById("detailModalClose").addEventListener("click", closeDetailModal);
  document.getElementById("detailModalBackdrop").addEventListener("click", closeDetailModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetailModal();
  });
}

function openDetailModal(row) {
  const pagu = row.pagu || 0;
  const terbayar = row.terbayar || 0;
  const persen = pagu > 0 ? (terbayar / pagu) * 100 : 0;

  document.getElementById("detailModalTitle").textContent = row.uraianPrkPos || row.uraianAnggaran || "Detail Anggaran";
  document.getElementById("detailModalSub").innerHTML =
    `<span class="status-badge ${statusClass(row.status)}"><span class="dot"></span>${row.status || "-"}</span>
     <span class="detail-percent">${formatPercent(persen)} terealisasi</span>`;

  const body = document.getElementById("detailModalBody");
  body.innerHTML = DETAIL_FIELDS.map((f) => {
    const raw = f.key === "paguTersedia" ? getSisaPagu(row) : row[f.key];
    const value = f.currency ? formatRupiah(raw) : (raw !== undefined && raw !== null && raw !== "" ? raw : "-");
    return `<div class="detail-row"><span class="detail-label">${f.label}</span><span class="detail-value">${value}</span></div>`;
  }).join("");

  document.getElementById("detailModal").classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeDetailModal() {
  document.getElementById("detailModal").classList.remove("show");
  document.body.style.overflow = "";
}

const CHART_COLORS = {
  primary: "#0b4da2",
  info: "#2e86de",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#dc2626",
  grid: "#e3e7ee",
  text: "#5c6b7a"
};

function chartColorWithAlpha(color, alpha = 0.14) {
  if (typeof color !== "string") return color;
  const hex = color.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Styling visual global. Hanya properti tampilan yang disentuh; data, skala,
// callback, serta interaksi setiap grafik tetap menggunakan konfigurasi asal.
if (typeof window.Chart === "function" && !window.__softChartShadowRegistered) {
  window.__softChartShadowRegistered = true;
  Chart.defaults.elements.line.tension = 0.4;
  Chart.defaults.elements.line.cubicInterpolationMode = "monotone";
  Chart.defaults.elements.line.borderWidth = 2.5;
  Chart.defaults.elements.point.radius = 3;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.borderWidth = 2;
  Chart.defaults.elements.bar.borderRadius = 0;
  Chart.defaults.elements.bar.borderSkipped = false;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;

  Chart.register({
    id: "softChartShadow",
    beforeUpdate(chart) {
      const baseType = chart.config.type;
      (chart.data.datasets || []).forEach((dataset) => {
        const type = dataset.type || baseType;
        if (type === "line") {
          const lineColor = dataset.borderColor || CHART_COLORS.primary;
          dataset.tension = 0.4;
          dataset.cubicInterpolationMode = "monotone";
          dataset.borderWidth = 2.5;
          dataset.fill = "origin";
          dataset.backgroundColor = chartColorWithAlpha(lineColor, 0.13);
          dataset.pointBackgroundColor = lineColor;
          dataset.pointBorderColor = "#FFFFFF";
          dataset.pointBorderWidth = 2;
          dataset.pointRadius = 3;
          dataset.pointHoverRadius = 5;
        } else if (type === "bar") {
          dataset.borderRadius = 0;
          dataset.borderSkipped = false;
        }
      });
    },
    beforeDatasetDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.shadowColor = "rgba(74, 91, 119, 0.16)";
      ctx.shadowBlur = 9;
      ctx.shadowOffsetY = 4;
    },
    afterDatasetDraw(chart) {
      chart.ctx.restore();
    }
  });
}

function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function chartsReady() {
  return typeof window.Chart === "function";
}

function showChartEmpty(wrapId, canvasId) {
  destroyChart(canvasId);
  const wrap = document.getElementById(wrapId);
  const canvas = document.getElementById(canvasId);
  if (canvas) canvas.style.display = "none";
  if (!wrap) {
    console.warn(`[script.js] showChartEmpty: elemen wrap "#${wrapId}" tidak ditemukan di HTML.`);
    return;
  }

  let emptyEl = wrap.querySelector(".chart-empty-msg");
  if (!emptyEl) {
    emptyEl = document.createElement("div");
    emptyEl.className = "empty-state empty-state-mini chart-empty-msg";
    emptyEl.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>
      <h4>Belum ada data</h4>`;
    wrap.appendChild(emptyEl);
  }
  emptyEl.style.display = "flex";
}

function hideChartEmpty(wrapId, canvasId) {
  const wrap = document.getElementById(wrapId);
  const canvas = document.getElementById(canvasId);
  if (canvas) canvas.style.display = "block";
  if (!wrap) {
    console.warn(`[script.js] hideChartEmpty: elemen wrap "#${wrapId}" tidak ditemukan di HTML.`);
    return;
  }
  const emptyEl = wrap.querySelector(".chart-empty-msg");
  if (emptyEl) emptyEl.style.display = "none";
}

const MONTH_LABEL_ID = {
  JAN: "JAN", FEB: "FEB", MAR: "MAR", APR: "APR", MAY: "MEI", JUN: "JUN",
  JUL: "JUL", AUG: "AGU", SEP: "SEP", OCT: "OKT", NOV: "NOV", DEC: "DES"
};

function aggregateByBulan(data) {
  const rows = state.progressAI && Array.isArray(state.progressAI.terbayar) ? state.progressAI.terbayar : [];
  if (rows.length === 0) return null;

  const map = {};
  rows.forEach((r) => {
    const key = String(r.bulan || "").toUpperCase().trim();
    if (!key) return;
    map[key] = (map[key] || 0) + (r.nilai || 0);
  });

  const keys = Object.keys(map);
  if (keys.length === 0) return null;

  const sortedKeys = keys.sort((a, b) => {
    const ia = PROGRESS_MONTH_ORDER.indexOf(a);
    const ib = PROGRESS_MONTH_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return {
    labels: sortedKeys.map((k) => MONTH_LABEL_ID[k] || k),
    values: sortedKeys.map((k) => map[k])
  };
}

function aggregateByUnit(data) {
  if (data.length === 0) return null;
  const map = {};
  data.forEach((r) => {
    const key = r.unit || "Tidak Diketahui";
    if (!map[key]) map[key] = { pagu: 0, realisasi: 0 };
    map[key].pagu += r.pagu || 0;
    map[key].realisasi += r.terbayar || 0;
  });
  const labels = Object.keys(map);
  return {
    labels,
    pagu: labels.map((l) => map[l].pagu),
    realisasi: labels.map((l) => map[l].realisasi)
  };
}

function aggregateByStatus(data) {
  if (data.length === 0) return null;
  const summary = computeSummaryFull(data);
  return {
    labels: ["Selesai (Terbayar)", "Dalam Proses", "Belum Terkontrak"],
    values: [
      summary.totalTerbayar,
      Math.max(summary.totalKontrak - summary.totalTerbayar, 0),
      Math.max(summary.totalSisa, 0)
    ]
  };
}

function renderCharts(scope) {
  if (!chartsReady()) {
    console.error("Chart.js tidak berhasil dimuat. Periksa assets/chart.umd.min.js.");
    return;
  }
  // scope: "home" untuk mini chart di Dashboard Home (data berjalan, mengikuti
  // filter kategori Murni/Lanjutan yang aktif), "full" untuk halaman Grafik
  // (seluruh data, semua tahun, tidak terpengaruh filter Dashboard Home)
  const data = scope === "home"
    ? getHomeData()
    : (state.grafikTahun ? state.rawData.filter((r) => String(r.tahun) === state.grafikTahun) : state.rawData);
  const suffix = scope === "home" ? "Home" : "Full";

  if (scope === "full") {
    const availableYears = uniqueValues(state.rawData, "tahun");
    const yearSelect = document.getElementById("filterTahunGrafik");
    if (yearSelect) {
      const optionYears = Array.from(yearSelect.options).map((option) => option.value).filter(Boolean);
      if (optionYears.join("|") !== availableYears.join("|")) {
        fillSelect("filterTahunGrafik", "Semua Tahun", availableYears);
      }
      yearSelect.value = state.grafikTahun;
    }
    const years = uniqueValues(data, "tahun");
    const label = document.getElementById("grafikCakupanLabel");
    if (label) label.textContent = state.grafikTahun
      ? `Cakupan data: tahun ${state.grafikTahun}`
      : `Cakupan data: ${yearRangeLabel(years, "tidak tersedia")} (${formatNumber(data.length)} baris)`;
  }

  renderStatusChart(data, `wrapChartStatus${suffix}`, `chartStatus${suffix}`);

  // Grafik per-Program (Pagu vs Terkontrak vs Tertagih vs Terbayar, Proporsi Pagu, Progress Penyerapan).
  renderProgramBandingChart(`chartProgramBanding${suffix}`, `wrapChartProgramBanding${suffix}`, data);
  renderProgramProporsiChart(`chartProgramProporsi${suffix}`, `wrapChartProgramProporsi${suffix}`, data);
  renderProgramProgressChart(`chartProgramProgress${suffix}`, `wrapChartProgramProgress${suffix}`, data);

  if (scope === "home") {
    // Proporsi Pagu per PRK Efisiensi & per PRK Pemasaran (khusus Dashboard Home, data berjalan).
    // Bisa ditampilkan per Program (Uraian Anggaran) atau per PRK/POS, mengikuti toggle di panel masing-masing.
    const efisiensiKeyFn = state.homeProporsiGroupBy.efisiensi === "prkpos" ? prkPosLabel : undefined;
    const pemasaranKeyFn = state.homeProporsiGroupBy.pemasaran === "prkpos" ? prkPosLabel : undefined;
    renderProgramProporsiChart("chartProgramProporsiEfisiensiHome", "wrapChartProgramProporsiEfisiensiHome", filterByProgramGroup(data, "Efisiensi"), { keyFn: efisiensiKeyFn });
    renderProgramProporsiChart("chartProgramProporsiPemasaranHome", "wrapChartProgramProporsiPemasaranHome", filterByProgramGroup(data, "Pemasaran"), { keyFn: pemasaranKeyFn });

    // Perbandingan % Antar-PRK: AI Terkontrak vs Tertagih vs Terbayar (skala 0–1), seluruh program data berjalan.
    const perbandinganKeyFn = state.homeProporsiGroupBy.perbandingan === "prkpos" ? prkPosLabel : undefined;
    renderPerbandinganPersenPrkChart("chartPerbandinganPersenPrkHome", "wrapChartPerbandinganPersenPrkHome", data, { keyFn: perbandinganKeyFn });
  }

  if (scope === "full") renderUnitProgressList(data);
}

function renderBulanChart(data, wrapId, canvasId) {
  const agg = aggregateByBulan(data);
  if (!agg) return showChartEmpty(wrapId, canvasId);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: agg.labels,
      datasets: [{
        label: "Realisasi",
        data: agg.values,
        borderColor: CHART_COLORS.primary,
        backgroundColor: "rgba(11, 77, 162, 0.12)",
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: CHART_COLORS.primary
      }]
    },
    options: {
      ...chartBaseOptions({ y: { formatter: formatRupiahShort } }),
      onClick: (evt, elements) => {
        if (!elements.length) return;
        goToMonitoringWithFilter("bulan", agg.labels[elements[0].index]);
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? "pointer" : "default"; }
    }
  });
}

function renderUnitChart(data, wrapId, canvasId) {
  const agg = aggregateByUnit(data);
  if (!agg) return showChartEmpty(wrapId, canvasId);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: agg.labels,
      datasets: [
        { label: "Pagu", data: agg.pagu, backgroundColor: CHART_COLORS.info, borderRadius: 5, maxBarThickness: 28 },
        { label: "Realisasi", data: agg.realisasi, backgroundColor: CHART_COLORS.primary, borderRadius: 5, maxBarThickness: 28 }
      ]
    },
    options: {
      ...chartBaseOptions({ y: { formatter: formatRupiahShort }, legend: true }),
      onClick: (evt, elements) => {
        if (!elements.length) return;
        goToMonitoringWithFilter("unit", agg.labels[elements[0].index]);
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? "pointer" : "default"; }
    }
  });
}

function renderStatusChart(data, wrapId, canvasId) {
  const agg = aggregateByStatus(data);
  if (!agg) return showChartEmpty(wrapId, canvasId);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const colorMap = { "Selesai (Terbayar)": CHART_COLORS.success, "Dalam Proses": CHART_COLORS.warning, "Belum Terkontrak": CHART_COLORS.danger };
  const colors = agg.labels.map((l) => colorMap[l] || CHART_COLORS.text);

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: agg.labels,
      datasets: [{ data: agg.values, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: CHART_COLORS.text } },
        tooltip: { callbacks: { label: (ctx2) => `${ctx2.label}: ${formatRupiah(ctx2.parsed)}` } }
      }
    }
  });
}

function renderUnitProgressList(data) {
  const container = document.getElementById("unitProgressList");
  const agg = aggregateByUnit(data);

  if (!agg) {
    container.innerHTML = `<div class="empty-state empty-state-mini">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
      <h4>Belum ada data</h4>
      <p>Progress per unit akan tampil setelah data terhubung.</p>
    </div>`;
    return;
  }

  container.innerHTML = agg.labels
    .map((unit, i) => {
      const pagu = agg.pagu[i];
      const realisasi = agg.realisasi[i];
      const pct = pagu > 0 ? Math.min((realisasi / pagu) * 100, 100) : 0;
      return `
      <div class="unit-progress-item" data-unit="${unit}" role="button" tabindex="0">
        <div class="up-head">
          <span>${unit}</span>
          <span>${formatRupiah(realisasi)} / ${formatRupiah(pagu)} (${formatPercent(pct)})</span>
        </div>
        <div class="up-bar-track"><div class="up-bar-fill" style="width:${pct}%;"></div></div>
      </div>`;
    })
    .join("");

  container.querySelectorAll(".unit-progress-item").forEach((el) => {
    el.addEventListener("click", () => goToMonitoringWithFilter("unit", el.dataset.unit));
  });
}

function formatRupiahShort(value) {
  const num = Number(value) || 0;
  if (Math.abs(num) >= 1e9) return "Rp " + (num / 1e9).toFixed(1) + "M";
  if (Math.abs(num) >= 1e6) return "Rp " + (num / 1e6).toFixed(1) + "Jt";
  if (Math.abs(num) >= 1e3) return "Rp " + (num / 1e3).toFixed(0) + "Rb";
  return "Rp " + num;
}

function goToMonitoringWithFilter(filterKey, value) {
  state.filters[filterKey] = value;
  state.pagination.page = 1;

  const selectId = "filter" + filterKey.charAt(0).toUpperCase() + filterKey.slice(1);
  const select = document.getElementById(selectId);
  if (select) select.value = value;

  applyFilters();
  const navBtn = document.querySelector('[data-page="monitoring"]');
  if (navBtn) navBtn.click();
  showToastMsg(`Menampilkan Monitoring dengan filter: ${value}`, "info");
}

function chartBaseOptions({ y = {}, legend = false } = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: legend, position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: CHART_COLORS.text } },
      tooltip: {
        backgroundColor: "#06294f",
        padding: 10,
        titleFont: { size: 12 },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatRupiah(ctx.parsed.y)}`
        }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { size: 11 } } },
      y: {
        grid: { color: CHART_COLORS.grid },
        ticks: { color: CHART_COLORS.text, font: { size: 11 }, callback: (v) => (y.formatter ? y.formatter(v) : v) }
      }
    }
  };
}

function aggregateProgressByBulan(rows) {
  if (!rows || rows.length === 0) return null;
  const map = {};
  rows.forEach((r) => {
    if (!map[r.bulan]) map[r.bulan] = { nilai: 0, kumulatif: 0 };
    map[r.bulan].nilai += r.nilai || 0;
    map[r.bulan].kumulatif += r.kumulatif || 0;
  });
  const labels = PROGRESS_MONTH_ORDER.filter((m) => map[m] !== undefined);
  return {
    labels,
    nilai: labels.map((l) => map[l].nilai),
    kumulatif: labels.map((l) => map[l].kumulatif)
  };
}

function aggregateProgresPersenBulan() {
  const rows = Array.isArray(state.monthlyProgress) ? state.monthlyProgress : [];
  const byMonth = Object.fromEntries(rows.map((row) => [row.bulan, row]));
  // Selalu tampilkan JAN–DES. Bulan tanpa data menggunakan null agar label
  // tetap terlihat tanpa menciptakan batang/titik Rp0 palsu.
  const monthKeys = [...PROGRESS_MONTH_ORDER];

  const valueFor = (key, field) => {
    const row = byMonth[key];
    if (!row) return null;
    if (state.homeKategoriFilter && row.kategori && row.kategori[state.homeKategoriFilter]) {
      const source = row.kategori[state.homeKategoriFilter];
      if ((source.pagu || 0) <= 0) return null;
      return source[field] || 0;
    }
    if ((row.pagu || 0) <= 0) return null;
    return row[field] || 0;
  };
  const pagu = monthKeys.map((key) => valueFor(key, "pagu"));
  const terbayar = monthKeys.map((key) => valueFor(key, "terbayar"));
  const terkontrak = monthKeys.map((key) => valueFor(key, "terkontrak"));

  return {
    labels: monthKeys.map((k) => MONTH_LABEL_ID[k] || k),
    pagu,
    terbayar,
    terkontrak,
    persenTerbayar: terbayar.map((value, index) => pagu[index] > 0 ? Math.round((value / pagu[index]) * 1000) / 10 : null),
    persenTerkontrak: terkontrak.map((value, index) => pagu[index] > 0 ? Math.round((value / pagu[index]) * 1000) / 10 : null)
  };
}

function renderChartProgresPersenHome() {
  const agg = aggregateProgresPersenBulan();
  const charts = [
    {
      wrapId: "wrapChartProgresTerbayarHome",
      canvasId: "chartProgresTerbayarHome",
      label: "% Progres Penyerapan Terbayar",
      metricLabel: "Terbayar",
      values: agg && agg.persenTerbayar,
      rupiah: agg && agg.terbayar,
      rupiahLabel: "Terbayar (Rp)",
      color: CHART_COLORS.success,
      background: "rgba(22, 163, 74, 0.14)"
    },
    {
      wrapId: "wrapChartProgresTerkontrakHome",
      canvasId: "chartProgresTerkontrakHome",
      label: "% Progres Penyerapan Terkontrak",
      metricLabel: "Terkontrak",
      values: agg && agg.persenTerkontrak,
      rupiah: agg && agg.terkontrak,
      rupiahLabel: "AI Terkontrak (Rp)",
      color: CHART_COLORS.info,
      background: "rgba(14, 165, 233, 0.14)"
    }
  ];

  charts.forEach((config) => {
    if (!agg) return showChartEmpty(config.wrapId, config.canvasId);
    hideChartEmpty(config.wrapId, config.canvasId);
    destroyChart(config.canvasId);

    const ctx = document.getElementById(config.canvasId).getContext("2d");
    // Nilai 0 hanya untuk garis dasar visual pada bulan kosong. Array sumber
    // config.values tetap null sehingga bulan kosong tidak dianggap data nyata.
    const displayValues = config.values.map((value) => value === null ? 0 : value);
    state.charts[config.canvasId] = new Chart(ctx, {
      type: "line",
      data: {
        // Label sumbu hanya nama bulan. Nominal dan persentase ditampilkan
        // lengkap di tooltip agar tidak muncul dua kali.
        labels: agg.labels,
        datasets: [{
          type: "line",
          label: config.label,
          data: displayValues,
          borderColor: config.color,
          backgroundColor: config.color,
          tension: 0.35,
          fill: false,
          pointRadius: (context) => config.values[context.dataIndex] === null ? 0 : 4,
          pointHoverRadius: (context) => config.values[context.dataIndex] === null ? 0 : 6,
          pointBackgroundColor: config.color,
          spanGaps: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: (item) => config.values[item.dataIndex] !== null,
            callbacks: {
              title: (items) => agg.labels[items[0].dataIndex],
              label: (ctx2) => {
                const index = ctx2.dataIndex;
                const lines = [];
                const rupiah = config.rupiah[index];
                const persen = config.values[index];
                const previous = index > 0 ? config.rupiah[index - 1] : null;
                if (rupiah !== null && persen !== null) {
                  lines.push(`${config.metricLabel}: ${formatRupiah(rupiah)} (${formatPercent(persen)})`);
                  if (index > 0 && previous !== null && previous !== undefined) {
                    const delta = rupiah - previous;
                    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
                    lines.push(`Perubahan ${config.metricLabel}: ${sign}${formatRupiah(Math.abs(delta))}`);
                  } else if (index > 0) {
                    lines.push(`Perubahan ${config.metricLabel}: belum dapat dihitung (bulan sebelumnya kosong)`);
                  }
                }
                return lines;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { size: 11 } } },
          y: {
            grid: { color: CHART_COLORS.grid },
            ticks: { color: config.color, font: { size: 10 }, callback: (v) => v + "%" },
            suggestedMin: 0,
            suggestedMax: 100
          }
        }
      }
    });
  });
}

function setupProgressTabs() {
  document.querySelectorAll(".progress-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeProgressTab = btn.dataset.tab;
      document.querySelectorAll(".progress-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderProgressAI();
    });
  });
}

function renderProgressAI() {
  const tabKey = state.activeProgressTab;
  const rows = state.progressAI[tabKey] || [];
  const meta = PROGRESS_TABS[tabKey];

  const totalNilai = rows.reduce((sum, r) => sum + (r.nilai || 0), 0);
  document.getElementById("progressAITotal").textContent = formatRupiah(totalNilai);
  document.getElementById("progressAITotalLabel").textContent = `Total ${meta.label} (seluruh item)`;

  const agg = aggregateProgressByBulan(rows);
  const wrapId = "wrapChartProgressAI";
  const canvasId = "chartProgressAI";

  if (!agg) {
    showChartEmpty(wrapId, canvasId);
  } else {
    hideChartEmpty(wrapId, canvasId);
    destroyChart(canvasId);
    const ctx = document.getElementById(canvasId).getContext("2d");
    state.charts[canvasId] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: agg.labels,
        datasets: [
          { type: "bar", label: `${meta.label} per Bulan`, data: agg.nilai, backgroundColor: CHART_COLORS[meta.color] || CHART_COLORS.primary, borderRadius: 5, maxBarThickness: 32 },
          { type: "line", label: "Kumulatif", data: agg.kumulatif, borderColor: CHART_COLORS.warning, backgroundColor: "transparent", tension: 0.3, yAxisID: "y", pointRadius: 3 }
        ]
      },
      options: chartBaseOptions({ y: { formatter: formatRupiahShort }, legend: true })
    });
  }

  // Rincian per kode PRK (dropdown filter), mengikuti kolom Total & Kumulatif pada sheet
  populateProgressAIPrkOptions(rows);
  renderProgressAIPrkDetail(rows, meta);
}

function progressRowCode(r) {
  return (r.prkPos || r.kodePrk || r.kode || r.noAnggaran || r.prk || r.kodeAnggaran || "").toString().trim();
}

function populateProgressAIPrkOptions(rows) {
  const select = document.getElementById("filterProgressAIPrk");
  if (!select) return;

  const codes = Array.from(new Set(rows.map((r) => progressRowCode(r)).filter(Boolean))).sort();
  const currentValue = select.value;

  select.innerHTML = `<option value="">-- Pilih Kode PRK --</option>` + codes.map((c) => `<option value="${c}">${c}</option>`).join("");

  // Pertahankan kode yang sedang dipilih kalau masih tersedia di tab ini.
  if (codes.includes(currentValue)) select.value = currentValue;
}

function renderProgressAIPrkDetail(rows, meta) {
  const wrap = document.getElementById("progressAIPrkDetail");
  const select = document.getElementById("filterProgressAIPrk");
  if (!wrap || !select) return;

  const code = select.value;
  if (!code) {
    wrap.innerHTML = `<div class="empty-state empty-state-mini">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>
      <h4>Pilih kode PRK</h4><p>Pilih salah satu kode PRK pada dropdown di atas untuk melihat rincian Jan–Des.</p></div>`;
    return;
  }

  const byMonth = {};
  rows.forEach((r) => {
    if (progressRowCode(r) === code) byMonth[String(r.bulan || "").toUpperCase().trim()] = r;
  });

  const rowsHtml = PROGRESS_MONTH_ORDER.map((m) => {
    const row = byMonth[m];
    const total = row ? formatRupiah(row.nilai || 0) : "-";
    const kumulatif = row ? formatRupiah(row.kumulatif || 0) : "-";
    return `<tr><td>${MONTH_LABEL_ID[m] || m}</td><td class="cell-num">${total}</td><td class="cell-num">${kumulatif}</td></tr>`;
  }).join("");

  wrap.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Bulan</th><th class="heading-number">Total (${meta.label})</th><th class="heading-number">Kumulatif</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
}

function setupProgressAIPrkFilter() {
  const select = document.getElementById("filterProgressAIPrk");
  if (!select) return;
  select.addEventListener("change", () => {
    const rows = state.progressAI[state.activeProgressTab] || [];
    renderProgressAIPrkDetail(rows, PROGRESS_TABS[state.activeProgressTab]);
  });
}

function aggregateRekap(data, groupKey) {
  const map = {};
  data.forEach((r) => {
    const key = r[groupKey] || "Tidak Diketahui";
    if (!map[key]) map[key] = { pagu: 0, kontrak: 0, tertagih: 0, terbayar: 0, sisa: 0 };
    map[key].pagu += r.pagu || 0;
    map[key].kontrak += r.aiTerkontrak || 0;
    map[key].tertagih += r.tertagih || 0;
    map[key].terbayar += r.terbayar || 0;
    map[key].sisa += getSisaPagu(r);
  });
  return Object.keys(map)
    .map((key) => {
      const v = map[key];
      const persen = v.pagu > 0 ? (v.terbayar / v.pagu) * 100 : 0;
      return { label: key, ...v, persen };
    })
    .sort((a, b) => b.pagu - a.pagu);
}

function renderDetailKategoriTable(bodyId, rows) {
  const tbody = document.getElementById(bodyId);
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state empty-state-mini">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>
      <h4>Belum ada data</h4><p>Tidak ada baris data untuk tahun yang dipilih.</p></div></td></tr>`;
    return;
  }
  const sorted = [...rows].sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
  tbody.innerHTML = sorted
    .map(
      (r, index) => `<tr>
      <td>${index + 1}</td>
      <td>${r.unit || "-"}</td>
      <td>${r.prkPos || "-"}</td>
      <td>${r.uraianPrkPos || "-"}</td>
      <td>${r.tahun || "-"}</td>
      <td class="cell-num">${formatRupiah(r.pagu)}</td>
      <td class="cell-num">${formatRupiah(r.terbayar)}</td>
      <td>${r.status || "-"}</td>
    </tr>`
    )
    .join("");
}

function renderDetailMurniTable(bodyId, rows) {
  const tbody = document.getElementById(bodyId);
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state empty-state-mini">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>
      <h4>Belum ada data</h4><p>Tidak ada baris data untuk tahun yang dipilih.</p></div></td></tr>`;
    return;
  }
  const sorted = [...rows].sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
  tbody.innerHTML = sorted
    .map(
      (r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${r.prkPos || "-"}</td>
      <td>${r.uraianPrkPos || "-"}</td>
      <td class="cell-num">${formatRupiah(r.pagu)}</td>
      <td class="cell-num">${formatRupiah(r.aiTerkontrak)}</td>
      <td class="cell-num">${formatRupiah(r.terbayar)}</td>
      <td class="cell-num">${formatRupiah(getSisaPagu(r))}</td>
    </tr>`
    )
    .join("");
}

function renderRekapTable(bodyId, rekap, labelHeader) {
  const tbody = document.getElementById(bodyId);
  if (rekap.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state empty-state-mini">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>
      <h4>Belum ada data</h4><p>Rekap akan tampil setelah data terhubung.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rekap
    .map(
      (r) => `<tr class="row-clickable" data-label="${r.label}">
      <td>${r.label}</td>
      <td class="cell-num">${formatRupiah(r.pagu)}</td>
      <td class="cell-num">${formatRupiah(r.kontrak)}</td>
      <td class="cell-num">${formatRupiah(r.tertagih)}</td>
      <td class="cell-num">${formatRupiah(r.terbayar)}</td>
      <td class="cell-num">${formatRupiah(r.sisa)}</td>
      <td class="cell-num">${formatPercent(r.persen)}</td>
    </tr>`
    )
    .join("");
}

function renderRekapChart(canvasId, wrapId, rekap) {
  if (rekap.length === 0) return showChartEmpty(wrapId, canvasId);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rekap.map((r) => r.label),
      datasets: [
        { label: "Pagu", data: rekap.map((r) => r.pagu), backgroundColor: CHART_COLORS.info, borderRadius: 5, maxBarThickness: 28 },
        { label: "Terbayar", data: rekap.map((r) => r.terbayar), backgroundColor: CHART_COLORS.primary, borderRadius: 5, maxBarThickness: 28 }
      ]
    },
    options: chartBaseOptions({ y: { formatter: formatRupiahShort }, legend: true })
  });
}

function renderRekapUnit() {
  const rekap = aggregateRekap(state.rawData, "unit");
  renderRekapTable("rekapUnitTableBody", rekap, "Unit");
  renderRekapChart("chartRekapUnit", "wrapChartRekapUnit", rekap);
  document.querySelectorAll("#rekapUnitTableBody tr[data-label]").forEach((tr) => {
    tr.addEventListener("click", () => goToMonitoringWithFilter("unit", tr.dataset.label));
  });
}

function renderRekapProgram() {
  // Sinkronkan ulang opsi dari baris yang benar-benar berhasil dimuat.
  // Ini memastikan endpoint historis (termasuk 2024) muncul setelah refresh.
  fillSelect("filterTahunRekapProgram", "Semua Tahun", uniqueValues(state.rawData, "tahun"));
  const tahunSelect = document.getElementById("filterTahunRekapProgram");
  const selectedTahun = tahunSelect ? tahunSelect.value : "";
  const dataForChart = selectedTahun ? state.rawData.filter((r) => String(r.tahun) === selectedTahun) : state.rawData;

  const rekap = aggregateRekap(dataForChart, "uraianAnggaran");
  renderRekapTable("rekapProgramTableBody", rekap, "Program");
  renderRekapChart("chartRekapProgram", "wrapChartRekapProgram", rekap);
  document.querySelectorAll("#rekapProgramTableBody tr[data-label]").forEach((tr) => {
    tr.addEventListener("click", () => {
      state.filters.search = tr.dataset.label.toLowerCase();
      document.getElementById("searchInput").value = tr.dataset.label;
      if (selectedTahun) { state.filters.tahun = selectedTahun; document.getElementById("filterTahun").value = selectedTahun; }
      state.pagination.page = 1;
      applyFilters();
      document.querySelector('[data-page="monitoring"]').click();
    });
  });

  // Tambahan: rekap seluruh program per tahun (selalu seluruh tahun, tidak ikut filter di atas).
  const rekapTahun = aggregateRekap(state.rawData, "tahun").sort((a, b) => String(a.label).localeCompare(String(b.label)));
  renderRekapTable("rekapProgramPerTahunTableBody", rekapTahun, "Tahun");
  document.querySelectorAll("#rekapProgramPerTahunTableBody tr[data-label]").forEach((tr) => {
    tr.addEventListener("click", () => {
      if (tahunSelect) tahunSelect.value = tr.dataset.label;
      renderRekapProgram();
    });
  });
}

function setupRekapProgramYearFilter() {
  const select = document.getElementById("filterTahunRekapProgram");
  if (!select) return;
  select.addEventListener("change", renderRekapProgram);
}

function setupGrafikYearFilter() {
  const select = document.getElementById("filterTahunGrafik");
  if (!select) return;
  select.addEventListener("change", () => {
    state.grafikTahun = select.value;
    renderCharts("full");
  });
}

function aggregateProgramMetrics(data, keyFn) {
  const resolveKey = typeof keyFn === "function" ? keyFn : (r) => r.uraianAnggaran || "Tidak Diketahui";
  const map = {};
  data.forEach((r) => {
    const key = resolveKey(r) || "Tidak Diketahui";
    if (!map[key]) map[key] = { pagu: 0, aiTerkontrak: 0, akiTerkontrak: 0, tertagih: 0, terbayar: 0 };
    map[key].pagu += r.pagu || 0;
    map[key].aiTerkontrak += r.aiTerkontrak || 0;
    map[key].akiTerkontrak += r.akiTerkontrak || 0;
    map[key].tertagih += r.tertagih || 0;
    map[key].terbayar += r.terbayar || 0;
  });
  return Object.keys(map)
    .map((key) => ({ label: key, ...map[key] }))
    .sort((a, b) => b.pagu - a.pagu);
}

function wrapChartLabel(label, maxLen = 26) {
  const text = String(label || "");
  const words = text.split(" ");
  const lines = [];
  let current = "";
  words.forEach((w) => {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxLen && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  });
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

// Label sumbu chart dipersingkat jadi kode PRK/POS-nya saja (mis. "2026.DJBB.5.005"),
// tanpa uraian panjangnya, supaya tidak perlu dibungkus jadi banyak baris dan tidak
// tumpang tindih. Uraian lengkapnya tetap ditampilkan lewat tooltip saat di-hover.
function shortChartLabel(label, maxLen = 20) {
  const text = String(label || "").trim();
  const dashIdx = text.indexOf("—");
  if (dashIdx > 0) {
    const code = text.slice(0, dashIdx).trim();
    if (code) return code;
  }
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function limitTopPrograms(rekap, limit = 8) {
  if (rekap.length <= limit) return rekap;
  const top = rekap.slice(0, limit);
  const rest = rekap.slice(limit);
  const lain = rest.reduce(
    (acc, r) => {
      acc.pagu += r.pagu;
      acc.aiTerkontrak += r.aiTerkontrak;
      acc.akiTerkontrak += r.akiTerkontrak;
      acc.tertagih += r.tertagih;
      acc.terbayar += r.terbayar;
      return acc;
    },
    { label: `Lainnya (${rest.length} program)`, pagu: 0, aiTerkontrak: 0, akiTerkontrak: 0, tertagih: 0, terbayar: 0 }
  );
  return [...top, lain];
}

function horizontalBarOptions({ x = {}, legend = true } = {}) {
  return {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: legend, position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: CHART_COLORS.text } },
      tooltip: {
        backgroundColor: "#06294f",
        padding: 10,
        titleFont: { size: 12 },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${x.formatter ? x.formatter(ctx.parsed.x) : ctx.parsed.x}`
        }
      }
    },
    scales: {
      x: {
        grid: { color: CHART_COLORS.grid },
        ticks: { color: CHART_COLORS.text, font: { size: 11 }, callback: (v) => (x.formatter ? x.formatter(v) : v) }
      },
      y: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { size: 11 }, autoSkip: false } }
    }
  };
}

function renderProgramBandingChart(canvasId, wrapId, data, opts = {}) {
  const rekapRaw = aggregateProgramMetrics(data);
  if (rekapRaw.length === 0) return showChartEmpty(wrapId, canvasId);
  const rekap = limitTopPrograms(rekapRaw, opts.limit || 8);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const datasets = [
    { label: "Pagu", data: rekap.map((r) => r.pagu), backgroundColor: CHART_COLORS.info, borderRadius: 4, maxBarThickness: 16 },
    { label: "Terkontrak (AI)", data: rekap.map((r) => r.aiTerkontrak), backgroundColor: CHART_COLORS.primary, borderRadius: 4, maxBarThickness: 16 }
  ];
  if (opts.includeAki) {
    datasets.push({ label: "Terkontrak (AKI)", data: rekap.map((r) => r.akiTerkontrak), backgroundColor: "#7c3aed", borderRadius: 4, maxBarThickness: 16 });
  }
  datasets.push({ label: "Tertagih", data: rekap.map((r) => r.tertagih), backgroundColor: CHART_COLORS.warning, borderRadius: 4, maxBarThickness: 16 });
  datasets.push({ label: "Terbayar", data: rekap.map((r) => r.terbayar), backgroundColor: CHART_COLORS.success, borderRadius: 4, maxBarThickness: 16 });

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: { labels: rekap.map((r) => shortChartLabel(r.label)), datasets },
    options: {
      ...horizontalBarOptions({ x: { formatter: formatRupiahShort }, legend: true }),
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: CHART_COLORS.text } },
        tooltip: {
          backgroundColor: "#06294f",
          padding: 10,
          titleFont: { size: 12 },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items) => wrapChartLabel(rekap[items[0].dataIndex].label, 28),
            label: (ctx2) => `${ctx2.dataset.label}: ${formatRupiah(ctx2.parsed.x)}`
          }
        }
      },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text, font: { size: 11 }, callback: formatRupiahShort } },
        y: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { size: 10 }, autoSkip: false } }
      }
    }
  });
}

function renderProgramTerkontrakChart(canvasId, wrapId, data) {
  const rekapRaw = aggregateProgramMetrics(data);
  if (rekapRaw.length === 0) return showChartEmpty(wrapId, canvasId);
  const rekap = limitTopPrograms(rekapRaw, 8);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rekap.map((r) => wrapChartLabel(r.label)),
      datasets: [
        { label: "AI Terkontrak", data: rekap.map((r) => r.aiTerkontrak), backgroundColor: CHART_COLORS.info, borderRadius: 4, maxBarThickness: 18 },
        { label: "AKI Terkontrak", data: rekap.map((r) => r.akiTerkontrak), backgroundColor: "#7c3aed", borderRadius: 4, maxBarThickness: 18 }
      ]
    },
    options: horizontalBarOptions({ x: { formatter: formatRupiahShort }, legend: true })
  });
}

function renderProgramProporsiChart(canvasId, wrapId, data, opts = {}) {
  const rekapRaw = aggregateProgramMetrics(data, opts.keyFn);
  if (rekapRaw.length === 0) return showChartEmpty(wrapId, canvasId);
  const rekap = limitTopPrograms(rekapRaw, opts.limit || 7);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const palette = ["#0b4da2", "#2e86de", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0d9488", "#94a3b8"];
  const colors = rekap.map((_, i) => palette[i % palette.length]);
  const totalPagu = rekap.reduce((s, r) => s + r.pagu, 0);

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "doughnut",
    data: { labels: rekap.map((r) => r.label), datasets: [{ data: rekap.map((r) => r.pagu), backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 }, color: CHART_COLORS.text } },
        tooltip: {
          backgroundColor: "#06294f",
          padding: 10,
          titleFont: { size: 12 },
          bodyFont: { size: 12 },
          callbacks: {
            // Judul (nama PRK/POS) dipecah jadi beberapa baris pendek supaya tidak
            // melebihi lebar canvas (kalau 1 baris terlalu panjang, teksnya kepotong
            // karena canvas tidak bisa menggambar di luar area gambarnya sendiri).
            title: (items) => wrapChartLabel(items[0].label, 28),
            label: (ctx2) => {
              const pct = totalPagu > 0 ? ((ctx2.parsed / totalPagu) * 100).toFixed(1) : 0;
              return `${formatRupiah(ctx2.parsed)} (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

function renderProgramProgressChart(canvasId, wrapId, data) {
  const rekapRaw = aggregateProgramMetrics(data);
  if (rekapRaw.length === 0) return showChartEmpty(wrapId, canvasId);
  const rekap = limitTopPrograms(rekapRaw, 8).map((r) => ({
    label: r.label,
    persenAI: r.pagu > 0 ? (r.aiTerkontrak / r.pagu) * 100 : 0,
    persenTertagih: r.pagu > 0 ? (r.tertagih / r.pagu) * 100 : 0,
    persenTerbayar: r.pagu > 0 ? (r.terbayar / r.pagu) * 100 : 0
  }));
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      // Sumbu-Y pakai kode PRK/POS-nya saja (singkat, 1 baris) supaya tidak tumpang
      // tindih; uraian lengkapnya tetap tampil di tooltip saat batangnya di-hover.
      labels: rekap.map((r) => shortChartLabel(r.label)),
      datasets: [
        { label: "% AI Terkontrak", data: rekap.map((r) => Math.round(r.persenAI * 10) / 10), backgroundColor: CHART_COLORS.info, borderRadius: 4, maxBarThickness: 14 },
        { label: "% Tertagih", data: rekap.map((r) => Math.round(r.persenTertagih * 10) / 10), backgroundColor: CHART_COLORS.warning, borderRadius: 4, maxBarThickness: 14 },
        { label: "% Terbayar", data: rekap.map((r) => Math.round(r.persenTerbayar * 10) / 10), backgroundColor: CHART_COLORS.success, borderRadius: 4, maxBarThickness: 14 }
      ]
    },
    options: {
      ...horizontalBarOptions({ x: { formatter: (v) => v + "%" }, legend: true }),
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: CHART_COLORS.text } },
        tooltip: {
          backgroundColor: "#06294f",
          padding: 10,
          titleFont: { size: 12 },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items) => wrapChartLabel(rekap[items[0].dataIndex].label, 28),
            label: (ctx2) => `${ctx2.dataset.label}: ${ctx2.parsed.x}%`
          }
        }
      },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text, font: { size: 11 }, callback: (v) => v + "%" } },
        y: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { size: 11 }, autoSkip: false } }
      }
    }
  });
}

function renderPerbandinganPersenPrkChart(canvasId, wrapId, data, opts = {}) {
  const rekapRaw = aggregateProgramMetrics(data, opts.keyFn);
  if (rekapRaw.length === 0) return showChartEmpty(wrapId, canvasId);
  const rekap = limitTopPrograms(rekapRaw, opts.limit || 10).map((r) => ({
    label: r.label,
    fracAI: r.pagu > 0 ? r.aiTerkontrak / r.pagu : 0,
    fracTertagih: r.pagu > 0 ? r.tertagih / r.pagu : 0,
    fracTerbayar: r.pagu > 0 ? r.terbayar / r.pagu : 0
  }));
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const round3 = (v) => Math.round(v * 1000) / 1000;

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      // Sumbu-Y pakai kode PRK/POS-nya saja (singkat, 1 baris) supaya tidak tumpang
      // tindih; uraian lengkapnya tetap tampil di tooltip saat batangnya di-hover.
      labels: rekap.map((r) => shortChartLabel(r.label)),
      datasets: [
        { label: "SUM of % AI Terkotrak", data: rekap.map((r) => round3(r.fracAI)), backgroundColor: "#0b3d66", borderRadius: 3, maxBarThickness: 16 },
        { label: "Sum of % Tertagih", data: rekap.map((r) => round3(r.fracTertagih)), backgroundColor: "#f2cf5b", borderRadius: 3, maxBarThickness: 16 },
        { label: "Sum of % Terbayar", data: rekap.map((r) => round3(r.fracTerbayar)), backgroundColor: "#83a63d", borderRadius: 3, maxBarThickness: 16 }
      ]
    },
    options: {
      ...horizontalBarOptions({ x: { formatter: (v) => v }, legend: true }),
      layout: { padding: { left: 4 } },
      scales: {
        x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text, font: { size: 11 } }, suggestedMin: 0, suggestedMax: 1 },
        y: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { size: 11 }, autoSkip: false } }
      },
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: CHART_COLORS.text } },
        tooltip: {
          backgroundColor: "#06294f",
          padding: 10,
          titleFont: { size: 12 },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items) => wrapChartLabel(rekap[items[0].dataIndex].label, 28),
            label: (ctx2) => `${ctx2.dataset.label}: ${formatPercent(ctx2.parsed.x * 100)}`
          }
        }
      }
    }
  });
}

function aggregateMonitoringByBulan(data) {
  const rows = data.filter((r) => r.bulan);
  if (rows.length === 0) return null;

  const map = {};
  rows.forEach((r) => {
    const key = String(r.bulan).toUpperCase().trim();
    if (!map[key]) map[key] = { pagu: 0, kontrak: 0, tertagih: 0, terbayar: 0 };
    map[key].pagu += r.pagu || 0;
    map[key].kontrak += r.aiTerkontrak || 0;
    map[key].tertagih += r.tertagih || 0;
    map[key].terbayar += r.terbayar || 0;
  });

  const keys = Object.keys(map).sort((a, b) => MONTH_ORDER.indexOf(a) - MONTH_ORDER.indexOf(b));
  return {
    labels: keys,
    pagu: keys.map((k) => map[k].pagu),
    kontrak: keys.map((k) => map[k].kontrak),
    tertagih: keys.map((k) => map[k].tertagih),
    terbayar: keys.map((k) => map[k].terbayar)
  };
}

function aggregateProgresPerTahun(dataKategoriAll) {
  const rekap = aggregateRekap(dataKategoriAll, "tahun").sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return rekap;
}

function renderChartProgresTahun(dataKategoriAll, canvasId, wrapId) {
  const rekap = aggregateProgresPerTahun(dataKategoriAll);
  if (rekap.length === 0) return showChartEmpty(wrapId, canvasId);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);

  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rekap.map((r) => r.label),
      datasets: [{ label: "% Terbayar / Pagu", data: rekap.map((r) => Math.round(r.persen * 10) / 10), backgroundColor: CHART_COLORS.primary, borderRadius: 5, maxBarThickness: 40 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx2) => `${ctx2.parsed.y}% terealisasi` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: CHART_COLORS.text, font: { size: 11 } } },
        y: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text, font: { size: 11 }, callback: (v) => v + "%" } }
      }
    }
  });
}

function renderChartBandingMetrik(dataTahun, canvasId, wrapId) {
  const agg = aggregateMonitoringByBulan(dataTahun);

  if (!agg) {
    // Fallback: tidak ada kolom "bulan" terisi — tampilkan total tunggal agar chart tidak kosong.
    if (dataTahun.length === 0) return showChartEmpty(wrapId, canvasId);
    hideChartEmpty(wrapId, canvasId);
    destroyChart(canvasId);
    const totals = computeSummaryFull(dataTahun);
    const ctx = document.getElementById(canvasId).getContext("2d");
    state.charts[canvasId] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: ["Total"],
        datasets: [
          { label: "AI Terkontrak", data: [totals.totalKontrak], backgroundColor: CHART_COLORS.info, borderRadius: 5, maxBarThickness: 46 },
          { label: "Tertagih", data: [totals.totalTertagih], backgroundColor: CHART_COLORS.warning, borderRadius: 5, maxBarThickness: 46 },
          { label: "Terbayar", data: [totals.totalTerbayar], backgroundColor: CHART_COLORS.success, borderRadius: 5, maxBarThickness: 46 }
        ]
      },
      options: chartBaseOptions({ y: { formatter: formatRupiahShort }, legend: true })
    });
    return;
  }

  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: agg.labels,
      datasets: [
        { label: "AI Terkontrak", data: agg.kontrak, backgroundColor: CHART_COLORS.info, borderRadius: 5, maxBarThickness: 22 },
        { label: "Tertagih", data: agg.tertagih, backgroundColor: CHART_COLORS.warning, borderRadius: 5, maxBarThickness: 22 },
        { label: "Terbayar", data: agg.terbayar, backgroundColor: CHART_COLORS.success, borderRadius: 5, maxBarThickness: 22 }
      ]
    },
    options: chartBaseOptions({ y: { formatter: formatRupiahShort }, legend: true })
  });
}

function renderChartPaguKontrakPerPrk(data, canvasId, wrapId) {
  const agg = aggregateRekap(data, "prkPos");
  if (agg.length === 0) return showChartEmpty(wrapId, canvasId);
  hideChartEmpty(wrapId, canvasId);
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId).getContext("2d");
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: agg.map((r) => r.label),
      datasets: [
        { label: "Pagu", data: agg.map((r) => r.pagu), backgroundColor: CHART_COLORS.info, borderRadius: 5, maxBarThickness: 28 },
        { label: "AI Terkontrak", data: agg.map((r) => r.kontrak), backgroundColor: CHART_COLORS.primary, borderRadius: 5, maxBarThickness: 28 }
      ]
    },
    options: chartBaseOptions({ y: { formatter: formatRupiahShort }, legend: true })
  });
}

function renderKategoriDashboard(kategori) {
  const suffix = kategori; // "Murni" / "Lanjutan" — cocok dengan akhiran ID elemen di index.html
  const dataKategoriAll = filterByKategori(state.rawData, kategori);

  const tahunSelect = document.getElementById(`filterTahun${suffix}`);
  const selectedTahun = tahunSelect ? tahunSelect.value : "";
  const dataTahun = selectedTahun ? dataKategoriAll.filter((r) => String(r.tahun) === selectedTahun) : dataKategoriAll;

  // Summary cards
  const summary = computeSummaryFull(dataTahun);
  document.getElementById(`statPagu${suffix}`).textContent = formatRupiah(summary.totalPagu);
  document.getElementById(`statKontrak${suffix}`).textContent = formatRupiah(summary.totalKontrak);
  document.getElementById(`statPersenKontrak${suffix}`).textContent = formatPercent(summary.persenKontrak);
  document.getElementById(`statTertagih${suffix}`).textContent = formatRupiah(summary.totalUsulan);
  document.getElementById(`statTerbayar${suffix}`).textContent = formatRupiah(summary.totalTerbayar);
  document.getElementById(`statSisa${suffix}`).textContent = formatRupiah(summary.totalSisa);
  document.getElementById(`statPersenSisa${suffix}`).textContent = formatPercent(summary.persenSisa);
  document.getElementById(`statPersen${suffix}`).textContent = formatPercent(summary.persenRealisasi);

  renderChartPaguKontrakPerPrk(dataTahun, `chartProgresTahun${suffix}`, `wrapChartProgresTahun${suffix}`);
  renderRekapChart(`chartBanding${suffix}`, `wrapChartBanding${suffix}`, aggregateRekap(dataTahun, "prkPos"));
  renderDetailMurniTable(`detailTable${suffix}TableBody`, dataTahun);

  // Tabel rekap per tahun
  const rekapTahun = aggregateProgresPerTahun(dataKategoriAll);
  renderRekapTable(`rekapTahun${suffix}TableBody`, rekapTahun, "Tahun");
  document.querySelectorAll(`#rekapTahun${suffix}TableBody tr[data-label]`).forEach((tr) => {
    tr.addEventListener("click", () => {
      if (tahunSelect) tahunSelect.value = tr.dataset.label;
      renderKategoriDashboard(kategori);
    });
  });

  const detailSub = document.getElementById(`detailTableSub${suffix}`);
  if (detailSub) {
    detailSub.textContent = selectedTahun
      ? `Menampilkan ${dataTahun.length} baris data kategori ${kategori} tahun ${selectedTahun}`
      : `Menampilkan seluruh ${dataTahun.length} baris data kategori ${kategori} (semua tahun)`;
  }
}

function setupKategoriDashboardFilters() {
  const murniSelect = document.getElementById("filterTahunMurni");
  if (murniSelect) murniSelect.addEventListener("change", () => renderKategoriDashboard("Murni"));

  const lanjutanSelect = document.getElementById("filterTahunLanjutan");
  if (lanjutanSelect) lanjutanSelect.addEventListener("change", () => renderKategoriDashboard("Lanjutan"));
}

function renderArsipDashboard() {
  const dataArsipAll = filterByTahunArsip(state.rawData);

  const tahunSelect = document.getElementById("filterTahunArsip");
  const selectedTahun = tahunSelect ? tahunSelect.value : "";
  const dataTahun = selectedTahun ? dataArsipAll.filter((r) => String(r.tahun) === selectedTahun) : dataArsipAll;

  // Summary cards
  const summary = computeSummaryFull(dataTahun);
  document.getElementById("statPaguArsip").textContent = formatRupiah(summary.totalPagu);
  document.getElementById("statKontrakArsip").textContent = formatRupiah(summary.totalKontrak);
  document.getElementById("statTertagihArsip").textContent = formatRupiah(summary.totalUsulan);
  document.getElementById("statTerbayarArsip").textContent = formatRupiah(summary.totalTerbayar);
  document.getElementById("statSisaArsip").textContent = formatRupiah(summary.totalSisa);
  document.getElementById("statPersenArsip").textContent = formatPercent(summary.persenRealisasi);

  // 3 grafik (pakai ulang fungsi yang sama dengan Dashboard Murni/Lanjutan)
  renderChartProgresTahun(dataArsipAll, "chartProgresTahunArsip", "wrapChartProgresTahunArsip");
  renderChartBandingMetrik(dataTahun, "chartBandingArsip", "wrapChartBandingArsip");

  // Grafik per-Program khusus Arsip: AI vs AKI Terkontrak, dan ringkasan lengkap 5 metrik.
  renderProgramTerkontrakChart("chartProgramTerkontrakArsip", "wrapChartProgramTerkontrakArsip", dataTahun);
  renderProgramBandingChart("chartProgramFullArsip", "wrapChartProgramFullArsip", dataTahun, { includeAki: true });

  // Tabel rekap per tahun
  const rekapTahun = aggregateProgresPerTahun(dataArsipAll);
  renderRekapTable("rekapTahunArsipTableBody", rekapTahun, "Tahun");
  document.querySelectorAll("#rekapTahunArsipTableBody tr[data-label]").forEach((tr) => {
    tr.addEventListener("click", () => {
      if (tahunSelect) tahunSelect.value = tr.dataset.label;
      renderArsipDashboard();
    });
  });
}

function setupArsipFilter() {
  const arsipSelect = document.getElementById("filterTahunArsip");
  if (arsipSelect) arsipSelect.addEventListener("change", () => renderArsipDashboard());
}

function applyLaporanFilters() {
  const f = state.laporanFilters;
  let data = state.rawData;

  if (f.cakupan === "realtime") data = data.filter((r) => !isArsipTahun(r.tahun));
  else if (f.cakupan === "arsip") data = data.filter((r) => isArsipTahun(r.tahun));

  if (f.tahun) data = data.filter((r) => String(r.tahun) === f.tahun);
  if (f.kategori) data = data.filter((r) => r.kategori === f.kategori);
  if (f.unit) data = data.filter((r) => r.unit === f.unit);
  if (f.status) data = data.filter((r) => r.status === f.status);

  return data;
}

function populateLaporanFilterOptions() {
  fillSelect("filterTahunLaporan", "Semua Tahun", uniqueValues(state.rawData, "tahun"));
  fillSelect("filterUnitLaporan", "Semua Unit", uniqueValues(state.rawData, "unit"));
  fillSelect("filterStatusLaporan", "Semua Status", uniqueValues(state.rawData, "status"));
}

function setupLaporanFilters() {
  const map = {
    filterCakupanLaporan: "cakupan",
    filterTahunLaporan: "tahun",
    filterKategoriLaporan: "kategori",
    filterUnitLaporan: "unit",
    filterStatusLaporan: "status"
  };
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      state.laporanFilters[map[id]] = el.value;
      renderLaporan();
    });
  });

  const resetBtn = document.getElementById("btnResetFilterLaporan");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.laporanFilters = { cakupan: "realtime", tahun: "", kategori: "", unit: "", status: "" };
      const cakupanEl = document.getElementById("filterCakupanLaporan");
      if (cakupanEl) cakupanEl.value = "realtime";
      ["filterTahunLaporan", "filterKategoriLaporan", "filterUnitLaporan", "filterStatusLaporan"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      renderLaporan();
    });
  }
}

function renderLaporan() {
  const data = applyLaporanFilters();

  const summary = computeSummaryFull(data);
  document.getElementById("reportGeneratedAt").textContent =
    `Dibuat pada ${new Date().toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short" })} — mengikuti ${data.length} data terfilter`;

  const laporanJumlahDataText = document.getElementById("laporanJumlahDataText");
  if (laporanJumlahDataText) {
    const cakupanLabel = { semua: "Semua Data (Berjalan + Arsip)", realtime: `Data Berjalan (${getBerjalanLabel()})`, arsip: `Arsip (${getArsipLabel()})` }[state.laporanFilters.cakupan] || "Data";
    laporanJumlahDataText.textContent = `${cakupanLabel} — ${formatNumber(data.length)} baris data siap diunduh`;
  }

  const reportGrid = document.getElementById("reportSummaryGrid");
  reportGrid.innerHTML = `
    <div class="summary-card card-pagu"><div class="summary-card-label">Total Pagu</div><div class="summary-card-value">${formatRupiah(summary.totalPagu)}</div></div>
    <div class="summary-card card-jumlah"><div class="summary-card-label">Total AI Terkontrak</div><div class="summary-card-value">${formatRupiah(summary.totalKontrak)}</div></div>
    <div class="summary-card card-info"><div class="summary-card-label">Progres Pengadaan</div><div class="summary-card-value">${formatRupiah(summary.totalUsulan)}</div></div>
    <div class="summary-card card-realisasi"><div class="summary-card-label">Total Realisasi</div><div class="summary-card-value">${formatRupiah(summary.totalTerbayar)}</div></div>
    <div class="summary-card card-sisa"><div class="summary-card-label">Sisa Pagu</div><div class="summary-card-value">${formatRupiah(summary.totalSisa)}</div></div>
    <div class="summary-card card-persen"><div class="summary-card-label">Persentase Realisasi</div><div class="summary-card-value">${formatPercent(summary.persenRealisasi)}</div></div>
  `;

  const headEl = document.getElementById("reportTableHead");
  const bodyEl = document.getElementById("reportTableBody");
  headEl.innerHTML = COLUMNS.map((c) => `<th class="${["number", "currency"].includes(c.type) || c.key === "tahun" ? "heading-number" : "heading-text"}">${c.label}</th>`).join("");

  if (data.length === 0) {
    bodyEl.innerHTML = `<tr><td colspan="${COLUMNS.length}">
      <div class="empty-state empty-state-mini">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
        <h4>Belum ada data untuk dilaporkan</h4>
        <p>Coba ubah filter di atas, atau hubungkan Google Sheets terlebih dahulu pada api.js.</p>
      </div>
    </td></tr>`;
  } else {
    bodyEl.innerHTML = data.map((row, index) => `<tr>${COLUMNS.map((col) => renderCell(col.key === "no" ? { ...row, no: index + 1 } : row, col)).join("")}</tr>`).join("");
  }
}

function getReportData() {
  return applyLaporanFilters();
}

function exportToExcel() {
  const data = getReportData();
  if (data.length === 0) return showToastMsg("Tidak ada data untuk diekspor.", "error");

  const exportRows = data.map((row) => {
    const obj = {};
    COLUMNS.forEach((col) => (obj[col.label] = row[col.key]));
    return obj;
  });

  const worksheet = XLSX.utils.json_to_sheet(exportRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Monitoring SKKI");
  XLSX.writeFile(workbook, `Monitoring_Anggaran_SKKI_${dateStamp()}.xlsx`);
  showToastMsg("Data berhasil diekspor ke Excel.", "success");
}

function exportToPDF() {
  const data = getReportData();
  if (data.length === 0) return showToastMsg("Tidak ada data untuk diekspor.", "error");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

  doc.setFontSize(14);
  doc.text("Laporan Monitoring Anggaran SKKI", 40, 32);
  doc.setFontSize(9);
  doc.text(`Dibuat: ${new Date().toLocaleString("id-ID")} | Jumlah data: ${data.length}`, 40, 48);

  doc.autoTable({
    startY: 60,
    head: [COLUMNS.map((c) => c.label)],
    body: data.map((row) => COLUMNS.map((col) => (col.type === "currency" ? formatRupiah(row[col.key]) : row[col.key] ?? "-"))),
    styles: { fontSize: 7, cellPadding: 4 },
    headStyles: { fillColor: [11, 77, 162], textColor: 255 },
    alternateRowStyles: { fillColor: [242, 244, 248] }
  });

  doc.save(`Monitoring_Anggaran_SKKI_${dateStamp()}.pdf`);
  showToastMsg("Data berhasil diekspor ke PDF.", "success");
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function setupExportButtons() {
  document.getElementById("btnExportExcel").addEventListener("click", exportToExcel);
  document.getElementById("btnExportExcelTable").addEventListener("click", exportToExcel);
  document.getElementById("btnExportPDF").addEventListener("click", exportToPDF);
  document.getElementById("btnPrint").addEventListener("click", () => {
    document.querySelector('[data-page="laporan"]').click();
    setTimeout(() => window.print(), 200);
  });
}

function showToastMsg(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function init() {
  setupNavigation();
  setupDashboardSubmenuToggle();
  setupHomeKategoriFilter();
  setupProporsiGroupToggle();
  setupSidebarToggle();
  setupFilters();
  setupSorting();
  setupExportButtons();
  setupRowClick();
  setupProgressTabs();
  setupProgressAIPrkFilter();
  setupRekapProgramYearFilter();
  setupGrafikYearFilter();
  setupKategoriDashboardFilters();
  setupArsipFilter();
  setupLaporanFilters();

  document.getElementById("refreshBtn").addEventListener("click", (e) => {
    e.currentTarget.classList.add("loading");
    const task = window.KPI && window.KPI.state && window.KPI.state.app === "kpi" ? window.KPI.reload() : loadData(true);
    Promise.resolve(task).finally(() => e.currentTarget.classList.remove("loading"));
  });

  renderTableHeader();
  loadData(true);
}

document.addEventListener("DOMContentLoaded", init);