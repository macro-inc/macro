#!/usr/bin/env bash
set -euo pipefail

lab_dir="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
mkdir -p "$lab_dir/generated"
if [[ -s "$lab_dir/generated/server.pem" && -s "$lab_dir/generated/server.key" ]]; then
    exit 0
fi
umask 077
openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -subj '/CN=Macro IMAP local test CA' \
    -addext 'basicConstraints=critical,CA:TRUE' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$lab_dir/generated/ca.key" -out "$lab_dir/generated/ca.pem"
openssl req -newkey rsa:2048 -nodes \
    -subj '/CN=maillab.example.net' \
    -keyout "$lab_dir/generated/server.key" -out "$lab_dir/generated/server.csr"
openssl x509 -req -days 30 -in "$lab_dir/generated/server.csr" \
    -CA "$lab_dir/generated/ca.pem" -CAkey "$lab_dir/generated/ca.key" -CAcreateserial \
    -extfile "$lab_dir/server.ext" -out "$lab_dir/generated/server.pem"
# The rootless Dovecot image reads its private key as uid 1000.
chmod 755 "$lab_dir/generated"
chmod 644 "$lab_dir/generated/server.pem" "$lab_dir/generated/ca.pem"
chmod 640 "$lab_dir/generated/server.key"
