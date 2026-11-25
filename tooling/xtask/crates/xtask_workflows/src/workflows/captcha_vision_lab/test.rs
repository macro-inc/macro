use super::*;

#[test]
fn lab_check_keeps_dev_shell_bun_and_clears_library_environment() {
    let fixture = tempfile::tempdir().expect("lab runtime fixture");
    let output = std::process::Command::new("bash")
        .args([
            "-ec",
            r#"
mkdir -p repo/bin node_modules/.bin
export BASH_ENV="$PWD/dev-env"
cat > "$BASH_ENV" <<'EOF'
export PATH="$PWD/repo/bin:$PATH"
export LD_LIBRARY_PATH=/fixture/nix-libraries
EOF
cat > repo/bin/bun <<'EOF'
#!/usr/bin/env bash
if [[ $* == 'install --frozen-lockfile' ]]; then
  test "$LD_LIBRARY_PATH" = /fixture/nix-libraries
  exit $?
fi
[[ -z ${BASH_ENV+x} && -z ${LD_LIBRARY_PATH+x} ]] || exit 1
if [[ $* == 'run check' ]]; then
  exec bash -ec 'bun probe'
fi
test "$*" = 'probe' && printf 'dev-shell Bun reached the nested script\n'
EOF
cat > node_modules/.bin/playwright <<'EOF'
#!/usr/bin/env bash
test "$*" = 'install --with-deps chromium'
EOF
chmod +x repo/bin/bun node_modules/.bin/playwright
exec bash -ec "$LAB_CHECK"
"#,
        ])
        .current_dir(fixture.path())
        .env_remove("BASH_ENV")
        .env_remove("LD_LIBRARY_PATH")
        .env("LAB_CHECK", LAB_CHECK)
        .output()
        .expect("run the lab workflow command");

    assert!(
        output.status.success(),
        "lab workflow command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.stdout, b"dev-shell Bun reached the nested script\n");
}
