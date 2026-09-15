# Local TLS materials

Dummy certificate authority and `localhost` server certificate used by the
local reverse proxy (`just run_local` / `just stack up`). Caddy mounts this
directory and serves HTTPS with `localhost.pem` + `localhost-key.pem`.

These keys are not secrets. Anyone with the repo can mint a matching cert;
do not reuse them outside local development.

## Trust the CA (once per machine)

Browsers will reject the proxy until the CA is trusted:

```bash
# macOS
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain infra/local/certs/ca.pem

# Linux (Debian/Ubuntu)
sudo cp infra/local/certs/ca.pem /usr/local/share/ca-certificates/macro-local-ca.crt
sudo update-ca-certificates
```

`curl` against the proxy can pass `--cacert infra/local/certs/ca.pem` instead.

## Regenerate

```bash
bash infra/local/certs/generate.sh
```
