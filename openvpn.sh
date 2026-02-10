#!/bin/bash
#
# https://github.com/Nyr/openvpn-install
#
# Copyright (c) 2013 Nyr. Released under the MIT License.
# ────────────────────────────────────────────────────────────────
#   GTN OpenVPN Installer ─ Vertical Aesthetic Edition
#   Author: Deki Niswara | GLOBAL TUNNELING NUSANTARA
# ────────────────────────────────────────────────────────────────

# Color Definitions
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

# Detect Debian users running the script with "sh" instead of bash
if readlink /proc/$$/exe | grep -q "dash"; then
	echo -e "${RED}This installer needs to be run with 'bash', not 'sh'.${NC}"
	exit
fi

# Discard stdin. Needed when running from a one-liner which includes a newline
read -N 999999 -t 0.001

# Detect OS
# $os_version variables aren't always in use, but are kept here for convenience
if grep -qs "ubuntu" /etc/os-release; then
	os="ubuntu"
	os_version=$(grep 'VERSION_ID' /etc/os-release | cut -d '"' -f 2 | tr -d '.')
	group_name="nogroup"
elif [[ -e /etc/debian_version ]]; then
	os="debian"
	os_version=$(grep -oE '[0-9]+' /etc/debian_version | head -1)
	group_name="nogroup"
elif [[ -e /etc/almalinux-release || -e /etc/rocky-release || -e /etc/centos-release ]]; then
	os="centos"
	os_version=$(grep -shoE '[0-9]+' /etc/almalinux-release /etc/rocky-release /etc/centos-release | head -1)
	group_name="nobody"
elif [[ -e /etc/fedora-release ]]; then
	os="fedora"
	os_version=$(grep -oE '[0-9]+' /etc/fedora-release | head -1)
	group_name="nobody"
else
	echo "This installer seems to be running on an unsupported distribution.
Supported distros are Ubuntu, Debian, AlmaLinux, Rocky Linux, CentOS and Fedora."
	exit
fi

if [[ "$os" == "ubuntu" && "$os_version" -lt 2004 ]]; then
	echo "Ubuntu 20.04 or higher is required to use this installer.
This version of Ubuntu is too old and unsupported."
	# exit
fi

if [[ "$os" == "debian" ]]; then
	if grep -q '/sid' /etc/debian_version; then
		echo "Debian Testing and Debian Unstable are unsupported by this installer."
		# exit
	fi
	if [[ "$os_version" -lt 11 ]]; then
		echo "Debian 11 or higher is required to use this installer.
This version of Debian is too old and unsupported."
		# exit
	fi
fi

if [[ "$os" == "centos" && "$os_version" -lt 9 ]]; then
	os_name=$(sed 's/ release.*//' /etc/almalinux-release /etc/rocky-release /etc/centos-release 2>/dev/null | head -1)
	echo "$os_name 9 or higher is required to use this installer.
This version of $os_name is too old and unsupported."
	# exit
fi

# Detect environments where $PATH does not include the sbin directories
if ! grep -q sbin <<< "$PATH"; then
	echo '$PATH does not include sbin. Try using "su -" instead of "su".'
	exit
fi

if [[ "$EUID" -ne 0 ]]; then
	echo "This installer needs to be run with superuser privileges."
	exit
fi

if [[ ! -e /dev/net/tun ]] || ! ( exec 7<>/dev/net/tun ) 2>/dev/null; then
	echo "The system does not have the TUN device available.
TUN needs to be enabled before running this installer."
	exit
fi

# Store the absolute path of the directory where the script is located
script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Function to install and configure Nginx
function install_nginx_setup() {
	if ! hash nginx 2>/dev/null; then
		if [[ "$os" = "debian" || "$os" = "ubuntu" ]]; then
			apt-get update
			apt-get install -y nginx python3-certbot-nginx certbot
		elif [[ "$os" = "centos" ]]; then
			dnf install -y nginx python3-certbot-nginx certbot
		else
			dnf install -y nginx python3-certbot-nginx certbot
		fi
	fi

	# Configure Nginx
	if [[ -d /etc/nginx/sites-available ]]; then
		# Debian/Ubuntu
		if [[ ! -f /etc/nginx/sites-available/openvpn ]]; then
			echo "server {
	listen 81;
	listen [::]:81;
	server_name $domain;
	root /var/www/html;
	index index.html index.htm index.nginx-debian.html;

	location / {
		try_files \$uri \$uri/ =404;
	}
}" > /etc/nginx/sites-available/openvpn
			ln -s /etc/nginx/sites-available/openvpn /etc/nginx/sites-enabled/
			rm -f /etc/nginx/sites-enabled/default
		fi
	elif [[ -d /etc/nginx/conf.d ]]; then
		# CentOS/Fedora
		if [[ ! -f /etc/nginx/conf.d/openvpn.conf ]]; then
			echo "server {
	listen 81;
	listen [::]:81;
	server_name $domain;
	root /usr/share/nginx/html;
	index index.html index.htm;

	location / {
		try_files \$uri \$uri/ =404;
	}
}" > /etc/nginx/conf.d/openvpn.conf
		fi
	fi

	# Open ports 80 and 81
	if systemctl is-active --quiet firewalld.service; then
		firewall-cmd --add-port=80/tcp
		firewall-cmd --add-port=81/tcp
		firewall-cmd --permanent --add-port=80/tcp
		firewall-cmd --permanent --add-port=81/tcp
	else
		iptables_path=$(command -v iptables)
		# Check if rule exists before adding
		if ! $iptables_path -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null; then
			$iptables_path -I INPUT -p tcp --dport 80 -j ACCEPT
		fi
		if ! $iptables_path -C INPUT -p tcp --dport 81 -j ACCEPT 2>/dev/null; then
			$iptables_path -I INPUT -p tcp --dport 81 -j ACCEPT
		fi
	fi

	systemctl enable --now nginx
	systemctl restart nginx
}

# Load configuration variables from sc contoh context
# These files are assumed to exist based on the user's environment
[[ -f /root/.isp ]] && izp=$(cat /root/.isp)
[[ -f /root/.region ]] && region=$(cat /root/.region)
[[ -f /root/.city ]] && city=$(cat /root/.city)
[[ -f /etc/xray/domain ]] && domain=$(cat /etc/xray/domain)
if [ -f /etc/xray/domssh ]; then
	domargo=$(cat /etc/xray/domssh)
	domain=$domssh
fi

# Date calculation
dateFromServer=$(curl -v --insecure --silent https://google.com/ 2>&1 | grep Date | sed -e 's/< Date: //')
biji=$(date +"%Y-%m-%d" -d "$dateFromServer")

if [[ ! -e /etc/openvpn/server/server.conf ]]; then
	# Detect some Debian minimal setups where neither wget nor curl are installed
	if ! hash wget 2>/dev/null && ! hash curl 2>/dev/null; then
		echo "Wget is required to use this installer."
		read -n1 -r -p "Press any key to install Wget and continue..."
		apt-get update
		apt-get install -y wget
	fi
	clear
	echo -e "${CYAN}  ╔════════════════════════════════════════════════════╗${NC}"
	echo -e "${CYAN}  ║${NC}  ${MAGENTA}${BOLD}            GTN OpenVPN Road Warrior              ${NC}${CYAN}║${NC}"
	echo -e "${CYAN}  ║${NC}  ${MAGENTA}${BOLD}               INSTALLER v2026                    ${NC}${CYAN}║${NC}"
	echo -e "${CYAN}  ╚════════════════════════════════════════════════════╝${NC}"
	echo -e "  ${YELLOW}Author: Deki Niswara | GLOBAL TUNNELING NUSANTARA${NC}\n"

	# If system has a single IPv4, it is selected automatically. Else, ask the user
	if [[ $(ip -4 addr | grep inet | grep -vEc '127(\.[0-9]{1,3}){3}') -eq 1 ]]; then
		ip=$(ip -4 addr | grep inet | grep -vE '127(\.[0-9]{1,3}){3}' | cut -d '/' -f 1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}')
	else
		number_of_ip=$(ip -4 addr | grep inet | grep -vEc '127(\.[0-9]{1,3}){3}')
		echo -e "${CYAN}Which IPv4 address should be used?${NC}"
		ip -4 addr | grep inet | grep -vE '127(\.[0-9]{1,3}){3}' | cut -d '/' -f 1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | nl -s ') '
		read -p "  → IPv4 address [1]: " ip_number
		until [[ -z "$ip_number" || "$ip_number" =~ ^[0-9]+$ && "$ip_number" -le "$number_of_ip" ]]; do
			echo "$ip_number: invalid selection."
			read -p "  → IPv4 address [1]: " ip_number
		done
		[[ -z "$ip_number" ]] && ip_number="1"
		ip=$(ip -4 addr | grep inet | grep -vE '127(\.[0-9]{1,3}){3}' | cut -d '/' -f 1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | sed -n "$ip_number"p)
	fi
	# If $ip is a private IP address, the server must be behind NAT
	if echo "$ip" | grep -qE '^(10\.|172\.1[6789]\.|172\.2[0-9]\.|172\.3[01]\.|192\.168)'; then
		echo -e "\n${YELLOW}This server is behind NAT. What is the public IPv4 address or hostname?${NC}"
		# Get public IP and sanitize with grep
		get_public_ip=$(grep -m 1 -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' <<< "$(wget -T 10 -t 1 -4qO- "http://ip1.dynupdate.no-ip.com/" || curl -m 10 -4Ls "http://ip1.dynupdate.no-ip.com/")")
		read -p "  → Public IPv4 address / hostname [$get_public_ip]: " public_ip
		# If the checkip service is unavailable and user didn't provide input, ask again
		until [[ -n "$get_public_ip" || -n "$public_ip" ]]; do
			echo "Invalid input."
			read -p "  → Public IPv4 address / hostname: " public_ip
		done
		[[ -z "$public_ip" ]] && public_ip="$get_public_ip"
	fi
	# If system has a single IPv6, it is selected automatically
	if [[ $(ip -6 addr | grep -c 'inet6 [23]') -eq 1 ]]; then
		ip6=$(ip -6 addr | grep 'inet6 [23]' | cut -d '/' -f 1 | grep -oE '([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}')
	fi
	# If system has multiple IPv6, ask the user to select one
	if [[ $(ip -6 addr | grep -c 'inet6 [23]') -gt 1 ]]; then
		number_of_ip6=$(ip -6 addr | grep -c 'inet6 [23]')
		echo -e "\n${CYAN}Which IPv6 address should be used?${NC}"
		ip -6 addr | grep 'inet6 [23]' | cut -d '/' -f 1 | grep -oE '([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}' | nl -s ') '
		read -p "  → IPv6 address [1]: " ip6_number
		until [[ -z "$ip6_number" || "$ip6_number" =~ ^[0-9]+$ && "$ip6_number" -le "$number_of_ip6" ]]; do
			echo "$ip6_number: invalid selection."
			read -p "  → IPv6 address [1]: " ip6_number
		done
		[[ -z "$ip6_number" ]] && ip6_number="1"
		ip6=$(ip -6 addr | grep 'inet6 [23]' | cut -d '/' -f 1 | grep -oE '([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}' | sed -n "$ip6_number"p)
	fi

	# Protocol
	echo -e "\n${MAGENTA}┌──────────────────────────────────────────────┐${NC}"
	echo -e "${MAGENTA}│${NC}              ${BOLD}Protocol Selection${NC}              ${MAGENTA}│${NC}"
	echo -e "${MAGENTA}└──────────────────────────────────────────────┘${NC}"
	echo "   1) UDP (recommended)"
	echo "   2) TCP"
	read -p "  → Protocol [1]: " protocol
	until [[ -z "$protocol" || "$protocol" =~ ^[12]$ ]]; do
		echo "$protocol: invalid selection."
		read -p "  → Protocol [1]: " protocol
	done
	case "$protocol" in
		1|"")
		protocol=udp
		;;
		2)
		protocol=tcp
		;;
	esac

	# Port
	echo -e "\n${MAGENTA}┌──────────────────────────────────────────────┐${NC}"
	echo -e "${MAGENTA}│${NC}                 ${BOLD}Server Port${NC}                   ${MAGENTA}│${NC}"
	echo -e "${MAGENTA}└──────────────────────────────────────────────┘${NC}"
	read -p "  → Port [1194]: " port
	until [[ -z "$port" || "$port" =~ ^[0-9]+$ && "$port" -le 65535 ]]; do
		echo "$port: invalid port."
		read -p "  → Port [1194]: " port
	done
	[[ -z "$port" ]] && port="1194"

	# DNS
	echo -e "\n${MAGENTA}┌──────────────────────────────────────────────┐${NC}"
	echo -e "${MAGENTA}│${NC}               ${BOLD}DNS Resolver${NC}                   ${MAGENTA}│${NC}"
	echo -e "${MAGENTA}└──────────────────────────────────────────────┘${NC}"
	echo "   1) Default system resolvers"
	echo "   2) Google"
	echo "   3) 1.1.1.1"
	echo "   4) OpenDNS"
	echo "   5) Quad9"
	echo "   6) Gcore"
	echo "   7) AdGuard"
	echo "   8) Specify custom resolvers"
	read -p "  → DNS server [1]: " dns
	until [[ -z "$dns" || "$dns" =~ ^[1-8]$ ]]; do
		echo "$dns: invalid selection."
		read -p "  → DNS server [1]: " dns
	done
	# If the user selected custom resolvers, we deal with that here
	if [[ "$dns" = "8" ]]; then
		echo
		until [[ -n "$custom_dns" ]]; do
			echo "Enter DNS servers (one or more IPv4 addresses, separated by commas or spaces):"
			read -p "  → DNS servers: " dns_input
			# Convert comma delimited to space delimited
			dns_input=$(echo "$dns_input" | tr ',' ' ')
			# Validate and build custom DNS IP list
			for dns_ip in $dns_input; do
				if [[ "$dns_ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
					if [[ -z "$custom_dns" ]]; then
						custom_dns="$dns_ip"
					else
						custom_dns="$custom_dns $dns_ip"
					fi
				fi
			done
			if [ -z "$custom_dns" ]; then
				echo "Invalid input."
			fi
		done
	fi

	# Client Name
	clear
	echo -e "\e[33m═══════════════════════════════════\033[0m"
	echo -e "\E[40;1;37m      ❖ SSH VPN Account ❖          \E[0m"
	echo -e "\e[33m═══════════════════════════════════\033[0m"
	read -p "➯ Username     : " Login
	read -p "➯ Password     : " Pass
	read -p "➯ Limit IP     : " iplimit
	read -p "➯ Masa Aktif   : " masaaktif
	echo -e "\e[33m═══════════════════════════════════\033[0m"
	clear

	unsanitized_client="$Login"
	# Allow a limited set of characters to avoid conflicts
	client=$(sed 's/[^0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-]/_/g' <<< "$unsanitized_client")
	[[ -z "$client" ]] && client="client"

	echo -e "\n${CYAN}OpenVPN installation is ready to begin.${NC}"
	# Install a firewall if firewalld or iptables are not already available
	if ! systemctl is-active --quiet firewalld.service && ! hash iptables 2>/dev/null; then
		if [[ "$os" == "centos" || "$os" == "fedora" ]]; then
			firewall="firewalld"
			echo "firewalld, which is required to manage routing tables, will also be installed."
		elif [[ "$os" == "debian" || "$os" == "ubuntu" ]]; then
			firewall="iptables"
		fi
	fi

	# Open port 80 and 81 for Nginx/Certbot
	# Moved to install_nginx_setup function

	read -n1 -r -p "Press any key to continue..."

	# If running inside a container, disable LimitNPROC to prevent conflicts
	if systemd-detect-virt -cq; then
		mkdir /etc/systemd/system/openvpn-server@server.service.d/ 2>/dev/null
		echo "[Service]
LimitNPROC=infinity" > /etc/systemd/system/openvpn-server@server.service.d/disable-limitnproc.conf
	fi
	if [[ "$os" = "debian" || "$os" = "ubuntu" ]]; then
		apt-get update
		apt-get install -y --no-install-recommends openvpn openssl ca-certificates $firewall
	elif [[ "$os" = "centos" ]]; then
		dnf install -y epel-release
		dnf install -y openvpn openssl ca-certificates tar $firewall
	else
		# Else, OS must be Fedora
		dnf install -y openvpn openssl ca-certificates tar $firewall
	fi

	# Install and Setup Nginx
	install_nginx_setup
	# If firewalld was just installed, enable it
	if [[ "$firewall" == "firewalld" ]]; then
		systemctl enable --now firewalld.service
	fi
	# Get easy-rsa
	easy_rsa_url='https://github.com/OpenVPN/easy-rsa/releases/download/v3.2.5/EasyRSA-3.2.5.tgz'
	mkdir -p /etc/openvpn/server/easy-rsa/
	{ wget -qO- "$easy_rsa_url" 2>/dev/null || curl -sL "$easy_rsa_url" ; } | tar xz -C /etc/openvpn/server/easy-rsa/ --strip-components 1
	chown -R root:root /etc/openvpn/server/easy-rsa/
	cd /etc/openvpn/server/easy-rsa/
	# Create the PKI, set up the CA and create TLS key
	./easyrsa --batch init-pki
	./easyrsa --batch build-ca nopass
	./easyrsa gen-tls-crypt-key
	if [ ! -f pki/private/easyrsa-tls.key ]; then
		# Fallback for OpenVPN 2.4 / EasyRSA issues
		openvpn --genkey --secret pki/private/easyrsa-tls.key
	fi
	# Create the DH parameters file using the predefined ffdhe2048 group
	echo '-----BEGIN DH PARAMETERS-----
MIIBCAKCAQEA//////////+t+FRYortKmq/cViAnPTzx2LnFg84tNpWp4TZBFGQz
+8yTnc4kmz75fS/jY2MMddj2gbICrsRhetPfHtXV/WVhJDP1H18GbtCFY2VVPe0a
87VXE15/V8k1mE8McODmi3fipona8+/och3xWKE2rec1MKzKT0g6eXq8CrGCsyT7
YdEIqUuyyOP7uWrat2DX9GgdT0Kj3jlN9K5W7edjcrsZCwenyO4KbXCeAvzhzffi
7MA0BM0oNC9hkXL+nOmFg/+OTxIy7vKBg8P+OxtMb61zO7X8vC7CIAXFjvGDfRaD
ssbzSibBsu/6iGtCOGEoXJf//////////wIBAg==
-----END DH PARAMETERS-----' > /etc/openvpn/server/dh.pem
	# Make easy-rsa aware of our external DH file (prevents a warning)
	ln -s /etc/openvpn/server/dh.pem pki/dh.pem
	# Create certificates and CRL
	./easyrsa --batch --days=3650 build-server-full server nopass
	./easyrsa --batch --days=3650 build-client-full "$client" nopass
	./easyrsa --batch --days=3650 gen-crl
	# Move the stuff we need
	cp pki/ca.crt pki/private/ca.key pki/issued/server.crt pki/private/server.key pki/crl.pem /etc/openvpn/server
	cp pki/private/easyrsa-tls.key /etc/openvpn/server/tc.key
	# CRL is read with each client connection, while OpenVPN is dropped to nobody
	chown nobody:"$group_name" /etc/openvpn/server/crl.pem
	# Without +x in the directory, OpenVPN can't run a stat() on the CRL file
	chmod o+x /etc/openvpn/server/
	# Generate server.conf
	echo "local $ip
port $port
proto $protocol
dev tun
ca ca.crt
cert server.crt
key server.key
dh dh.pem
auth SHA512
tls-crypt tc.key
topology subnet
server 10.8.0.0 255.255.255.0" > /etc/openvpn/server/server.conf
	# IPv6
	if [[ -z "$ip6" ]]; then
		echo 'push "redirect-gateway def1 bypass-dhcp"' >> /etc/openvpn/server/server.conf
	else
		echo 'server-ipv6 fddd:1194:1194:1194::/64' >> /etc/openvpn/server/server.conf
		echo 'push "redirect-gateway def1 ipv6 bypass-dhcp"' >> /etc/openvpn/server/server.conf
	fi
	echo 'ifconfig-pool-persist ipp.txt' >> /etc/openvpn/server/server.conf
	# DNS
	case "$dns" in
		1|"")
			if grep '^nameserver' "/etc/resolv.conf" | grep -qv '127.0.0.53' ; then
				resolv_conf="/etc/resolv.conf"
			else
				resolv_conf="/run/systemd/resolve/resolv.conf"
			fi
			grep -v '^#\|^;' "$resolv_conf" | grep '^nameserver' | grep -v '127.0.0.53' | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | while read line; do
				echo "push \"dhcp-option DNS $line\"" >> /etc/openvpn/server/server.conf
			done
		;;
		2)
			echo 'push "dhcp-option DNS 8.8.8.8"' >> /etc/openvpn/server/server.conf
			echo 'push "dhcp-option DNS 8.8.4.4"' >> /etc/openvpn/server/server.conf
		;;
		3)
			echo 'push "dhcp-option DNS 1.1.1.1"' >> /etc/openvpn/server/server.conf
			echo 'push "dhcp-option DNS 1.0.0.1"' >> /etc/openvpn/server/server.conf
		;;
		4)
			echo 'push "dhcp-option DNS 208.67.222.222"' >> /etc/openvpn/server/server.conf
			echo 'push "dhcp-option DNS 208.67.220.220"' >> /etc/openvpn/server/server.conf
		;;
		5)
			echo 'push "dhcp-option DNS 9.9.9.9"' >> /etc/openvpn/server/server.conf
			echo 'push "dhcp-option DNS 149.112.112.112"' >> /etc/openvpn/server/server.conf
		;;
		6)
			echo 'push "dhcp-option DNS 95.85.95.85"' >> /etc/openvpn/server/server.conf
			echo 'push "dhcp-option DNS 2.56.220.2"' >> /etc/openvpn/server/server.conf
		;;
		7)
			echo 'push "dhcp-option DNS 94.140.14.14"' >> /etc/openvpn/server/server.conf
			echo 'push "dhcp-option DNS 94.140.15.15"' >> /etc/openvpn/server/server.conf
		;;
		8)
		for dns_ip in $custom_dns; do
			echo "push \"dhcp-option DNS $dns_ip\"" >> /etc/openvpn/server/server.conf
		done
		;;
	esac
	echo 'push "block-outside-dns"' >> /etc/openvpn/server/server.conf
	echo "keepalive 10 120
user nobody
group $group_name
persist-key
persist-tun
verb 3
crl-verify crl.pem" >> /etc/openvpn/server/server.conf
	if [[ "$protocol" = "udp" ]]; then
		echo "explicit-exit-notify" >> /etc/openvpn/server/server.conf
	fi
	# Enable net.ipv4.ip_forward for the system
	echo 'net.ipv4.ip_forward=1' > /etc/sysctl.d/99-openvpn-forward.conf
	# Enable without waiting for a reboot or service restart
	echo 1 > /proc/sys/net/ipv4/ip_forward
	if [[ -n "$ip6" ]]; then
		# Enable net.ipv6.conf.all.forwarding for the system
		echo "net.ipv6.conf.all.forwarding=1" >> /etc/sysctl.d/99-openvpn-forward.conf
		# Enable without waiting for a reboot or service restart
		echo 1 > /proc/sys/net/ipv6/conf/all/forwarding
	fi
	if systemctl is-active --quiet firewalld.service; then
		firewall-cmd --add-port="$port"/"$protocol"
		firewall-cmd --zone=trusted --add-source=10.8.0.0/24
		firewall-cmd --permanent --add-port="$port"/"$protocol"
		firewall-cmd --permanent --zone=trusted --add-source=10.8.0.0/24
		# Set NAT for the VPN subnet
		firewall-cmd --direct --add-rule ipv4 nat POSTROUTING 0 -s 10.8.0.0/24 ! -d 10.8.0.0/24 -j SNAT --to "$ip"
		firewall-cmd --permanent --direct --add-rule ipv4 nat POSTROUTING 0 -s 10.8.0.0/24 ! -d 10.8.0.0/24 -j SNAT --to "$ip"
		if [[ -n "$ip6" ]]; then
			firewall-cmd --zone=trusted --add-source=fddd:1194:1194:1194::/64
			firewall-cmd --permanent --zone=trusted --add-source=fddd:1194:1194:1194::/64
			firewall-cmd --direct --add-rule ipv6 nat POSTROUTING 0 -s fddd:1194:1194:1194::/64 ! -d fddd:1194:1194:1194::/64 -j SNAT --to "$ip6"
			firewall-cmd --permanent --direct --add-rule ipv6 nat POSTROUTING 0 -s fddd:1194:1194:1194::/64 ! -d fddd:1194:1194:1194::/64 -j SNAT --to "$ip6"
		fi
	else
		# Create a service to set up persistent iptables rules
		iptables_path=$(command -v iptables)
		ip6tables_path=$(command -v ip6tables)
		# nf_tables is not available as standard in OVZ kernels. So use iptables-legacy
		if [[ $(systemd-detect-virt) == "openvz" ]] && readlink -f "$(command -v iptables)" | grep -q "nft" && hash iptables-legacy 2>/dev/null; then
			iptables_path=$(command -v iptables-legacy)
			ip6tables_path=$(command -v ip6tables-legacy)
		fi
		echo "[Unit]
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=$iptables_path -w 5 -t nat -A POSTROUTING -s 10.8.0.0/24 ! -d 10.8.0.0/24 -j SNAT --to $ip
ExecStart=$iptables_path -w 5 -I INPUT -p $protocol --dport $port -j ACCEPT
ExecStart=$iptables_path -w 5 -I FORWARD -s 10.8.0.0/24 -j ACCEPT
ExecStart=$iptables_path -w 5 -I FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
ExecStart=$iptables_path -w 5 -I INPUT -p tcp --dport 80 -j ACCEPT
ExecStart=$iptables_path -w 5 -I INPUT -p tcp --dport 81 -j ACCEPT
ExecStop=$iptables_path -w 5 -t nat -D POSTROUTING -s 10.8.0.0/24 ! -d 10.8.0.0/24 -j SNAT --to $ip
ExecStop=$iptables_path -w 5 -D INPUT -p $protocol --dport $port -j ACCEPT
ExecStop=$iptables_path -w 5 -D FORWARD -s 10.8.0.0/24 -j ACCEPT
ExecStop=$iptables_path -w 5 -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT" > /etc/systemd/system/openvpn-iptables.service
		if [[ -n "$ip6" ]]; then
			echo "ExecStart=$ip6tables_path -w 5 -t nat -A POSTROUTING -s fddd:1194:1194:1194::/64 ! -d fddd:1194:1194:1194::/64 -j SNAT --to $ip6
ExecStart=$ip6tables_path -w 5 -I FORWARD -s fddd:1194:1194:1194::/64 -j ACCEPT
ExecStart=$ip6tables_path -w 5 -I FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT
ExecStop=$ip6tables_path -w 5 -t nat -D POSTROUTING -s fddd:1194:1194:1194::/64 ! -d fddd:1194:1194:1194::/64 -j SNAT --to $ip6
ExecStop=$ip6tables_path -w 5 -D FORWARD -s fddd:1194:1194:1194::/64 -j ACCEPT
ExecStop=$ip6tables_path -w 5 -D FORWARD -m state --state RELATED,ESTABLISHED -j ACCEPT" >> /etc/systemd/system/openvpn-iptables.service
		fi
		echo "RemainAfterExit=yes
[Install]
WantedBy=multi-user.target" >> /etc/systemd/system/openvpn-iptables.service
		systemctl enable --now openvpn-iptables.service
	fi
	# If SELinux is enabled and a custom port was selected, we need this
	if sestatus 2>/dev/null | grep "Current mode" | grep -q "enforcing" && [[ "$port" != 1194 ]]; then
		if ! hash semanage 2>/dev/null; then
				dnf install -y policycoreutils-python-utils
		fi
		semanage port -a -t openvpn_port_t -p "$protocol" "$port"
	fi
	# If the server is behind NAT, use the correct IP address
	[[ -n "$public_ip" ]] && ip="$public_ip"
	# client-common.txt is created so we have a template to add further users later
	echo "client
dev tun
proto $protocol
remote $ip $port
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth SHA512
ignore-unknown-option block-outside-dns
verb 3" > /etc/openvpn/server/client-common.txt
	systemctl enable --now openvpn-server@server.service
	grep -vh '^#' /etc/openvpn/server/client-common.txt /etc/openvpn/server/easy-rsa/pki/inline/private/"$client".inline > "$script_dir"/"$client".ovpn

	# Nginx configuration moved to install_nginx_setup function

	# Attempt to obtain SSL certificate if domain is valid and not an IP
	if [[ "$domain" != "$ip" && ! "$domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		# Stop nginx momentarily to free port 80 if needed, though certbot --nginx should handle it.
		# However, if port 80 is used by another service, certbot might fail.
		# We'll use --nginx plugin which should be safe.
		certbot --nginx -d $domain --non-interactive --agree-tos --register-unsafely-without-email --redirect
	fi

	# IP Limit Logic
	mkdir -p /etc/openvpn/limit/
	if [[ $iplimit -gt 0 ]]; then
		echo -e "$iplimit" > /etc/openvpn/limit/$client
	fi

	# Create system user for expiration management
	useradd -e $(date -d "$masaaktif days" +"%Y-%m-%d") -s /bin/false -M $client
	echo -e "$Pass\n$Pass\n" | passwd $client &> /dev/null
	echo "$client:$Pass" | chpasswd

	# Calculate expiration date for display
	exp_date=$(date -d "$masaaktif days" +"%Y-%m-%d")

	# Fallback if domain is missing
	if [[ -z "$domain" ]]; then
		domain="$ip"
	fi

	# Copy config to web server directory if it exists
	if [[ -d /var/www/html ]]; then
		cp "$script_dir/$client.ovpn" "/var/www/html/$client.ovpn"
		chmod 644 "/var/www/html/$client.ovpn"
	fi

	clear
	TEKS="
════════════════════════
  ❖ OPENVPN PREMIUM ❖
════════════════════════
Host         : $domain
Username     : $client
Password     : $Pass
Port OVPN    : $port
════════════════════════
Config OVPN  : http://$domain:81/$client.ovpn
════════════════════════
Expired On   : $exp_date
════════════════════════
By: GLOBAL TUNNELING NUSANTARA"

	clear
	echo -e "$TEKS"
	echo -e "\nThe client configuration is available in: ${BOLD}$script_dir/$client.ovpn${NC}"
else
	# Ensure Nginx is setup even if running in management mode
	install_nginx_setup

	# Load domain from existing config if not already set (e.g. if script run again)
	if [[ -z "$domain" || "$domain" == "$ip" ]]; then
		# Try to get it from openvpn config
		config_domain=$(grep '^remote ' /etc/openvpn/server/client-common.txt | awk '{print $2}' | head -1)
		[[ -n "$config_domain" ]] && domain="$config_domain"
	fi

	# Fallback to public IP if domain is still empty
	if [[ -z "$domain" ]]; then
		# Detect public IPv4 address
		domain=$(grep -m 1 -oE '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' <<< "$(wget -T 10 -t 1 -4qO- "http://ip1.dynupdate.no-ip.com/" || curl -m 10 -4Ls "http://ip1.dynupdate.no-ip.com/")")
	fi

	# Final fallback if external check fails: get local IP
	if [[ -z "$domain" ]]; then
		domain=$(ip -4 addr | grep inet | grep -vE '127(\.[0-9]{1,3}){3}' | cut -d '/' -f 1 | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | head -1)
	fi

	clear
	echo -e "${CYAN}  ╔════════════════════════════════════════════════════╗${NC}"
	echo -e "${CYAN}  ║${NC}  ${MAGENTA}${BOLD}            GTN OpenVPN Management                ${NC}${CYAN}║${NC}"
	echo -e "${CYAN}  ╚════════════════════════════════════════════════════╝${NC}\n"
	echo "Select an option:"
	echo "   1) Add a new client"
	echo "   2) Revoke an existing client"
	echo "   3) Remove OpenVPN"
	echo "   4) Exit"
	read -p "  → Option [1-4]: " option
	until [[ "$option" =~ ^[1-4]$ ]]; do
		echo "$option: invalid selection."
		read -p "  → Option [1-4]: " option
	done
	case "$option" in
		1)
			clear
			echo -e "\e[33m═══════════════════════════════════\033[0m"
			echo -e "\E[40;1;37m      ❖ SSH VPN Account ❖          \E[0m"
			echo -e "\e[33m═══════════════════════════════════\033[0m"
			read -p "➯ Username     : " Login
			read -p "➯ Password     : " Pass
			read -p "➯ Limit IP     : " iplimit
			read -p "➯ Masa Aktif   : " masaaktif
			echo -e "\e[33m═══════════════════════════════════\033[0m"
			clear

			unsanitized_client="$Login"
			client=$(sed 's/[^0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-]/_/g' <<< "$unsanitized_client")
			while [[ -z "$client" || -e /etc/openvpn/server/easy-rsa/pki/issued/"$client".crt ]]; do
				echo "$client: invalid name or already exists."
				read -p "➯ Username     : " unsanitized_client
				client=$(sed 's/[^0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-]/_/g' <<< "$unsanitized_client")
			done

			# IP Limit Logic
			mkdir -p /etc/openvpn/limit/
			if [[ $iplimit -gt 0 ]]; then
				echo -e "$iplimit" > /etc/openvpn/limit/$client
			fi

			# Create system user for expiration management
			useradd -e $(date -d "$masaaktif days" +"%Y-%m-%d") -s /bin/false -M $client
			echo -e "$Pass\n$Pass\n" | passwd $client &> /dev/null
			echo "$client:$Pass" | chpasswd

			# Calculate expiration date for display
			exp_date=$(date -d "$masaaktif days" +"%Y-%m-%d")

			# Get port and protocol from server config if variables are empty
			if [[ -z "$port" || -z "$protocol" ]]; then
				port=$(grep '^port ' /etc/openvpn/server/server.conf | awk '{print $2}')
				protocol=$(grep '^proto ' /etc/openvpn/server/server.conf | awk '{print $2}')
			fi

			# Copy config to web server directory if it exists
			if [[ -d /var/www/html ]]; then
				cp "$script_dir/$client.ovpn" "/var/www/html/$client.ovpn"
				chmod 644 "/var/www/html/$client.ovpn"
			fi

			clear
			TEKS="
════════════════════════
  ❖ OPENVPN PREMIUM ❖
════════════════════════
Host         : $domain
Username     : $client
Password     : $Pass
Port OVPN    : $port
════════════════════════
Config OVPN  : http://$domain:81/$client.ovpn
════════════════════════
Expired On   : $exp_date
════════════════════════
By: GLOBAL TUNNELING NUSANTARA"

			clear
			echo -e "$TEKS"
			echo -e "\nThe client configuration is available in: ${BOLD}$script_dir/$client.ovpn${NC}"
			exit
		;;
		2)
			number_of_clients=$(tail -n +2 /etc/openvpn/server/easy-rsa/pki/index.txt | grep -c "^V")
			if [[ "$number_of_clients" = 0 ]]; then
				echo -e "\n${RED}There are no existing clients!${NC}"
				exit
			fi
			echo
			echo "Select the client to revoke:"
			tail -n +2 /etc/openvpn/server/easy-rsa/pki/index.txt | grep "^V" | cut -d '=' -f 2 | nl -s ') '
			read -p "  → Client: " client_number
			until [[ "$client_number" =~ ^[0-9]+$ && "$client_number" -le "$number_of_clients" ]]; do
				echo "$client_number: invalid selection."
				read -p "  → Client: " client_number
			done
			client=$(tail -n +2 /etc/openvpn/server/easy-rsa/pki/index.txt | grep "^V" | cut -d '=' -f 2 | sed -n "$client_number"p)
			echo
			read -p "Confirm $client revocation? [y/N]: " revoke
			until [[ "$revoke" =~ ^[yYnN]*$ ]]; do
				echo "$revoke: invalid selection."
				read -p "Confirm $client revocation? [y/N]: " revoke
			done
			if [[ "$revoke" =~ ^[yY]$ ]]; then
				cd /etc/openvpn/server/easy-rsa/
				./easyrsa --batch revoke "$client"
				./easyrsa --batch --days=3650 gen-crl
				rm -f /etc/openvpn/server/crl.pem
				rm -f /etc/openvpn/server/easy-rsa/pki/reqs/"$client".req
				rm -f /etc/openvpn/server/easy-rsa/pki/private/"$client".key
				cp /etc/openvpn/server/easy-rsa/pki/crl.pem /etc/openvpn/server/crl.pem
				chown nobody:"$group_name" /etc/openvpn/server/crl.pem
				echo -e "\n${RED}$client revoked!${NC}"
			else
				echo -e "\n$client revocation aborted!"
			fi
			exit
		;;
		3)
			echo
			read -p "Confirm OpenVPN removal? [y/N]: " remove
			until [[ "$remove" =~ ^[yYnN]*$ ]]; do
				echo "$remove: invalid selection."
				read -p "Confirm OpenVPN removal? [y/N]: " remove
			done
			if [[ "$remove" =~ ^[yY]$ ]]; then
				port=$(grep '^port ' /etc/openvpn/server/server.conf | cut -d " " -f 2)
				protocol=$(grep '^proto ' /etc/openvpn/server/server.conf | cut -d " " -f 2)
				if systemctl is-active --quiet firewalld.service; then
					ip=$(firewall-cmd --direct --get-rules ipv4 nat POSTROUTING | grep '\-s 10.8.0.0/24 '"'"'!'"'"' -d 10.8.0.0/24' | grep -oE '[^ ]+$')
					firewall-cmd --remove-port="$port"/"$protocol"
					firewall-cmd --zone=trusted --remove-source=10.8.0.0/24
					firewall-cmd --permanent --remove-port="$port"/"$protocol"
					firewall-cmd --permanent --zone=trusted --remove-source=10.8.0.0/24
					firewall-cmd --direct --remove-rule ipv4 nat POSTROUTING 0 -s 10.8.0.0/24 ! -d 10.8.0.0/24 -j SNAT --to "$ip"
					firewall-cmd --permanent --direct --remove-rule ipv4 nat POSTROUTING 0 -s 10.8.0.0/24 ! -d 10.8.0.0/24 -j SNAT --to "$ip"
					if grep -qs "server-ipv6" /etc/openvpn/server/server.conf; then
						ip6=$(firewall-cmd --direct --get-rules ipv6 nat POSTROUTING | grep '\-s fddd:1194:1194:1194::/64 '"'"'!'"'"' -d fddd:1194:1194:1194::/64' | grep -oE '[^ ]+$')
						firewall-cmd --zone=trusted --remove-source=fddd:1194:1194:1194::/64
						firewall-cmd --permanent --zone=trusted --remove-source=fddd:1194:1194:1194::/64
						firewall-cmd --direct --remove-rule ipv6 nat POSTROUTING 0 -s fddd:1194:1194:1194::/64 ! -d fddd:1194:1194:1194::/64 -j SNAT --to "$ip6"
						firewall-cmd --permanent --direct --remove-rule ipv6 nat POSTROUTING 0 -s fddd:1194:1194:1194::/64 ! -d fddd:1194:1194:1194::/64 -j SNAT --to "$ip6"
					fi
				else
					systemctl disable --now openvpn-iptables.service
					rm -f /etc/systemd/system/openvpn-iptables.service
				fi
				if sestatus 2>/dev/null | grep "Current mode" | grep -q "enforcing" && [[ "$port" != 1194 ]]; then
					semanage port -d -t openvpn_port_t -p "$protocol" "$port"
				fi
				systemctl disable --now openvpn-server@server.service
				rm -f /etc/systemd/system/openvpn-server@server.service.d/disable-limitnproc.conf
				rm -f /etc/sysctl.d/99-openvpn-forward.conf
				if [[ "$os" = "debian" || "$os" = "ubuntu" ]]; then
					rm -rf /etc/openvpn/server
					apt-get remove --purge -y openvpn
				else
					dnf remove -y openvpn
					rm -rf /etc/openvpn/server
				fi
				echo -e "\n${RED}OpenVPN removed!${NC}"
			else
				echo -e "\nOpenVPN removal aborted!"
			fi
			exit
		;;
		4)
			exit
		;;
	esac
fi