const fs = require('fs');
let code = fs.readFileSync('src/worker.js', 'utf8');

// 1. Add X-Project-Name handling in the backend API
const search1 = `// 16. Endpoint: Deploy Upload ZIP/Folder Pages
if (url.pathname === '/api/deploy-pages') {
// Direct Upload ZIP/Folder massal via API fetch dibatasi tanpa hashing/CLI khusus dari wrangler.
// Endpoint ini akan mengembalikan respon peringatan yang tampil elegan di UI.
return new Response(JSON.stringify({
success: false,
error: "Sistem Direct Upload Cloudflare API membatasi upload massal (ZIP/Folder) tanpa file-hash. Silakan gunakan CLI (Wrangler) atau hubungkan akun GitHub Anda langsung di dashboard resmi Cloudflare untuk fitur ini."
}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}`;

const replace1 = `// 16. Endpoint: Deploy Upload Folder Pages
if (url.pathname === '/api/deploy-pages') {
  try {
    const projectName = request.headers.get('X-Project-Name');
    if (!projectName) throw new Error("Project name missing");

    const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
    const accData = await accRes.json();
    if (!accData.success) throw new Error("Gagal login API Cloudflare.");
    const accountId = accData.result?.[0]?.id;

    // Direct proxy to Cloudflare deployments endpoint using FormData
    const deployRes = await fetch(\`https://api.cloudflare.com/client/v4/accounts/\${accountId}/pages/projects/\${projectName}/deployments\`, {
      method: 'POST',
      headers: { ...commonHeaders },
      body: request.body
    });

    // Sometimes Cloudflare API might need the body to not be chunked, but request.body is a stream.
    // If it fails, we will see it in the error response.
    const deployData = await deployRes.json();

    return new Response(JSON.stringify(deployData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch(err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}`;

code = code.replace(search1, replace1);

// 2. Modify deployPagesProject frontend function
const search2 = `async function deployPagesProject() {
const projectName = document.getElementById('deploy-pages-select').value;
const method = document.getElementById('pages-upload-method').value;
const fileInput = document.getElementById('pages-file-input');
const urlInput = document.getElementById('pages-url-input').value;
if (!projectName) return Swal.fire('Gagal', 'Silakan pilih target project terlebih dahulu!', 'error');
if (method !== 'url' && (!fileInput.files || fileInput.files.length === 0)) {
return Swal.fire('Gagal', 'Silakan lampirkan file/folder untuk di-upload!', 'error');
}
if (method === 'url' && !urlInput) {
return Swal.fire('Gagal', 'Silakan masukkan link URL Repository Git!', 'error');
}
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, "Memproses pengiriman file...");
try {
const res = await fetch('/api/deploy-pages', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, projectName, method })
});
const data = await res.json();
if (data.success) {
Swal.fire('Sukses', 'Upload file web statis berhasil diproses!', 'success');
} else {
// Karena batasan Cloudflare API Direct Upload yang butuh hashing,
// kita kembalikan error elegan ke UI agar pengguna mengerti.
Swal.fire({
icon: 'info',
title: 'Info Sistem API',
text: data.error,
background: '#0f1524',
color: '#fff'
});
}
} catch(e) {
Swal.fire('Error', e.message, 'error');
} finally {
showLoading(false);
fileInput.value = '';
}
}`;

const replace2 = `async function deployPagesProject() {
const projectName = document.getElementById('deploy-pages-select').value;
const method = document.getElementById('pages-upload-method').value;
const fileInput = document.getElementById('pages-file-input');
const urlInput = document.getElementById('pages-url-input').value;

if (!projectName) return Swal.fire('Gagal', 'Silakan pilih target project terlebih dahulu!', 'error');
if (method === 'zip') {
  return Swal.fire('Informasi', 'Sistem Direct Upload API belum mendukung file ZIP secara langsung dari frontend tanpa library ekstrak. Silakan ekstrak ZIP Anda dan gunakan opsi "Upload Folder Aset" untuk mengunggah.', 'warning');
}
if (method !== 'url' && (!fileInput.files || fileInput.files.length === 0)) {
  return Swal.fire('Gagal', 'Silakan lampirkan file/folder untuk di-upload!', 'error');
}
if (method === 'url' && !urlInput) {
  return Swal.fire('Gagal', 'Silakan masukkan link URL Repository Git!', 'error');
}

const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, "Memproses pengiriman file...");

try {
  let res, data;
  if (method === 'folder') {
    const formData = new FormData();
    for (const file of fileInput.files) {
      const path = file.webkitRelativePath || file.name;
      // Strip top level directory if there's only one. For safety, just append with path.
      formData.append(path, file);
    }

    const headers = new Headers();
    if (account.email) headers.append('X-Auth-Email', account.email);
    headers.append('X-Auth-Key', account.apiKey);
    headers.append('X-Project-Name', projectName);

    res = await fetch('/api/deploy-pages', {
      method: 'POST',
      headers: headers,
      body: formData
    });
    data = await res.json();
  } else {
    // Handling URL is omitted as it wasn't implemented originally either, just giving a placeholder
    throw new Error('Fitur Git URL deployment belum diimplementasi pada endpoint ini.');
  }

  if (data.success) {
    Swal.fire('Sukses', 'Upload file web statis berhasil diproses!', 'success');
  } else {
    Swal.fire({
      icon: 'info',
      title: 'Info Sistem API',
      text: data.errors?.[0]?.message || data.error || 'Terjadi kesalahan saat upload',
      background: '#0f1524',
      color: '#fff'
    });
  }
} catch(e) {
  Swal.fire('Error', e.message, 'error');
} finally {
  showLoading(false);
  fileInput.value = '';
}
}`;

code = code.replace(search2, replace2);

fs.writeFileSync('src/worker.js', code);
