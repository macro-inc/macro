# xtask_deploy_cargo

## What it is

Prints the Cargo selection of every deploy build so
`tooling/scripts/check-loro-native-editor-features.sh` resolves exactly what
ships: the nix `.#deploy-*` derivations (services and Lambdas) and every
tracked Dockerfile except the named exemptions in `src/main.rs`.

## Start here

- `src/command.rs`: parses one shell command into a selection; rejects any
  Cargo argument it does not understand.
- `src/deploy.rs`: binds each nix deploy root (or each build its bundle copies)
  and each Dockerfile RUN to its selections; a Dockerfile whose Cargo commands
  use `${ARG}`s resolves once per supported consumer that builds it.
- `src/infra.rs`: reads each stack's `dockerfile:` and literal `buildArgs:`.
- `src/callers.rs`: inventories literal generic-Dockerfile references in tracked
  every tracked YAML document by parsed structure (independent of filename
  or path spelling), shell and just references; resolves each Compose context/file
  before binding args, and resolves direct just builds,
  and refuses unsupported references. This does not parse arbitrary dynamic
  shell or TypeScript programs. The main docker/docker-compose.yml uses the
  repository-root project-directory contract of the root justfile and
  tooling/scripts/run-local.sh; other Compose files use their own directory.
- `src/main.rs`: runs nix, git and `cargo metadata`, lists exemptions, prints
  `source<TAB>args`.

## Checks

- `cargo test -p xtask_deploy_cargo`
- `just check-loro-native-editor-features`

## Gotchas

- A deploy build that selects no package fails: `cargo build --bin X` resolves
  features across the whole workspace.
- Pass `PACKAGE_NAME` as well as `SERVICE_NAME` to the generic Dockerfile,
  including local Compose and direct just recipes.
- Every deploy root must yield its own selection; one root's extra commands
  never cover another root's missing ones.
- Add an option to `command.rs` only with a test; unknown options must fail.
- The grammar is strict on purpose: Cargo behind a wrapper (`env`, `sh -c`),
  exec-form RUNs, any heredoc, `$NAME` instead of `${NAME}`, an unset build arg,
  a non-literal `dockerfile:`/`buildArgs:` value, a `buildArgs:` outside its
  `dockerfile:`'s object, or a package outside the workspace all fail rather
  than being skipped. Cargo is matched by basename (`/path/to/cargo`,
  `cargo-*`).
- A non-exempt Dockerfile with no Cargo selection fails; add one that compiles
  no workspace code (or compiles through worker-build/wasm-pack, checked
  elsewhere) to `EXEMPT` in `src/main.rs` with its reason.
