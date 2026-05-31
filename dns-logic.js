// --- DNS MANAGEMENT CODE START ---
function manageDNS(zoneId, domainName) {
  openModal(`DNS Records - ${domainName}`, `
    <div id="dns-management-container">
      <div style="text-align:center; padding: 20px;"><div class="spinner"></div><p>Memuat DNS Records...</p></div>
    </div>
  `, `<button class="btn btn-secondary" onclick="closeModal()">Tutup</button>`);

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
    container.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><h4>Error: ${err.message}</h4></div>`;
  }
}

function renderDNSRecords(records, zoneId, domainName) {
  const container = document.getElementById('dns-management-container');
  if (!container) return;

  let html = `
    <div style="margin-bottom: 15px;">
       <button class="btn btn-success btn-sm" style="padding: 8px 12px; font-size: 0.8rem; border-radius: 6px;" onclick="showAddDNSForm('${zoneId}', '${domainName}')"><i class="fas fa-plus"></i> Tambah Record</button>
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
            <button class="btn btn-primary btn-sm" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 6px;" onclick="addDNSRecord('${zoneId}', '${domainName}')">Simpan</button>
        </div>
    </div>
    <div style="max-height: 400px; overflow-y: auto;">
  `;

  if (records.length === 0) {
    html += `<div class="empty-state"><i class="fas fa-dns"></i><h4>Tidak ada DNS Record</h4></div>`;
  } else {
    html += `<table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; color: var(--text-primary);">
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
    `;

    records.forEach(r => {
      html += `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 8px; font-weight: bold;">${r.type}</td>
          <td style="padding: 8px;">${r.name}</td>
          <td style="padding: 8px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.content}">${r.content}</td>
          <td style="padding: 8px;">
             ${r.proxied ? '<i class="fas fa-cloud" style="color:var(--accent-color);" title="Proxied"></i>' : '<i class="fas fa-cloud" style="color:var(--text-secondary);" title="DNS Only"></i>'}
          </td>
          <td style="padding: 8px;">
            <button class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.7rem; border-radius: 6px;" onclick="deleteDNSRecord('${zoneId}', '${r.id}', '${domainName}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
  }

  html += `</div>`;
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
