# 🚀 GITHUB MANAGER TELEGRAM BOT (Cloudflare Worker)

Bot Telegram powerfull untuk mengelola repository, folder, file, dan foto/gambar di GitHub secara langsung dari Telegram tanpa perlu membuka website GitHub.

---

## ✨ Fitur Utama

- 🔑 **Sistem Autentikasi Mudah & Aman**:
  - Login via `/login username token_github` atau `/login token_github`
  - Token tersimpan secara aman di Cloudflare KV (`SAWIT` / `GH_DATA`)
  - Logout sesi instan via `/logout`
  - Cek profil GitHub via `/user`
  - Panduan estetik interaktif via `/start` atau `/help`

- 🎯 **Navigasi Cepat & Estetik**:
  - **`/start`**: Menampilkan panduan estetik beserta instruksi prompt & tombol ke menu utama.
  - **`/menu`**: Membuka daftar repository / workspace secara langsung.

- 🔒 **Ubah Visibilitas Repo (Private <-> Public)**:
  - Buka detail repo via tombol `ℹ️ Detail`.
  - Klik tombol **`🌐 Ubah Jadi Public`** atau **`🔒 Ubah Jadi Private`** untuk mengubah visibilitas repo secara instan tanpa perlu repot buka website GitHub!

- 📦 **Manajemen Repository Super Lengkap**:
  - **Daftar Repo & Paginasi**: Menampilkan daftar repo pengguna secara rapi dengan indikator Public (🌐) / Private (🔒) dan urutan aktivitas terbaru.
  - **Detail Repository**: Informasi lengkap seperti stars, forks, default branch, deskripsi, dan statistik update.
  - **Buat Repo Baru**: Dukungan membuat repository Public maupun Private (`namarepo private`) langsung dari chat.
  - **Hapus Repo Safely**: Fitur konfirmasi dialog interaktif sebelum menghapus repository secara permanen.

- 📸 **Upload Foto / Gambar Langsung**:
  - Kirim foto/gambar dari galeri ponsel secara langsung ke chat.
  - Penamaan file otomatis (`photo_12345.jpg`) atau kustom melalui caption foto (misal caption: `logo.png`).

- 🛠️ **Workspace & File Manager Interaktif**:
  - **Daftar File Tanpa Icon Bingung**: Nama file ditampilkan langsung pada tombol utama.
  - **Navigasi Folder & Paginasi File**: Buka sub-folder, navigasi kembali (Up Folder), dan atur pagination file/folder dengan gampang.
  - **Upload File Multifungsi**:
    - **Dokumen/Gambar**: Langsung drag-and-drop / upload dokumen atau foto.
    - **Manual Teks**: Kirim pesan teks dengan format `namafile.ext isi_script`.
  - **Lihat & Download File**:
    - Tampilan kode dengan syntax block `<pre>`.
    - Unduh file sebagai dokumen fisik.
  - **Edit File Seamless**: Edit langsung melalui pesan teks atau timpa dengan upload file/foto baru. File berukuran besar otomatis dikirim sebagai dokumen untuk diedit kembali.
  - **Rename / Move File**: Ubah nama file atau pindahkan file ke folder lain (contoh: `src/index.js`).
  - **Buat Folder Baru**: Pembuatan folder otomatis dengan `.gitkeep`.
  - **Hapus File**: Konfirmasi hapus file secara aman.

---

## ⚡ Cara Quick Setup & Deploy

### 1. Buat KV Namespace di Cloudflare Worker
1. Buka dashboard Cloudflare Worker / Pages.
2. Buat KV Namespace baru bernama `SAWIT` atau `GH_DATA`.
3. Bind KV Namespace tersebut ke Worker kamu dengan Variable Name `SAWIT` atau `GH_DATA`.

### 2. Environment Variables (Opsional)
- **`TG_TOKEN`**: Token Bot Telegram dari [@BotFather](https://t.me/BotFather).
  *(Jika tidak diisi, bot akan otomatis menggunakan fallback token default yang sudah terpasang)*.

### 3. Deploy Code
Copy seluruh isi file `worker.js` dan paste ke Cloudflare Worker Editor, lalu **Save and Deploy**.

### 4. Set Telegram Webhook
Set webhook bot Telegram kamu ke URL Cloudflare Worker yang telah dideploy:
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN_BOT_KAMU>/setWebhook?url=https://<WORKER-SUBDOMAIN>.workers.dev"
```

---

## 📋 Daftar Perintah Bot Telegram (Prompt List)

| Perintah | Deskripsi |
| :--- | :--- |
| `/start` | Tampilkan panduan estetik & bantuan prompt |
| `/menu` | Masuk ke menu utama (Repository / Workspace) secara langsung |
| `/login [user] <token>` | Login ke akun GitHub menggunakan Personal Access Token (PAT) |
| `/user` | Melihat informasi dan profil akun GitHub kamu |
| `/help` | Menampilkan halaman bantuan & panduan prompt |
| `/logout` | Keluar dan menghapus token dari KV |
| `/cancel` | Membatalkan aksi aktif (seperti upload/edit/rename) |

---

## 🔑 Scope Token GitHub (PAT) Yang Dibutuhkan
Saat membuat Personal Access Token di GitHub (`Settings -> Developer settings -> Personal access tokens`), pastikan centang scope berikut:
- `repo` (Full control of private repositories)
- `delete_repo` (Jika ingin menggunakan fitur hapus repository)
