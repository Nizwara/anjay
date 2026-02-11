#!/bin/bash
# Script Auto Install RDP (Windows) di VPS
# Metode: DD (Disk Dump)
# Wrapper by Jules
# Source Logic: Based on community scripts (MoeClub/bin456789)

# Warna
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Cek Root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: Script ini harus dijalankan sebagai root!${NC}"
   exit 1
fi

# Install Dependencies
echo -e "${BLUE}[*] Menginstall dependencies...${NC}"
apt-get update -y
apt-get install -y wget curl ca-certificates util-linux gawk sed grep xz-utils openssl
if [ $? -ne 0 ]; then
    yum install -y wget curl ca-certificates util-linux gawk sed grep xz openssl
fi

clear

# Banner
echo -e "${YELLOW}==========================================================${NC}"
echo -e "${YELLOW}       AUTO INSTALL RDP (WINDOWS) DI VPS (DD METHOD)      ${NC}"
echo -e "${YELLOW}==========================================================${NC}"
echo -e "${RED}PERINGATAN: SCRIPT INI AKAN MENGHAPUS SEMUA DATA DI VPS!${NC}"
echo -e "${RED}WARNING: THIS SCRIPT WILL WIPE ALL DATA ON THE VPS!${NC}"
echo -e "${YELLOW}==========================================================${NC}"
echo ""

# Menu Pilihan OS
echo -e "${GREEN}Pilih Versi Windows yang ingin diinstall:${NC}"
echo -e "${GREEN}Select Windows Version to install:${NC}"
echo ""
echo -e "[1] Windows 10 Enterprise LTSC 2021 (English)"
echo -e "[2] Windows 11 Pro (English)"
echo -e "[3] Windows Server 2012 R2 (English)"
echo -e "[4] Windows Server 2016 (English)"
echo -e "[5] Windows Server 2019 (English)"
echo -e "[6] Windows Server 2022 (English)"
echo -e "[7] Custom Image URL (Masukan Link ISO/GZ Sendiri)"
echo ""
read -p "Masukan Pilihan (1-7): " choice

# Define Image URLs (Menggunakan mirror public yang umum digunakan - credit to bin456789/teddysun)
# Note: Link ini bisa berubah sewaktu-waktu. Jika mati, gunakan Custom URL.
WIN10="https://dl.lamp.sh/vhd/en-us_win10_ltsc_2021.vhd.gz"
WIN11="https://dl.lamp.sh/vhd/en-us_win11_22h2.vhd.gz"
WIN2012="https://dl.lamp.sh/vhd/en-us_win2012r2.vhd.gz"
WIN2016="https://dl.lamp.sh/vhd/en-us_win2016.vhd.gz"
WIN2019="https://dl.lamp.sh/vhd/en-us_win2019.vhd.gz"
WIN2022="https://dl.lamp.sh/vhd/en-us_win2022.vhd.gz"

IMAGE_URL=""

case $choice in
    1) IMAGE_URL="$WIN10"; OS_NAME="Windows 10 Enterprise LTSC 2021" ;;
    2) IMAGE_URL="$WIN11"; OS_NAME="Windows 11 Pro" ;;
    3) IMAGE_URL="$WIN2012"; OS_NAME="Windows Server 2012 R2" ;;
    4) IMAGE_URL="$WIN2016"; OS_NAME="Windows Server 2016" ;;
    5) IMAGE_URL="$WIN2019"; OS_NAME="Windows Server 2019" ;;
    6) IMAGE_URL="$WIN2022"; OS_NAME="Windows Server 2022" ;;
    7)
        read -p "Masukan Direct Link Image (GZ/XZ/RAW): " custom_url
        IMAGE_URL="$custom_url"
        OS_NAME="Custom Image"
        ;;
    *) echo -e "${RED}Pilihan tidak valid!${NC}"; exit 1 ;;
esac

echo ""
echo -e "${BLUE}[*] OS Terpilih: $OS_NAME${NC}"
echo -e "${BLUE}[*] Image URL: $IMAGE_URL${NC}"
echo ""

# Konfirmasi
read -p "Apakah anda yakin ingin melanjutkan? (y/n): " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo -e "${RED}Dibatalkan.${NC}"
    exit 0
fi

# Download Helper Script (reinstall.sh by bin456789 is robust)
# Kita gunakan script ini karena dia handle network config secara otomatis
echo ""
echo -e "${BLUE}[*] Mendownload script installer...${NC}"
wget --no-check-certificate -qO reinstall.sh "https://raw.githubusercontent.com/bin456789/reinstall/main/reinstall.sh"

if [ ! -f "reinstall.sh" ]; then
    echo -e "${RED}Gagal mendownload script installer! Cek koneksi internet.${NC}"
    exit 1
fi

chmod +x reinstall.sh

# Eksekusi
echo ""
echo -e "${GREEN}Mulai Installasi... VPS akan restart otomatis.${NC}"
echo -e "${GREEN}Starting Installation... VPS will reboot automatically.${NC}"
echo -e "${YELLOW}Proses installasi memakan waktu 10-30 menit tergantung kecepatan VPS/Internet.${NC}"
echo -e "${YELLOW}Default Password biasanya: Teddysun.com atau P@ssw0rd atau Changeme (Tergantung Image)${NC}"
echo -e "${YELLOW}Jika menggunakan image di atas (dl.lamp.sh), password default: Teddysun.com${NC}"
echo ""

# Run the reinstall script with the DD option
# Syntax: bash reinstall.sh -dd "IMAGE_URL"
bash reinstall.sh -dd "$IMAGE_URL"
