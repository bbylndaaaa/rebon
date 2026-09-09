# Icon instalasi Dashboard

Kedua PNG sudah dibuat dari logo asli `../assets/logo-pln.png` dengan mengubah ukuran saja, tanpa mengganti desain. Manifest sudah menunjuk ke:

| File tersedia | Ukuran sebenarnya | Format |
| --- | --- | --- |
| `icon-192.png` | 192 x 192 piksel | PNG |
| `icon-512.png` | 512 x 512 piksel | PNG |

Sumber asli `../assets/logo-pln.png` (656 x 656 piksel) dan `../assets/logo.svg` tetap dipertahankan. Jika mengganti icon nanti, ekspor logo yang disetujui ke dua ukuran di atas. Mengganti nama file saja tidak mengubah ukuran gambar.

Dimensi dan format kedua file telah diperiksa sesuai manifest. Instalasi pada perangkat tetap perlu diuji melalui localhost atau HTTPS.

Opsional: siapkan `icon-maskable-512.png` berukuran 512 x 512 dengan latar
solid dan logo penting di dalam lingkaran tengah berdiameter 80% kanvas.
Setelah file tersedia, tambahkan ke array `icons` pada manifest:

```json
{
  "src": "icons/icon-maskable-512.png",
  "sizes": "512x512",
  "type": "image/png",
  "purpose": "maskable"
}
```

Jangan menandai icon biasa sebagai maskable jika area amannya belum diperiksa.
