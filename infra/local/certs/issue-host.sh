#!/usr/bin/env bash
# Issue a machine certificate without replacing the development CA.
set -euo pipefail
certs_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_dir="${1:?output directory required}"
host="${2:?hostname required}"
if [[ ! "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]; then
  echo "Invalid development hostname: $host" >&2
  exit 1
fi
mkdir -p "$output_dir"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out "$output_dir/server-key.pem"
openssl req -new -key "$output_dir/server-key.pem" \
  -out "$output_dir/server.csr" -subj "/CN=$host"
openssl x509 -req -in "$output_dir/server.csr" \
  -CA "$certs_dir/ca.pem" -CAkey "$certs_dir/ca-key.pem" \
  -set_serial "0x$(openssl rand -hex 16)" -days 365 \
  -out "$output_dir/server-leaf.pem" \
  -extfile <(printf '%s\n' \
    "subjectAltName=DNS:localhost,DNS:*.localhost,DNS:$host,IP:127.0.0.1,IP:::1" \
    'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature' \
    'extendedKeyUsage=serverAuth')
cat "$output_dir/server-leaf.pem" "$certs_dir/ca.pem" > "$output_dir/server.pem"
chmod 600 "$output_dir/server-key.pem"
rm -f "$output_dir/server.csr" "$output_dir/server-leaf.pem"
