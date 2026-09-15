#!/usr/bin/env bash
# Regenerate the local-dev CA and the localhost server certificate.
# These materials are dummy, checked-in secrets for `just run_local` only.
set -euo pipefail

cd "$(dirname "$0")"

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ca-key.pem
openssl req -new -x509 -key ca-key.pem -out ca.pem -days 3650 \
  -subj "/CN=Macro Local CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out localhost-key.pem
openssl req -new -key localhost-key.pem -out localhost.csr \
  -subj "/CN=localhost"

openssl x509 -req -in localhost.csr -CA ca.pem -CAkey ca-key.pem \
  -out localhost-leaf.pem -days 3650 \
  -extfile <(printf '%s\n' \
    'subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1,IP:::1' \
    'extendedKeyUsage=serverAuth')

# Serve the leaf plus the CA so clients that do not have the CA yet still
# see a complete chain; trusting `ca.pem` is what makes browsers happy.
cat localhost-leaf.pem ca.pem > localhost.pem
rm -f localhost.csr localhost-leaf.pem ca.srl

chmod 644 ca.pem ca-key.pem localhost.pem localhost-key.pem
echo "wrote CA and localhost cert in $(pwd)"
