#!/bin/bash

# =============================================================
# GLOBAL TUNNELING NUSANTARA (GTN)
# Project: Ultimate Aria2 + AriaNg + File Browser (Interactive)
# =============================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

clear
echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}      GTN ULTIMATE RE-INSTALLER (ESTETIK)          ${NC}"
echo -e "${CYAN}====================================================${NC}"

# --- INPUT INTERAKTIF ---
echo -e "${YELLOW}>>> Konfigurasi Branding:${NC}"
read -p "Nama Brand Web (Judul): " WEB_TITLE
WEB_TITLE=${WEB_TITLE:-GTN Downloader}

echo -e "\n${YELLOW}>>> Konfigurasi Akses:${NC}"
read -p "Username Login: " USER_NAME
USER_NAME=${USER_NAME:-admin}

read -p "Password Login: " USER_PASS
USER_PASS=${USER_PASS:-gtn-mantap}

read -p "RPC Secret Token: " RPC_SECRET
RPC_SECRET=${RPC_SECRET:-gtn-secret-token}

echo -e "\n${YELLOW}>>> Konfigurasi Domain:${NC}"
read -p "Domain Utama (GTN Downloader) (Kosongkan jika hanya pakai IP): " MY_DOMAIN
read -p "Subdomain CasaOS (Opsional, misal: os.domain.com): " CASA_DOMAIN

# --- EKSEKUSI ---
set -e
echo -e "\n${GREEN}Memulai proses instalasi ulang...${NC}"

# --- FIX: FORCE DNS (Cegah Error Resolution GitHub) ---
echo "nameserver 8.8.8.8" > /etc/resolv.conf

# --- FIX: BERSIHKAN SERVICE LAMA ---
systemctl stop aria2 nginx filebrowser casaos-gateway casaos 2>/dev/null || true
rm -f /var/run/nginx.pid

# --- FIX: KONFIGURASI PORT CASAOS (Hindari Konflik dengan Nginx Port 80) ---
# Jalankan ini di awal agar Nginx bisa memakai Port 80 untuk SSL
if [ -f /etc/casaos/gateway.ini ]; then
    echo -e "${YELLOW}Mengubah Port CasaOS ke 81 untuk menghindari konflik...${NC}"
    sed -i 's/^port=.*/port=81/' /etc/casaos/gateway.ini
    sed -i 's/^port =.*/port = 81/' /etc/casaos/gateway.ini
    # Jangan restart dulu, biar mati
fi

# 1. Update & Dependencies
apt update && apt install -y wget curl unzip tar aria2 nginx apache2-utils certbot python3-certbot-nginx python3-pip psmisc

# --- FIX: DEPENDENCY CONFLICT (urllib3) ---
# Hapus library python yang mungkin bentrok dengan Certbot bawaan APT
if [ -f /usr/local/lib/python3.8/dist-packages/urllib3/__init__.py ]; then
    echo -e "${YELLOW}Memperbaiki konflik dependency Python (urllib3)...${NC}"
    pip3 uninstall -y urllib3 requests chardet idna || true
    apt install --reinstall -y python3-urllib3 python3-requests python3-certbot-nginx python3-six
fi

# 2. Setup Direktori
DOWNLOAD_DIR="/downloads"
WEB_DIR="/var/www/ariang"
mkdir -p /etc/aria2 "$DOWNLOAD_DIR" "$WEB_DIR"

# --- FIX: WAJIB BUAT SESSION AGAR TIDAK FAILED ---
touch /etc/aria2/aria2.session
chmod 666 /etc/aria2/aria2.session
chmod 777 "$DOWNLOAD_DIR"

# 3. Config Aria2 Engine (Turbo Mode)
cat > /etc/aria2/aria2.conf <<EOF
dir=$DOWNLOAD_DIR
continue=true
always-resume=true
input-file=/etc/aria2/aria2.session
save-session=/etc/aria2/aria2.session
save-session-interval=60
enable-rpc=true
rpc-secret=$RPC_SECRET
rpc-listen-all=true
rpc-allow-origin-all=true
rpc-listen-port=6800
max-connection-per-server=16
split=16
min-split-size=1M
disk-cache=64M
file-allocation=falloc
EOF

# Systemd Aria2
cat > /etc/systemd/system/aria2.service <<EOF
[Unit]
Description=Aria2 RPC Daemon
After=network.target
[Service]
ExecStart=/usr/bin/aria2c --conf-path=/etc/aria2/aria2.conf
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload && systemctl enable aria2 && systemctl restart aria2

# 4. Install File Browser (Manager File Estetik)
curl -fsSL https://raw.githubusercontent.com/filebrowser/get/master/get.sh | bash
rm -f /etc/filebrowser.db
filebrowser -d /etc/filebrowser.db config init
filebrowser -d /etc/filebrowser.db config set --address 0.0.0.0 --port 8080 --root "$DOWNLOAD_DIR" --baseurl /files
# --- FIX: BYPASS PASSWORD PENDEK ---
filebrowser -d /etc/filebrowser.db users add "$USER_NAME" "TEMPPASSWORD123" --perm.admin
filebrowser -d /etc/filebrowser.db users update "$USER_NAME" --password "$USER_PASS"

cat > /etc/systemd/system/filebrowser.service <<EOF
[Unit]
Description=File Browser
After=network.target
[Service]
ExecStart=/usr/local/bin/filebrowser -d /etc/filebrowser.db
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload && systemctl enable filebrowser && systemctl restart filebrowser

# 5. Install AriaNg UI
ARIANG_VER=$(curl -s https://api.github.com/repos/mayswind/AriaNg/releases/latest | grep tag_name | cut -d '"' -f 4)
ARIANG_VER=${ARIANG_VER:-1.3.13}
wget -O /tmp/ariang.zip https://github.com/mayswind/AriaNg/releases/download/${ARIANG_VER}/AriaNg-${ARIANG_VER}.zip
unzip -o /tmp/ariang.zip -d "$WEB_DIR"
sed -i "s/AriaNg/$WEB_TITLE/g" "$WEB_DIR/index.html"

# 6. Setup Nginx Proxy (URUTAN DIPERBAIKI: Share Link diletakkan paling atas)
htpasswd -bc /etc/nginx/.htpasswd "$USER_NAME" "$USER_PASS"

cat > /etc/nginx/sites-available/ariang <<EOF
server {
    listen 80;
    server_name ${MY_DOMAIN:-_};

    # --- JALUR SHARE LINK PUBLIK (URUTAN PERTAMA AGAR BYPASS LOGIN) ---
    location ~ ^/files/(share|api/public|static) {
        auth_basic off;
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # AriaNg UI (dilindungi)
    location / {
        root $WEB_DIR;
        index index.html;
        auth_basic "$WEB_TITLE Login";
        auth_basic_user_file /etc/nginx/.htpasswd;
    }

    # RPC Aria2 (auth basic dimatikan agar tetap Connected)
    location /jsonrpc {
        auth_basic off;
        proxy_pass http://127.0.0.1:6800/jsonrpc;
        proxy_set_header Host \$host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # File Browser Dashboard (dilindungi)
    location /files/ {
        # auth_basic "$WEB_TITLE Login";
        # auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:8080/files/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# --- BLOK SERVER UNTUK CASAOS (SUBDOMAIN) ---
EOF

if [ -n "$CASA_DOMAIN" ]; then
cat >> /etc/nginx/sites-available/ariang <<EOF

server {
    listen 80;
    server_name $CASA_DOMAIN;

    client_max_body_size 0;

    location / {
        proxy_pass http://127.0.0.1:81;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Websocket Support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
fi

ln -sf /etc/nginx/sites-available/ariang /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 7. Setup SSL (No Email)
# Cek config nginx sebelum restart agar tidak gagal
echo -e "${GREEN}Memeriksa konfigurasi Nginx...${NC}"
nginx -t || { echo -e "${RED}Konfigurasi Nginx Error!${NC}"; exit 1; }

# --- FIX: FORCE KILL PORT 80/443 (Jaga-jaga ada process bandel) ---
echo -e "${YELLOW}Memastikan Port 80 & 443 Kosong...${NC}"
fuser -k 80/tcp || true
fuser -k 443/tcp || true

if [ -n "$MY_DOMAIN" ]; then
    echo -e "${GREEN}Mengajukan SSL untuk $MY_DOMAIN...${NC}"

    # Coba restart nginx dengan debug jika gagal
    if ! systemctl restart nginx; then
        echo -e "${RED}Gagal memulai Nginx! Cek log dibawah:${NC}"
        echo -e "${YELLOW}--- systemctl status nginx ---${NC}"
        systemctl status nginx --no-pager
        echo -e "${YELLOW}--- journalctl -xe ---${NC}"
        journalctl -xe --no-pager | tail -n 50
        exit 1
    fi

    certbot --nginx -d "$MY_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
    FINAL_URL="https://$MY_DOMAIN"
else
    FINAL_URL="http://$(curl -s ifconfig.me)"
fi

if [ -n "$CASA_DOMAIN" ]; then
    echo -e "${GREEN}Mengajukan SSL untuk CasaOS ($CASA_DOMAIN)...${NC}"
    certbot --nginx -d "$CASA_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email
    CASA_URL="https://$CASA_DOMAIN"
else
    CASA_URL="http://$(curl -s ifconfig.me):81"
fi
systemctl restart nginx || true

# 8. Install CasaOS (Opsional tapi Requested)
echo -e "${GREEN}Menginstall CasaOS...${NC}"
if ! command -v casaos &> /dev/null; then
    curl -fsSL https://get.casaos.io | sudo bash
else
    echo "CasaOS sudah terinstall."
fi

# --- FIX: KONFIGURASI ULANG PORT CASAOS (Jaga-jaga setelah install baru) ---
if [ -f /etc/casaos/gateway.ini ]; then
    sed -i 's/^port=.*/port=81/' /etc/casaos/gateway.ini
    sed -i 's/^port =.*/port = 81/' /etc/casaos/gateway.ini
    systemctl restart casaos-gateway || systemctl restart casaos
fi

# --- FIX: HUBUNGKAN FOLDER DOWNLOAD KE CASAOS ---
mkdir -p /DATA/Downloads
mount --bind "$DOWNLOAD_DIR" /DATA/Downloads || true
# Agar permanen setelah reboot
if ! grep -q "$DOWNLOAD_DIR /DATA/Downloads" /etc/fstab; then
    echo "$DOWNLOAD_DIR /DATA/Downloads none bind 0 0" >> /etc/fstab
fi

# --- FIX: BUAT SHORTCUT GTN DI CASAOS (Via File App Store Manual) ---
# Tidak ada cara resmi via CLI untuk add shortcut external app di CasaOS saat ini tanpa API token.
# Kita akan memberikan instruksi manual di akhir.

clear
echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}    GTN ULTIMATE INSTALLATION COMPLETED!           ${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "${YELLOW}Nama Brand     :${NC} $WEB_TITLE"
echo -e "${YELLOW}URL Utama      :${NC} $FINAL_URL"
echo -e "${YELLOW}File Manager   :${NC} $FINAL_URL/files/"
echo -e "${YELLOW}CasaOS Panel   :${NC} $CASA_URL"
echo -e "${YELLOW}Username       :${NC} $USER_NAME"
echo -e "${YELLOW}Password       :${NC} $USER_PASS"
echo -e "${YELLOW}RPC Secret     :${NC} $RPC_SECRET"
echo -e "${RED}PENTING (AGAR CONNECTED):${NC}"
echo -e "Di Menu AriaNg Settings > RPC:"
echo -e "1. Aria2 RPC Address: $MY_DOMAIN (atau IP VPS)"
echo -e "2. Aria2 RPC Port: 443 (GANTI DARI 6800 KE 443)"
echo -e "3. Aria2 RPC Protocol: WebSocket (Secure)"
echo -e "${CYAN}====================================================${NC}"
echo -e "${GREEN}✓ Share link publik: AKTIF TANPA LOGIN${NC}"
echo -e "${GREEN}✓ Dashboard: AMAN TERKUNCI${NC}"
echo -e "${GREEN}✓ CasaOS: TERINSTALL${NC}"
echo -e "${GREEN}✓ Folder Download: Terhubung ke /DATA/Downloads di CasaOS${NC}"
echo -e "${CYAN}====================================================${NC}"
echo -e "${YELLOW}TIPS: Untuk Menambahkan Shortcut GTN di CasaOS:${NC}"
echo -e "1. Buka Dashboard CasaOS"
echo -e "2. Klik tombol '+' > 'External Link'"
echo -e "3. Masukkan URL: $FINAL_URL"
echo -e "4. Masukkan Nama: $WEB_TITLE"
echo -e "${CYAN}====================================================${NC}"
