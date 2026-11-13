---
name: coding-workflow
description: How to take a coding task from prompt to pushed branch on this Macro computer. Use for any change to a repository.
---

# Coding workflow

1. Clone into `/home/macro/work/<repo>` (or reuse the existing checkout) and
   read its `AGENTS.md` / `CLAUDE.md` / README before changing anything.
   This machine is NixOS without `apt`: get a missing toolchain with
   `nix shell nixpkgs#<package>` (or the repo's own `flake.nix` /
   `nix develop`), or run it in Docker.
2. Work on a branch, never the default branch. Commit in small logical
   commits with clear messages.
3. Run the project's own checks (tests, lint, type check) before saying the
   work is done; report what you ran and what you could not run.
4. For web apps, start the dev server in a herdr pane and check the change in
   the browser (see the `browser` skill).
5. Push or open a pull request only when asked. Never commit secrets; keep
   tokens in environment variables or the tool's credential store.
6. Summarize what changed and anything left undone for the person who
   prompted you.
