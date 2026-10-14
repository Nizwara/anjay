# 🚀 GITHUB MANAGER TELEGRAM BOT (Cloudflare Worker)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/USERNAME/REPOSITORY)

Bot Telegram powerfull untuk mengelola repository, folder, file, dan foto/gambar di GitHub secara langsung dari Telegram tanpa perlu membuka website GitHub.

---

## ⚡ Deploy Instan Ke Cloudflare Workers (1-Click Deploy)

Klik tombol di bawah ini untuk langsung men-deploy bot ini ke akun Cloudflare milikmu secara otomatis:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/USERNAME/REPOSITORY)

> 💡 **Catatan:** Ganti `USERNAME/REPOSITORY` pada URL tombol di atas dengan link repository GitHub milikmu (misalnya `https://deploy.workers.cloudflare.com/?url=https://github.com/namaku/my-bot-worker`).

---

## 🔑 SYARAT PAT TOKEN GITHUB (PENTING SANGAT ILMUNYA!)

Agar bot bisa membaca, mengubah file, dan **MENGHAPUS REPOSITORY**, pastikan Personal Access Token (PAT) milikmu dibuat dengan izin berikut di GitHub (`Settings -> Developer settings -> Personal access tokens`):

1. **Classic Token (PAT Classic):**
   - ✅ **`repo`** (Full control of private repositories)
   - ✅ **`delete_repo`** *(WAJIB CENTANG INI UNTUK MENYALAKAN FITUR HAPUS REPO)*

2. **Fine-grained Token:**
   - ✅ Repository permissions: **`Administration`** -> **`Read and write`** *(Wajib untuk izin hapus repo)*
   - ✅ Repository permissions: **`Contents`** -> **`Read and write`**

---

## ⚙️ PANDUAN LENGKAP PENGATURAN ENV & KV BINDING

Agar bot berjalan **100% Normal Jaya** setelah dideploy, kamu wajib mengonfigurasi **KV Namespace Binding** dan **Environment Variables** di Cloudflare Worker kamu.

---

### 📍 CARA 1: LEWAT DASHBOARD CLOUDFLARE (Rekomendasi untuk Pemula)

#### Step 1: Buat KV Namespace
1. Buka [Dashboard Cloudflare](https://dash.cloudflare.com/).
2. Di menu sebelah kiri, klik **Workers & Pages** -> **KV**.
3. Klik tombol **Create a Namespace**.
4. Beri nama Namespace, contoh: `SAWIT_KV` (atau nama apapun bebas), lalu klik **Add**.

#### Step 2: Hubungkan (Bind) KV Namespace ke Worker
1. Masuk ke **Workers & Pages** -> Pilih Worker kamu (misal: `github-manager-bot`).
2. Masuk ke tab **Settings** -> klik **Variables**.
3. Gulir ke bawah sampai ke bagian **KV Namespace Bindings**.
4. Klik **Add binding**.
5. Isikan field berikut:
   - **Variable name**: `SAWIT` *(atau `GH_DATA`)* ⚠️ *Harus persis huruf kapital ini!*
   - **KV namespace**: Pilih namespace `SAWIT_KV` yang baru saja kamu buat pada Step 1.
6. Klik **Save and deploy**.

#### Step 3: Atur Environment Variable (`TG_TOKEN`)
1. Di halaman Worker kamu -> tab **Settings** -> **Variables**.
2. Pada bagian **Environment Variables**, klik **Add variable**.
3. Isikan:
   - **Variable name**: `TG_TOKEN`
   - **Value**: Masukkan Token Bot Telegram kamu dari [@BotFather](https://t.me/BotFather) (contoh: `8789495014:AAFTA9yUl7...`).
4. Klik **Encrypt** (opsional agar token tersembunyi) lalu klik **Save and deploy**.

#### Step 4: Hubungkan Webhook Telegram
Buka browser atau jalankan perintah cURL ini untuk mendaftarkan URL Worker kamu ke Telegram API:
```bash
https://api.telegram.org/bot<TOKEN_BOT_KAMU>/setWebhook?url=https://<WORKER-KAMU>.<SUBDOMAIN>.workers.dev
```

---

### 📍 CARA 2: LEWAT WRANGLER (`wrangler.toml`)

Jika kamu mengedit atau men-deploy menggunakan Wrangler CLI, cukup tambahkan konfigurasi berikut ke file `wrangler.toml` kamu:

```toml
name = "github-manager-bot"
main = "worker.js"
compatibility_date = "2024-01-01"

# Environment Variables (Token Bot Telegram)
[vars]
TG_TOKEN = "8789495014:AAFTA9yUl7POqkV-jEQGrNc0W858mXuKkls"

# KV Namespace Binding (Penyimpanan data user)
[[kv_namespaces]]
binding = "SAWIT"             # Bisa juga "GH_DATA"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" # Isikan ID KV Namespace kamu
```

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

- 🗑️ **Hapus Folder Rekursif**:
  - Klik tombol **`🗑️ Hapus Folder`** pada item direktori untuk menghapus seluruh folder beserta file di dalamnya secara otomatis tanpa menyisakan `.gitkeep`.

- 📤 **Support Multi-File & Batch Photo Upload**:
  - Kirim banyak file atau foto sekaligus ke chat! Bot akan memproses dan mengunggah setiap file satu per satu tanpa menghentikan mode upload.
  - Selesaikan mode upload kapan saja dengan menekan tombol **`✅ Selesai / Kembali ke Folder`**.

- 🔒 **Ubah Visibilitas Repo (Private <-> Public)**:
  - Buka detail repo via tombol `ℹ️ Detail`.
  - Klik tombol **`🌐 Ubah Jadi Public`** atau **`🔒 Ubah Jadi Private`** untuk mengubah visibilitas repo secara instan.

- 📦 **Manajemen Repository Super Lengkap**:
  - **Daftar Repo & Paginasi**: Menampilkan daftar repo pengguna secara rapi dengan indikator Public (🌐) / Private (🔒) dan urutan aktivitas terbaru.
  - **Detail Repository**: Informasi lengkap seperti stars, forks, default branch, deskripsi, dan statistik update.
  - **Buat Repo Baru**: Dukungan membuat repository Public maupun Private (`namarepo private`) langsung dari chat.
  - **Hapus Repo Safely**: Fitur hapus repository permanen dengan informasi lisensi izin token PAT.

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
  - **Hapus File / Folder**: Konfirmasi hapus file atau folder secara aman.

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
