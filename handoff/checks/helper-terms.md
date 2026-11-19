## Terms (the same for all three fix helpers)

- Work only in your checkout, on its branch. Commit each fix on its own, through the commit
  hook (never `--no-verify`), as a Conventional Commit (`fix(routines): …`, `docs(routines): …`,
  `refactor(routines): …`, `test(routines): …`) whose body says why. Don't push, rebase,
  amend commits you didn't make, `git stash`, or touch another checkout.
- No Python, not even a one-off, and no perl. Don't write repo files with shell heredocs or
  `cat >>`; edit with your editing tools. `just check` and the commit hook call the repo's own
  scanners; that's fine.
- A behavior fix comes with a test that fails without it: run it once with the fix reverted
  (keep the red output) and once with it (green). Keep those logs in your log directory.
- Moving code to split a file is a pure move in a commit of its own: no behavior change, the
  same tests passing before and after.
- Don't start, stop or touch a running stack, container, browser or database, and don't deploy.
  The only database you may use is the local test Postgres at `localhost:28699` for `sqlx`
  compile checks and `#[sqlx::test]` tests.
- Rust: run inside `nix develop`, after `source
  <scratchpad>/env.sh`
  (it sets the shared `CARGO_TARGET_DIR`, `RUSTC_WRAPPER=`, `TMPDIR` and `DATABASE_URL`; the
  nix shell resets `DATABASE_URL`, so source it inside the shell). Use `-j 16`. Other sessions
  build in that target dir too: cargo may wait on its lock, and on "failed to move dependency
  graph" rerun once. Clippy runs with `DATABASE_URL` unset and `SQLX_OFFLINE=true`.
- Web and SDK: inside `nix develop`, with `TMPDIR=$HOME/.cache/pw`.
- A changed HTTP route or DTO regenerates the clients with `just gen-api` (it rewrites files in
  place; commit what it changes with the change that caused it).
- I own the PR body (`~/.cache/routines-draft-subroutines/pr<N>/pr-body.md`): don't
  edit it. Say in your report what each fix changes that the body should say.
- Update every doc your change makes stale, in the same commit (grep the names you change).
- Before you finish: `just check` (scoped to changes) passes, and the tests of every package
  you touched pass, with their summary lines in your logs.
- Report: each commit (sha and title), the red and green lines per behavior fix, every check
  you ran with its result line, and each finding you left or could only partly fix, with why.
  Write it to your log directory as `report.md` too.
