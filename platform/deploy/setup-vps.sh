#!/usr/bin/env bash
# One-time preparation of a Hostinger VPS (Ubuntu 22.04/24.04). Run as root:
#   DOMAIN=kometa.example.com EMAIL=you@example.com REPO=https://github.com/<you>/Mybusiness.git bash setup-vps.sh
set -euo pipefail
: "${DOMAIN:?Set DOMAIN}"; : "${EMAIL:?Set EMAIL (for the TLS certificate)}"; : "${REPO:?Set REPO (git clone URL)}"
BRANCH=${BRANCH:-main}

apt-get update
apt-get install -y curl git nginx certbot python3-certbot-nginx ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
npm install -g pm2

id kometa >/dev/null 2>&1 || useradd -m -s /bin/bash kometa
if [ ! -d /home/kometa/app ]; then
  sudo -u kometa git clone --branch "$BRANCH" "$REPO" /home/kometa/app
fi

sed "s/__DOMAIN__/$DOMAIN/g" /home/kometa/app/platform/deploy/nginx-kometa.conf > /etc/nginx/sites-available/kometa
ln -sf /etc/nginx/sites-available/kometa /etc/nginx/sites-enabled/kometa
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect -n

pm2 startup systemd -u kometa --hp /home/kometa | tail -1 | bash || true
echo
echo "Now create /home/kometa/app/platform/.env.production (see deploy/env.production.example)"
echo "then run as user kometa:  bash /home/kometa/app/platform/deploy/deploy.sh"
