const TG_TOKEN = "8789495014:AAFTA9yUl7POqkV-jEQGrNc0W858mXuKkls";

function getToken(env) {
  return (env && env.TG_TOKEN) || TG_TOKEN;
}

function getKV(env) {
  try {
    return env?.GH_DATA || env?.SAWIT || globalThis.GH_DATA || globalThis.SAWIT;
  } catch {
    return env?.GH_DATA || env?.SAWIT;
  }
}

// UTF-8 & Base64 Helpers using TextEncoder/TextDecoder
function stringToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToString(b64) {
  const cleanB64 = b64.replace(/\s/g, '');
  const binary = atob(cleanB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'POST') {
      let payload;
      try {
        payload = JSON.parse(await request.text());
        if (payload.callback_query) {
          await handleCallbackQuery(payload.callback_query, env, ctx);
        } else if (payload.message) {
          await handleBotMessage(payload.message, env, ctx);
        }
      } catch (e) {
        console.error("Worker Error:", e.message, e.stack);
        try {
          const chatId = payload?.message?.chat?.id || payload?.callback_query?.message?.chat?.id;
          if (chatId) {
            await sendReply(chatId, `⚠️ <b>TERJADI ERROR SISTEM</b>\n\n<code>${escapeHtml(e.message)}</code>\n\n<i>Bot gagal memproses perintah. Cek kembali input atau koneksi API.</i>`, null, env);
          }
        } catch {}
      }
      return new Response('OK', { status: 200 });
    }
    const kv = getKV(env);
    const token = getToken(env);
    return new Response(`Bot Powerfull Active - KV: ${kv ? 'OK (SAWIT/GH_DATA)' : 'MISSING'} | TOKEN: ${token && token.includes(':') ? 'OK' : 'KOSONG'}`, { status: 200 });
  }
};

// Recursive helper function to delete directory contents from GitHub
async function deleteFolderRecursive(repo, token, folderPath) {
  const cleanPath = folderPath.replace(/^\/+|\/+$/g, '');
  const url = `https://api.github.com/repos/${repo}/contents/${cleanPath}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker' }
  });

  if (!res.ok) {
    if (res.status === 404) return 0;
    throw new Error(`Gagal membaca folder ${cleanPath} (Status: ${res.status})`);
  }

  const items = await res.json();
  let deletedCount = 0;

  if (Array.isArray(items)) {
    for (const item of items) {
      if (item.type === 'dir') {
        deletedCount += await deleteFolderRecursive(repo, token, item.path);
      } else {
        const delRes = await fetch(`https://api.github.com/repos/${repo}/contents/${item.path}`, {
          method: 'DELETE',
          headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Delete file ${item.path} in folder ${cleanPath}`, sha: item.sha })
        });
        if (delRes.ok) deletedCount++;
      }
    }
  } else if (items.type === 'file') {
    const delRes = await fetch(`https://api.github.com/repos/${repo}/contents/${items.path}`, {
      method: 'DELETE',
      headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Delete file ${items.path}`, sha: items.sha })
    });
    if (delRes.ok) deletedCount++;
  }

  return deletedCount;
}

// ================= 1. HANDLER TOMBOL INTERAKTIF =================
async function handleCallbackQuery(callbackQuery, env, ctx) {
  const KV = getKV(env);
  if (!KV) throw new Error("KV Namespace (SAWIT / GH_DATA) tidak ditemukan. Mohon atur KV Binding SAWIT di Cloudflare Worker Settings.");

  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  const callbackId = callbackQuery.id;

  let userSettings = await KV.get(`user_${chatId}`, { type: "json" }) || {};

  // Always answer callback to clear loading state in client
  await answerCallback(callbackId, "", false, env);

  if (data === "goto_help") {
    await deleteMessage(chatId, messageId, env);
    return await sendHelpMenu(chatId, userSettings.repo ? true : false, env);
  }

  if (!userSettings.token && !data.startsWith("help")) {
    return await sendReply(chatId, `⚠️ <b>BELUM LOGIN</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan login terlebih dahulu menggunakan format:\n<code>/login username token_github</code>\natau\n<code>/login token_github</code>`, null, env);
  }

  // --- REPOSITORY NAVIGATION ---
  if (data.startsWith("page:")) {
    const targetPage = parseInt(data.split("page:")[1]);
    await deleteMessage(chatId, messageId, env);
    return await sendRepoMenu(chatId, userSettings.token, targetPage, env);
  }

  if (data.startsWith("setrepo:")) {
    const repoFullName = data.split("setrepo:")[1];
    userSettings.repo = repoFullName;
    userSettings.current_path = "";
    userSettings.state = null;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, "", 1, env);
  }

  if (data.startsWith("repodetail:")) {
    const repoName = data.split("repodetail:")[1];
    await deleteMessage(chatId, messageId, env);
    return await sendRepoDetail(chatId, repoName, userSettings.token, env);
  }

  // TOGGLE REPOSITORY VISIBILITY (Private <-> Public)
  if (data.startsWith("make_public:")) {
    const repoName = data.split("make_public:")[1];
    await answerCallback(callbackId, "Mengubah repo ke Public...", false, env);
    const res = await fetch(`https://api.github.com/repos/${repoName}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${userSettings.token}`,
        'User-Agent': 'CF-Worker',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ private: false })
    });
    await deleteMessage(chatId, messageId, env);
    if (res.ok) {
      await sendReply(chatId, `🌐 <b>BERHASIL MENGUBAH VISIBILITAS</b>\n━━━━━━━━━━━━━━━━━━━━\nRepository <code>${escapeHtml(repoName)}</code> sekarang berstatus <b>PUBLIC 🌐</b> (dapat diakses publik).`, null, env);
      return await sendRepoDetail(chatId, repoName, userSettings.token, env);
    } else {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gagal mengubah visibilitas repo (${res.status}): ${err.message || 'Error API GitHub'}`);
    }
  }

  if (data.startsWith("make_private:")) {
    const repoName = data.split("make_private:")[1];
    await answerCallback(callbackId, "Mengubah repo ke Private...", false, env);
    const res = await fetch(`https://api.github.com/repos/${repoName}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${userSettings.token}`,
        'User-Agent': 'CF-Worker',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ private: true })
    });
    await deleteMessage(chatId, messageId, env);
    if (res.ok) {
      await sendReply(chatId, `🔒 <b>BERHASIL MENGUBAH VISIBILITAS</b>\n━━━━━━━━━━━━━━━━━━━━\nRepository <code>${escapeHtml(repoName)}</code> sekarang berstatus <b>PRIVATE 🔒</b> (hanya kamu yang bisa lihat).`, null, env);
      return await sendRepoDetail(chatId, repoName, userSettings.token, env);
    } else {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gagal mengubah visibilitas repo (${res.status}): ${err.message || 'Error API GitHub'}`);
    }
  }

  if (data.startsWith("confirm_del:")) {
    const repoName = data.split("confirm_del:")[1];
    await deleteMessage(chatId, messageId, env);
    const textDel = `⚠️ <b>KONFIRMASI HAPUS REPOSITORY</b>\n━━━━━━━━━━━━━━━━━━━━\nApakah kamu yakin ingin menghapus repository <code>${escapeHtml(repoName)}</code> secara permanen dari GitHub?\n\n<i>Tindakan ini tidak bisa dibatalkan!</i>`;
    return await sendReply(chatId, textDel, {
      inline_keyboard: [
        [{ text: "✅ Ya, Hapus Selamanya!", callback_data: `do_del:${repoName}` }],
        [{ text: "❌ Batal", callback_data: "goto_repomenu" }]
      ]
    }, env);
  }

  if (data.startsWith("do_del:")) {
    const repoName = data.split("do_del:")[1];
    await answerCallback(callbackId, "Menghapus repo...", false, env);
    const res = await fetch(`https://api.github.com/repos/${repoName}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${userSettings.token}`,
        'User-Agent': 'CF-Worker',
        'Accept': 'application/vnd.github+json'
      }
    });
    await deleteMessage(chatId, messageId, env);
    if (res.ok) {
      if (userSettings.repo === repoName) {
        userSettings.repo = null;
        userSettings.current_path = "";
        await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
      }
      return await sendReply(chatId, `🗑️ <b>BERHASIL</b>\n━━━━━━━━━━━━━━━━━━━━\nRepo <code>${escapeHtml(repoName)}</code> telah dihapus permanen.`, {
        inline_keyboard: [[{ text: "🔙 Kembali ke Daftar Repo", callback_data: "goto_repomenu" }]]
      }, env);
    } else {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Gagal Menghapus Repo (${res.status}): ${err.message || 'Pastikan token PAT memiliki scope delete_repo.'}`);
    }
  }

  if (data === "action_createrepo") {
    userSettings.state = 'WAITING_FOR_NEW_REPO_NAME';
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendReply(chatId, `✨ <b>BUAT REPOSITORY BARU</b>\n━━━━━━━━━━━━━━━━━━━━\nKetik nama repository baru yang ingin dibuat:\n\n<i>Atau kirim format:</i> <code>namarepo private</code> <i>untuk repo private.</i>\n\nContoh: <code>my-awesome-app private</code>`, {
      inline_keyboard: [[{ text: "❌ Batal", callback_data: "goto_repomenu" }]]
    }, env);
  }

  // --- FILE & WORKSPACE NAVIGATION ---
  if (data.startsWith("open_dir:")) {
    const targetDir = data.substring("open_dir:".length);
    userSettings.current_path = targetDir;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, targetDir, 1, env);
  }

  if (data.startsWith("filepage:")) {
    const parts = data.split("filepage:")[1].split(":");
    const targetPage = parseInt(parts[0]);
    const path = parts.slice(1).join(":");
    await deleteMessage(chatId, messageId, env);
    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, path, targetPage, env);
  }

  if (data === "back_dir") {
    let currentPath = userSettings.current_path || "";
    let parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    userSettings.current_path = parts.join("/");
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, userSettings.current_path, 1, env);
  }

  if (data === "menu_tambah_global") {
    userSettings.state = 'WAITING_FOR_FILE';
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    const pathText = userSettings.current_path ? `folder <code>${escapeHtml(userSettings.current_path)}/</code>` : "<b>Root Folder</b>";
    const textAdd = `📝 <b>TAMBAH BANYAK FILE / GAMBAR BARU</b>\n━━━━━━━━━━━━━━━━━━━━\n📍 Target: ${pathText}\n\n👉 <b>Satu / Banyak File Sekaligus:</b> Kirim satu atau beberapa file/foto sekaligus ke chat ini.\n👉 <b>Format Teks Manual:</b> Ketik teks dengan format:\n<code>namafile.js isi_script_kamu</code>\n\n📌 <i>Mode upload akan tetap aktif sampai kamu klik tombol <b>✅ Selesai / Kembali ke Folder</b> di bawah.</i>`;
    return await sendReply(chatId, textAdd, {
      inline_keyboard: [[{ text: "✅ Selesai / Kembali ke Folder", callback_data: "goto_filemenu" }]]
    }, env);
  }

  if (data === "menu_buat_folder") {
    userSettings.state = 'WAITING_FOR_FOLDER_NAME';
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendReply(chatId, `📁 <b>BUAT FOLDER BARU</b>\n━━━━━━━━━━━━━━━━━━━━\nKetik nama folder baru yang ingin dibuat:`, {
      inline_keyboard: [[{ text: "❌ Batal", callback_data: "goto_filemenu" }]]
    }, env);
  }

  if (data.startsWith("viewfile:")) {
    const targetFile = data.substring("viewfile:".length);
    await deleteMessage(chatId, messageId, env);
    return await sendViewFile(chatId, userSettings.repo, userSettings.token, targetFile, env);
  }

  if (data.startsWith("dlfile:")) {
    const targetFile = data.substring("dlfile:".length);
    await answerCallback(callbackId, "Mengunduh file...", false, env);
    const check = await fetch(`https://api.github.com/repos/${userSettings.repo}/contents/${targetFile}`, {
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker' }
    });
    if (check.ok) {
      const fileData = await check.json();
      const fileContent = base64ToString(fileData.content);
      const fileName = targetFile.split('/').pop();
      await sendDocumentBuffer(chatId, fileContent, fileName, env);
    } else {
      throw new Error(`Gagal mengunduh file ${targetFile}`);
    }
    return;
  }

  if (data.startsWith("editfile:")) {
    const targetFile = data.substring("editfile:".length);
    userSettings.state = 'WAITING_FOR_FILE_EDIT';
    userSettings.target_path = targetFile;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    await sendReply(chatId, `⏳ <i>Menarik data dari <code>${escapeHtml(targetFile)}</code>...</i>`, null, env);

    const check = await fetch(`https://api.github.com/repos/${userSettings.repo}/contents/${targetFile}`, {
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker' }
    });

    if (check.ok) {
      const fileData = await check.json();
      let isiLama = "";
      try {
        isiLama = base64ToString(fileData.content);
      } catch (e) {
        throw new Error("Gagal mendekode isi file dari base64.");
      }

      if (isiLama.length > 3500) {
        const textBig = `✏️ <b>EDIT FILE (Ukuran Besar)</b>\n━━━━━━━━━━━━━━━━━━━━\n📄 <b>File:</b> <code>${escapeHtml(targetFile)}</code>\n\n⚠️ <i>Ukuran file besar (${isiLama.length} karakter). File dikirim sebagai dokumen di bawah ini.</i>\n\n🔄 <b>Cara Edit:</b> Download, edit isinya, lalu kirim kembali file hasil edit ke sini untuk menimpa file lama.`;
        await sendReply(chatId, textBig, { inline_keyboard: [[{ text: "❌ Batal", callback_data: "goto_filemenu" }]] }, env);
        return await sendDocumentBuffer(chatId, isiLama, targetFile.split('/').pop(), env);
      } else {
        const textEdit = `✏️ <b>EDIT FILE MANUAL</b>\n━━━━━━━━━━━━━━━━━━━━\n📄 <b>File:</b> <code>${escapeHtml(targetFile)}</code>\n\n<b>Cara 1:</b> Kirim file dokumen/foto baru ke sini.\n<b>Cara 2:</b> Salin teks di bawah ini, edit, lalu kirim kembali sebagai chat biasa:\n\n<pre>${escapeHtml(isiLama)}</pre>`;
        return await sendReply(chatId, textEdit, { inline_keyboard: [[{ text: "❌ Batal", callback_data: "goto_filemenu" }]] }, env);
      }
    } else {
      throw new Error(`Gagal mengambil file dari GitHub (Status: ${check.status})`);
    }
  }

  if (data.startsWith("renamefile:")) {
    const targetFile = data.substring("renamefile:".length);
    userSettings.state = 'WAITING_FOR_RENAME';
    userSettings.target_path = targetFile;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendReply(chatId, `✏️ <b>RENAME / MOVE FILE</b>\n━━━━━━━━━━━━━━━━━━━━\n📄 <b>File Asal:</b> <code>${escapeHtml(targetFile)}</code>\n\nKetik nama atau path baru untuk file ini:\nContoh: <code>index.js</code> atau <code>src/index.js</code>`, {
      inline_keyboard: [[{ text: "❌ Batal", callback_data: "goto_filemenu" }]]
    }, env);
  }

  if (data.startsWith("delfile:")) {
    const targetFile = data.substring("delfile:".length);
    await deleteMessage(chatId, messageId, env);
    return await sendReply(chatId, `⚠️ <b>KONFIRMASI HAPUS ITEM</b>\n━━━━━━━━━━━━━━━━━━━━\nApakah kamu yakin ingin menghapus <code>${escapeHtml(targetFile)}</code> dari repository?`, {
      inline_keyboard: [
        [{ text: "✅ Ya, Hapus!", callback_data: `dodel_file:${targetFile}` }],
        [{ text: "❌ Batal", callback_data: "goto_filemenu" }]
      ]
    }, env);
  }

  if (data.startsWith("dodel_file:")) {
    const targetFile = data.substring("dodel_file:".length);
    await answerCallback(callbackId, "Menghapus item...", false, env);

    const check = await fetch(`https://api.github.com/repos/${userSettings.repo}/contents/${targetFile}`, {
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker' }
    });

    if (check.ok) {
      const itemInfo = await check.json();

      // IF IT'S A DIRECTORY (Array of items):
      if (Array.isArray(itemInfo)) {
        await sendReply(chatId, `⏳ <i>Menghapus seluruh isi folder <code>${escapeHtml(targetFile)}</code> secara rekursif...</i>`, null, env);
        const deletedFiles = await deleteFolderRecursive(userSettings.repo, userSettings.token, targetFile);
        await deleteMessage(chatId, messageId, env);
        await sendReply(chatId, `🗑️ <b>FOLDER BERHASIL DIHAPUS</b>\n━━━━━━━━━━━━━━━━━━━━\nFolder <code>${escapeHtml(targetFile)}</code> (${deletedFiles} file) telah dihapus dari repository.`, null, env);
      }
      // IF IT'S A SINGLE FILE:
      else {
        const sha = itemInfo.sha;
        const delReq = await fetch(`https://api.github.com/repos/${userSettings.repo}/contents/${targetFile}`, {
          method: 'DELETE',
          headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Hapus file ${targetFile} via Telegram Bot`, sha })
        });
        if (!delReq.ok) throw new Error("Gagal menghapus file dari GitHub.");
        await deleteMessage(chatId, messageId, env);
      }
    } else {
      throw new Error(`Item ${targetFile} tidak ditemukan di GitHub.`);
    }

    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, userSettings.current_path || "", 1, env);
  }

  if (data === "goto_repomenu") {
    userSettings.state = null;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendRepoMenu(chatId, userSettings.token, 1, env);
  }

  if (data === "goto_filemenu") {
    userSettings.state = null;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    await deleteMessage(chatId, messageId, env);
    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, userSettings.current_path || "", 1, env);
  }
}

// ================= 2. HANDLER TEXT CHAT & MEDIA MESSAGES =================
async function handleBotMessage(message, env, ctx) {
  const KV = getKV(env);
  if (!KV) throw new Error("KV Namespace (SAWIT / GH_DATA) tidak ditemukan. Silakan atur KV Binding SAWIT di Cloudflare Dashboard.");

  const chatId = message.chat.id;
  const text = (message.text || message.caption || "").trim();

  let userSettings = await KV.get(`user_${chatId}`, { type: "json" }) || {};

  // Command /cancel
  if (text === '/cancel') {
    userSettings.state = null;
    userSettings.target_path = null;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    return await sendReply(chatId, `❌ <b>Aksi Dibatalkan</b>`, {
      inline_keyboard: [[{ text: "🔙 Ke Menu Utama", callback_data: userSettings.repo ? "goto_filemenu" : "goto_repomenu" }]]
    }, env);
  }

  // Command /logout
  if (text === '/logout') {
    await KV.delete(`user_${chatId}`);
    return await sendReply(chatId, `🚪 <b>LOGOUT BERHASIL</b>\n━━━━━━━━━━━━━━━━━━━━\nSesi dan token kamu telah dihapus dari sistem.`, null, env);
  }

  // Command /help
  if (text === '/help') {
    return await sendHelpMenu(chatId, userSettings.repo ? true : false, env);
  }

  // Command /start - Displays Aesthetic Guide
  if (text === '/start') {
    return await sendHelpMenu(chatId, userSettings.repo ? true : false, env);
  }

  // Command /menu - Opens Main Workspace or Repository Menu Directly
  if (text === '/menu') {
    if (!userSettings.token) {
      return await sendReply(chatId, `🔑 <b>BELUM LOGIN</b>\n━━━━━━━━━━━━━━━━━━━━\nSilakan login terlebih dahulu menggunakan format:\n<code>/login username token_github</code>\natau\n<code>/login token_github</code>`, null, env);
    }
    return userSettings.repo
      ? await sendFileMenu(chatId, userSettings.repo, userSettings.token, userSettings.current_path || "", 1, env)
      : await sendRepoMenu(chatId, userSettings.token, 1, env);
  }

  // Command /login
  if (text.startsWith('/login')) {
    const args = text.split(/\s+/);
    let username = "";
    let token = "";

    if (args.length === 2) {
      token = args[1];
    } else if (args.length >= 3) {
      username = args[1];
      token = args[2];
    } else {
      throw new Error("Format login salah.\nGunakan: /login username token_github\natau: /login token_github");
    }

    // Verify token with GitHub
    const userCheck = await fetch("https://api.github.com/user", {
      headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker' }
    });

    if (!userCheck.ok) {
      throw new Error("Token GitHub tidak valid atau telah kadaluarsa! Pastikan Personal Access Token (PAT) benar.");
    }

    const userData = await userCheck.json();
    username = userData.login;

    userSettings = { user: username, token: token, repo: null, current_path: "", state: null };
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));

    await sendReply(chatId, `✅ <b>LOGIN SUKSES!</b>\n━━━━━━━━━━━━━━━━━━━━\nSelamat datang, <b>${escapeHtml(userData.name || username)}</b> (@${escapeHtml(username)})\nToken berhasil disimpan secara aman di KV.`, null, env);
    return await sendRepoMenu(chatId, token, 1, env);
  }

  // Command /user
  if (text === '/user') {
    if (!userSettings.token) {
      return await sendReply(chatId, `🔑 <b>BELUM LOGIN</b>\nSilakan login dengan <code>/login username token</code>`, null, env);
    }
    const userRes = await fetch("https://api.github.com/user", {
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker' }
    });
    if (!userRes.ok) throw new Error("Gagal mengambil info user dari GitHub.");
    const u = await userRes.json();

    const userInfo = `👤 <b>PROFIL GITHUB</b>\n━━━━━━━━━━━━━━━━━━━━\n📛 <b>Nama:</b> ${escapeHtml(u.name || '-')}\n🪪 <b>Username:</b> <code>${escapeHtml(u.login)}</code>\n📦 <b>Public Repos:</b> ${u.public_repos}\n🔒 <b>Private Repos:</b> ${u.total_private_repos || 0}\n👥 <b>Followers:</b> ${u.followers} | <b>Following:</b> ${u.following}\n🔗 <b>Profile URL:</b> ${u.html_url}`;
    return await sendReply(chatId, userInfo, {
      inline_keyboard: [[{ text: "📂 Lihat Repository", callback_data: "goto_repomenu" }]]
    }, env);
  }

  // Handle active states (WAITING_FOR_FILE, WAITING_FOR_FILE_EDIT, WAITING_FOR_FOLDER_NAME, etc.)
  if (!userSettings.token) {
    return await sendReply(chatId, `🤖 Silakan login terlebih dahulu dengan format:\n<code>/login username token_github</code>\n\nAtau ketik <code>/start</code> untuk panduan lengkap.`, null, env);
  }

  let currentPath = userSettings.current_path ? `${userSettings.current_path}/` : "";

  // 1. UPLOAD OR EDIT FILE / PHOTO
  if (userSettings.state === 'WAITING_FOR_FILE' || userSettings.state === 'WAITING_FOR_FILE_EDIT') {
    let inputName = "";
    let b64Content = "";

    const tgToken = getToken(env);

    // CASE A: PHOTO UPLOAD
    if (message.photo && message.photo.length > 0) {
      // Pick highest resolution photo
      const photoObj = message.photo[message.photo.length - 1];
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/getFile?file_id=${photoObj.file_id}`);
      if (!res.ok) throw new Error("Gagal mengambil info foto dari Telegram.");

      const filePath = (await res.json()).result.file_path;
      const imageRes = await fetch(`https://api.telegram.org/file/bot${tgToken}/${filePath}`);
      const imageBuffer = await imageRes.arrayBuffer();
      b64Content = arrayBufferToBase64(imageBuffer);

      if (userSettings.state === 'WAITING_FOR_FILE_EDIT') {
        inputName = userSettings.target_path.split('/').pop();
      } else if (text && text.includes('.')) {
        inputName = text.trim();
      } else {
        const ext = filePath.split('.').pop() || 'jpg';
        inputName = `photo_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
      }
    }
    // CASE B: DOCUMENT FILE UPLOAD
    else if (message.document) {
      inputName = message.document.file_name;
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/getFile?file_id=${message.document.file_id}`);
      if (!res.ok) throw new Error("Gagal mengambil info file dari Telegram.");

      const filePath = (await res.json()).result.file_path;
      const fileRes = await fetch(`https://api.telegram.org/file/bot${tgToken}/${filePath}`);
      const fileBuffer = await fileRes.arrayBuffer();
      b64Content = arrayBufferToBase64(fileBuffer);
    }
    // CASE C: TEXT / SCRIPT INPUT
    else if (text) {
      if (userSettings.state === 'WAITING_FOR_FILE_EDIT') {
        inputName = userSettings.target_path.split('/').pop();
        b64Content = stringToBase64(text);
      } else {
        const spaceIndex = text.indexOf(' ');
        if (spaceIndex === -1) {
          throw new Error("Format salah!\nGunakan format: <code>namafile.js isi_script</code>\natau langsung upload file dokumen/foto.");
        }
        inputName = text.substring(0, spaceIndex).trim();
        const fileTextContent = text.substring(spaceIndex + 1).trim();
        b64Content = stringToBase64(fileTextContent);
      }
    }

    let fullPath = userSettings.state === 'WAITING_FOR_FILE_EDIT'
      ? userSettings.target_path
      : `${currentPath}${inputName}`;

    const isEdit = userSettings.state === 'WAITING_FOR_FILE_EDIT';

    if (isEdit) {
      userSettings.state = null;
      userSettings.target_path = null;
    } else {
      // Keep state active so continuous batch multi-file uploads work seamlessly!
      userSettings.state = 'WAITING_FOR_FILE';
    }
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));

    if (!inputName || !b64Content) throw new Error("Gagal membaca data file/gambar.");

    const ghUrl = `https://api.github.com/repos/${userSettings.repo}/contents/${fullPath}`;
    const check = await fetch(ghUrl, { headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker' } });
    const sha = check.ok ? (await check.json()).sha : null;

    const pushReq = await fetch(ghUrl, {
      method: 'PUT',
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "Upload item via Telegram Bot",
        content: b64Content,
        sha: sha
      })
    });

    if (!pushReq.ok) {
      const errDetail = await pushReq.json().catch(() => ({}));
      throw new Error(`API GitHub menolak upload (${pushReq.status}): ${errDetail.message || 'Error'}`);
    }

    const inlineBtn = {
      inline_keyboard: [[{ text: "✅ Selesai / Kembali ke Folder", callback_data: "goto_filemenu" }]]
    };
    return await sendReply(chatId, `✅ <b>BERHASIL UPLOAD!</b>\n━━━━━━━━━━━━━━━━━━━━\n📦 <b>File/Gambar:</b> <code>${escapeHtml(inputName)}</code>\n📍 <b>Path:</b> <code>${escapeHtml(fullPath)}</code>\n📦 <b>Repo:</b> <code>${escapeHtml(userSettings.repo)}</code>\n\n<i>Mode upload masih AKTIF. Kirim file/foto berikutnya atau klik tombol di bawah untuk selesai.</i>`, inlineBtn, env);
  }

  // 2. CREATE FOLDER
  if (userSettings.state === 'WAITING_FOR_FOLDER_NAME') {
    const folderName = text.trim().replace(/\/$/, "");
    if (!folderName) throw new Error("Nama folder tidak boleh kosong.");

    const fullPathFolder = `${currentPath}${folderName}/.gitkeep`;
    const ghUrl = `https://api.github.com/repos/${userSettings.repo}/contents/${fullPathFolder}`;

    const pushDir = await fetch(ghUrl, {
      method: 'PUT',
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Create folder ${folderName}`, content: stringToBase64("# Keep directory") })
    });

    if (!pushDir.ok) throw new Error("Gagal membuat folder di GitHub.");

    userSettings.state = null;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));
    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, userSettings.current_path || "", 1, env);
  }

  // 3. CREATE NEW REPOSITORY
  if (userSettings.state === 'WAITING_FOR_NEW_REPO_NAME') {
    const parts = text.split(/\s+/);
    const repoName = parts[0].trim();
    const isPrivate = parts.length > 1 && parts[1].toLowerCase() === 'private';

    if (!repoName) throw new Error("Nama repository tidak boleh kosong.");

    const createRepo = await fetch(`https://api.github.com/user/repos`, {
      method: 'POST',
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: repoName, private: isPrivate, auto_init: true })
    });

    if (!createRepo.ok) {
      const err = await createRepo.json().catch(() => ({}));
      throw new Error(`Gagal membuat repository (${createRepo.status}): ${err.message || 'Nama repo mungkin sudah ada.'}`);
    }

    const createdData = await createRepo.json();
    userSettings.state = null;
    userSettings.repo = createdData.full_name;
    userSettings.current_path = "";
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));

    await sendReply(chatId, `✨ <b>REPOSITORY BERHASIL DIBUAT!</b>\n━━━━━━━━━━━━━━━━━━━━\n📦 Name: <code>${escapeHtml(createdData.full_name)}</code>\n🔒 Visibility: <b>${createdData.private ? 'Private' : 'Public'}</b>`, null, env);
    return await sendFileMenu(chatId, userSettings.repo, userSettings.token, "", 1, env);
  }

  // 4. RENAME / MOVE FILE
  if (userSettings.state === 'WAITING_FOR_RENAME') {
    const oldPath = userSettings.target_path;
    const newPath = text.trim();

    if (!newPath) throw new Error("Path/nama baru tidak boleh kosong.");

    // Get old file content & SHA
    const oldCheck = await fetch(`https://api.github.com/repos/${userSettings.repo}/contents/${oldPath}`, {
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker' }
    });

    if (!oldCheck.ok) throw new Error("File lama tidak ditemukan.");
    const oldData = await oldCheck.json();

    // Create file at new location
    const createNew = await fetch(`https://api.github.com/repos/${userSettings.repo}/contents/${newPath}`, {
      method: 'PUT',
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Move/rename ${oldPath} to ${newPath}`, content: oldData.content })
    });

    if (!createNew.ok) throw new Error("Gagal membuat file di lokasi baru.");

    // Delete old file
    await fetch(`https://api.github.com/repos/${userSettings.repo}/contents/${oldPath}`, {
      method: 'DELETE',
      headers: { 'Authorization': `token ${userSettings.token}`, 'User-Agent': 'CF-Worker', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Delete old file after rename to ${newPath}`, sha: oldData.sha })
    });

    userSettings.state = null;
    userSettings.target_path = null;
    await KV.put(`user_${chatId}`, JSON.stringify(userSettings));

    return await sendReply(chatId, `✅ <b>BERHASIL RENAME/MOVE!</b>\n━━━━━━━━━━━━━━━━━━━━\n📄 <b>Lama:</b> <code>${escapeHtml(oldPath)}</code>\n📄 <b>Baru:</b> <code>${escapeHtml(newPath)}</code>`, {
      inline_keyboard: [[{ text: "🔙 Kembali ke Folder", callback_data: "goto_filemenu" }]]
    }, env);
  }

  // Fallback default message if no state match
  return await sendReply(chatId, `❓ Perintah tidak dikenali.\n\nKetik <code>/menu</code> untuk masuk menu utama, atau <code>/help</code> untuk melihat panduan lengkap.`, null, env);
}

// ================= 3. RENDER LOGIKA DAFTAR REPO =================
async function sendRepoMenu(chatId, token, page = 1, env) {
  const perPage = 5;
  const res = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated`, {
    headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker' }
  });

  if (!res.ok) throw new Error("Gagal mengambil daftar repository. Pastikan Token PAT valid.");

  let keyboard = { inline_keyboard: [] };
  const allRepos = await res.json();
  const totalRepos = allRepos.length;
  const startIndex = (page - 1) * perPage;
  const endIndex = startIndex + perPage;
  const paginatedRepos = allRepos.slice(startIndex, endIndex);

  paginatedRepos.forEach(r => {
    const visIcon = r.private ? "🔒" : "🌐";
    keyboard.inline_keyboard.push([
      { text: `${visIcon} ${r.name}`, callback_data: `setrepo:${r.full_name}` },
      { text: "ℹ️ Detail", callback_data: `repodetail:${r.full_name}` },
      { text: "🗑️ Hapus", callback_data: `confirm_del:${r.full_name}` }
    ]);
  });

  let navRow = [];
  if (page > 1) navRow.push({ text: "⬅️ Prev", callback_data: `page:${page - 1}` });
  if (endIndex < totalRepos) navRow.push({ text: "➡️ Next", callback_data: `page:${page + 1}` });
  if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);

  keyboard.inline_keyboard.push([{ text: "✨ Buat Repository Baru", callback_data: "action_createrepo" }]);
  keyboard.inline_keyboard.push([{ text: "📖 Bantuan & Panduan Prompt", callback_data: "goto_help" }]);

  const textHeader = `🚀 <b>GITHUB MANAGER BOT</b>\n━━━━━━━━━━━━━━━━━━━━\n📂 <b>Daftar Repository</b> (Hal ${page}/${Math.ceil(totalRepos / perPage) || 1})\n<i>Total: ${totalRepos} Repo | Diurutkan dari yang terbaru diubah.</i>\n\nPilih repo yang ingin dikelola:`;
  return await sendReply(chatId, textHeader, keyboard, env);
}

// ================= 4. RENDER REPO DETAIL =================
async function sendRepoDetail(chatId, repoName, token, env) {
  const res = await fetch(`https://api.github.com/repos/${repoName}`, {
    headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker' }
  });
  if (!res.ok) throw new Error("Gagal mengambil detail repository.");
  const r = await res.json();

  const toggleBtn = r.private
    ? { text: "🌐 Ubah Jadi Public", callback_data: `make_public:${r.full_name}` }
    : { text: "🔒 Ubah Jadi Private", callback_data: `make_private:${r.full_name}` };

  const detailText = `ℹ️ <b>DETAIL REPOSITORY</b>\n━━━━━━━━━━━━━━━━━━━━\n📦 <b>Nama:</b> <code>${escapeHtml(r.full_name)}</code>\n🔒 <b>Visibility:</b> ${r.private ? 'Private 🔒' : 'Public 🌐'}\n⭐ <b>Stars:</b> ${r.stargazers_count} | 🍴 <b>Forks:</b> ${r.forks_count}\n🌿 <b>Default Branch:</b> <code>${escapeHtml(r.default_branch)}</code>\n📝 <b>Deskripsi:</b> ${escapeHtml(r.description || 'Tidak ada deskripsi.')}\n📅 <b>Update Terakhir:</b> ${new Date(r.updated_at).toLocaleString('id-ID')}\n🔗 <b>URL:</b> ${r.html_url}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "📂 Kelola File & Folder", callback_data: `setrepo:${r.full_name}` }],
      [toggleBtn],
      [{ text: "🗑️ Hapus Repository", callback_data: `confirm_del:${r.full_name}` }],
      [{ text: "🔙 Kembali ke Daftar Repo", callback_data: "goto_repomenu" }]
    ]
  };

  return await sendReply(chatId, detailText, keyboard, env);
}

// ================= 5. RENDER DAFTAR FILE & FOLDER DINAMIS =================
async function sendFileMenu(chatId, repoName, token, path = "", page = 1, env) {
  const perPage = 6;
  const cleanPath = path ? `${path}` : "";
  const res = await fetch(`https://api.github.com/repos/${repoName}/contents/${cleanPath}`, {
    headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker' }
  });

  if (!res.ok && res.status !== 404) throw new Error(`Gagal membaca isi repository (${res.status}).`);

  let keyboard = { inline_keyboard: [] };
  let currentListText = "";

  if (cleanPath) {
    keyboard.inline_keyboard.push([{ text: "⬅️ Kembali (Up Folder)", callback_data: "back_dir" }]);
  }

  if (res.ok) {
    let items = await res.json();
    if (!Array.isArray(items)) items = [items];

    // Sort: directories first, then files
    items.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'dir' ? -1 : 1;
    });

    const totalItems = items.length;
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedItems = items.slice(startIndex, endIndex);

    paginatedItems.forEach(item => {
      if (item.type === 'dir') {
        currentListText += ` ├ 📁 <b>${escapeHtml(item.name)}</b>\n`;
        keyboard.inline_keyboard.push([
          { text: `📁 Buka [${item.name}]`, callback_data: `open_dir:${item.path}` },
          { text: `🗑️ Hapus Folder`, callback_data: `delfile:${item.path}` }
        ]);
      } else if (item.type === 'file') {
        if (item.name === '.gitkeep') return;
        currentListText += ` ├ 📄 <code>${escapeHtml(item.name)}</code>\n`;
        keyboard.inline_keyboard.push([
          { text: `📄 ${item.name}`, callback_data: `viewfile:${item.path}` }
        ]);
        keyboard.inline_keyboard.push([
          { text: `✏️ Edit`, callback_data: `editfile:${item.path}` },
          { text: `🔤 Rename`, callback_data: `renamefile:${item.path}` },
          { text: `🗑️ Hapus`, callback_data: `delfile:${item.path}` }
        ]);
      }
    });

    let navRow = [];
    if (page > 1) navRow.push({ text: "⬅️ Prev", callback_data: `filepage:${page - 1}:${cleanPath}` });
    if (endIndex < totalItems) navRow.push({ text: "➡️ Next", callback_data: `filepage:${page + 1}:${cleanPath}` });
    if (navRow.length > 0) keyboard.inline_keyboard.push(navRow);
  }

  if (!currentListText) currentListText = " <i>( Folder ini kosong )</i>\n";

  keyboard.inline_keyboard.push([
    { text: "➕ Upload File / Foto", callback_data: "menu_tambah_global" },
    { text: "📁 Buat Folder", callback_data: "menu_buat_folder" }
  ]);
  keyboard.inline_keyboard.push([
    { text: "🔙 Ke Daftar Repo", callback_data: "goto_repomenu" },
    { text: "📖 Bantuan & Prompt", callback_data: "goto_help" }
  ]);

  const displayPath = cleanPath ? `/${cleanPath}` : "/ (Root)";
  const textHeader = `🛠️ <b>WORKSPACE MANAGER</b>\n━━━━━━━━━━━━━━━━━━━━\n📦 <b>Repo:</b> <code>${escapeHtml(repoName)}</code>\n📍 <b>Path:</b> <code>${escapeHtml(displayPath)}</code>\n━━━━━━━━━━━━━━━━━━━━\n<b>Isi Direktori:</b>\n${currentListText}\n<i>Klik nama file/folder untuk membuka item:</i>`;
  return await sendReply(chatId, textHeader, keyboard, env);
}

// ================= 6. RENDER VIEW FILE =================
async function sendViewFile(chatId, repoName, token, filePath, env) {
  const res = await fetch(`https://api.github.com/repos/${repoName}/contents/${filePath}`, {
    headers: { 'Authorization': `token ${token}`, 'User-Agent': 'CF-Worker' }
  });
  if (!res.ok) throw new Error("Gagal mengambil data file.");
  const data = await res.json();

  let contentFormatted = "";
  const isImage = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i.test(filePath);

  if (isImage) {
    contentFormatted = `🖼️ <i>Ini adalah file gambar/media (${data.size} bytes). Klik tombol '📥 Download File' di bawah untuk mengunduhnya.</i>`;
  } else {
    try {
      const content = base64ToString(data.content);
      if (content.length > 3500) {
        contentFormatted = `<i>Isi file terlalu panjang untuk ditampilkan (${content.length} karakter). Gunakan tombol '📥 Download File' di bawah ini.</i>`;
      } else {
        contentFormatted = `<pre>${escapeHtml(content)}</pre>`;
      }
    } catch {
      contentFormatted = `<i>Format binary / file tidak dapat dibaca sebagai teks biasa.</i>`;
    }
  }

  const text = `📄 <b>LIHAT FILE</b>\n━━━━━━━━━━━━━━━━━━━━\n📦 <b>Repo:</b> <code>${escapeHtml(repoName)}</code>\n📄 <b>Path:</b> <code>${escapeHtml(filePath)}</code>\n📏 <b>Ukuran:</b> ${data.size} bytes\n━━━━━━━━━━━━━━━━━━━━\n${contentFormatted}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✏️ Edit File", callback_data: `editfile:${filePath}` },
        { text: "📥 Download File", callback_data: `dlfile:${filePath}` }
      ],
      [
        { text: "🔤 Rename / Move", callback_data: `renamefile:${filePath}` },
        { text: "🗑️ Hapus File", callback_data: `delfile:${filePath}` }
      ],
      [{ text: "🔙 Kembali ke Folder", callback_data: "goto_filemenu" }]
    ]
  };

  return await sendReply(chatId, text, keyboard, env);
}

// ================= 7. RENDER AESTHETIC HELP MENU =================
async function sendHelpMenu(chatId, hasRepoSelected, env) {
  const helpText = `✨ <b>PANDUAN & BANTUAN BOT GITHUB</b> ✨\n━━━━━━━━━━━━━━━━━━━━\n<i>Kelola repository, file, folder, dan gambar GitHub kamu secara instan dan estetik dari Telegram!</i>\n\n📌 <b>DAFTAR PERINTAH (PROMPT) UTAMA:</b>\n\n⚡ <b>/menu</b> — Langsung buka Workspace / Repo\n🚀 <b>/start</b> — Buka panduan bantuan ini\n🔑 <b>/login</b> — Masuk dengan Personal Access Token\n<code>    👉 Format: /login username token_github</code>\n<code>    👉 Format: /login token_github</code>\n👤 <b>/user</b> — Cek profil & statistik akun GitHub\n📖 <b>/help</b> — Tampilkan halaman panduan ini\n❌ <b>/cancel</b> — Batalkan aksi aktif (upload/rename)\n🚪 <b>/logout</b> — Hapus sesi login dari bot\n\n━━━━━━━━━━━━━━━━━━━━\n⚙️ <b>PENGATURAN ENV & KV CLOUDFLARE WORKER:</b>\n• <b>KV Binding:</b> Atur KV Binding bernama <code>SAWIT</code> atau <code>GH_DATA</code> di Cloudflare Dashboard (Settings -> Variables -> KV Namespace Bindings).\n• <b>Environment Variable:</b> Set variable <code>TG_TOKEN</code> dengan token bot Telegram kamu.\n\n━━━━━━━━━━━━━━━━━━━━\n🗑️ <b>HAPUS FOLDER REKURSIF:</b>\nKlik tombol <b>🗑️ Hapus Folder</b> pada folder di menu workspace. Bot akan secara otomatis menghapus seluruh isi file di dalam folder tersebut sampai bersih!\n\n━━━━━━━━━━━━━━━━━━━━\n📤 <b>CARA UPLOAD BANYAK FILE SEKALIGUS:</b>\n1️⃣ Pilih repo & folder target via <b>/menu</b>.\n2️⃣ Klik tombol <b>➕ Upload File / Foto</b>.\n3️⃣ Kirim 1 atau banyak file/foto sekaligus ke chat.\n4️⃣ Bot akan mengunggah semua file satu per satu!\n5️⃣ Klik tombol <b>✅ Selesai / Kembali ke Folder</b> jika sudah selesai.\n\n━━━━━━━━━━━━━━━━━━━━\n🌐 <b>CARA MENGUBAH REPO PRIVATE KE PUBLIC:</b>\n1️⃣ Buka <b>/menu</b> lalu klik tombol <b>ℹ️ Detail</b>.\n2️⃣ Klik tombol <b>🌐 Ubah Jadi Public</b> atau <b>🔒 Ubah Jadi Private</b>.\n\n━━━━━━━━━━━━━━━━━━━━\n📄 <b>PANDUAN UPLOAD FILE SCRIPT / TEKS:</b>\n• <b>Dokumen:</b> Upload file <code>.js</code>, <code>.html</code>, <code>.json</code> dll.\n• <b>Pesan Teks Manual:</b> Ketik dengan format:\n<code>index.js console.log("Hello World");</code>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🚀 Masuk Ke Menu Utama", callback_data: hasRepoSelected ? "goto_filemenu" : "goto_repomenu" }]
    ]
  };

  return await sendReply(chatId, helpText, keyboard, env);
}

// ================= 8. UTILITY FUNCTIONS =================
async function sendReply(chatId, text, replyMarkup = null, env) {
  const token = getToken(env);
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: replyMarkup, disable_web_page_preview: true })
  });
  return await res.json();
}

async function editReply(chatId, messageId, text, replyMarkup = null, env) {
  const token = getToken(env);
  const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: replyMarkup, disable_web_page_preview: true })
  });
  return await res.json();
}

async function sendDocumentBuffer(chatId, textContent, fileName, env) {
  const token = getToken(env);
  const formData = new FormData();
  formData.append('chat_id', chatId);
  const blob = new Blob([textContent], { type: 'text/plain' });
  formData.append('document', blob, fileName);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: formData });
}

async function answerCallback(callbackId, text = "", alert = false, env) {
  const token = getToken(env);
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: alert })
  }).catch(() => {});
}

async function deleteMessage(chatId, messageId, env) {
  const token = getToken(env);
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).catch(() => {});
}
