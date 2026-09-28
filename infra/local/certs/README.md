# Local TLS materials

Development certificate authority and localhost fixtures for the local proxy.
`just local` / `just stack up` call `hostname` and generate a leaf certificate
under `infra/local/generated/<instance>/proxy/certs/`. Caddy mounts that directory
and serves `server.pem` + `server-key.pem`. The certificate covers the detected
hostname, `localhost`, `*.localhost`, and loopback IPs. The CA stays unchanged
between starts, so coworkers only need to trust it once; Tailscale is optional.

These keys are not secrets. Anyone with the repo can mint a matching cert;
do not reuse them outside local development.

## Trust the CA (once per machine)

Trust the CA on the machine running the browser:

```bash
# macOS
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain infra/local/certs/ca.pem

# Linux (Debian/Ubuntu)
sudo cp infra/local/certs/ca.pem /usr/local/share/ca-certificates/macro-local-ca.crt
sudo update-ca-certificates
```

Firefox may use its own certificate store: Settings → Privacy & Security →
Certificates → View Certificates → Authorities → Import `ca.pem`, then enable
trust for identifying websites. Restart the browser after changing trust.

`curl` against the proxy can pass `--cacert infra/local/certs/ca.pem` instead.

## Issue a leaf manually

```bash
bash infra/local/certs/issue-host.sh /tmp/macro-certs "$(hostname)"
```

This preserves the CA. The generated directory contains the certificate and key.

## Regenerate the CA and localhost fixtures

This replaces the CA; everyone who trusted the previous CA must import it again.
Normal stack startup does not run this command.

```bash
bash infra/local/certs/generate.sh
```
