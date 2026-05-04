export default {
  async email(message, env, ctx) {
    try {
      const subject = message.headers.get("subject") || "(Tanpa Subjek)";
      const from = message.from;
      const to = message.to;

      const allowedDomains = ["nizwara.web.id", "gtns.app"];
      const toDomain = to.split("@")[1];
      if (!allowedDomains.includes(toDomain)) {
        console.warn(`❌ Email ditolak: domain tidak terdaftar - ${to}`);
        return;
      }

      const raw = await new Response(message.raw).text();

      let textContent = "";
      let htmlContent = "";

      const textMatch = raw.match(/Content-Type:\s*text\/plain[^]*?(?:\n\n|\r\n\r\n)([^]*?)(?=\n--|\nContent-Type:|$)/i);
      if (textMatch) {
        textContent = textMatch[1].trim();
      }

      const htmlMatch = raw.match(/Content-Type:\s*text\/html[^]*?(?:\n\n|\r\n\r\n)([^]*?)(?=\n--|\nContent-Type:|$)/i);
      if (htmlMatch) {
        htmlContent = htmlMatch[1].trim();
      }

      if (!textContent && htmlContent) {
        textContent = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }

      const htmlPreview = htmlContent
        ? htmlContent.replace(/<[^>]*>/g, ' ').substring(0, 200).trim()
        : "";

      const now = new Date();
      const timeWIB = now.toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit', timeZone: "Asia/Jakarta" });
      const dateWIB = now.toLocaleDateString("id-ID", { day: 'numeric', month: 'short', year: 'numeric', timeZone: "Asia/Jakarta" });

      const emailData = {
        id: crypto.randomUUID(),
        from,
        subject,
        body: textContent || "(Konten tidak tersedia)",
        htmlBody: htmlContent,
        htmlPreview: htmlPreview,
        receivedAt: now.toISOString(),
        time: timeWIB,
        date: dateWIB,
        isRead: false
      };

      const existing = await env.TEMP_MAIL_KV.get(to, "json") || { emails: [], createdAt: Date.now() };
      existing.emails.unshift(emailData);
      if (existing.emails.length > 50) existing.emails = existing.emails.slice(0, 50);

      await env.TEMP_MAIL_KV.put(to, JSON.stringify(existing));

      console.log(`✅ Email diterima: ${to} - ${subject}`);
    } catch (err) {
      console.error("❌ Error processing email:", err);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const params = url.searchParams;

    if (url.pathname === "/api/check") {
      const email = params.get("email");
      if (!email) return new Response(JSON.stringify({ error: "Email required" }), { status: 400, headers: { "Content-Type": "application/json" } });
      const data = await env.TEMP_MAIL_KV.get(email, "json");
      return new Response(JSON.stringify(data || { emails: [] }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });
    }

    if (url.pathname === "/api/delete" && request.method === "POST") {
      const { email, messageId } = await request.json();
      if (!email || !messageId) return new Response(JSON.stringify({ error: "Missing params" }), { status: 400, headers: { "Content-Type": "application/json" } });
      const data = await env.TEMP_MAIL_KV.get(email, "json");
      if (data?.emails) {
        data.emails = data.emails.filter(e => e.id !== messageId);
        await env.TEMP_MAIL_KV.put(email, JSON.stringify(data));
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/api/mark-read" && request.method === "POST") {
      const { email, messageId } = await request.json();
      if (!email || !messageId) return new Response(JSON.stringify({ error: "Missing params" }), { status: 400, headers: { "Content-Type": "application/json" } });
      const data = await env.TEMP_MAIL_KV.get(email, "json");
      if (data?.emails) {
        const target = data.emails.find(e => e.id === messageId);
        if (target) {
          target.isRead = true;
          await env.TEMP_MAIL_KV.put(email, JSON.stringify(data));
          return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        }
      }
      return new Response(JSON.stringify({ error: "Email not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const ICON_URL_512 = "https://nizwara.biz.id/icon-tempmail.png";
    const APP_NAME = "Vortex Temp Mail";

    if (url.pathname === "/manifest.json") {
      const manifest = {
        name: APP_NAME,
        short_name: "VortexMail",
        description: "Email sementara cepat, aman, tanpa registrasi • by Vortex Project",
        theme_color: "#6366f1",
        background_color: "#0a0e17",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [{ src: ICON_URL_512, sizes: "512x512", type: "image/png", purpose: "any maskable" }]
      };
      return new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json" } });
    }

    if (url.pathname === "/sw.js") {
      const sw = `const CACHE_NAME='vortex-mail-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['/']))));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));`;
      return new Response(sw, { headers: { "Content-Type": "application/javascript" } });
    }

    const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>✨ ${APP_NAME} | by Vortex Project</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#6366f1">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="VortexMail">
  <link rel="apple-touch-icon" href="${ICON_URL_512}">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            gtn: { dark:'#0a0e17', card:'#111827', border:'#1f2937', primary:'#6366f1', primaryHover:'#4f46e5', accent:'#8b5cf6', text:'#f1f5f9', muted:'#94a3b8' }
          },
          animation: { 'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite', 'float': 'float 6s ease-in-out infinite', 'spin-slow': 'spin 1.5s linear infinite' },
          keyframes: { float: { '0%,100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-10px)' } } }
        }
      }
    }
  <\/script>
  <style>
    *{font-family:'Inter',sans-serif}
    body{background:linear-gradient(135deg,#0a0e17 0%,#1e1b4b 50%,#0f172a 100%);color:#f1f5f9;min-height:100vh}
    .glass{background:rgba(17,24,39,0.7);backdrop-filter:blur(12px);border:1px solid rgba(99,102,241,0.2);box-shadow:0 8px 32px rgba(0,0,0,0.3),0 0 0 1px rgba(99,102,241,0.1)}
    .email-card{transition:all 0.3s ease;border-left:3px solid transparent}
    .email-card:hover{transform:translateX(4px);border-left-color:#8b5cf6;background:rgba(30,41,59,0.8)}
    .email-card.unread{border-left-color:#6366f1;background:rgba(30,41,59,0.6)}
    .toast{animation:slideIn 0.3s ease,fadeOut 0.3s ease 2.7s forwards}
    @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes fadeOut{from{opacity:1}to{opacity:0}}
    .gradient-text{background:linear-gradient(135deg,#6366f1,#8b5cf6,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .glow{box-shadow:0 0 20px rgba(99,102,241,0.3)}
    .btn-glow:hover{box-shadow:0 0 25px rgba(99,102,241,0.5)}
    ::-webkit-scrollbar{width:6px}
    ::-webkit-scrollbar-track{background:#1e293b}
    ::-webkit-scrollbar-thumb{background:#4f46e5;border-radius:3px}
    ::-webkit-scrollbar-thumb:hover{background:#6366f1}
    .email-body-html { max-width: 100%; overflow-x: auto; }
    .email-body-html img { max-width: 100%; height: auto; }
    .history-item{transition:all 0.2s ease;background:rgba(30,41,59,0.5);backdrop-filter:blur(4px)}
    .history-item:hover{background:rgba(99,102,241,0.2);border-color:#6366f1}
    .history-item.active{background:rgba(99,102,241,0.3);border-color:#8b5cf6;box-shadow:0 0 8px rgba(99,102,241,0.4)}
  </style>
</head>
<body class="flex items-center justify-center p-4">
  <div id="toast-container" class="fixed top-4 right-4 z-50 space-y-2"></div>
  <div class="w-full max-w-2xl">
    <!-- Header -->
    <div class="text-center mb-6 animate-float">
      <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full glass mb-3">
        <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
        <span class="text-xs text-gtn-muted">Powered by</span>
        <span class="font-bold gradient-text">Vortex Project</span>
      </div>
      <h1 class="text-3xl md:text-4xl font-bold"><span class="gradient-text">✨ ${APP_NAME}</span></h1>
      <p class="text-gtn-muted mt-2 text-sm">Email sementara cepat • Aman • Tanpa registrasi</p>
    </div>

    <!-- Card Utama -->
    <div class="glass rounded-2xl p-6 glow">
      <div class="space-y-4 mb-6">
        <label class="block text-sm font-medium text-gtn-muted">Buat Alamat Email</label>
        <div class="flex flex-col sm:flex-row gap-3">
          <div class="flex-1 relative">
            <input type="text" id="username" placeholder="nama-anda" class="w-full px-4 py-3 rounded-xl bg-gtn-card border border-gtn-border focus:outline-none focus:border-gtn-primary focus:ring-2 focus:ring-gtn-primary/20 transition-all placeholder:text-gtn-muted/60" oninput="updatePreview()">
            <button onclick="randomizeUsername()" class="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gtn-card hover:bg-gtn-border border border-gtn-border hover:border-gtn-primary/50 transition-all text-gtn-muted hover:text-gtn-primary" title="Acak alamat baru">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            </button>
          </div>
          <select id="domain" onchange="updatePreview()" class="px-4 py-3 rounded-xl bg-gtn-card border border-gtn-border focus:outline-none focus:border-gtn-primary cursor-pointer hover:border-gtn-primary/50 transition-all">
            <option value="nizwara.web.id">@nizwara.web.id</option>
            <option value="gtns.app" selected>@gtns.app</option>
          </select>
        </div>

        <div class="flex items-center gap-3 p-3 rounded-xl bg-gtn-card/50 border border-gtn-border">
          <code id="emailPreview" class="flex-1 text-sm text-gtn-primary font-mono truncate lowercase">nama@domain.com</code>
          <button onclick="copyEmail(event)" class="btn-glow px-4 py-2 rounded-lg bg-gradient-to-r from-gtn-primary to-gtn-accent text-white font-medium text-sm hover:from-gtn-primaryHover hover:to-gtn-primary transition-all flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            Salin
          </button>
          <button onclick="checkMail(true)" class="p-2 rounded-lg hover:bg-gtn-card border border-gtn-border hover:border-gtn-primary/50 transition-all" title="Periksa Sekarang">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gtn-muted hover:text-gtn-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          </button>
        </div>

        <!-- Riwayat Alamat -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-gtn-muted flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Riwayat Alamat (muncul setelah disalin)
            </span>
            <button onclick="clearHistory()" class="text-xs text-gtn-muted/60 hover:text-red-400 transition-colors">Hapus Riwayat</button>
          </div>
          <div id="emailHistory" class="flex flex-wrap gap-2 max-h-20 overflow-y-auto pr-1"></div>
        </div>

        <div class="flex items-center justify-between text-xs text-gtn-muted">
          <span id="statusText">🔄 Auto-refresh: Aktif (1s)</span>
          <span id="emailCount" class="hidden px-2 py-1 rounded-full bg-gtn-primary/20 text-gtn-primary">0 email</span>
        </div>
      </div>

      <!-- Inbox -->
      <div class="border-t border-gtn-border pt-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gtn-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            <span id="inboxTitle">Kotak Masuk</span>
          </h2>
          <button id="backButton" onclick="backToInbox()" class="hidden text-xs text-gtn-primary hover:text-gtn-accent transition-colors flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
            Kembali ke Inbox
          </button>
          <button onclick="clearInbox()" id="clearInboxBtn" class="text-xs text-gtn-muted hover:text-red-400 transition-colors">Hapus Semua</button>
        </div>

        <div id="contentArea">
          <div id="inboxContainer">
            <div id="inbox" class="space-y-2 max-h-80 overflow-y-auto pr-2">
              <div class="text-center py-8 text-gtn-muted">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
                <p class="text-sm animate-pulse-slow">Menunggu email masuk...</p>
                <p class="text-xs mt-1">Kirim email ke alamat di atas untuk melihat di sini</p>
              </div>
            </div>
          </div>
          <div id="detailContainer" class="hidden"></div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="text-center mt-6 text-xs text-gtn-muted/60">
      <p>🔒 Email disimpan selamanya (tidak terhapus otomatis)</p>
      <div class="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-full glass">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a5 5 0 01-1.414-4.243M4.929 4.929a9 9 0 0112.728 0M4.929 19.071A9 9 0 0112 21"/></svg>
        <span class="text-gtn-muted">Support</span>
        <a href="https://wa.me/6282247233909" target="_blank" class="gradient-text font-medium hover:underline flex items-center gap-1">Deki Niswara <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>
      </div>
    </div>
  </div>

  <script>
    let currentEmail = '';
    let autoRefresh = true;
    let refreshInterval;
    let activeToast = null;
    let currentEmails = [];
    let emailHistory = [];
    let isFirstLoad = true;

    async function showNotification(title, body) {
      if (Notification.permission === 'granted') {
        const iconUrl = 'https://nizwara.biz.id/icon-tempmail.png';
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready;
          reg.showNotification(title, { body: body, icon: iconUrl, badge: iconUrl });
        } else {
          new Notification(title, { body: body, icon: iconUrl });
        }
      }
    }

    try {
      const stored = localStorage.getItem('vortexMailHistory');
      emailHistory = stored ? JSON.parse(stored) : [];
    } catch(e) { emailHistory = []; }

    function saveHistory() {
      localStorage.setItem('vortexMailHistory', JSON.stringify(emailHistory));
      renderHistory();
    }

    function addToHistory(email) {
      // Pastikan email selalu lowercase
      email = email.toLowerCase();
      emailHistory = emailHistory.filter(e => e !== email);
      emailHistory.unshift(email);
      if (emailHistory.length > 10) emailHistory = emailHistory.slice(0, 10);
      saveHistory();
    }

    function clearHistory() {
      if (!emailHistory.length) return;
      emailHistory = [];
      saveHistory();
      showToast('Riwayat alamat dihapus', 'info');
    }

    function renderHistory() {
      const container = document.getElementById('emailHistory');
      if (!container) return;
      if (!emailHistory.length) {
        container.innerHTML = '<span class="text-xs text-gtn-muted/50 italic">Belum ada riwayat</span>';
        return;
      }
      container.innerHTML = emailHistory.map(email => {
        const isActive = email === currentEmail;
        return \`<div class="history-item \${isActive ? 'active' : ''} rounded-lg px-3 py-1.5 text-xs cursor-pointer border border-gtn-border flex items-center gap-2 group" onclick="selectHistory('\${escapeHtml(email)}')"><span class="truncate max-w-[150px] font-mono text-gtn-text lowercase">\${escapeHtml(email)}</span><button onclick="event.stopPropagation(); removeHistoryItem('\${escapeHtml(email)}')" class="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity text-gtn-muted"><svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>\`;
      }).join('');
    }

    function selectHistory(email) {
      const [user, domain] = email.split('@');
      // Pastikan user lowercase
      document.getElementById('username').value = user.toLowerCase();
      document.getElementById('domain').value = domain;
      updatePreview();
      checkMail(false);
      showToast('Beralih ke ' + email, 'info');
    }

    function removeHistoryItem(email) {
      emailHistory = emailHistory.filter(e => e !== email);
      saveHistory();
      showToast('Alamat dihapus dari riwayat', 'info');
    }

    document.addEventListener('DOMContentLoaded', () => {
      generateRandomUsername();
      updatePreview();
      startAutoRefresh();
      renderHistory();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(() => console.log('✅ SW')).catch(err => console.log('SW gagal', err));
      }
      if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    });

    function generateRandomUsername() {
      const konsonan = ['b','c','d','f','g','h','j','k','l','m','n','p','q','r','s','t','v','w','x','y','z'];
      const vokal = ['a','i','u','e','o','ai','au','ia','ua','ea','ie','uo','ei','ou','ae'];
      const jumlahSuku = Math.floor(Math.random() * 3) + 2;
      let nama = '';
      for (let i = 0; i < jumlahSuku; i++) {
        const k = konsonan[Math.floor(Math.random() * konsonan.length)];
        const v = vokal[Math.floor(Math.random() * vokal.length)];
        nama += k + v;
      }
      // Tanpa kapitalisasi, langsung lowercase
      document.getElementById('username').value = nama.toLowerCase();
    }

    function randomizeUsername() {
      generateRandomUsername();
      updatePreview();
      checkMail(false);
      showToast('Alamat baru: ' + getFullEmail(), 'info');
    }

    function getFullEmail() {
      // Ambil input dan paksa lowercase
      const user = document.getElementById('username').value.trim().toLowerCase() || 'nama';
      const domain = document.getElementById('domain').value;
      return user + '@' + domain;
    }

    function updatePreview() {
      currentEmail = getFullEmail();
      document.getElementById('emailPreview').textContent = currentEmail;
      // Tampilkan juga dengan gaya lowercase
      document.getElementById('emailPreview').style.textTransform = 'lowercase';
      renderHistory();
    }

    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      if (activeToast) { activeToast.remove(); activeToast = null; }
      const colors = { success: 'bg-green-500/90 border-green-400', error: 'bg-red-500/90 border-red-400', info: 'bg-gtn-primary/90 border-gtn-primary' };
      const icons = { success: '✓', error: '✕', info: 'ℹ' };
      const toast = document.createElement('div');
      toast.className = \`toast glass border-l-4 \${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg min-w-[250px]\`;
      toast.innerHTML = \`<div class="flex items-center gap-3"><span class="text-lg font-bold">\${icons[type]}</span><span class="text-sm">\${message}</span></div>\`;
      container.appendChild(toast);
      activeToast = toast;
      setTimeout(() => { toast.remove(); if (activeToast === toast) activeToast = null; }, 3000);
    }

    async function copyEmail(event) {
      const btn = event.currentTarget;
      const originalHTML = btn.innerHTML;
      try {
        await navigator.clipboard.writeText(currentEmail);
        showToast('📋 Email berhasil disalin!', 'success');
        addToHistory(currentEmail);
        btn.innerHTML = '<span>✓ Tersalin!</span>';
        setTimeout(() => btn.innerHTML = originalHTML, 1500);
      } catch {
        showToast('❌ Gagal menyalin email', 'error');
        btn.innerHTML = '<span>✕ Gagal</span>';
        setTimeout(() => btn.innerHTML = originalHTML, 1500);
      }
    }

    function startAutoRefresh() {
      refreshInterval = setInterval(() => { if (autoRefresh && currentEmail) checkMail(false); }, 1000);
    }

    async function checkMail(showToastOnCheck = false) {
      if (!currentEmail) return;
      const inbox = document.getElementById('inbox');
      if (showToastOnCheck) {
        inbox.innerHTML = \`<div class="text-center py-6"><div class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gtn-primary border-t-transparent"></div><p class="text-xs text-gtn-muted mt-2">Memeriksa email...</p></div>\`;
      }
      try {
        const res = await fetch('/api/check?email=' + encodeURIComponent(currentEmail));
        const data = await res.json();
        const newEmails = data.emails || [];

        if (!isFirstLoad) {
          const oldIds = new Set(currentEmails.map(e => e.id));
          const justReceived = newEmails.filter(e => !oldIds.has(e.id));
          if (justReceived.length > 0) {
            justReceived.forEach(e => {
              showNotification(e.subject || 'Email Baru Masuk', 'Dari: ' + (e.from || 'Tidak diketahui'));
            });
          }
        }
        isFirstLoad = false;

        currentEmails = newEmails;
        if (currentEmails.length > 0) {
          document.getElementById('emailCount').textContent = \`\${currentEmails.length} email\`;
          document.getElementById('emailCount').classList.remove('hidden');
          renderInbox(currentEmails);
          if (showToastOnCheck) showToast(\`✅ Ditemukan \${currentEmails.length} email!\`, 'success');
        } else {
          document.getElementById('emailCount').classList.add('hidden');
          if (showToastOnCheck) showToast('📭 Belum ada email baru', 'info');
          renderEmptyInbox();
        }
      } catch {
        if (showToastOnCheck) showToast('⚠️ Gagal memeriksa email', 'error');
      }
    }

    function renderInbox(emails) {
      const inbox = document.getElementById('inbox');
      inbox.innerHTML = emails.map(email => \`
        <div class="email-card \${!email.isRead ? 'unread' : ''} rounded-xl p-4 cursor-pointer" onclick="viewEmail('\${email.id}')">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-medium text-sm truncate">\${escapeHtml(email.from)}</span>
                \${!email.isRead ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-gtn-primary/30 text-gtn-primary">Baru</span>' : ''}
              </div>
              <p class="text-xs text-gtn-primary font-medium truncate mb-1">\${escapeHtml(email.subject)}</p>
              <p class="text-xs text-gtn-muted/80 line-clamp-2">\${escapeHtml(email.body.substring(0, 100))}\${email.body.length > 100 ? '...' : ''}</p>
            </div>
            <div class="text-right flex-shrink-0">
              <span class="text-xs text-gtn-muted">\${email.time}</span>
              <button onclick="event.stopPropagation(); deleteEmail('\${email.id}')" class="mt-2 p-1 rounded hover:bg-red-500/20 text-gtn-muted hover:text-red-400 transition-colors" title="Hapus">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        </div>
      \`).join('');
    }

    function renderEmptyInbox() {
      document.getElementById('inbox').innerHTML = \`
        <div class="text-center py-8 text-gtn-muted">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          <p class="text-sm">Kotak masuk masih kosong</p>
          <p class="text-xs mt-1">Kirim email ke <span class="text-gtn-primary font-mono lowercase">\${currentEmail}</span></p>
        </div>
      \`;
    }

    async function viewEmail(messageId) {
      const email = currentEmails.find(e => e.id === messageId);
      if (!email) { showToast('Email tidak ditemukan', 'error'); return; }
      document.getElementById('inboxContainer').classList.add('hidden');
      document.getElementById('detailContainer').classList.remove('hidden');
      document.getElementById('backButton').classList.remove('hidden');
      document.getElementById('clearInboxBtn').classList.add('hidden');
      document.getElementById('inboxTitle').textContent = 'Detail Email';

      const dateStr = email.date || new Date(email.receivedAt).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Jakarta' });
      const timeStr = email.time || new Date(email.receivedAt).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jakarta' });

      let bodyHtml = '';
      if (email.htmlBody) {
        bodyHtml = email.htmlBody;
      } else {
        bodyHtml = escapeHtml(email.body).replace(/\\n/g, '<br>');
      }

      document.getElementById('detailContainer').innerHTML = \`
        <div class="space-y-4">
          <div class="border-b border-gtn-border pb-3">
            <h3 class="text-lg font-semibold text-gtn-text">\${escapeHtml(email.subject)}</h3>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gtn-muted">
              <span class="flex items-center gap-1"><svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207"/></svg>\${escapeHtml(email.from)}</span>
              <span class="flex items-center gap-1"><svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>\${dateStr} \${timeStr}</span>
            </div>
          </div>
          <div class="email-body-html max-h-96 overflow-y-auto pr-2 text-gtn-text/90">\${bodyHtml}</div>
          <div class="flex gap-2 pt-2 border-t border-gtn-border">
            <button onclick="backToInbox()" class="flex-1 py-2 rounded-lg bg-gtn-card hover:bg-gtn-border transition-colors text-sm">Kembali</button>
            <button onclick="deleteEmailFromDetail('\${email.id}')" class="flex-1 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors text-sm">Hapus Email</button>
          </div>
        </div>
      \`;

      if (!email.isRead) {
        await markAsRead(messageId);
        email.isRead = true;
      }
    }

    async function markAsRead(messageId) {
      try {
        await fetch('/api/mark-read', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: currentEmail, messageId }) });
      } catch {}
    }

    function backToInbox() {
      document.getElementById('detailContainer').classList.add('hidden');
      document.getElementById('inboxContainer').classList.remove('hidden');
      document.getElementById('backButton').classList.add('hidden');
      document.getElementById('clearInboxBtn').classList.remove('hidden');
      document.getElementById('inboxTitle').textContent = 'Kotak Masuk';
      checkMail(false);
    }

    async function deleteEmailFromDetail(messageId) {
      if (!confirm('Hapus email ini?')) return;
      await deleteEmail(messageId);
      backToInbox();
    }

    async function deleteEmail(messageId) {
      try {
        const res = await fetch('/api/delete', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: currentEmail, messageId }) });
        const result = await res.json();
        if (result.success) {
          showToast('🗑️ Email dihapus', 'success');
          if (!document.getElementById('inboxContainer').classList.contains('hidden')) checkMail(false);
        } else showToast('Gagal menghapus email', 'error');
      } catch { showToast('Error koneksi', 'error'); }
    }

    function clearInbox() {
      if (!confirm('Hapus SEMUA email di kotak masuk?')) return;
      showToast('🧹 Fitur hapus semua akan segera hadir!', 'info');
    }

    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    document.addEventListener('visibilitychange', () => {
      // Keep autoRefresh active even when in background so notifications trigger correctly
      document.getElementById('statusText').textContent = document.hidden ? '🔄 Auto-refresh: Latar Belakang (1s)' : '🔄 Auto-refresh: Aktif (1s)';
    });
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html", "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" }
    });
  }
};
