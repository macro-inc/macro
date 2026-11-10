---
name: this-machine
description: Facts about this Macro computer (users, services, display, ports, where to work, what persists). Use when setting things up, debugging the environment, or before installing software.
---

# This machine

- Ubuntu 24.04 VM. You are `macro` (passwordless sudo); home `/home/macro`,
  work in `/home/macro/work`. The disk persists across restarts.
- System services: `macrod` (connects this machine to Macro; do not stop it),
  `docker`. Persona agents may have their own user and service; leave them
  alone unless asked.
- User services (`systemctl --user`): `macro-display` (Xvnc `:0`, VNC on
  127.0.0.1:5900), `macro-openbox`, `macro-chromium` (CDP on 127.0.0.1:9222).
- A power-off stops running jobs.
- Outbound internet works; inbound does not. Cloud metadata, the host, and
  internal networks are blocked.
- Install with `sudo apt install`, `npm`, `pip` (in a venv), or Docker.
  Node, Claude Code, Chromium and herdr live in `/nix/store`, linked from
  `/usr/local/bin`; do not try to upgrade them in place.
