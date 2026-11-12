#!/bin/bash
# First-boot setup for the computers WireGuard gateway (Amazon Linux 2023).
# index.ts substitutes the __PLACEHOLDERS__; the private key is never in here,
# it is read from SSM Parameter Store at boot.
set -euo pipefail

REGION="__REGION__"
PRIVATE_KEY_PARAMETER="__PRIVATE_KEY_PARAMETER__"

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
