# Dukungan PWA Dashboard

Nama dan short name adalah **Dashboard**, sesuai konfirmasi terakhir.
Manifest memakai `display: "standalone"`, `start_url: "./index.html?app=skki"`,
`scope: "./"`, warna utama `#0b4da2`, dan latar `#f2f4f8` dari CSS aplikasi.
Tidak ada deployment atau perubahan hosting/domain.

## Status icon — perlu dilengkapi

Kedua icon sudah dibuat dari `assets/logo-pln.png` tanpa mengganti desain:
`icons/icon-192.png` (192 x 192) dan `icons/icon-512.png` (512 x 512).
Format PNG dan dimensi sesuai manifest sudah diverifikasi. Logo asli tetap
dipertahankan. Lihat `icons/README.md` untuk penggantian icon dan opsi maskable.

## Analisis project sebelum perubahan

| File / aset | Peran dan keputusan PWA |
| --- | --- |
| `index.html` | Dashboard SKKI/KPI, card, tabel, grafik, filter, modal, dan ekspor. Hanya ditambah metadata PWA dan pemuat `pwa.js` di head. |
| `portal.html` | Pilihan SKKI/KPI dan logout. Tambahan head yang sama agar identitas PWA tersedia di portal. |
| `login.html` | Form login. Tambahan head yang sama agar registrasi dapat berjalan tanpa harus login. |
| `style.css` | Tata letak, warna, komponen, dan responsivitas dashboard. Tidak diubah. |
| `portal.css` | Desain portal. Tidak diubah. |
| `login.css` | Desain login desktop/mobile. Tidak diubah. |
| `script.js` | Navigasi, ringkasan SKKI, tabel, filter, grafik, ekspor, dan refresh. Tidak diubah. |
| `kpi.js` | API KPI, grafik, peta unit, filter, perbandingan, dan pengusahaan. Memiliki cache respons di memori selama 10 menit; tidak diubah. |
| `api.js` | Pengambilan data SKKI, historis, progress, normalisasi, timeout/retry. Tidak diubah. File JavaScript boleh dicache; hasil request API tidak. |
| `auth.js` | Sesi di sessionStorage, validasi ke server, logout, dan pengalihan login. Tidak diubah. |
| `login.js` | Submit login, penanganan error, simpan sesi, dan pengalihan ke portal. Tidak diubah. |
| `cursor-effect.js` | Efek pointer. Tidak diubah. |
| `assets/chart.umd.min.js` | Library Chart.js lokal 4.4.4. Tidak diubah; termasuk aset statis. |
| `assets/logo-pln.png` | Logo 656 x 656. Tidak diubah. |
| `assets/logo.svg` | Pembungkus SVG berisi gambar logo 656 x 656. Tidak diubah. |
| `assets/peta-wilayah-up3-cirebon.png` | Peta 1536 x 1024. Tidak diubah. |
| `assets/pln-up3-cirebon-login-bg.png` | Latar login 1448 x 1086. Tidak diubah. |
| `assets/pln-up3-cirebon-login-mobile.png` | Latar login mobile 941 x 1671. Tidak diubah. |
| `apps-script/Code.gs` | Backend KPI, pembacaan sheet, cache server, dan autentikasi. Tidak diubah dan tidak dicache SW. |
| `apps-script/Code skki.gs` | Backend SKKI dan progress. Tidak diubah dan tidak dicache SW. |
| `2026 monitor anggaran skki.xlsx` | Workbook sumber SKKI, 21 sheet. Struktur ditinjau; bukan aset PWA dan tidak dicache. |
| `Realisasi KPI 2026 Cirebon - Versi.2.xlsx` | Workbook sumber KPI, 23 sheet. Struktur ditinjau; bukan aset PWA dan tidak dicache. |
| `~$Realisasi KPI 2026 Cirebon - Versi.2.xlsx` | File kunci sementara Excel. Tidak diubah dan tidak dicache. |
| `README-KPI.md` | Dokumentasi modul dan riwayat perubahan; beberapa catatan lama berbeda dari kode aktif. Tidak diubah. |
| `AUDIT-KPI.md` | Catatan integritas KPI. Tidak diubah. |
| `AUTH-SETUP.md` | Dokumentasi setup autentikasi. Tidak diubah. |
| `PANDUAN-LOGIN-ADMIN.md` | Panduan admin. Tidak diubah. |

Google Fonts dan library ekspor dari CDN tetap dimuat dengan cara sebelumnya.
Tidak ada build system/package manager yang diwajibkan dan tidak ada dependency baru.

## File baru dan kode tambahan

- `manifest.webmanifest`: identitas instalasi, mode standalone, alamat awal, scope, warna, dan konfigurasi icon.
- `pwa.js`: registrasi SW setelah event load, pemeriksaan secure context/browser,
  `updateViaCache: "none"`, pemeriksaan update, dan error handling lewat console.
- `service-worker.js`: allowlist aset lokal, network-first, dan pembersihan versi cache lama.
- `icons/README.md`: spesifikasi icon yang tersedia dan panduan penggantian.
- `tests/pwa.test.cjs`: pengujian cache dan registrasi tanpa dependency eksternal.
- `PWA.md`: analisis dan panduan ini.

Pada ketiga HTML, hanya ditambahkan blok bertanda `<!-- PWA: ... -->` di head:
link manifest, theme-color, application-name, meta mobile/Apple, apple-touch-icon,
dan `<script src="pwa.js" defer></script>`. Tidak ada perubahan body, stylesheet,
script aplikasi lama, atau tombol instalasi tambahan.

## Login, alamat awal, dan scope

Icon membuka `index.html?app=skki`, sehingga sesi yang masih valid langsung
membuka dashboard SKKI. Bila belum login atau sesi berakhir, alur lama tetap
berlaku: login, portal, lalu pilihan dashboard. sessionStorage tidak menjamin
sesi tab browser ikut terbawa ke jendela PWA baru. Tidak ada bypass login atau
perubahan penyimpanan sesi.

Scope relatif mengikuti folder manifest. Namun navigasi yang SUDAH ADA pada
`index.html`, `portal.html`, `login.html`, `auth.js`, dan `login.js` menulis ulang
alamat menjadi `/`. Karena itu jalankan project ini pada root origin, misalnya
`http://localhost:8080/`, sesuai asumsi aplikasi lama. PWA tidak memperbaiki atau
mengubah navigasi untuk hosting subfolder. Jika aplikasi kelak dipindahkan ke
subfolder, kompatibilitas navigasi tersebut perlu ditangani sebagai pekerjaan terpisah.

## Strategi cache dan data terbaru

SW hanya menangani GET untuk nama file statis dalam `STATIC_FILES`, pada origin
yang sama, dengan destination browser yang sesuai. Query aset boleh berupa `v`;
parameter lain seperti `action`, `sheet`, atau `token` tidak ditangani. Request
fetch/XHR data, POST login/logout, Apps Script, Google Sheets, CDN, HTML/navigasi,
manifest, file Excel, serta kode backend tidak masuk cache SW.

CSS/JS/gambar selalu dicoba lewat jaringan dengan `cache: "no-store"`, sehingga
cache HTTP browser juga dilewati. Response sukses dengan MIME yang sesuai
disimpan sebagai fallback ketika jaringan gagal. Response HTTP 404/500 tidak
digantikan diam-diam oleh cache. Response private/no-store, redirect, dan error
tidak disimpan. Kegagalan menulis cache tidak menggagalkan aset dari jaringan.
URL query versi dicocokkan persis; `?v=baru` tidak mendapat fallback `?v=lama`.

Cache diisi saat aset dipakai setelah SW aktif, bukan saat instalasi. Icon
yang belum tersedia tidak menggagalkan registrasi SW. HTML selalu dari jaringan;
tidak ada janji dashboard atau login bisa digunakan offline. Data dan validasi
login tetap membutuhkan internet. Cache memori KPI dan cache backend bawaan
tetap berlaku seperti sebelum PWA; SW tidak memperpanjang masa simpan data.

## Menjalankan dan menguji di localhost

Dari folder project, jalankan:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Buka `http://localhost:8080/login.html` atau
`http://localhost:8080/index.html?app=skki` di Chrome/Edge. Tetap gunakan hostname
yang sama selama pengujian. Hentikan server dengan Ctrl+C. Jangan memakai `file://`.
Untuk penggunaan hosted, diperlukan HTTPS; kode tidak mengubah pengaturan hosting.
Alamat HTTP IP LAN dari HP bukan pengecualian localhost: gunakan situs HTTPS
untuk pengujian instalasi pada HP.

Jalankan pengujian kode:

```powershell
node --test tests/pwa.test.cjs
```

Di DevTools Chrome/Edge:

1. **Application > Manifest**: periksa nama Dashboard, standalone, start URL,
   scope, dan icon. Pastikan kedua PNG tampil dan tidak ada error icon.
2. **Application > Service Workers**: periksa `service-worker.js` berstatus
   activated/running dengan scope root. Reload sekali bila halaman belum dikontrol.
3. **Application > Cache Storage**: setelah membuka halaman, hanya aset allowlist
   muncul pada `dashboard-skki-root-v1`; tidak ada URL Apps Script atau token.
4. **Network**: reload biasa untuk mengecek CSS/JS tetap melakukan request jaringan.
   Gunakan tombol refresh aplikasi dan pastikan request API masih berjalan.
5. Uji login/logout, pilihan SKKI/KPI, tabel, filter, grafik, ekspor, dan refresh
   dengan data/akun yang biasa digunakan. Hasil harus sama dengan website sebelumnya.

## Instalasi

Kedua file PNG sudah tersedia di folder `icons`.

- **Android (Chrome)**: buka website HTTPS, buka menu tiga titik, pilih
  **Install app / Instal aplikasi** atau **Add to Home screen / Tambahkan ke layar utama**,
  lalu konfirmasi. Nama dan ketersediaan menu bergantung browser/perangkat.
- **Desktop (Chrome/Edge)**: buka website, klik icon instalasi di address bar atau
  menu browser **Install / Apps > Install this site as an app**, kemudian konfirmasi.
- Buka icon **Dashboard** yang terbentuk. Jendela PWA memakai standalone;
  login tetap diperlukan jika tidak ada sesi valid. Website biasa tetap dapat dibuka.
- Di console jendela aplikasi, verifikasi
  `matchMedia('(display-mode: standalone)').matches` menghasilkan `true`.

## Mengganti nama dan icon

Nama: ubah `name` dan `short_name` pada manifest, serta `application-name` dan
`apple-mobile-web-app-title` pada ketiga HTML. Jangan mengubah `id` hanya untuk
mengganti nama. Nama pada instalasi lama dapat baru berubah setelah pembaruan
browser; untuk pengujian segera, hapus instalasi lalu install ulang.

Icon: ganti kedua PNG dengan ukuran yang sama. Jika nama file berubah, sesuaikan
`icons[].src`, link apple-touch-icon, dan allowlist `STATIC_FILES`. Untuk maskable,
ikuti `icons/README.md`. Icon yang sudah terpasang dapat memerlukan instalasi ulang
untuk segera memperlihatkan perubahan.

## Memperbarui website tanpa tertahan cache SW lama

1. Naikkan `CACHE_VERSION` pada `service-worker.js`, misalnya `v1` menjadi `v2`,
   pada setiap rilis. Jika menambah aset lokal baru, tambahkan ke allowlist.
2. Pertahankan/ganti query `?v=` CSS/JS sesuai pola rilis aplikasi yang sudah ada.
3. Setelah file baru tersedia di server, buka ulang website. Registrasi mengecek
   update SW tanpa memakai cache HTTP script worker.
4. Worker baru menunggu seluruh tab/jendela aplikasi lama ditutup sebelum aktif.
   Tidak ada reload otomatis yang mengganggu pekerjaan. Tutup tab DAN jendela PWA,
   lalu buka kembali. Pada aktivasi, cache versi lama milik scope ini dihapus;
   cache aplikasi lain tidak dihapus.
5. Untuk uji development, gunakan **Application > Service Workers > Update**,
   lalu **Skip waiting** bila masih waiting, dan reload. Periksa bahwa cache v1
   sudah hilang setelah v2 aktif dan aset dimuat ulang.

Bahkan selama worker lama masih aktif, strategi network-first tetap meminta
CSS/JS terbaru saat online. Tab yang sudah terbuka tetap menjalankan kode yang
telah dimuat sampai pengguna reload. Cache CDN/server berada di luar SW;
bila server mengirim file lama, periksa proses pembaruan server tersebut.

## Hasil validasi source

- 12 pengujian otomatis cache, routing request SW, manifest, dan registrasi lulus.
- Sintaks `pwa.js` dan `service-worker.js` lulus pemeriksaan Node.
- Server localhost mengembalikan HTTP 200 untuk tiga HTML, manifest, dan dua
  script PWA; MIME JavaScript sesuai. Kedua PNG kini tersedia; signature PNG dan dimensinya telah diverifikasi sesuai manifest.
- Checksum seluruh 27 file asli sama setelah blok tambahan PWA dikeluarkan
  dari tiga HTML. Body HTML, CSS, JavaScript lama, backend, gambar, dan workbook
  tidak berubah.
- Pengujian browser otomatis Edge belum selesai karena koneksi debugger timeout.
  Instalasi pada perangkat, mode standalone, serta alur login dengan akun nyata
  belum diuji; ikuti langkah pengujian manual di atas dengan kedua PNG yang sudah tersedia.

## Referensi teknis

- [MDN: syarat instalasi PWA dan secure context](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [MDN: service worker dan versioning cache](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
- [MDN: updateViaCache](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache)
- [web.dev: instalasi Android dan desktop](https://web.dev/learn/pwa/installation)
