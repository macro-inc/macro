#!/bin/bash
# First-boot setup for the computers WireGuard gateway (Amazon Linux 2023).
# index.ts substitutes the __PLACEHOLDERS__; the private key is never in here,
# it is read from SSM Parameter Store at boot.
set -euo pipefail

REGION="__REGION__"
PRIVATE_KEY_PARAMETER="__PRIVATE_KEY_PARAMETER__"

# dnf's metadata alone outgrows a t4g.nano's 512 MiB; without swap the
# OOM killer stops the install.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  echo '/swapfile none swap defaults 0 0' >> /etc/fstab
fi
swapon -a

dnf install -y wireguard-tools nftables

cat > /etc/sysctl.d/90-wireguard-gateway.conf <<'SYSCTL'
net.ipv4.ip_forward = 1
SYSCTL
sysctl --system

umask 077
mkdir -p /etc/wireguard
PRIVATE_KEY="$(aws ssm get-parameter --region "$REGION" \
  --name "$PRIVATE_KEY_PARAMETER" --with-decryption \
  --query Parameter.Value --output text)"

cat > /etc/wireguard/wg0.conf <<WG
[Interface]
Address = __GATEWAY_ADDRESS__
# Matches runtime-dev-1's wg0.
MTU = 1400
PrivateKey = ${PRIVATE_KEY}
PostUp = nft -f /etc/wireguard/wg0.nft
PostDown = nft delete table ip wireguard_gateway

[Peer]
# runtime-dev-1. The gateway initiates; the host has no endpoint for it.
PublicKey = __PEER_PUBLIC_KEY__
Endpoint = __PEER_ENDPOINT__
AllowedIPs = __PEER_ALLOWED_IPS__
PersistentKeepalive = 25
WG
unset PRIVATE_KEY

# Forward only the Incus API, and masquerade so the host sees only the
# gateway's tunnel address.
cat > /etc/wireguard/wg0.nft <<'NFT'
table ip wireguard_gateway {
  chain forward {
    type filter hook forward priority 0; policy drop;
    # Clamp the MSS so harness connections fit the tunnel's MTU.
    oifname "wg0" tcp flags syn tcp option maxseg size set rt mtu
    ct state established,related accept
    oifname "wg0" ip daddr __INCUS_ADDRESS__ tcp dport __INCUS_PORT__ accept
  }
  chain postrouting {
    type nat hook postrouting priority 100;
    oifname "wg0" masquerade
  }
}
NFT

systemctl enable --now wg-quick@wg0
