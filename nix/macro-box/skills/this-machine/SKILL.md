---
name: this-machine
description: Facts about this Macro computer (users, services, display, ports, where to work, what persists). Use when setting things up, debugging the environment, or before installing software.
---

# This machine

- NixOS VM. You are `macro` (passwordless sudo); home `/home/macro`,
  work in `/home/macro/work`. The disk persists across restarts.
- System services: `macrod` (connects this machine to Macro; do not stop it),
  `docker`. Persona agents may have their own user and service; leave them
  alone unless asked.
- User services (`systemctl --user`): `macro-display` (Xvnc `:0`, VNC on
  127.0.0.1:5900), `macro-openbox`, `macro-chromium` (CDP on 127.0.0.1:9222).
- A power-off stops running jobs.
- Outbound internet works; inbound does not. Cloud metadata, the host, and
  internal networks are blocked.
- This is NixOS: `apt` is not available. Get a tool for one command with
  `nix shell nixpkgs#<package> -c <command>`, keep one with
  `nix profile install nixpkgs#<package>`, or use Docker. Search packages
  with `nix search nixpkgs <name>`. `npm`, `uv` and `pip` (in a venv) work.
- Downloaded Linux binaries (release tarballs, Playwright browsers, uv's
  Python) run through nix-ld; `#!/bin/bash` and `#!/usr/bin/env` shebangs
  work. To build against C libraries, use
  `nix shell nixpkgs#pkg-config nixpkgs#<library>.dev`.
- The system (macrod, Claude Code, Chromium, herdr, Node) is part of the
  image; do not try to upgrade it in place.
