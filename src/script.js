/**
* ================================================================================
* CLOUDFLARE MANAGER (WORKER & DOMAIN MANAGER)
* ================================================================================
* Deskripsi : Panel dashboard Cloudflare terpadu untuk mendeploy Workers, mengelola
* variabel env, mengikat KV namespace, serta menambah/menghapus domain
* secara instan tanpa perlu masuk ke dashboard resmi Cloudflare.
* Author : Gemini & Deki_niswara
* Bahasa : Antarmuka & Dokumentasi dalam Bahasa Indonesia (Premium UI Style)
* Fitur Tambahan : Wildcard Pages Manager + Auto Create Pages Project (STABLE FIX)
* Fitur Baru : Pages Manager Khusus (Upload ZIP/Folder/URL & Manajemen).
* ================================================================================
*/

export default {
async fetch(request, env, ctx) {
const url = new URL(request.url);
const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
"Access-Control-Allow-Headers": "Content-Type, X-Auth-Email, X-Auth-Key",
"Access-Control-Max-Age": "86400",
};

// Tangani Preflight Request CORS
if (request.method === "OPTIONS") {
return new Response(null, {
status: 204,
headers: corsHeaders
});
}

// Tangani Operasi API Post (Rute Backend Worker)
if (request.method === 'POST') {
try {
let body = {};
// deploy-pages API sends FormData, not JSON, so we skip JSON parse for it.
if (url.pathname !== '/api/deploy-pages') {
  body = await request.json();
} else {
  // For deploy-pages, extract credentials from headers
  body = {
    email: request.headers.get('X-Auth-Email') || "",
    apiKey: request.headers.get('X-Auth-Key') || ""
  };
}
const { email, apiKey, globalAPIKey } = body;

const authEmail = email ? email.trim() : "";
const authKey = apiKey ? apiKey.trim() : (globalAPIKey ? globalAPIKey.trim() : "");

// Deteksi secara pintar apakah menggunakan API Token (Bearer) atau Email + Global API Key
const commonHeaders = {};
if (authEmail !== "") {
commonHeaders["X-Auth-Email"] = authEmail;
commonHeaders["X-Auth-Key"] = authKey;
} else {
commonHeaders["Authorization"] = `Bearer ${authKey}`;
}
commonHeaders["Content-Type"] = "application/json";

// 1. Endpoint: Ambil Subdomain Workers & ID Akun Pertama
if (url.pathname === '/api/subdomain') {
const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error(accData.errors?.[0]?.message || "Gagal login API Cloudflare. Periksa kredensial Anda.");
const accountId = accData.result?.[0]?.id;

if (!accountId) throw new Error("Tidak menemukan ID Akun Cloudflare yang aktif.");

const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers: commonHeaders });
const subData = await subRes.json();

return new Response(JSON.stringify({
success: true,
subdomain: subData.success ? subData.result.subdomain : "",
accountId: accountId
}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 2. Endpoint: Ambil Semua Workers Terdaftar
if (url.pathname === '/api/list-workers') {
const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Gagal memverifikasi akun Cloudflare.");
const accountId = accData.result?.[0]?.id;

const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, { headers: commonHeaders });
const listData = await listRes.json();
return new Response(JSON.stringify(listData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 3. Endpoint: Ambil Semua KV Namespace
if (url.pathname === '/api/list-kv') {
const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Gagal memverifikasi akun Cloudflare.");
const accountId = accData.result?.[0]?.id;

const kvRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/namespaces?per_page=100`, { headers: commonHeaders });
const kvData = await kvRes.json();
return new Response(JSON.stringify(kvData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 4. Endpoint: Hapus Worker Tertentu
if (url.pathname === '/api/delete-worker') {
const { workerName } = body;
if (!workerName) throw new Error("Nama worker wajib disertakan.");
const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Gagal memverifikasi akun Cloudflare.");
const accountId = accData.result?.[0]?.id;

const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
method: 'DELETE', headers: commonHeaders
});
const delData = await delRes.json();
return new Response(JSON.stringify(delData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 5. Endpoint: Ambil Script Worker Aktif + Bindings (KV & Env)
if (url.pathname === '/api/get-script') {
const { workerName } = body;
if (!workerName) throw new Error("Nama worker wajib disertakan.");
const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Gagal memverifikasi akun Cloudflare.");
const accountId = accData.result?.[0]?.id;

const scriptRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, { headers: commonHeaders });
const scriptRaw = await scriptRes.text();

let finalCleanScript = scriptRaw;
if (scriptRaw.includes('Content-Disposition')) {
const parts = scriptRaw.split(/--[a-f0-9-]{10,}/);
for (const part of parts) {
if (part.includes('name="worker.js"') || part.includes('Content-Type: application/javascript')) {
const contentArr = part.split(/\r?\n\r?\n/);
if (contentArr.length > 1) {
finalCleanScript = contentArr.slice(1).join('\n\n').trim();
finalCleanScript = finalCleanScript.replace(/--\s*$/, '').trim();
}
break;
}
}
}

const bindingsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/bindings`, { headers: commonHeaders });
const bindingsData = await bindingsRes.json();

let kvBindings = []; let envVars = [];
if (bindingsData.success && bindingsData.result) {
kvBindings = bindingsData.result.filter(b => b.type === 'kv_namespace').map(b => ({ name: b.name, id: b.namespace_id }));
envVars = bindingsData.result.filter(b => b.type === 'plain_text').map(b => ({ key: b.name, value: b.text }));
}

return new Response(JSON.stringify({ success: true, script: finalCleanScript, kvBindings: kvBindings, envVars: envVars }), {
headers: { ...corsHeaders, "Content-Type": "application/json" }
});
}

// 6. Endpoint: Deploy Worker + Pengikat Metadata Multi-Binding
if (url.pathname === '/api/deploy') {
const { workerName, githubUrl, scriptContent: manualScript, kvBindings, envVars } = body;
if (!authKey || !workerName) throw new Error("Kredensial API dan Nama Worker wajib diisi.");

let finalScript = "";
if (manualScript && manualScript.trim() !== "") {
finalScript = manualScript;
} else if (githubUrl) {
const res = await fetch(githubUrl);
if (!res.ok) throw new Error(`Gagal mengambil script dari URL GitHub: ${githubUrl}`);
finalScript = await res.text();
} else { throw new Error("Harap masukkan Script Manual atau URL GitHub Raw."); }

const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Gagal login API Cloudflare.");
const accountId = accData.result?.[0]?.id;

const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers: commonHeaders });
const subData = await subRes.json();
const subdomain = subData.success ? subData.result.subdomain : "";

const metadata = { main_module: "worker.js", compatibility_date: "2024-01-01", bindings: [] };

if (kvBindings && Array.isArray(kvBindings)) {
kvBindings.forEach(kv => { if (kv.name && kv.id) metadata.bindings.push({ type: "kv_namespace", name: kv.name, namespace_id: kv.id }); });
}

if (envVars && Array.isArray(envVars)) {
envVars.forEach(ev => { if (ev.key && ev.value) metadata.bindings.push({ type: "plain_text", name: ev.key, text: ev.value }); });
}

const formData = new FormData();
formData.append("metadata", JSON.stringify(metadata));
formData.append("worker.js", new Blob([finalScript], { type: "application/javascript+module" }));

const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
method: "PUT",
headers: authEmail !== "" ? { "X-Auth-Email": authEmail, "X-Auth-Key": authKey } : { "Authorization": `Bearer ${authKey}` },
body: formData
});
const deployData = await deployRes.json();
if (!deployData.success) throw new Error(deployData.errors?.[0]?.message || "Gagal mengunggah kode script ke Cloudflare.");

await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
method: "POST", headers: commonHeaders, body: JSON.stringify({ enabled: true })
});

const finalUrl = subdomain ? `https://${workerName}.${subdomain}.workers.dev` : `https://${workerName}.workers.dev`;
return new Response(JSON.stringify({ success: true, workerName, sub: finalUrl }), {
headers: { ...corsHeaders, "Content-Type": "application/json" }
});
}

// 7. Endpoint: Daftarkan Domain Baru (Add Zone)
if (url.pathname === '/api/add-domain') {
const { domain } = body;
if (!domain) throw new Error("Nama domain tidak boleh kosong.");

const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Verifikasi API Key gagal.");
const accountId = accData.result?.[0]?.id;

const addRes = await fetch("https://api.cloudflare.com/client/v4/zones", {
method: "POST", headers: commonHeaders,
body: JSON.stringify({ name: domain, account: { id: accountId }, jump_start: true, type: "full" })
});
const addData = await addRes.json();
return new Response(JSON.stringify(addData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 8. Endpoint: Dapatkan Seluruh Daftar Domain (List Zones)
if (url.pathname === '/api/list-domains') {
const listRes = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=50", { headers: commonHeaders });
const listData = await listRes.json();
return new Response(JSON.stringify(listData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 9. Endpoint: Hapus Domain (Delete Zone)
if (url.pathname === '/api/delete-domain') {
const { zoneId } = body;
if (!zoneId) throw new Error("ID Zone wajib dilampirkan.");

const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}`, { method: "DELETE", headers: commonHeaders });
const delData = await delRes.json();
return new Response(JSON.stringify(delData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ================================================================================
// ENDPOINT: WILDCARDS PAGES ENGINE & PROJECT CREATOR
// ================================================================================

// 10. Endpoint: Ambil Daftar Pages Projects (Untuk Dropdown)
if (url.pathname === '/api/list-pages-projects') {
const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Gagal verifikasi akun.");
const accountId = accData.result?.[0]?.id;

const projRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, { headers: commonHeaders });
const projData = await projRes.json();
return new Response(JSON.stringify(projData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 11. Endpoint: Dapatkan Wildcard Domains
if (url.pathname === '/api/list-wildcards') {
const { projectName } = body;
if (!projectName) throw new Error("Nama Project Pages wajib diisi.");

const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
const accountId = accData.result?.[0]?.id;

const listRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`, { headers: commonHeaders });
const listData = await listRes.json();
return new Response(JSON.stringify(listData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 12. Endpoint: Tambah Wildcard Domain (SUDAH DITAMBAHKAN TARGET SUBDOMAIN FIX)
if (url.pathname === '/api/add-wildcard') {
const { projectName, prefix, rootDomain, zoneId, targetSubdomain } = body;
if (!projectName || !prefix || !rootDomain || !zoneId) throw new Error("Data tidak lengkap.");

const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
const accountId = accData.result?.[0]?.id;

const fullDomain = `${prefix}.${rootDomain}`;

// Jika targetSubdomain dari frontend kosong, fallback ke projectName.pages.dev
const cnameContent = targetSubdomain ? targetSubdomain : `${projectName}.pages.dev`;

const addRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains`, {
method: 'POST', headers: commonHeaders, body: JSON.stringify({ name: fullDomain })
});
const addData = await addRes.json();

if (!addData.success && addData.errors?.[0]?.code !== 8000008) {
throw new Error(addData.errors?.[0]?.message || "Gagal menambahkan domain ke Project Pages.");
}

await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
method: 'POST', headers: commonHeaders,
body: JSON.stringify({ type: 'CNAME', name: fullDomain, content: cnameContent, ttl: 1, proxied: true })
});

await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains/${fullDomain}`, {
method: 'PATCH', headers: commonHeaders
});

return new Response(JSON.stringify({ success: true, domain: fullDomain }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 13. Endpoint: Hapus Wildcard Domain
if (url.pathname === '/api/delete-wildcard') {
const { projectName, fullDomain, zoneId } = body;

const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
const accountId = accData.result?.[0]?.id;

await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/domains/${fullDomain}`, {
method: 'DELETE', headers: commonHeaders
});

const findDnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${fullDomain}`, { headers: commonHeaders });
const findDnsData = await findDnsRes.json();

if (findDnsData.success && findDnsData.result.length > 0) {
await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${findDnsData.result[0].id}`, {
method: 'DELETE', headers: commonHeaders
});
}

return new Response(JSON.stringify({ success: true, domain: fullDomain }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 14. Endpoint: Create Pages Project (Jika Belum Punya)
if (url.pathname === '/api/create-pages-project') {
const { projectName } = body;
if (!projectName) throw new Error("Nama Project wajib diisi.");

const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
if (!accData.success) throw new Error("Gagal verifikasi akun.");
const accountId = accData.result?.[0]?.id;

const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
method: 'POST',
headers: commonHeaders,
body: JSON.stringify({
name: projectName,
production_branch: "main"
})
});
const createData = await createRes.json();

if (!createData.success) {
throw new Error(createData.errors?.[0]?.message || "Gagal membuat project Pages. Nama mungkin sudah dipakai.");
}

return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ================================================================================
// [FITUR BARU] ENDPOINT: DELETE PAGES & DEPLOY PAGES API
// ================================================================================

// 15. Endpoint: Hapus Project Pages
if (url.pathname === '/api/delete-pages-project') {
const { projectName } = body;
const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
const accData = await accRes.json();
const accountId = accData.result?.[0]?.id;

const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`, {
method: 'DELETE', headers: commonHeaders
});
const delData = await delRes.json();
return new Response(JSON.stringify(delData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 16. Endpoint: Deploy Upload Folder Pages
if (url.pathname === '/api/deploy-pages') {
  try {
    const projectName = request.headers.get('X-Project-Name');
    if (!projectName) throw new Error("Project name missing");

    const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: commonHeaders });
    const accData = await accRes.json();
    if (!accData.success) throw new Error("Gagal login API Cloudflare.");
    const accountId = accData.result?.[0]?.id;

    // Direct proxy to Cloudflare deployments endpoint using FormData
    const headersForDeploy = { ...commonHeaders };
    delete headersForDeploy["Content-Type"]; // Allow fetch to set boundary automatically
    // The request content type should be passed through
    const contentType = request.headers.get("content-type");
    if (contentType) headersForDeploy["Content-Type"] = contentType;

    const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
      method: 'POST',
      headers: headersForDeploy,
      body: request.body
    });

    // Sometimes Cloudflare API might need the body to not be chunked, but request.body is a stream.
    // If it fails, we will see it in the error response.
    const deployData = await deployRes.json();

    return new Response(JSON.stringify(deployData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch(err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

} catch (e) {
return new Response(JSON.stringify({
success: false,
error: e.message
}), {
status: 400,
headers: { ...corsHeaders, "Content-Type": "application/json" }
});
}
}

// 17. Endpoint: Dapatkan DNS Records untuk Zone
if (url.pathname === '/api/list-dns') {
  const { zoneId } = body;
  if (!zoneId) throw new Error("ID Zone wajib disertakan.");

  const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=100`, { headers: commonHeaders });
  const dnsData = await dnsRes.json();
  return new Response(JSON.stringify(dnsData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 18. Endpoint: Tambah DNS Record
if (url.pathname === '/api/add-dns') {
  const { zoneId, record } = body;
  if (!zoneId || !record) throw new Error("Data tidak lengkap.");

  const addRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify(record)
  });
  const addData = await addRes.json();
  return new Response(JSON.stringify(addData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// 19. Endpoint: Hapus DNS Record
if (url.pathname === '/api/delete-dns') {
  const { zoneId, recordId } = body;
  if (!zoneId || !recordId) throw new Error("Data tidak lengkap.");

  const delRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
    headers: commonHeaders
  });
  const delData = await delRes.json();
  return new Response(JSON.stringify(delData), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}


// TAMPILKAN DASBOARD FRONTEND (Premium HTML/CSS/JS Enterprise Aesthetic)
const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<title>⚡ Cloudflare Manager | Dashboard</title>
<!-- Google Fonts & Font Awesome -->
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
<style>
:root {
--bg-primary: #090d16;
--bg-secondary: #0f1524;
--bg-card: #141c30;
--bg-input: #080a12;
--text-primary: #f8fafc;
--text-secondary: #94a3b8;
--accent-color: #f6821f; /* Cloudflare Orange */
--accent-hover: #e06b0d;
--accent-glow: rgba(246, 130, 31, 0.15);
--success-color: #10b981;
--danger-color: #ef4444;
--warning-color: #f59e0b;
--border-subtle: #1e293b;
--border-active: #334155;
--shadow-premium: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
--radius-large: 18px;
--radius-medium: 12px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
background-color: var(--bg-primary);
background-image: radial-gradient(circle at 50% 0%, #151d35 0%, var(--bg-primary) 65%);
min-height: 100vh;
padding: 90px 16px 40px 16px; /* Space for fixed sticky header */
color: var(--text-primary);
line-height: 1.5;
overflow-x: hidden;
}
/* Scrollbar styling */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: var(--bg-primary); }
::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent-color); }
.container { max-width: 1200px; margin: 0 auto; position: relative; }
/* FIXED STICKY TOP NAVIGATION BAR */
.top-navbar {
position: fixed;
top: 0; left: 0; right: 0;
height: 70px;
background: rgba(15, 21, 36, 0.85);
backdrop-filter: blur(14px);
-webkit-backdrop-filter: blur(14px);
border-bottom: 1px solid var(--border-subtle);
z-index: 998;
display: flex;
align-items: center;
justify-content: space-between;
padding: 0 24px;
box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
.navbar-brand {
display: flex;
align-items: center;
gap: 10px;
text-decoration: none;
color: white;
font-weight: 800;
font-size: 1.25rem;
letter-spacing: -0.02em;
}
.navbar-brand i {
color: var(--accent-color);
font-size: 1.5rem;
}
.navbar-actions {
display: flex;
align-items: center;
gap: 12px;
}
.navbar-user-btn {
background: rgba(246, 130, 31, 0.1);
border: 1px solid rgba(246, 130, 31, 0.25);
color: var(--accent-color);
height: 42px;
padding: 0 16px;
border-radius: 10px;
font-weight: 600;
font-size: 0.9rem;
display: flex;
align-items: center;
gap: 8px;
cursor: pointer;
transition: all 0.2s ease;
}
.navbar-user-btn:hover {
background: var(--accent-color);
color: white;
box-shadow: 0 0 12px var(--accent-glow);
transform: translateY(-1px);
}
.overlay {
position: fixed; top: 0; left: 0; right: 0; bottom: 0;
background: rgba(2, 4, 8, 0.8); backdrop-filter: blur(8px);
z-index: 999; display: none; animation: fadeIn 0.3s ease;
}
.overlay.active { display: block; }
/* Sleek Sidebar Drawer Panel */
.account-panel {
position: fixed; top: 0; right: -420px; width: 420px; height: 100vh;
background: rgba(15, 21, 36, 0.96); backdrop-filter: blur(20px);
box-shadow: -10px 0 40px rgba(0,0,0,0.7);
z-index: 1000; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
overflow-y: auto; padding: 35px 25px;
border-left: 1px solid var(--border-subtle);
}
.account-panel.active { right: 0; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
/* Welcome Header UI */
.header { text-align: left; margin: 20px 0 35px 0; animation: slideDown 0.6s ease; }
@keyframes slideDown { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }
.header h1 {
font-weight: 800;
font-size: 2.2rem;
letter-spacing: -0.03em;
color: var(--text-primary);
margin-bottom: 4px;
}
.header p { color: var(--text-secondary); font-size: 1rem; font-weight: 400; }
/* Stats Grid */
.stats {
display: grid;
grid-template-columns: repeat(4, 1fr);
gap: 16px;
margin-bottom: 30px;
}
.stat-item {
background: var(--bg-secondary);
border-radius: var(--radius-medium);
padding: 20px;
text-align: left;
box-shadow: var(--shadow-premium);
border: 1px solid var(--border-subtle);
transition: all 0.2s ease;
cursor: pointer;
position: relative;
}
.stat-item:hover {
transform: translateY(-2px);
border-color: var(--accent-color);
background: var(--bg-card);
}
.stat-number {
font-size: 1.8rem;
font-weight: 800;
color: var(--text-primary);
line-height: 1.1;
margin-bottom: 4px;
font-family: 'Fira Code', monospace;
}
.stat-label { color: var(--text-secondary); font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
/* Alerts */
.alert {
padding: 14px 18px; border-radius: var(--radius-medium); margin-bottom: 25px;
display: none; animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
font-weight: 500; font-size: 0.9rem; border: 1px solid transparent;
}
@keyframes slideIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
.alert-error { background: rgba(239, 68, 68, 0.1); color: var(--danger-color); border-color: rgba(239, 68, 110, 0.2); }
.alert-success { background: rgba(16, 185, 129, 0.1); color: var(--success-color); border-color: rgba(16, 185, 129, 0.2); }
/* Current Active Account Box */
.current-account {
background: linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-card) 100%);
border-radius: var(--radius-medium); padding: 14px 20px; margin-bottom: 25px;
border: 1px solid var(--border-subtle); display: flex; align-items: center;
gap: 14px; flex-wrap: wrap;
}
.current-account i { font-size: 20px; color: var(--accent-color); }
.current-account div { display: flex; flex-direction: column; }
.current-account strong { font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; }
.current-account span { font-size: 0.95rem; color: var(--text-primary); font-weight: 600; }
/* Cards and Containers */
.deploy-form {
background: var(--bg-secondary);
border-radius: var(--radius-large);
padding: 30px;
margin-bottom: 30px;
border: 1px solid var(--border-subtle);
box-shadow: var(--shadow-premium);
}
/* PREMIUM DOMAIN INPUT CONTAINER (Fokus Redesain Lebih Besar & Estetis) */
.domain-hero-section {
width: 100%;
}
.domain-input-container {
display: grid;
grid-template-columns: 1fr auto;
gap: 12px;
width: 100%;
}
.domain-input-wrapper {
position: relative;
width: 100%;
}
.domain-input-wrapper i {
position: absolute;
left: 20px;
top: 50%;
transform: translateY(-50%);
color: var(--text-secondary);
font-size: 1.2rem;
transition: color 0.2s;
}
.domain-input-wrapper input {
width: 100%;
padding: 16px 20px 16px 54px;
background: var(--bg-input);
border: 1.5px solid var(--border-subtle);
color: var(--text-primary);
border-radius: 14px;
font-size: 1.05rem;
font-weight: 500;
transition: all 0.2s ease;
letter-spacing: 0.02em;
}
.domain-input-wrapper input:focus {
outline: none;
border-color: var(--accent-color);
box-shadow: 0 0 0 3px rgba(246, 130, 31, 0.1);
background: rgba(8, 10, 18, 0.9);
}
.domain-input-wrapper input:focus + i {
color: var(--accent-color);
}
.btn-large {
padding: 0 32px;
font-size: 0.95rem;
font-weight: 700;
border-radius: 14px;
display: inline-flex;
align-items: center;
justify-content: center;
gap: 10px;
cursor: pointer;
transition: all 0.2s ease;
border: none;
height: 100%;
}
/* Forms elements */
.form-group { margin-bottom: 20px; }
.form-group label {
display: flex; margin-bottom: 8px;
font-weight: 600; color: var(--text-primary);
font-size: 0.9rem; justify-content: space-between;
}
.form-group input, .form-group select {
width: 100%; padding: 12px 16px;
border: 1.5px solid var(--border-subtle);
background: var(--bg-input); color: white;
border-radius: 10px; font-size: 0.9rem;
transition: all 0.2s ease;
font-family: inherit;
}
.form-group input[type="file"] { padding: 10px; background: var(--bg-input); cursor: pointer; }
.form-group input:focus, .form-group select:focus {
outline: none; border-color: var(--accent-color);
box-shadow: 0 0 0 3px rgba(246, 130, 31, 0.1);
}
/* Professional Code Editor Area */
.code-editor-wrapper {
border: 1.5px solid var(--border-subtle);
border-radius: 14px; overflow: hidden;
background: #080b13;
}
.code-editor-header {
background: var(--bg-secondary); color: var(--text-primary);
padding: 12px 18px; display: flex; justify-content: space-between;
align-items: center; flex-wrap: wrap; gap: 10px;
border-bottom: 1px solid var(--border-subtle);
}
.editor-actions { display: flex; gap: 8px; }
.editor-action-btn {
background: var(--bg-input); border: 1px solid var(--border-subtle);
color: var(--text-secondary); padding: 6px 12px; border-radius: 8px;
cursor: pointer; font-size: 0.75rem; font-weight: 600;
transition: all 0.2s;
}
.editor-action-btn:hover {
background: var(--accent-color); color: white;
border-color: var(--accent-color);
}
.editor-action-btn.danger:hover { background: var(--danger-color); border-color: var(--danger-color); }
#manual-code {
width: 100%; min-height: 500px; padding: 20px;
font-family: 'Fira Code', 'Courier New', monospace; font-size: 0.85rem;
line-height: 1.6; background: #060810; color: #cbd5e1;
border: none; resize: vertical; outline: none; tab-size: 4;
white-space: pre; overflow-x: auto;
}
.char-counter {
padding: 8px 18px; background: var(--bg-secondary);
color: var(--text-secondary); font-size: 0.75rem;
text-align: right; border-top: 1px solid var(--border-subtle);
font-family: 'Fira Code', monospace;
}
/* Buttons Styling */
.btn {
padding: 12px 24px; border: none; border-radius: 10px;
font-size: 0.9rem; font-weight: 600; cursor: pointer;
transition: all 0.2s ease;
display: inline-flex; align-items: center; gap: 8px;
justify-content: center;
}
.btn-primary {
background: linear-gradient(135deg, var(--accent-color) 0%, var(--accent-hover) 100%);
color: white; width: 100%;
box-shadow: 0 4px 12px var(--accent-glow);
}
.btn-primary:hover {
transform: translateY(-1px);
box-shadow: 0 6px 16px rgba(246, 130, 31, 0.35);
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
.btn-danger {
background: rgba(239, 68, 68, 0.1); color: var(--danger-color);
border: 1px solid rgba(239, 68, 68, 0.15);
}
.btn-danger:hover { background: var(--danger-color); color: white; border-color: var(--danger-color); }
.btn-success {
background: linear-gradient(135deg, var(--success-color) 0%, #059669 100%);
color: white;
box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
}
.btn-success:hover {
transform: translateY(-1px);
box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3);
}
.btn-secondary {
background: var(--bg-input); color: var(--text-primary);
border: 1px solid var(--border-subtle);
}
.btn-secondary:hover { background: var(--bg-card); border-color: var(--text-secondary); }
/* Tabs Navigation */
.tabs {
display: flex; gap: 6px; margin-bottom: 25px;
border-bottom: 1px solid var(--border-subtle);
overflow-x: auto; padding-bottom: 1px;
scrollbar-width: none; /* Hide scrollbar for Firefox */
}
.tabs::-webkit-scrollbar { display: none; } /* Hide scrollbar for Chrome/Safari */
.tab-btn {
padding: 12px 18px; background: none; border: none;
cursor: pointer; font-size: 0.9rem; font-weight: 600;
color: var(--text-secondary); transition: all 0.2s ease;
position: relative; white-space: nowrap;
}
.tab-btn:hover { color: var(--text-primary); }
.tab-btn.active { color: var(--accent-color); }
.tab-btn.active::after {
content: ''; position: absolute; bottom: -1px; left: 0; right: 0;
height: 2px; background: var(--accent-color);
border-radius: 2px;
}
.tab-content { display: none; animation: fadeIn 0.3s ease; }
.tab-content.active { display: block; }
/* CARD ROW LAYOUT */
.worker-list-wrapper {
background: var(--bg-secondary); border-radius: var(--radius-large);
padding: 24px; border: 1px solid var(--border-subtle);
margin-bottom: 30px; box-shadow: var(--shadow-premium);
}
.worker-list-wrapper h3 { font-size: 1.15rem; font-weight: 700; margin-bottom: 16px; }
.worker-list { max-height: 600px; overflow-y: auto; padding-right: 4px; }
.grid-card {
background: var(--bg-card);
padding: 16px 20px;
margin-bottom: 12px;
border-radius: var(--radius-medium);
display: flex;
flex-direction: column;
gap: 12px;
transition: all 0.2s ease;
border: 1px solid var(--border-subtle);
}
.grid-card:hover {
border-color: var(--accent-color);
box-shadow: 0 4px 15px rgba(0,0,0,0.15);
}
.card-row-top {
display: flex;
justify-content: space-between;
align-items: flex-start;
width: 100%;
}
.card-info {
display: flex;
flex-direction: column;
gap: 4px;
max-width: 75%;
}
.card-title-badge {
display: flex;
align-items: center;
gap: 8px;
flex-wrap: wrap;
}
.card-title-badge strong {
font-size: 1rem;
font-weight: 700;
color: var(--text-primary);
word-break: break-all;
}
/* Truncate Hash Helper */
.hash-id {
font-family: 'Fira Code', monospace;
font-size: 0.75rem;
color: var(--text-secondary);
background: var(--bg-input);
padding: 4px 8px;
border-radius: 6px;
display: inline-flex;
align-items: center;
gap: 6px;
max-width: 100%;
border: 1px solid rgba(255, 255, 255, 0.02);
}
.hash-text {
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
}
.hash-copy-btn {
background: none;
border: none;
color: var(--text-secondary);
cursor: pointer;
transition: color 0.15s;
}
.hash-copy-btn:hover {
color: var(--accent-color);
}
.card-meta {
font-size: 0.8rem;
color: var(--text-secondary);
display: flex;
align-items: center;
gap: 6px;
}
.card-actions-wrapper {
display: flex;
gap: 8px;
width: 100%;
border-top: 1px solid rgba(255, 255, 255, 0.04);
padding-top: 12px;
margin-top: 4px;
}
.card-actions-wrapper .btn {
flex: 1;
padding: 8px 14px;
font-size: 0.8rem;
border-radius: 8px;
}
/* [CSS BARU] Pages Grid Layout */
.pages-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
/* Badges */
.badge-premium {
font-size: 0.7rem;
font-weight: 800;
padding: 2px 8px;
border-radius: 20px;
text-transform: uppercase;
letter-spacing: 0.5px;
display: inline-block;
}
.badge-active { background: rgba(16, 185, 129, 0.15); color: var(--success-color); border: 1px solid rgba(16, 185, 129, 0.25); }
.badge-pending { background: rgba(245, 158, 11, 0.15); color: var(--warning-color); border: 1px solid rgba(245, 158, 11, 0.25); }
/* Empty States */
.empty-state { text-align: center; padding: 50px 20px; color: var(--text-secondary); }
.empty-state i { font-size: 40px; margin-bottom: 12px; color: var(--border-subtle); }
.empty-state h4 { font-size: 1.05rem; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; }
/* Loading Spinner */
.loading {
display: none; position: fixed; top: 50%; left: 50%;
transform: translate(-50%, -50%); background: var(--bg-secondary);
border: 1px solid var(--accent-color); padding: 30px 45px;
border-radius: var(--radius-large); box-shadow: 0 20px 50px rgba(0,0,0,0.8);
text-align: center; z-index: 2002; min-width: 280px;
}
.loading.active { display: block; }
.spinner {
border: 3px solid rgba(246, 130, 31, 0.1);
border-top: 3px solid var(--accent-color);
border-radius: 50%; width: 50px; height: 50px;
animation: spin 0.8s linear infinite; margin: 0 auto 16px;
}
.hidden { display: none; }
.edit-badge {
background: rgba(245, 158, 11, 0.12); color: var(--warning-color);
padding: 4px 12px; border-radius: 50px; font-size: 10px;
font-weight: 700; border: 1px solid rgba(245, 158, 11, 0.2);
text-transform: uppercase; letter-spacing: 0.05em;
}
.account-list .grid-card { cursor: pointer; }
.account-list .grid-card:hover { background: var(--bg-card); }
.env-row { display: flex; gap: 8px; margin-bottom: 8px; animation: fadeIn 0.2s ease; }
/* Custom Modal Window Overlay */
.modal-overlay {
position: fixed; top: 0; left: 0; right: 0; bottom: 0;
background: rgba(2, 4, 8, 0.85); backdrop-filter: blur(10px);
z-index: 2000; display: flex; align-items: center; justify-content: center;
opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
padding: 16px;
}
.modal-overlay.active { opacity: 1; pointer-events: auto; }
.modal-content {
background: var(--bg-secondary); border: 1px solid var(--border-subtle);
border-radius: 24px; padding: 28px;
max-width: 500px; width: 100%; box-shadow: var(--shadow-premium);
transform: translateY(15px); transition: transform 0.3s ease;
position: relative; color: white;
overflow: hidden;
/* Custom for DNS */
max-height: 90vh;
display: flex;
flex-direction: column;
}
.modal-overlay.active .modal-content { transform: translateY(0); }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.modal-header h3 { font-size: 1.25rem; color: white; font-weight: 700; }
.modal-close-btn { background: none; border: none; font-size: 1.6rem; color: var(--text-secondary); cursor: pointer; transition: color 0.2s; }
.modal-close-btn:hover { color: var(--danger-color); }
.modal-body { color: var(--text-secondary); line-height: 1.6; margin-bottom: 24px; font-size: 0.9rem; overflow-y: auto; flex: 1; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; }
/* IMPROVED DNS NAMESERVERS COMPONENT */
.ns-container {
background: var(--bg-input);
border: 1.5px solid var(--border-subtle);
border-radius: 14px;
padding: 12px;
margin: 18px 0;
}
.ns-row {
display: flex; justify-content: space-between; align-items: center;
margin-bottom: 10px; background: rgba(255, 255, 255, 0.02);
padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border-subtle);
cursor: pointer; transition: all 0.2s ease; gap: 12px;
}
.ns-row:last-child { margin-bottom: 0; }
.ns-row:hover { background: rgba(255, 255, 255, 0.04); border-color: var(--accent-color); }
.ns-value-text { font-family: 'Fira Code', monospace; font-size: 0.85rem; color: var(--text-primary); word-break: break-all; flex: 1; text-align: left; }
.ns-copy-icon {
background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle);
color: var(--text-secondary); width: 36px; height: 36px;
border-radius: 8px; display: flex; align-items: center; justify-content: center;
cursor: pointer; transition: all 0.15s ease; flex-shrink: 0;
}
.ns-row:hover .ns-copy-icon { background: var(--accent-color); color: white; border-color: var(--accent-color); }
.warning-banner {
display: flex; gap: 10px; background: rgba(245, 158, 11, 0.08);
border: 1px solid rgba(245, 158, 11, 0.15); padding: 12px 14px;
border-radius: 10px; color: var(--warning-color); font-size: 0.8rem;
margin-top: 14px; text-align: left; line-height: 1.4;
}
.panel-drawer-header {
display: flex; justify-content: space-between; align-items: center;
margin-bottom: 25px; padding-bottom: 15px; border-bottom: 1px solid var(--border-subtle);
}
.panel-drawer-title { font-weight: 800; font-size: 1.2rem; color: white; display: flex; align-items: center; gap: 8px; margin: 0; }
.panel-drawer-close-btn {
background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-subtle);
color: var(--text-secondary); width: 36px; height: 36px; border-radius: 50%;
display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease;
}
.panel-drawer-close-btn:hover { background: rgba(239, 68, 68, 0.15); color: var(--danger-color); border-color: rgba(239, 68, 68, 0.3); transform: rotate(90deg); }
@media (max-width: 1024px) {
.stats { grid-template-columns: repeat(2, 1fr); gap: 12px; }
}
@media (max-width: 768px) {
body { padding: 90px 12px 30px 12px; }
.header h1 { font-size: 1.8rem; }
.header p { font-size: 0.85rem; }
.stats { grid-template-columns: repeat(2, 1fr); gap: 10px; }
.stat-item { padding: 14px 12px; }
.stat-number { font-size: 1.5rem; }
.stat-label { font-size: 0.7rem; }
.account-panel { width: 100%; right: -100%; padding: 30px 20px; }
#manual-code { min-height: 380px; font-size: 0.8rem; padding: 15px; }
.deploy-form { padding: 18px; }
.tab-btn { padding: 10px 12px; font-size: 0.8rem; }
.domain-input-container { grid-template-columns: 1fr; gap: 8px; }
.btn-large { width: 100%; height: 50px; }
.top-navbar { padding: 0 16px; }
.pages-grid { grid-template-columns: 1fr; } /* Grid Mobile Pages */
}
/* CUSTOM DNS MANAGEMENT */
.dns-form-container { display: none; background: var(--bg-card); padding: 15px; border-radius: 10px; margin-bottom: 15px; border: 1px solid var(--border-subtle); }
</style>
</head>
<body>
<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
<script>
// --- DNS MANAGEMENT CODE START ---
function manageDNS(zoneId, domainName) {
  openModal(\`DNS Records - \\${domainName}\`, \`
    <div id="dns-management-container">
      <div style="text-align:center; padding: 20px;"><div class="spinner"></div><p>Memuat DNS Records...</p></div>
    </div>
  \`, \`<button class="btn btn-secondary" onclick="closeModal()">Tutup</button>\`);

  fetchDNSRecords(zoneId, domainName);
}

async function fetchDNSRecords(zoneId, domainName) {
  const container = document.getElementById('dns-management-container');
  if (!container) return;

  const account = accounts.find(acc => acc.id === currentAccountId);

  try {
    const res = await fetch('/api/list-dns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, apiKey: account.apiKey, zoneId: zoneId })
    });

    const data = await res.json();
    if (data.success) {
      renderDNSRecords(data.result, zoneId, domainName);
    } else {
      throw new Error(data.errors?.[0]?.message || 'Gagal mengambil DNS Records');
    }
  } catch (err) {
    container.innerHTML = \`<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h4>Error: \${err.message}</h4></div>\`;
  }
}

function renderDNSRecords(records, zoneId, domainName) {
  const container = document.getElementById('dns-management-container');
  if (!container) return;

  let html = \`
    <div style="margin-bottom: 15px;">
       <button class="btn btn-success btn-sm" style="padding: 8px 12px; font-size: 0.8rem; border-radius: 6px;" onclick="showAddDNSForm('\${zoneId}', '\${domainName}')"><i class="fas fa-plus"></i> Tambah Record</button>
    </div>
    <div id="add-dns-form-container" class="dns-form-container">
        <div style="display: grid; grid-template-columns: 1fr 2fr 2fr auto; gap: 10px; align-items: end;">
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.8rem;">Type</label>
                <select id="new-dns-type" style="padding: 8px; border-radius: 6px;">
                    <option value="A">A</option>
                    <option value="AAAA">AAAA</option>
                    <option value="CNAME">CNAME</option>
                    <option value="TXT">TXT</option>
                    <option value="MX">MX</option>
                </select>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.8rem;">Name</label>
                <input type="text" id="new-dns-name" placeholder="subdomain or @" style="padding: 8px; border-radius: 6px;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.8rem;">Content</label>
                <input type="text" id="new-dns-content" placeholder="192.168.1.1" style="padding: 8px; border-radius: 6px;">
            </div>
            <div style="margin-bottom: 8px;">
               <label style="font-size: 0.8rem; display:block; margin-bottom: 4px;">Proxy</label>
               <input type="checkbox" id="new-dns-proxied" checked>
            </div>
        </div>
        <div style="margin-top: 15px; text-align: right; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
            <button class="btn btn-secondary btn-sm" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px;" onclick="document.getElementById('add-dns-form-container').style.display='none'">Batal</button>
            <button class="btn btn-primary btn-sm" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px;" onclick="addDNSRecord('\${zoneId}', '\${domainName}')">Simpan</button>
        </div>
    </div>
    <div style="max-height: 400px; overflow-y: auto;">
  \`;

  if (records.length === 0) {
    html += \`<div class="empty-state"><i class="fas fa-dns"></i><h4>Tidak ada DNS Record</h4></div>\`;
  } else {
    html += \`<table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; color: var(--text-primary);">
      <thead>
        <tr style="border-bottom: 1px solid var(--border-subtle); text-align: left;">
          <th style="padding: 8px;">Type</th>
          <th style="padding: 8px;">Name</th>
          <th style="padding: 8px;">Content</th>
          <th style="padding: 8px;">Proxy</th>
          <th style="padding: 8px;">Aksi</th>
        </tr>
      </thead>
      <tbody>
    \`;

    records.forEach(r => {
      html += \`
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 8px; font-weight: bold;">\${r.type}</td>
          <td style="padding: 8px;">\${r.name}</td>
          <td style="padding: 8px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="\${r.content}">\${r.content}</td>
          <td style="padding: 8px;">
             \${r.proxied ? '<i class="fas fa-cloud" style="color:var(--accent-color);" title="Proxied"></i>' : '<i class="fas fa-cloud" style="color:var(--text-secondary);" title="DNS Only"></i>'}
          </td>
          <td style="padding: 8px;">
            <button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.7rem; border-radius: 6px;" onclick="deleteDNSRecord('\${zoneId}', '\${r.id}', '\${domainName}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      \`;
    });

    html += \`</tbody></table>\`;
  }

  html += \`</div>\`;
  container.innerHTML = html;
}

function showAddDNSForm() {
  document.getElementById('add-dns-form-container').style.display = 'block';
}

async function addDNSRecord(zoneId, domainName) {
  const type = document.getElementById('new-dns-type').value;
  const name = document.getElementById('new-dns-name').value;
  const content = document.getElementById('new-dns-content').value;
  const proxied = document.getElementById('new-dns-proxied').checked;

  if(!name || !content) {
    return Swal.fire('Error', 'Name dan Content wajib diisi', 'error');
  }

  const account = accounts.find(acc => acc.id === currentAccountId);

  showLoading(true, "Menambahkan DNS Record...");

  try {
    const res = await fetch('/api/add-dns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         email: account.email,
         apiKey: account.apiKey,
         zoneId: zoneId,
         record: { type, name, content, proxied, ttl: 1 }
      })
    });
    const data = await res.json();
    if(data.success) {
      fetchDNSRecords(zoneId, domainName);
      Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Record ditambahkan', showConfirmButton: false, timer: 1500});
    } else {
      throw new Error(data.errors?.[0]?.message || 'Gagal menambah record');
    }
  } catch(e) {
    Swal.fire('Error', e.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function deleteDNSRecord(zoneId, recordId, domainName) {
  if(!confirm('Yakin ingin menghapus record ini?')) return;

  const account = accounts.find(acc => acc.id === currentAccountId);
  showLoading(true, "Menghapus record...");
  try {
     const res = await fetch('/api/delete-dns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
         email: account.email,
         apiKey: account.apiKey,
         zoneId: zoneId,
         recordId: recordId
      })
    });
    const data = await res.json();
    if(data.success) {
      fetchDNSRecords(zoneId, domainName);
      Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Record dihapus', showConfirmButton: false, timer: 1500});
    } else {
      throw new Error(data.errors?.[0]?.message || 'Gagal menghapus record');
    }
  } catch(e) {
     Swal.fire('Error', e.message, 'error');
  } finally {
     showLoading(false);
  }
}
// --- DNS MANAGEMENT CODE END ---

</script>
<!-- FIXED STICKY TOP NAVIGATION BAR -->
<nav class="top-navbar">
<a href="javascript:void(0);" class="navbar-brand">
<i class="fab fa-cloudflare"></i>
<span>Cloudflare Manager</span>
</a>
<div class="navbar-actions">
<button class="navbar-user-btn" onclick="toggleAccountPanel()">
<i class="fas fa-users-cog"></i>
<span id="nav-btn-text">Kelola Akun</span>
</button>
</div>
</nav>
<div class="container">
<div class="overlay" id="overlay" onclick="toggleAccountPanel()"></div>
<!-- Panel Drawer Akun -->
<div class="account-panel" id="account-panel">
<div class="panel-drawer-header">
<div class="panel-drawer-title">
<i class="fas fa-user-shield" style="color: var(--accent-color);"></i>
<span>Kelola Akun</span>
</div>
<button class="panel-drawer-close-btn" onclick="toggleAccountPanel()" title="Tutup Panel">
<i class="fas fa-times"></i>
</button>
</div>
<div class="add-account-form">
<h3 style="margin-bottom: 20px; font-weight:700;"><i class="fas fa-plus-circle" style="color: var(--accent-color); margin-right: 8px;"></i> Tambah Akun</h3>
<div class="form-group">
<label for="new-account-email">Email Cloudflare (Opsional)</label>
<input type="email" id="new-account-email" placeholder="Kosongkan jika menggunakan API Token">
</div>
<div class="form-group">
<label for="new-account-key">API Token / Global API Key</label>
<input type="password" id="new-account-key" placeholder="Masukkan Kunci API">
</div>
<button class="btn btn-success" style="width: 100%; padding: 12px;" onclick="addNewAccount()">
<i class="fas fa-save"></i> Simpan Koneksi Akun
</button>
</div>
<hr style="margin: 24px 0; border: 0; border-top: 1px solid var(--border-subtle);">
<h4 style="margin-bottom: 12px; color: var(--text-secondary); font-weight:700;"><i class="fas fa-users" style="margin-right:8px;"></i> Akun Terdaftar</h4>
<div class="account-list" id="account-list">
<div class="empty-state" id="empty-accounts">
<i class="fas fa-user-plus"></i>
<h4>Belum ada akun</h4>
<p>Silakan daftarkan akun Cloudflare pertama Anda</p>
</div>
</div>
<button class="btn btn-secondary" style="width: 100%; margin-top: 25px; padding: 12px; font-weight:700; background: var(--bg-input); border-color: var(--border-subtle);" onclick="toggleAccountPanel()">
<i class="fas fa-arrow-left"></i> Selesai & Tutup Panel
</button>
</div>
<div class="header">
<h1>Satu Dashboard Terpusat</h1>
<p>Kelola rute DNS Domain dan deplasment serverless Workers secara cepat tanpa hambatan.</p>
</div>
<!-- Statistik Global -->
<div class="main-content">
<div class="stats">
<div class="stat-item" onclick="toggleAccountPanel()">
<div class="stat-number" id="total-accounts">0</div>
<div class="stat-label">Total Akun</div>
</div>
<div class="stat-item" onclick="switchTab('domains')">
<div class="stat-number" id="total-domains-stat">0</div>
<div class="stat-label">Managed Domains</div>
</div>
<div class="stat-item" onclick="switchTab('live')">
<div class="stat-number" id="live-count">0</div>
<div class="stat-label">Live Workers</div>
</div>
<div class="stat-item" onclick="switchTab('history')">
<div class="stat-number" id="total-workers">0</div>
<div class="stat-label">History Deploy</div>
</div>
</div>
<div class="alert alert-error" id="error-alert"></div>
<div class="alert alert-success" id="success-alert"></div>
<div class="current-account" id="current-account-info" style="display: none;">
<i class="fas fa-network-wired"></i>
<div>
<strong>Akun Cloudflare Terhubung</strong>
<span id="current-account-email">-</span>
<span id="current-account-stats" style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;"></span>
</div>
</div>
<!-- TABS NAVIGATION -->
<div class="results-section">
<div class="tabs">
<button class="tab-btn active" id="tab-domains" onclick="switchTab('domains')"><i class="fas fa-globe" style="margin-right:6px;"></i> Zone Domain</button>
<!-- [FITUR BARU] PAGES MANAGER & WILDCARD TAB PLACEMENT -->
<button class="tab-btn" id="tab-pages" onclick="switchTab('pages')"><i class="fas fa-file-code" style="margin-right:6px;"></i> Pages Manager</button>
<button class="tab-btn" id="tab-wildcards" onclick="switchTab('wildcards')"><i class="fas fa-asterisk" style="margin-right:6px;"></i> Wildcards Engine</button>
<button class="tab-btn" id="tab-deployer" onclick="switchTab('deployer')"><i class="fas fa-rocket" style="margin-right:6px;"></i> Worker Deployer</button>
<button class="tab-btn" id="tab-live" onclick="switchTab('live')"><i class="fas fa-satellite-dish" style="margin-right:6px;"></i> Live Workers</button>
<button class="tab-btn" id="tab-history" onclick="switchTab('history')"><i class="fas fa-history" style="margin-right:6px;"></i> History Deploy</button>
</div>
<!-- TAB 1: DOMAIN MANAGER -->
<div id="content-domains" class="tab-content active">
<div class="deploy-form" style="margin-bottom: 24px;">
<h3 style="margin-bottom: 6px; font-size: 1.25rem; font-weight:700;"><i class="fas fa-plus-circle" style="color: var(--success-color); margin-right: 6px;"></i> Hubungkan Domain Baru</h3>
<p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px;">Daftarkan nama domain baru Anda ke DNS Zone Cloudflare secara instan.</p>
<div class="domain-hero-section">
<div class="domain-input-container">
<div class="domain-input-wrapper">
<input type="text" id="new-domain-name" placeholder="Masukkan domain (contoh: websitesaya.com)">
<i class="fas fa-globe"></i>
</div>
<button class="btn-large btn-success" onclick="addNewDomain()">
<i class="fas fa-plus"></i> Tambah Domain
</button>
</div>
</div>
</div>
<div class="worker-list-wrapper">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
<h3 style="margin-bottom: 0;"><i class="fas fa-server" style="margin-right:6px;"></i> Domain di Cloudflare</h3>
<button class="btn btn-secondary" style="padding: 6px 14px; font-size: 0.8rem; border-radius: 8px;" onclick="refreshDomains()"><i class="fas fa-sync-alt"></i> Refresh Domains</button>
</div>
<div class="worker-list" id="domain-list">
<div class="empty-state"><i class="fas fa-globe"></i><h4>Silakan pilih akun Anda untuk melihat daftar domain.</h4></div>
</div>
</div>
</div>
<!-- [FITUR BARU] TAB: PAGES MANAGER (BUAT & UPLOAD) -->
<div id="content-pages" class="tab-content">
<div class="pages-grid">
<!-- KARTU BUAT PROJECT -->
<div class="deploy-form" style="margin-bottom: 0;">
<h3 style="margin-bottom: 6px; font-size: 1.25rem; font-weight:700;"><i class="fas fa-plus-square" style="color: var(--success-color); margin-right: 6px;"></i> Buat Project Pages</h3>
<p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 15px;">Buat wadah baru untuk website statis Anda.</p>
<div class="form-group" style="margin-bottom: 15px;">
<label style="font-size: 0.85rem;">Nama Project Baru</label>
<input type="text" id="new-pages-name" placeholder="contoh: landing-page-v1" style="padding: 12px;">
</div>
<button class="btn btn-success" style="width: 100%; padding: 14px;" onclick="createPagesProjectManager()">
<i class="fas fa-plus"></i> Buat Project Sekarang
</button>
</div>
<!-- KARTU UPLOAD ASSETS -->
<div class="deploy-form" style="margin-bottom: 0;">
<h3 style="margin-bottom: 6px; font-size: 1.25rem; font-weight:700;"><i class="fas fa-cloud-upload-alt" style="color: var(--accent-color); margin-right: 6px;"></i> Upload / Deploy Aset</h3>
<p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 15px;">Pilih file website untuk di-upload.</p>
<div class="form-group" style="margin-bottom: 10px;">
<select id="deploy-pages-select" style="padding: 12px; font-size: 0.85rem;">
<option value="">-- Pilih Project Target --</option>
</select>
</div>
<div class="form-group" style="margin-bottom: 10px;">
<select id="pages-upload-method" style="padding: 12px; font-size: 0.85rem;" onchange="togglePagesUploadMethod()">
<option value="zip">📦 Upload File .ZIP</option>
<option value="folder">📁 Upload Folder Aset</option>
<option value="url">🔗 Clone Dari URL Git (GitHub)</option>
</select>
</div>
<div class="form-group" id="pages-upload-file-group" style="margin-bottom: 15px;">
<input type="file" id="pages-file-input" accept=".zip" style="padding: 8px; background: var(--bg-input); cursor: pointer; border-radius: 8px;">
</div>
<div class="form-group hidden" id="pages-upload-url-group" style="margin-bottom: 15px;">
<input type="text" id="pages-url-input" placeholder="https://github.com/user/repository" style="padding: 12px;">
</div>
<button class="btn btn-primary" style="width: 100%; padding: 14px;" onclick="deployPagesProject()">
<i class="fas fa-upload"></i> Mulai Upload File Web
</button>
</div>
</div>
<!-- DAFTAR PROJECT PAGES & MANAJEMEN -->
<div class="worker-list-wrapper">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
<h3 style="margin-bottom: 0;"><i class="fas fa-sitemap" style="margin-right:6px;"></i> Manajemen Project Pages</h3>
<button class="btn btn-secondary" style="padding: 6px 14px; font-size: 0.8rem; border-radius: 8px;" onclick="loadPagesProjectsManager()"><i class="fas fa-sync-alt"></i> Refresh Project</button>
</div>
<div class="worker-list" id="pages-project-list">
<div class="empty-state"><i class="fas fa-folder-open"></i><h4>Silakan pilih akun Anda untuk melihat daftar project.</h4></div>
</div>
</div>
</div>
<!-- TAB: WILDCARD PAGES MANAGER -->
<div id="content-wildcards" class="tab-content">
<div class="deploy-form" style="margin-bottom: 24px;">
<h3 style="margin-bottom: 6px; font-size: 1.25rem; font-weight:700;"><i class="fas fa-asterisk" style="color: var(--accent-color); margin-right: 6px;"></i> Register Pages Wildcard</h3>
<p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 20px;">Sambungkan subdomain otomatis ke Cloudflare Pages Project Anda.</p>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">
<div class="form-group" style="margin-bottom: 0;">
<label style="font-size: 0.8rem; display: flex; justify-content: space-between;">
Pilih Project Pages
<button type="button" onclick="loadPagesProjects()" style="color: var(--accent-color); font-size: 11px; font-weight: bold; background: none; border: none; cursor: pointer;"><i class="fas fa-sync"></i> Refresh</button>
</label>
<select id="wildcard-project-select" style="padding: 14px;">
<option value="">-- Memuat Project... --</option>
</select>
</div>
<div class="form-group" style="margin-bottom: 0;">
<label style="font-size: 0.8rem;">Pilih Root Domain</label>
<select id="wildcard-domain-select" style="padding: 14px;">
<option value="">-- Pilih Root Domain --</option>
</select>
</div>
<div class="form-group" style="margin-bottom: 0;">
<label style="font-size: 0.8rem;">Prefix Subdomain</label>
<input type="text" id="wildcard-prefix-input" placeholder="contoh: sg1" style="padding: 14px;">
</div>
</div>
<button class="btn btn-primary" style="width: 100%; padding: 14px;" onclick="addWildcardDomain()">
<i class="fas fa-plus"></i> Inject & Deploy Custom Wildcard
</button>
</div>
<div class="worker-list-wrapper">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
<h3 style="margin-bottom: 0;"><i class="fas fa-link" style="margin-right:6px;"></i> Wildcards Pages Terdaftar</h3>
<button class="btn btn-secondary" style="padding: 6px 14px; font-size: 0.8rem; border-radius: 8px;" onclick="loadWildcardsList()"><i class="fas fa-sync-alt"></i> Refresh Data</button>
</div>
<div class="worker-list" id="wildcard-list">
<div class="empty-state"><i class="fas fa-asterisk"></i><h4>Silakan pilih Project Pages di atas untuk melihat daftar wildcard.</h4></div>
</div>
</div>
</div>
<!-- TAB 2: WORKER DEPLOYER -->
<div id="content-deployer" class="tab-content">
<div class="deploy-form">
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;">
<h3 style="margin-bottom: 0; font-size: 1.25rem;"><i class="fas fa-rocket" style="color: var(--accent-color); margin-right:6px;"></i> Deploy Worker Baru</h3>
<div id="edit-mode-badge" style="display: none;">
<span class="edit-badge"><i class="fas fa-edit"></i> MODE EDIT: <span id="editing-worker-name"></span></span>
<button class="btn btn-danger" style="width: auto; padding: 4px 8px; font-size: 10px; margin-left: 4px;" onclick="cancelEdit()"><i class="fas fa-times"></i> Batal</button>
</div>
</div>
<div class="form-group">
<label for="selected-account"><i class="fas fa-user-circle" style="margin-right:4px;"></i> Pilih Akun Aktif</label>
<select id="selected-account" onchange="onAccountSelected(this.value)">
<option value="">-- Pilih Akun --</option>
</select>
</div>
<div class="form-group">
<label for="workerName"><i class="fas fa-tag" style="margin-right:4px;"></i> Nama Worker</label>
<input type="text" id="workerName" placeholder="contoh: api-endpoint">
<small style="color: var(--text-secondary); display:block; margin-top:4px;">Format: huruf kecil, angka, dan tanda hubung (-)</small>
</div>
<div class="form-group">
<label for="script-select"><i class="fas fa-code" style="margin-right:4px;"></i> Pilih Sumber Script</label>
<select id="script-select" onchange="toggleScriptSource()">
<option value="">-- Pilih Sumber Script --</option>
<option value="upload">📁 Upload File (.js)</option>
<option value="custom">🔗 Custom URL (GitHub Raw)</option>
<option value="manual">✍️ Tulis / Edit Manual</option>
</select>
</div>
<div class="form-group hidden" id="file-upload-group">
<label for="file-input"><i class="fas fa-file-upload" style="margin-right:4px;"></i> Unggah File (.js)</label>
<input type="file" id="file-input" accept=".js" onchange="handleFileUpload(this)">
</div>
<div class="form-group hidden" id="custom-url-group">
<label for="custom-url"><i class="fab fa-github" style="margin-right:4px;"></i> URL GitHub (Raw)</label>
<input type="text" id="custom-url" placeholder="https://raw.githubusercontent.com/.../main/worker.js">
</div>
<div class="form-group hidden" id="manual-code-group">
<label for="manual-code"><i class="fas fa-file-code" style="margin-right:4px;"></i> Editor Kode JavaScript</label>
<div class="code-editor-wrapper">
<div class="code-editor-header">
<span id="editor-filename"><i class="fas fa-code"></i> worker.js - Premium Dark Editor</span>
<div class="editor-actions">
<button type="button" class="editor-action-btn" onclick="formatCode()"><i class="fas fa-magic"></i> Format</button>
<button type="button" class="editor-action-btn danger" onclick="clearCode()"><i class="fas fa-eraser"></i> Bersihkan</button>
</div>
</div>
<textarea id="manual-code" placeholder="// Tulis kode JavaScript worker Anda di sini..." spellcheck="false"></textarea>
</div>
<div class="char-counter" id="char-counter">0 karakter</div>
</div>
<div class="form-group" style="background: rgba(246, 130, 31, 0.02); padding: 18px; border-radius: 12px; border: 1px dashed var(--accent-color); margin-top: 20px;">
<label style="color: var(--accent-color); display:flex; align-items:center; gap:6px;"><i class="fas fa-database"></i> KV Namespace Binding (Auto-Fetch)</label>
<p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px;">Sambungkan database KV Cloudflare Anda secara langsung tanpa memasukkan ID manual.</p>
<div style="display: flex; gap: 10px; flex-wrap: wrap;">
<input type="text" id="kv-name" placeholder="Variabel (cth: DATABASE)" style="flex: 1; min-width: 140px;">
<select id="kv-id" style="flex: 2; min-width: 200px;">
<option value="">-- Pilih Database KV --</option>
</select>
</div>
</div>
<div class="form-group" style="background: rgba(245, 158, 11, 0.02); padding: 18px; border-radius: 12px; border: 1px dashed var(--warning-color); margin-top: 15px; margin-bottom: 25px;">
<label style="color: var(--warning-color); display:flex; align-items:center; gap:6px;"><i class="fas fa-key"></i> Environment Variables (Plain Text)</label>
<p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px;">Tanam konfigurasi penting (seperti TOKEN_BOT, SECRET_KEY) langsung ke dalam script.</p>
<div id="env-vars-container"></div>
<button type="button" class="btn" style="background: var(--bg-input); color: white; border: 1px solid var(--border-subtle); font-size: 0.75rem; padding: 6px 12px; border-radius: 8px; margin-top: 6px;" onclick="addEnvRow()">
<i class="fas fa-plus"></i> Tambah Baris Variabel
</button>
</div>
<button class="btn btn-primary" onclick="deployWorker()" id="deploy-btn" style="padding: 14px 20px;">
<i class="fas fa-rocket"></i> Deploy Worker Sekarang
</button>
</div>
</div>
<!-- TAB 3: LIVE WORKERS -->
<div id="content-live" class="tab-content">
<div style="margin-bottom: 16px; text-align: right;">
<button class="btn btn-primary" style="width: auto; padding: 8px 16px; font-size: 0.8rem; border-radius: 8px;" onclick="refreshLiveWorkers()"><i class="fas fa-sync-alt"></i> Refresh List</button>
</div>
<div class="worker-list-wrapper">
<div class="worker-list" id="live-worker-list">
<div class="empty-state"><i class="fas fa-satellite-dish"></i><h4>Pilih akun terlebih dahulu untuk melihat Workers yang aktif.</h4></div>
</div>
</div>
</div>
<!-- TAB 4: HISTORY DEPLOY -->
<div id="content-history" class="tab-content">
<div style="margin-bottom: 16px; text-align: right;">
<button class="btn btn-danger" style="width: auto; padding: 8px 16px; font-size: 0.8rem; border-radius: 8px;" onclick="clearAllHistory()"><i class="fas fa-trash-alt"></i> Bersihkan Semua History</button>
</div>
<div class="worker-list-wrapper">
<div class="worker-list" id="worker-list">
<div class="empty-state"><i class="fas fa-inbox"></i><h4>Belum ada riwayat deployment di akun ini.</h4></div>
</div>
</div>
</div>
</div>
</div>
</div>
<!-- Loading Overlay -->
<div class="loading" id="loading">
<div class="spinner"></div>
<p style="font-weight:600; color:white; font-size: 0.95rem;">Sedang memproses...</p>
</div>
<!-- CUSTOM OVERLAY MODAL -->
<div id="custom-modal" class="modal-overlay">
<div class="modal-content">
<div class="modal-header">
<h3 id="modal-title">Konfirmasi</h3>
<button class="modal-close-btn" onclick="closeModal()">&times;</button>
</div>
<div class="modal-body" id="modal-body">
Konten Modal
</div>
<div class="modal-footer" id="modal-footer">
<button class="btn btn-secondary" onclick="closeModal()">Tutup</button>
</div>
</div>
</div>
<script>
let accounts = JSON.parse(localStorage.getItem('cf-accounts') || '[]');
let workers = JSON.parse(localStorage.getItem('cf-workers') || '[]');
let currentAccountId = localStorage.getItem('current-account-id') || null;
let liveWorkers = [];
let domains = [];
let isEditMode = false;
let originalWorkerName = '';
let fetchedKVs = [];
document.addEventListener('DOMContentLoaded', () => {
initializeUI();
setupCharCounter();
addEnvRow();
});
function initializeUI() {
updateAccountDropdown();
updateWorkerList();
updateStats();
updateCurrentAccountInfo();
if (accounts.length > 0) {
if (currentAccountId && accounts.find(acc => acc.id === currentAccountId)) {
selectAccount(currentAccountId);
} else {
selectAccount(accounts[0].id);
}
}
}
function onAccountSelected(accountId) {
if(accountId) selectAccount(accountId);
}
function switchTab(tab) {
document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
document.getElementById('tab-' + tab).classList.add('active');
document.getElementById('content-' + tab).classList.add('active');
if (tab === 'live' && currentAccountId) refreshLiveWorkers();
if (tab === 'domains' && currentAccountId) refreshDomains();
if (tab === 'pages' && currentAccountId) loadPagesProjectsManager();
if (tab === 'wildcards' && currentAccountId) {
loadPagesProjects();
populateWildcardDomainSelect();
}
}
function setupCharCounter() {
const textarea = document.getElementById('manual-code');
const counter = document.getElementById('char-counter');
if (textarea && counter) {
textarea.addEventListener('input', function() {
counter.textContent = this.value.length.toLocaleString() + ' karakter';
});
}
}
function toggleScriptSource() {
const scriptSelect = document.getElementById('script-select').value;
document.getElementById('custom-url-group').classList.toggle('hidden', scriptSelect !== 'custom');
document.getElementById('file-upload-group').classList.toggle('hidden', scriptSelect !== 'upload');
document.getElementById('manual-code-group').classList.toggle('hidden', (scriptSelect !== 'manual' && scriptSelect !== 'upload'));
}
function handleFileUpload(input) {
const file = input.files[0];
if (!file) return;
if (!file.name.endsWith('.js')) {
Swal.fire('Error', 'Hanya file berkstensi .js yang diperbolehkan!', 'error');
input.value = ''; return;
}
const reader = new FileReader();
reader.onload = function(e) {
document.getElementById('manual-code').value = e.target.result;
document.getElementById('manual-code').dispatchEvent(new Event('input'));
document.getElementById('editor-filename').innerHTML = \`<i class="fas fa-file-code"></i> \${file.name} (Uploaded)\`;
Swal.fire('Sukses!', \`Berkas "\${file.name}" berhasil dimuat!\`, 'success');
const nameInput = document.getElementById('workerName');
if (!nameInput.value) nameInput.value = file.name.replace('.js', '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
};
reader.readAsText(file);
}
function toggleAccountPanel() {
document.getElementById('account-panel').classList.toggle('active');
document.getElementById('overlay').classList.toggle('active');
if (document.getElementById('account-panel').classList.contains('active')) updateAccountList();
}
function formatCode() {
const textarea = document.getElementById('manual-code'); if (!textarea) return;
try {
let code = textarea.value.replace(/\\s+$/gm, '').replace(/\\n{3,}/g, '\\n\\n').replace(/\\{\\s*\\n/g, '{\\n').replace(/\\}\\s*\\n/g, '}\\n');
textarea.value = code; textarea.dispatchEvent(new Event('input'));
Swal.fire('Sukses', 'Format kode dirapikan!', 'success');
} catch(e) { Swal.fire('Error', 'Gagal merapikan format kode', 'error'); }
}
function clearCode() {
askConfirmation('Bersihkan Workspace', 'Hapus semua kode pada editor? Tindakan ini tidak dapat dibatalkan.', () => {
document.getElementById('manual-code').value = '';
document.getElementById('manual-code').dispatchEvent(new Event('input'));
document.getElementById('editor-filename').innerHTML = '<i class="fas fa-code"></i> worker.js - Premium Dark Editor';
document.getElementById('file-input').value = '';
document.getElementById('kv-name').value = '';
document.getElementById('kv-id').value = '';
document.getElementById('env-vars-container').innerHTML = '';
addEnvRow();
Swal.fire('Sukses', 'Workspace berhasil dibersihkan', 'success');
});
}
function addEnvRow(key = '', value = '') {
const container = document.getElementById('env-vars-container');
const row = document.createElement('div');
row.className = 'env-row';
row.innerHTML = \`
<input type="text" placeholder="KEY (cth: TOKEN)" value="\${key}" class="env-key" style="flex: 1; border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 12px; font-size: 13px;">
<input type="text" placeholder="VALUE" value="\${value}" class="env-value" style="flex: 1; border: 1px solid var(--border-subtle); border-radius: 8px; padding: 8px 12px; font-size: 13px;">
<button type="button" onclick="this.parentElement.remove()" style="background: none; border: none; color: var(--danger-color); padding: 0 8px; cursor: pointer; font-size: 16px;"><i class="fas fa-minus-circle"></i></button>
\`;
container.appendChild(row);
}
// ================================================================================
// KUSTOM OVERLAY MODAL (PENGGANTI ALERT/CONFIRM)
// ================================================================================
function openModal(title, bodyHtml, footerHtml = '') {
document.getElementById('modal-title').textContent = title;
document.getElementById('modal-body').innerHTML = bodyHtml;
const footer = document.getElementById('modal-footer');
if (footerHtml) {
footer.innerHTML = footerHtml;
} else {
footer.innerHTML = '<button class="btn btn-secondary" onclick="closeModal()">Tutup</button>';
}
document.getElementById('custom-modal').classList.add('active');
}
function closeModal() {
document.getElementById('custom-modal').classList.remove('active');
}
function askConfirmation(title, message, onConfirm) {
const bodyHtml = \`<p style="font-size: 14px; color: var(--text-secondary);">\${message}</p>\`;
const footerHtml = \`
<button class="btn btn-secondary" onclick="closeModal()">Batal</button>
<button class="btn btn-danger" id="modal-confirm-btn">Ya, Lanjutkan</button>
\`;
openModal(title, bodyHtml, footerHtml);
document.getElementById('modal-confirm-btn').onclick = () => {
closeModal();
onConfirm();
};
}
// COPY FEEDBACK HELPER (IKON CENTANG DINAMIS)
function copyWithVisualFeedback(text, element) {
const textArea = document.createElement("textarea");
textArea.value = text;
textArea.style.position = "fixed";
textArea.style.top = "0";
textArea.style.left = "0";
document.body.appendChild(textArea);
textArea.focus();
textArea.select();
try {
const successful = document.execCommand('copy');
if (successful) {
const originalHTML = element.innerHTML;
element.innerHTML = '<i class="fas fa-check" style="color: var(--success-color);"></i>';
element.style.borderColor = 'var(--success-color)';
setTimeout(() => {
element.innerHTML = originalHTML;
element.style.borderColor = '';
}, 2000);
Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Tersalin ke clipboard!', showConfirmButton: false, timer: 1500 });
} else {
Swal.fire('Error', 'Gagal menyalin.', 'error');
}
} catch (err) {
Swal.fire('Error', 'Browser tidak mendukung penyalinan otomatis.', 'error');
}
document.body.removeChild(textArea);
}
// ================================================================================
// DOMAIN ZONE MANAGER
// ================================================================================
async function refreshDomains() {
const listContainer = document.getElementById('domain-list');
if (!currentAccountId) return;
listContainer.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="spinner"></div><p>Memuat daftar domain...</p></div>';
const account = accounts.find(acc => acc.id === currentAccountId);
try {
const res = await fetch('/api/list-domains', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey })
});
const data = await res.json();
if (data.success) {
domains = data.result || [];
renderDomains();
updateStats();
populateWildcardDomainSelect(); // Update dropdown root domain wildcard
} else {
throw new Error(data.errors?.[0]?.message || 'Gagal terhubung ke Cloudflare.');
}
} catch (e) {
listContainer.innerHTML = \`<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h4>Error: \${e.message.substring(0, 100)}</h4></div>\`;
}
}
function renderDomains() {
const listContainer = document.getElementById('domain-list');
if (!domains || domains.length === 0) {
listContainer.innerHTML = '<div class="empty-state"><i class="fas fa-globe"></i><h4>Belum ada domain terdaftar di akun ini</h4></div>'; return;
}
listContainer.innerHTML = domains.map(d => {
const statusBadgeClass = d.status === 'active' ? 'badge-active' : 'badge-pending';
const statusLabel = d.status === 'active' ? 'ACTIVE' : 'PENDING';
const planName = d.plan?.name || 'Free Plan';
const nsArrayJson = JSON.stringify(d.name_servers || []).replace(/"/g, '&quot;');
return \`
<div class="grid-card">
<div class="card-row-top">
<div class="card-info">
<div class="card-title-badge">
<strong>\${d.name}</strong>
<span class="badge-premium \${statusBadgeClass}">\${statusLabel}</span>
</div>
<div style="margin-top: 6px;">
<div class="hash-id" title="Klik ID untuk menyalin" onclick="copyWithVisualFeedback('\${d.id}', this)">
<i class="fas fa-fingerprint"></i>
<span class="hash-text">\${d.id.substring(0, 15)}...</span>
<i class="far fa-copy" style="font-size:10px;"></i>
</div>
</div>
<div class="card-meta" style="margin-top: 6px;">
<i class="fas fa-layer-group"></i> Paket: \${planName}
</div>
</div>
</div>
<div class="card-actions-wrapper">
<button class="btn btn-secondary" onclick="showNameservers('\${d.name}', '\${nsArrayJson.replace(/'/g, "\\'")}')"><i class="fas fa-server"></i> Nameservers</button>
<button class="btn btn-secondary" onclick="manageDNS('\${d.id}', '\${d.name}')"><i class="fas fa-dns"></i> Kelola DNS</button>
<button class="btn btn-danger" onclick="confirmDeleteDomain('\${d.id}', '\${d.name}')"><i class="fas fa-trash-alt"></i> Hapus</button>
</div>
</div>\`;
}).join('');
}
function showNameservers(domainName, nsJsonString) {
const nsList = JSON.parse(nsJsonString.replace(/&quot;/g, '"'));
let nsHtml = '';
if (nsList && nsList.length > 0) {
nsHtml = \`
<p style="margin-bottom: 14px; font-size: 0.9rem; color: var(--text-secondary);">Salin nama server berikut ke registrar domain Anda (Klik baris nama server untuk menyalin langsung):</p>
<div class="ns-container">
\${nsList.map(ns => \`
<div class="ns-row" onclick="copyWithVisualFeedback('\${ns}', this)" title="Klik untuk menyalin">
<span class="ns-value-text">\${ns}</span>
<div class="ns-copy-icon">
<i class="far fa-copy"></i>
</div>
</div>
\`).join('')}
</div>
<div class="warning-banner">
<i class="fas fa-info-circle"></i>
<span>Proses penyelarasan DNS propagasi membutuhkan waktu berkisar 1 s/d 24 jam tergantung provider registrar Anda.</span>
</div>
\`;
} else {
nsHtml = \`<p>Tidak ada nameserver yang tersedia untuk zona ini.</p>\`;
}
openModal(\`Persiapan DNS - \${domainName}\`, nsHtml);
}
async function addNewDomain() {
if (!currentAccountId) return Swal.fire('Error', 'Pilih akun terlebih dahulu!', 'error');
const domainInput = document.getElementById('new-domain-name');
const domainName = domainInput.value.trim().toLowerCase();
if (!domainName) return Swal.fire('Error', 'Nama domain tidak boleh kosong!', 'error');
const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
if (!domainRegex.test(domainName)) {
return Swal.fire('Error', 'Format domain tidak valid! (contoh: domainku.com, websaya.web.id)', 'error');
}
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, "Mendaftarkan domain ke Cloudflare...");
try {
const res = await fetch('/api/add-domain', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
email: account.email,
apiKey: account.apiKey,
domain: domainName
})
});
const data = await res.json();
if (data.success && data.result) {
domainInput.value = '';
await refreshDomains();
const ns = data.result.name_servers || [];
const successHtml = \`
<div style="text-align: center; margin-bottom: 18px;">
<i class="fas fa-check-circle" style="font-size: 44px; color: var(--success-color);"></i>
<h4 style="margin-top: 10px; font-size: 16px; color: white;">Domain Terdaftar Sukses!</h4>
</div>
<p style="margin-bottom: 12px; font-size: 0.85rem; color: var(--text-secondary);">Silakan arahkan konfigurasi nameserver Anda ke Cloudflare:</p>
<div class="ns-container">
\${ns.map(n => \`
<div class="ns-row" onclick="copyWithVisualFeedback('\${n}', this)" title="Klik untuk menyalin">
<span class="ns-value-text">\${n}</span>
<div class="ns-copy-icon">
<i class="far fa-copy"></i>
</div>
</div>
\`).join('')}
</div>
<p style="font-size: 11px; color: var(--text-secondary); text-align: center;">Domain akan aktif secara otomatis setelah Cloudflare menerima propagasi DNS global Anda.</p>
\`;
openModal("Registrasi Berhasil!", successHtml);
} else {
throw new Error(data.errors?.[0]?.message || 'Gagal menambahkan domain baru.');
}
} catch (e) {
Swal.fire('Error', e.message, 'error');
} finally {
showLoading(false);
}
}
function confirmDeleteDomain(zoneId, domainName) {
const bodyHtml = \`
<p>Apakah Anda yakin ingin menghapus domain <strong>\${domainName}</strong> dari sistem?</p>
<p style="color: var(--danger-color); font-weight: bold; margin-top: 8px;"><i class="fas fa-exclamation-triangle"></i> Seluruh record DNS di domain ini juga akan hilang secara permanen!</p>
<p style="margin-top: 15px;">Ketik kata kunci <strong>HAPUS</strong> di bawah untuk memverifikasi:</p>
<input type="text" id="delete-domain-confirm-input" style="width:100%; border:1.5px solid var(--danger-color); border-radius:10px; padding:10px; margin-top: 8px; background:var(--bg-input); color:white;" placeholder="HAPUS">
\`;
const footerHtml = \`
<button class="btn btn-secondary" onclick="closeModal()">Batal</button>
<button class="btn btn-danger" onclick="executeDeleteDomain('\${zoneId}', '\${domainName}')">Hapus Sekarang</button>
\`;
openModal(\`Konfirmasi Hapus \${domainName}\`, bodyHtml, footerHtml);
}
async function executeDeleteDomain(zoneId, domainName) {
const confirmVal = document.getElementById('delete-domain-confirm-input').value.trim();
if (confirmVal !== 'HAPUS') {
closeModal();
return Swal.fire('Error', 'Kata kunci verifikasi salah. Domain gagal dihapus.', 'error');
}
closeModal();
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, \`Menghapus domain \${domainName}...\`);
try {
const res = await fetch('/api/delete-domain', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
email: account.email,
apiKey: account.apiKey,
zoneId: zoneId
})
});
const data = await res.json();
if (data.success) {
await refreshDomains();
Swal.fire('Sukses', \`Domain \${domainName} berhasil dihapus dari Cloudflare.\`, 'success');
} else {
throw new Error(data.errors?.[0]?.message || 'Gagal menghapus domain.');
}
} catch (e) {
Swal.fire('Error', e.message, 'error');
} finally {
showLoading(false);
}
}
// ================================================================================
// FUNGSI JAVASCRIPT: PAGES MANAGER BARU (MEMBUAT & MENGELOLA PROJECT)
// ================================================================================
function togglePagesUploadMethod() {
const method = document.getElementById('pages-upload-method').value;
const fileGroup = document.getElementById('pages-upload-file-group');
const urlGroup = document.getElementById('pages-upload-url-group');
const fileInput = document.getElementById('pages-file-input');
if (method === 'url') {
fileGroup.classList.add('hidden');
urlGroup.classList.remove('hidden');
} else {
fileGroup.classList.remove('hidden');
urlGroup.classList.add('hidden');
if (method === 'folder') {
fileInput.setAttribute('webkitdirectory', '');
fileInput.setAttribute('directory', '');
fileInput.removeAttribute('accept');
} else {
fileInput.removeAttribute('webkitdirectory');
fileInput.removeAttribute('directory');
fileInput.setAttribute('accept', '.zip');
}
}
}
async function loadPagesProjectsManager() {
const listContainer = document.getElementById('pages-project-list');
const deploySelect = document.getElementById('deploy-pages-select');
if (!currentAccountId) return;
const account = accounts.find(acc => acc.id === currentAccountId);
listContainer.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="spinner"></div><p>Memuat daftar project Pages...</p></div>';
deploySelect.innerHTML = '<option value="">-- Memuat --</option>';
try {
const res = await fetch('/api/list-pages-projects', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey })
});
const data = await res.json();
if (data.success && data.result) {
if (data.result.length === 0) {
listContainer.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><h4>Belum ada project Pages di akun ini.</h4></div>';
deploySelect.innerHTML = '<option value="">-- Tidak Ada Project Tersedia --</option>';
} else {
deploySelect.innerHTML = '<option value="">-- Pilih Project Target --</option>' +
data.result.map(p => \`<option value="\${p.name}">📄 \${p.name}</option>\`).join('');
listContainer.innerHTML = data.result.map(p => \`
<div class="grid-card">
<div class="card-row-top">
<div class="card-info" style="display:flex; flex-direction:column; gap:4px; max-width:100%;">
<strong style="font-size:1.1rem; color:var(--text-primary);">\${p.name}</strong>
<span style="font-size:0.8rem; color:var(--text-secondary);"><i class="fas fa-link"></i> \${p.subdomain}</span>
<span style="font-size:0.75rem; color:var(--text-secondary);"><i class="far fa-clock"></i> Dibuat: \${new Date(p.created_on).toLocaleDateString('id-ID')}</span>
</div>
</div>
<div class="card-actions-wrapper">
<button class="btn btn-secondary" onclick="window.open('https://\${p.subdomain}', '_blank')"><i class="fas fa-external-link-alt"></i> Kunjungi</button>
<button class="btn btn-danger" onclick="deletePagesProjectManager('\${p.name}')"><i class="fas fa-trash-alt"></i> Hapus</button>
</div>
</div>\`).join('');
}
} else {
throw new Error(data.errors?.[0]?.message || 'Gagal memuat daftar project.');
}
} catch(e) {
listContainer.innerHTML = \`<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h4>Error: \${e.message}</h4></div>\`;
}
}
async function createPagesProjectManager() {
if (!currentAccountId) return Swal.fire('Error', 'Pilih akun terlebih dahulu!', 'error');
const nameInput = document.getElementById('new-pages-name');
const projectName = nameInput.value.trim().toLowerCase();
if (!projectName) return Swal.fire('Gagal', 'Nama project wajib diisi!', 'error');
if (!/^[a-z0-9-]+$/.test(projectName)) return Swal.fire('Gagal', 'Hanya huruf kecil, angka, dan strip (-) yang diizinkan', 'error');
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, \`Membuat project \${projectName}...\`);
try {
const res = await fetch('/api/create-pages-project', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, projectName })
});
const data = await res.json();
if (data.success) {
Swal.fire('Sukses', \`Project \${projectName} berhasil dibuat!\`, 'success');
nameInput.value = '';
await loadPagesProjectsManager(); // Refresh daftar pages
} else {
throw new Error(data.error || data.errors?.[0]?.message || "Gagal membuat project.");
}
} catch(e) { Swal.fire('Error', e.message, 'error'); }
finally { showLoading(false); }
}
async function deletePagesProjectManager(projectName) {
askConfirmation('Hapus Project', \`Apakah Anda yakin ingin menghapus project Pages <strong>\${projectName}</strong> secara permanen?\`, async () => {
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, \`Menghapus project \${projectName}...\`);
try {
const res = await fetch('/api/delete-pages-project', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, projectName })
});
const data = await res.json();
if (data.success) {
Swal.fire('Sukses', 'Project Pages telah dihapus', 'success');
await loadPagesProjectsManager();
} else {
throw new Error(data.errors?.[0]?.message || 'Gagal menghapus project');
}
} catch(e) { Swal.fire('Error', e.message, 'error'); }
finally { showLoading(false); }
});
}
async function deployPagesProject() {
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
}
// ================================================================================
// FUNGSI JAVASCRIPT: WILDCARD PAGES MANAGER OTOMATISASI
// ================================================================================
async function loadPagesProjects() {
const select = document.getElementById('wildcard-project-select');
if (!currentAccountId) return;
select.innerHTML = '<option value="">⏳ Memuat Project...</option>';
const account = accounts.find(acc => acc.id === currentAccountId);
try {
const res = await fetch('/api/list-pages-projects', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey })
});
const data = await res.json();
if (data.success && data.result) {
// MEMASUKKAN SUBDOMAIN ASLI UNTUK FIX CNAME "PENDING"
select.innerHTML = '<option value="">-- Pilih Project Pages --</option>' +
data.result.map(p => \`<option value="\${p.name}" data-subdomain="\${p.subdomain}">📄 \${p.name}</option>\`).join('');
select.onchange = loadWildcardsList;
} else {
select.innerHTML = '<option value="">⚠️ Gagal memuat project</option>';
}
} catch(e) { select.innerHTML = '<option value="">⚠️ Error API</option>'; }
}
function populateWildcardDomainSelect() {
const select = document.getElementById('wildcard-domain-select');
if (domains.length === 0) {
select.innerHTML = '<option value="">-- Tidak ada domain di akun ini --</option>';
return;
}
select.innerHTML = '<option value="">-- Pilih Root Domain --</option>' +
domains.map(d => \`<option value="\${d.name}" data-zone="\${d.id}">\${d.name}</option>\`).join('');
}
async function loadWildcardsList() {
const projectName = document.getElementById('wildcard-project-select').value;
const listContainer = document.getElementById('wildcard-list');
if (!projectName) {
listContainer.innerHTML = '<div class="empty-state"><i class="fas fa-asterisk"></i><h4>Pilih Project Pages terlebih dahulu.</h4></div>';
return;
}
listContainer.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="spinner"></div><p>Memuat daftar wildcard...</p></div>';
const account = accounts.find(acc => acc.id === currentAccountId);
try {
const res = await fetch('/api/list-wildcards', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, projectName })
});
const data = await res.json();
if (data.success) {
const wildcards = data.result || [];
if (wildcards.length === 0) {
listContainer.innerHTML = '<div class="empty-state"><i class="fas fa-asterisk"></i><h4>Belum ada wildcard untuk project ini.</h4></div>';
return;
}
listContainer.innerHTML = wildcards.map(w => {
const statusBadgeClass = w.status === 'active' ? 'badge-active' : 'badge-pending';
return \`
<div class="grid-card">
<div class="card-row-top">
<div class="card-info">
<div class="card-title-badge">
<strong>\${w.name}</strong>
<span class="badge-premium \${statusBadgeClass}">\${w.status.toUpperCase()}</span>
</div>
<div class="card-meta" style="margin-top: 6px;">
<i class="fas fa-link"></i> Target Pages Terhubung
</div>
</div>
</div>
<div class="card-actions-wrapper">
<button class="btn btn-danger" style="width:100%" onclick="deleteWildcard('\${projectName}', '\${w.name}')"><i class="fas fa-trash-alt"></i> Hapus Wildcard</button>
</div>
</div>\`;
}).join('');
} else {
throw new Error(data.errors?.[0]?.message || 'Gagal memuat list wildcard.');
}
} catch(e) {
listContainer.innerHTML = \`<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:var(--danger-color)"></i><h4 style="color:var(--danger-color)">Error: \${e.message}</h4></div>\`;
}
}
async function addWildcardDomain() {
const projectSelect = document.getElementById('wildcard-project-select');
const projectName = projectSelect.value;
// AMBIL SUBDOMAIN ASLI DARI ATRIBUT UNTUK MEMPERBAIKI CNAME PENDING
const targetSubdomain = projectSelect.options[projectSelect.selectedIndex]?.dataset?.subdomain;
const domainSelect = document.getElementById('wildcard-domain-select');
const rootDomain = domainSelect.value;
const zoneId = domainSelect.options[domainSelect.selectedIndex]?.dataset?.zone;
const prefix = document.getElementById('wildcard-prefix-input').value.trim().toLowerCase();
if (!projectName || !rootDomain || !prefix) return Swal.fire('Error', 'Pilih Project, Root Domain, dan isi Prefix!', 'error');
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, "Mendaftarkan Wildcard...");
try {
const res = await fetch('/api/add-wildcard', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, projectName, prefix, rootDomain, zoneId, targetSubdomain })
});
const data = await res.json();
if (data.success) {
document.getElementById('wildcard-prefix-input').value = '';
await loadWildcardsList();
Swal.fire({
title: 'Sukses!',
html: \`Wildcard <b>\${prefix}.\${rootDomain}</b> berhasil ditambahkan!<br><br><span style="color:var(--warning-color); font-size:13px;"><i class="fas fa-info-circle"></i> Status PENDING di awal sangat wajar (proses cek SSL Cloudflare) tunggu 1-3 menit.</span>\`,
icon: 'success'
});
} else {
throw new Error(data.error || 'Gagal menambahkan wildcard.');
}
} catch(e) { Swal.fire('Error', e.message, 'error'); }
finally { showLoading(false); }
}
function deleteWildcard(projectName, fullDomain) {
askConfirmation('Hapus Wildcard?', \`Yakin ingin menghapus wildcard \${fullDomain}? Seluruh record DNS CNAME terkait juga akan terhapus.\`, async () => {
const account = accounts.find(acc => acc.id === currentAccountId);
const rootDomainMatch = domains.find(d => fullDomain.endsWith(d.name));
const zoneId = rootDomainMatch ? rootDomainMatch.id : '';
if (!zoneId) return Swal.fire('Error', 'Zone ID tidak ditemukan di daftar domain Anda.', 'error');
showLoading(true, "Menghapus Wildcard...");
try {
const res = await fetch('/api/delete-wildcard', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, projectName, fullDomain, zoneId })
});
const data = await res.json();
if (data.success) {
await loadWildcardsList();
Swal.fire('Sukses', 'Wildcard dan DNS berhasil dihapus!', 'success');
} else {
throw new Error(data.error || 'Gagal menghapus wildcard.');
}
} catch(e) { Swal.fire('Error', e.message, 'error'); }
finally { showLoading(false); }
});
}
// ================================================================================
// KEY-VALUE & ENVIRONMENT VARIABLES DETECTOR
// ================================================================================
async function fetchCloudflareKVs() {
const kvDropdown = document.getElementById('kv-id');
if (!currentAccountId) return;
kvDropdown.innerHTML = '<option value="">⏳ Memuat database KV...</option>';
const account = accounts.find(acc => acc.id === currentAccountId);
try {
const res = await fetch('/api/list-kv', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey })
});
const data = await res.json();
if (data.success && data.result) {
fetchedKVs = data.result;
kvDropdown.innerHTML = '<option value="">-- Pilih Database KV Cloudflare --</option>' +
fetchedKVs.map(kv => \`<option value="\${kv.id}">📁 \${kv.title} (\${kv.id.substring(0,8)}...)</option>\`).join('');
} else {
kvDropdown.innerHTML = '<option value="">⚠️ Gagal memuat KV</option>';
}
} catch (e) {
kvDropdown.innerHTML = '<option value="">⚠️ Error koneksi API</option>';
}
}
async function addNewAccount() {
const emailInput = document.getElementById('new-account-email');
const keyInput = document.getElementById('new-account-key');
const email = emailInput.value.trim();
const apiKey = keyInput.value.trim();
if (!apiKey) return Swal.fire('Error', 'Kunci API (API Token atau API Key) wajib diinput!', 'error');
showLoading(true, "Memverifikasi akun...");
try {
const response = await fetch('/api/subdomain', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email, apiKey })
});
const data = await response.json();
if (!data.success) throw new Error(data.error);
// Buat nama alias representatif
const aliasName = email ? email : \`Token_\${data.accountId.substring(0, 6)}\`;
const newAccount = {
id: generateId(),
email: email,
apiKey: apiKey,
subdomain: data.subdomain,
accountId: data.accountId,
alias: aliasName
};
accounts.push(newAccount); saveAccounts();
selectAccount(newAccount.id); toggleAccountPanel();
Swal.fire('Sukses', 'Koneksi akun Cloudflare berhasil ditambahkan!', 'success');
emailInput.value = '';
keyInput.value = '';
} catch (error) { Swal.fire('Error', error.message, 'error'); } finally { showLoading(false); }
}
// ================================================================================
// WORKER CONTROLLER & LIFECYCLE
// ================================================================================
function selectAccount(accountId) {
currentAccountId = accountId;
localStorage.setItem('current-account-id', accountId);
updateAccountDropdown(); updateAccountList(); updateWorkerList(); updateStats(); updateCurrentAccountInfo();
fetchCloudflareKVs();
refreshDomains();
// Reload projects jika tab wildcard atau pages sedang aktif
if (document.getElementById('content-wildcards').classList.contains('active')) {
loadPagesProjects();
}
if (document.getElementById('content-pages').classList.contains('active')) {
loadPagesProjectsManager();
}
}
async function refreshLiveWorkers() {
const listContainer = document.getElementById('live-worker-list'); if (!currentAccountId) return;
listContainer.innerHTML = '<div style="text-align: center; padding: 40px;"><div class="spinner"></div><p>Memuat data...</p></div>';
const account = accounts.find(acc => acc.id === currentAccountId);
try {
const res = await fetch('/api/list-workers', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey })
});
const data = await res.json();
if (data.success) { liveWorkers = data.result; renderLiveWorkers(); updateStats(); } else { throw new Error('Gagal mengambil data'); }
} catch (e) { listContainer.innerHTML = \`<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h4>Error: \${e.message}</h4></div>\`; }
}
function renderLiveWorkers() {
const listContainer = document.getElementById('live-worker-list');
const account = accounts.find(acc => acc.id === currentAccountId);
if (!liveWorkers || liveWorkers.length === 0) {
listContainer.innerHTML = '<div class="empty-state"><i class="fas fa-cloud"></i><h4>Belum ada worker yang terdeploy</h4></div>'; return;
}
listContainer.innerHTML = liveWorkers.map(w => {
const url = account.subdomain ? \`https://\${w.id}.\${account.subdomain}.workers.dev\` : \`https://\${w.id}.workers.dev\`;
return \`
<div class="grid-card">
<div class="card-row-top">
<div class="card-info" style="max-width:100%;">
<div class="card-title-badge">
<strong><i class="fas fa-cube" style="color:var(--accent-color); margin-right:4px;"></i> \${w.id}</strong>
</div>
<div style="margin-top: 6px; font-size: 0.8rem; color:var(--text-secondary); word-break:break-all;">
<i class="fas fa-link"></i> \${url}
</div>
</div>
</div>
<div class="card-actions-wrapper">
<button class="btn btn-secondary" onclick="editLiveWorker('\${w.id}')"><i class="fas fa-edit"></i> Edit</button>
<button class="btn btn-danger" onclick="deleteLiveWorker('\${w.id}')"><i class="fas fa-trash-alt"></i> Hapus</button>
</div>
</div>\`;
}).join('');
}
async function editLiveWorker(workerName) {
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, "Mengambil berkas kode worker...");
try {
const res = await fetch('/api/get-script', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, workerName })
});
const data = await res.json();
if (data.success) {
isEditMode = true; originalWorkerName = workerName;
document.getElementById('workerName').value = workerName;
document.getElementById('script-select').value = 'manual';
toggleScriptSource();
document.getElementById('manual-code').value = data.script;
document.getElementById('manual-code').dispatchEvent(new Event('input'));
if (data.kvBindings && data.kvBindings.length > 0) {
document.getElementById('kv-name').value = data.kvBindings[0].name;
const kvDropdown = document.getElementById('kv-id');
kvDropdown.value = data.kvBindings[0].id;
} else {
document.getElementById('kv-name').value = '';
document.getElementById('kv-id').value = '';
}
const envContainer = document.getElementById('env-vars-container');
envContainer.innerHTML = '';
if (data.envVars && data.envVars.length > 0) {
data.envVars.forEach(ev => addEnvRow(ev.key, ev.value));
} else { addEnvRow(); }
document.getElementById('edit-mode-badge').style.display = 'block';
document.getElementById('editing-worker-name').textContent = workerName;
switchTab('deployer');
Swal.fire('Sukses', 'Mode edit aktif. Script dan Bindings berhasil dimuat.', 'success');
}
} catch (e) { Swal.fire('Error', e.message, 'error'); } finally { showLoading(false); }
}
function cancelEdit(isSuccess) {
isEditMode = false;
document.getElementById('workerName').value = '';
document.getElementById('manual-code').value = '';
document.getElementById('script-select').value = '';
document.getElementById('kv-name').value = '';
document.getElementById('kv-id').value = '';
document.getElementById('env-vars-container').innerHTML = '';
addEnvRow();
toggleScriptSource();
document.getElementById('edit-mode-badge').style.display = 'none';
if (isSuccess === true) return;
Swal.fire('Sukses', 'Mode edit dibatalkan', 'success');
}
function deleteLiveWorker(workerName) {
askConfirmation('Hapus Worker', \`Apakah Anda yakin ingin menghapus worker "\${workerName}" secara permanen?\`, async () => {
const account = accounts.find(acc => acc.id === currentAccountId);
showLoading(true, \`Menghapus worker \${workerName}...\`);
try {
await fetch('/api/delete-worker', {
method: 'POST', headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({ email: account.email, apiKey: account.apiKey, workerName })
});
await refreshLiveWorkers();
Swal.fire('Sukses', \`Worker "\${workerName}" berhasil dihapus\`, 'success');
} catch (e) { Swal.fire('Error', e.message, 'error'); } finally { showLoading(false); }
});
}
async function deployWorker() {
if (!currentAccountId) return Swal.fire('Error', 'Harap pilih akun terlebih dahulu', 'error');
const account = accounts.find(acc => acc.id === currentAccountId);
const workerName = document.getElementById('workerName').value.trim();
const scriptSelect = document.getElementById('script-select').value;
const kvName = document.getElementById('kv-name').value.trim();
const kvId = document.getElementById('kv-id').value;
if (!workerName || !scriptSelect) return Swal.fire('Error', 'Nama worker dan Sumber script wajib diisi!', 'error');
if ((kvName && !kvId) || (!kvName && kvId)) return Swal.fire('Error', 'KV Name dan ID pilihan wajib diisi keduanya!', 'error');
const payload = { email: account.email, apiKey: account.apiKey, workerName };
if (kvName && kvId) payload.kvBindings = [{ name: kvName, id: kvId }];
const envRows = document.querySelectorAll('.env-row');
const packedEnvs = [];
envRows.forEach(row => {
const k = row.querySelector('.env-key').value.trim();
const v = row.querySelector('.env-value').value.trim();
if (k && v) packedEnvs.push({ key: k, value: v });
});
if (packedEnvs.length > 0) payload.envVars = packedEnvs;
if (scriptSelect === 'custom') {
const githubUrl = document.getElementById('custom-url').value.trim();
if (!githubUrl) return Swal.fire('Error', 'URL GitHub harus diisi', 'error');
payload.githubUrl = githubUrl;
} else {
const scriptContent = document.getElementById('manual-code').value.trim();
if (!scriptContent) return Swal.fire('Error', 'Kode worker tidak boleh kosong', 'error');
payload.scriptContent = scriptContent;
}
showLoading(true, "Mendeploy script ke Server Cloudflare...");
try {
const res = await fetch('/api/deploy', {
method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
});
const data = await res.json();
if (data.success) {
workers.unshift({ ...data, accountId: currentAccountId, workerName, timestamp: new Date().toISOString() });
saveWorkers(); updateWorkerList();
Swal.fire('Sukses', \`Worker "\${workerName}" berhasil dideploy!\`, 'success');
if(isEditMode) cancelEdit(true);
document.getElementById('workerName').value = '';
document.getElementById('custom-url').value = '';
document.getElementById('manual-code').value = '';
document.getElementById('script-select').value = '';
document.getElementById('kv-name').value = '';
document.getElementById('kv-id').value = '';
document.getElementById('env-vars-container').innerHTML = '';
addEnvRow();
toggleScriptSource();
switchTab('live');
} else { throw new Error(data.error || 'Gagal deploy'); }
} catch (e) { Swal.fire('Error', e.message, 'error'); } finally { showLoading(false); }
}
function updateAccountList() {
const list = document.getElementById('account-list');
if (accounts.length === 0) { list.innerHTML = '<div class="empty-state"><h4>Belum ada akun</h4><p>Tambah akun pertama Anda</p></div>'; return; }
list.innerHTML = accounts.map(acc => \`
<div class="grid-card" onclick="selectAccount('\${acc.id}')">
<div class="card-row-top">
<div class="card-info" style="max-width:100%;">
<strong style="font-size:0.95rem;"><i class="fas fa-envelope" style="color:var(--accent-color); margin-right:6px;"></i> \${acc.alias || acc.email}</strong>
<span style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">Subdomain: \${acc.subdomain || 'Belum diatur'}</span>
</div>
</div>
<div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
<span style="font-size:0.75rem; color: var(--text-secondary);">Account ID: \${acc.accountId.substring(0,10)}...</span>
<span style="background: \${currentAccountId === acc.id ? 'var(--success-color)' : '#1e293b'}; color: white; padding: 2px 10px; border-radius: 20px; font-size: 0.75rem; font-weight:600;">\${currentAccountId === acc.id ? 'Aktif' : 'Pilih'}</span>
</div>
</div>\`).join('');
}
function updateAccountDropdown() {
const drp = document.getElementById('selected-account');
drp.innerHTML = '<option value="">-- Pilih Akun --</option>' + accounts.map(acc => \`<option value="\${acc.id}" \${currentAccountId === acc.id ? 'selected' : ''}>\${acc.alias || acc.email}</option>\`).join('');
}
function updateWorkerList() {
const list = document.getElementById('worker-list');
const accWorkers = workers.filter(w => w.accountId === currentAccountId);
if (accWorkers.length === 0) { list.innerHTML = '<div class="empty-state"><h4>Belum ada history deploy</h4></div>'; return; }
list.innerHTML = accWorkers.map(w => \`
<div class="grid-card">
<div class="card-row-top">
<div class="card-info" style="max-width:100%;">
<strong><i class="fas fa-history" style="color:var(--text-secondary); margin-right:4px;"></i> \${w.workerName}</strong>
<span style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px; word-break:break-all;"><i class="fas fa-link"></i> \${w.sub}</span>
<span style="font-size: 0.75rem; color: var(--text-secondary); margin-top:4px;"><i class="far fa-clock"></i> \${new Date(w.timestamp).toLocaleString('id-ID')}</span>
</div>
</div>
<button class="btn btn-secondary" style="width:100%; margin-top:8px;" onclick="window.open('\${w.sub}', '_blank')"><i class="fas fa-external-link-alt"></i> Buka Layanan</button>
</div>\`).join('');
}
function clearAllHistory() {
askConfirmation('Hapus History', 'Hapus semua history deploy?', () => {
workers = workers.filter(w => w.accountId !== currentAccountId);
saveWorkers();
updateWorkerList();
updateStats();
Swal.fire('Sukses', 'History dibersihkan', 'success');
});
}
function updateStats() {
document.getElementById('total-accounts').textContent = accounts.length;
document.getElementById('total-workers').textContent = workers.filter(w => w.accountId === currentAccountId).length;
document.getElementById('live-count').textContent = liveWorkers ? liveWorkers.length : 0;
document.getElementById('total-domains-stat').textContent = domains ? domains.length : 0;
}
function updateCurrentAccountInfo() {
const acc = accounts.find(a => a.id === currentAccountId);
const navBtnText = document.getElementById('nav-btn-text');
if(acc) {
document.getElementById('current-account-info').style.display = 'flex';
document.getElementById('current-account-email').textContent = acc.alias || acc.email;
document.getElementById('current-account-stats').textContent = \`Subdomain: \${acc.subdomain || 'None'} | Account ID: \${acc.accountId.substring(0,12)}\`;
if (navBtnText) navBtnText.textContent = (acc.alias || acc.email).substring(0, 15) + ( (acc.alias || acc.email).length > 15 ? '...' : '');
} else {
document.getElementById('current-account-info').style.display = 'none';
if (navBtnText) navBtnText.textContent = "Kelola Akun";
}
}
function saveAccounts() { localStorage.setItem('cf-accounts', JSON.stringify(accounts)); updateStats(); }
function saveWorkers() { localStorage.setItem('cf-workers', JSON.stringify(workers)); updateStats(); }
function generateId() { return Math.random().toString(36).substr(2, 9); }
function showAlert(type, message) {
Swal.fire({
icon: type,
title: type === 'error' ? 'Gagal' : 'Pemberitahuan',
text: message,
background: '#0f1524',
color: '#fff'
});
}
// Memastikan spinner loading tidak terhalang
function showLoading(show, message = "Sedang memproses...") {
const loadingEl = document.getElementById('loading');
const deployBtn = document.getElementById('deploy-btn');
const p = loadingEl.querySelector('p');
if (p && message) p.textContent = message;
if (show) { loadingEl.classList.add('active'); if (deployBtn) deployBtn.disabled = true; }
else { loadingEl.classList.remove('active'); if (deployBtn) deployBtn.disabled = false; }
}
</script>
</body>
</html>`;
return new Response(html, {
headers: {
'content-type': 'text/html;charset=UTF-8'
},
});
},
};
