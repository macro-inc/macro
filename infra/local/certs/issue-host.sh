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

# Modern clients reject a leaf whose EC key carries explicit curve parameters or a
# SHA-1 signature. LibreSSL (the macOS default `/usr/bin/openssl`) writes both, so
# prefer an OpenSSL 3 binary when one is installed.
resolve_openssl() {
  if [[ -n "${OPENSSL_BIN:-}" && -x "${OPENSSL_BIN}" ]]; then
    printf '%s' "$OPENSSL_BIN"
    return
  fi
  local candidate
  for candidate in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  command -v openssl
}
openssl_bin="$(resolve_openssl)"

"$openssl_bin" genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \
  -out "$output_dir/server-key.pem"
"$openssl_bin" req -new -sha256 -key "$output_dir/server-key.pem" \
  -out "$output_dir/server.csr" -subj "/CN=$host"
"$openssl_bin" x509 -req -sha256 -in "$output_dir/server.csr" \
  -CA "$certs_dir/ca.pem" -CAkey "$certs_dir/ca-key.pem" \
  -set_serial "0x$("$openssl_bin" rand -hex 16)" -days 365 \
  -out "$output_dir/server-leaf.pem" \
  -extfile <(printf '%s\n' \
    "subjectAltName=DNS:localhost,DNS:*.localhost,DNS:$host,IP:127.0.0.1,IP:::1" \
    'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature' \
    'extendedKeyUsage=serverAuth')

# Fail here rather than at the TLS handshake: a leaf that encodes explicit curve
# parameters or a SHA-1 signature is unusable by Chrome, Node, and curl alike.
if ! "$openssl_bin" x509 -in "$output_dir/server-leaf.pem" -noout -text \
  | grep -q 'ASN1 OID: prime256v1'; then
  echo "Issued leaf does not use the named P-256 curve; install OpenSSL 3 or set OPENSSL_BIN" >&2
  exit 1
fi
if ! "$openssl_bin" x509 -in "$output_dir/server-leaf.pem" -noout -text \
  | grep -q 'Signature Algorithm: ecdsa-with-SHA256'; then
  echo "Issued leaf is not signed with SHA-256; install OpenSSL 3 or set OPENSSL_BIN" >&2
  exit 1
fi

cat "$output_dir/server-leaf.pem" "$certs_dir/ca.pem" > "$output_dir/server.pem"
chmod 600 "$output_dir/server-key.pem"
rm -f "$output_dir/server.csr" "$output_dir/server-leaf.pem"
