use super::*;

#[test]
fn android_native_check_is_an_unconditional_required_merge_check() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let android = job(&yaml, "android-native-check", "typescript");
    assert!(
        !android.contains("\n    if:"),
        "native enforcement must always run (steps may be gated, the job may not): {android}"
    );
    assert!(
        !android.contains("fetch-depth"),
        "shallow checkout; the base commit is fetched by the step: {android}"
    );
    assert!(
        android.contains("git cat-file -p HEAD | sed -n 's/^parent //p' | head -1")
            && !android.contains("github.event.pull_request.base.sha"),
        "the base is the merge commit's first parent, not the event payload: {android}"
    );
    assert!(android.contains("bun scripts/android-version-check.mjs"));
    assert!(android.contains("bun scripts/android-play-status.mjs --version-code"));
    assert!(android.contains("id-token: write"));
    // skip-android-update bypasses the bump too, like skip-ios-update: the
    // labels are read first, and the version check only runs without it.
    let labels = android.find("id: labels").expect("labels step");
    let version = android
        .find("id: android-version")
        .expect("version check step");
    assert!(
        labels < version,
        "labels must be read before the version check: {android}"
    );
    let version_step = android[version..]
        .split("\n    - ")
        .next()
        .expect("version check step body");
    assert!(
        version_step.contains("if: steps.labels.outputs.skip != 'true'"),
        "the version check runs only without the skip label: {android}"
    );
    assert!(
        !android.contains("!steps.labels"),
        "never negate a comparison with a leading `!`: {android}"
    );
    let status = yaml
        .split("\n  status-check:\n")
        .nth(1)
        .expect("status job");
    assert!(status.contains("- android-native-check"));
    assert!(status.contains("needs.android-native-check.result }}\" != \"success\""));
}

fn filters(yaml: &str) -> (&str, &str) {
    let filters = yaml
        .split("filters: |")
        .nth(1)
        .and_then(|rest| rest.split("id: filter").next())
        .expect("path-check filters");
    filters
        .split_once("codegen_changed:")
        .expect("should_run block, then codegen_changed block")
}

/// A job's rendered YAML, from its id up to the next job's id. Slicing by id
/// keeps the job's `needs:` and `if:`, which render before its `name:`.
fn job<'a>(yaml: &'a str, id: &str, next_id: &str) -> &'a str {
    yaml.split(&format!("\n  {id}:\n"))
        .nth(1)
        .and_then(|rest| rest.split(&format!("\n  {next_id}:\n")).next())
        .unwrap_or_else(|| panic!("{id} job"))
}

#[test]
fn nix_dev_shell_does_not_start_typecheck() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let (should_run, _) = filters(&yaml);
    assert!(
        !should_run.contains("setup-nix-dev-shell"),
        "Typecheck runs on should_run; nix-dev-shell must not be in it: {should_run}"
    );
    assert!(
        should_run.contains("setup-reqs-web"),
        "web setup action still belongs in should_run: {should_run}"
    );
}

/// The iOS merge gate is required through the aggregator, not the ruleset:
/// the status check must depend on it and fail when it fails.
#[test]
fn status_check_requires_the_ios_native_check() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let gate = job(&yaml, "ios-native-check", "status-check");
    assert!(
        gate.contains("name: iOS Native Check"),
        "gate job name is a check name: {gate}"
    );
    assert!(
        gate.contains("predicate-quantifier: every"),
        "negated path filters need the `every` quantifier: {gate}"
    );
    assert!(
        gate.contains("!apps/web/tauri/**/*.md"),
        "documentation must not trigger an iOS native release: {gate}"
    );
    assert!(
        gate.contains("!apps/web/tauri/**/desktop-*/**"),
        "macOS CEF files must not trigger an iOS native release: {gate}"
    );
    // `!` binds tighter than `==` in GitHub expressions: `!x == 'true'` is
    // always false, which silently skipped every gated step.
    assert!(
        !gate.contains("!steps.labels"),
        "never negate a comparison with a leading `!`: {gate}"
    );
    assert!(
        gate.contains("steps.labels.outputs.skip != 'true'"),
        "gated steps run when the skip label is absent: {gate}"
    );
    let status = yaml
        .split("\n  status-check:\n")
        .nth(1)
        .expect("status-check job");
    assert!(
        status.contains("- ios-native-check"),
        "status-check must need the gate: {status}"
    );
    assert!(
        status.contains("needs.ios-native-check.result }}\" == \"failure\""),
        "status-check must fail when the gate fails: {status}"
    );
}

#[test]
fn typecheck_runs_lexical_service_check_and_tests() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let typescript = job(&yaml, "typescript", "generated-code");
    assert!(
        typescript.contains("bun run check"),
        "Typecheck must type-check lexical-service: {typescript}"
    );
    assert!(
        typescript.contains("bun test src"),
        "Typecheck must run lexical-service endpoint tests: {typescript}"
    );
    assert!(
        typescript.contains("services/lexical-service"),
        "lexical-service steps must run in the service directory: {typescript}"
    );
}

#[test]
fn sdk_and_documentation_changes_run_their_checks() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let (should_run, _) = filters(&yaml);
    assert!(should_run.contains("packages/sdk/**"));
    assert!(should_run.contains("packages/sdk-docs/**"));
    let typescript = job(&yaml, "typescript", "generated-code");
    assert!(typescript.contains("name: Install SDK Documentation Dependencies"));
    assert!(typescript.contains("name: Check SDK Documentation"));
    assert!(typescript.contains("working-directory: packages/sdk-docs"));
}

#[test]
fn typecheck_compiles_no_rust() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let typescript = job(&yaml, "typescript", "generated-code");
    for rust in ["gen-api", "cargo", "sccache", "just gen-"] {
        assert!(
            !typescript.contains(rust),
            "generated code is checked in its own job, so Typecheck must not run `{rust}`: {typescript}"
        );
    }
    assert!(
        typescript.contains("should_run == 'true'") && !typescript.contains("codegen_changed"),
        "a Rust-only change does not start Typecheck: {typescript}"
    );
}

/// The OpenAPI clients, specta types, SDK and docs tool pages all come from
/// workspace binaries, so one job builds them once and checks all four.
#[test]
fn generated_code_checks_every_rust_generated_artifact_in_one_job() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let generated = job(&yaml, "generated-code", "biome-check");
    // Specta runs last: its `cargo run -p` builds resolve features per
    // package and would otherwise make the docs build recompile.
    let order = [
        "Build schema binaries",
        "bun run gen-api -- --check",
        "bun run sync-specs",
        "git status --porcelain -- packages/sdk",
        "bun run generate:tools",
        "git status --porcelain -- apps/docs",
        "just gen-agent-fold-types",
        "just gen-database-sql-types",
    ];
    let positions: Vec<usize> = order
        .iter()
        .map(|needle| {
            generated
                .find(needle)
                .unwrap_or_else(|| panic!("missing `{needle}`: {generated}"))
        })
        .collect();
    assert!(
        positions.windows(2).all(|pair| pair[0] < pair[1]),
        "the binaries build first, then each artifact is checked: {generated}"
    );
    let sdk = generated
        .split("name: Regenerate SDK code")
        .nth(1)
        .and_then(|rest| rest.split("- name:").next())
        .expect("SDK regeneration step");
    assert!(
        !sdk.contains("gen-api") && !sdk.contains("update-generated"),
        "the SDK reuses the specs gen-api wrote instead of rerunning it: {sdk}"
    );
    assert!(
        generated.contains("nsc cache sccache setup --cache_name web-ci"),
        "the build uses the shared web-ci remote sccache: {generated}"
    );
}

/// Debug info only slows the throwaway generator build. Set at job level so
/// every cargo call in the job shares the profile and reuses one build.
#[test]
fn generated_code_builds_without_debug_info_for_every_step() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let generated = job(&yaml, "generated-code", "biome-check");
    let (header, steps) = generated
        .split_once("\n    steps:\n")
        .expect("job header, then steps");
    assert!(
        header.contains("CARGO_PROFILE_DEV_DEBUG: '0'"),
        "the job env turns debug info off: {header}"
    );
    assert!(
        header.contains("RUSTFLAGS: '-C link-arg=-fuse-ld=mold'"),
        "the job links with mold like the Rust jobs: {header}"
    );
    for flag in ["CARGO_PROFILE_DEV_DEBUG", "RUSTFLAGS", "--config"] {
        assert!(
            !steps.contains(flag),
            "no step may override `{flag}`, or its build stops reusing the others: {steps}"
        );
    }
}

#[test]
fn codegen_filter_covers_every_input_of_the_generated_code_job() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let (_, codegen) = filters(&yaml);
    for path in [
        "'crates/**/*.rs'",
        "'services/**/*.rs'",
        "'Cargo.toml'",
        "'Cargo.lock'",
        "'apps/web/scripts/generate-api-schema.ts'",
        "'apps/web/scripts/services.ts'",
        "'packages/sdk/**'",
        "'apps/docs/**'",
    ] {
        assert!(
            codegen.contains(path),
            "codegen_changed must include {path}: {codegen}"
        );
    }
    let generated = job(&yaml, "generated-code", "biome-check");
    assert!(generated.contains("needs.path-check.outputs.codegen_changed == 'true'"));
}

#[test]
fn status_check_requires_generated_code() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let status = yaml
        .split("\n  status-check:\n")
        .nth(1)
        .expect("status check job");
    assert!(status.contains("- generated-code"), "{status}");
    assert!(
        status.contains("needs.generated-code.result }}\" == \"failure\""),
        "{status}"
    );
}

#[test]
fn should_run_includes_fold_wasm_inputs() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let filters = yaml
        .split("filters: |")
        .nth(1)
        .and_then(|rest| rest.split("id: filter").next())
        .expect("path-check filters");
    let should_run = filters
        .split("api_changed:")
        .next()
        .expect("should_run block");
    assert!(
        should_run.contains("crates/folds/agent_fold/**"),
        "fold wasm source must rebuild the web artifact: {should_run}"
    );
    assert!(
        should_run.contains("crates/agent_runtime_protocol/**"),
        "fold wasm path dep must rebuild the web artifact: {should_run}"
    );
    assert!(
        should_run.contains("crates/database_sql/**"),
        "SQL engine wasm source must rebuild the web artifact: {should_run}"
    );
}

#[test]
fn build_job_uses_remote_sccache_and_wasm_cache() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let build = yaml
        .split("\n  build:\n")
        .nth(1)
        .and_then(|rest| rest.split("\n  status-check:").next())
        .expect("build job");
    assert!(
        build.contains("namespace-profile-linux-mid"),
        "wasm compile needs the mid runner: {build}"
    );
    assert!(
        build.contains("nsc cache sccache setup --cache_name web-ci"),
        "build must use the shared web-ci remote sccache: {build}"
    );
    let configure = build
        .find("nsc cache sccache setup")
        .expect("remote cache configuration");
    let start = build
        .find("run: sccache --start-server")
        .expect("start the server in a separate step with the exported credentials");
    let build_command = build.find("just build-").expect("web build command");
    assert!(configure < start && start < build_command);
    assert!(
        build.contains(".wasm-pack"),
        "build must persist wasm-pack's wasm-opt cache: {build}"
    );
    assert!(
        build.contains("just build-dev"),
        "build still produces the vite bundle: {build}"
    );
}

#[test]
fn test_job_runs_signup_browser_tests_after_vitest() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    // The job and its vitest step are both named "Test"; slice from the job.
    let start = yaml.find("name: Test\n").expect("Test job");
    let end = yaml[start..]
        .find("name: Cycles Import Check")
        .map_or(yaml.len(), |offset| start + offset);
    let test_job = &yaml[start..end];
    let wasm = test_job
        .find("just build-agent-fold-wasm")
        .expect("build WASM before the test setup hook");
    let vitest = test_job.find("bun run test").expect("vitest step");
    assert!(wasm < vitest, "cold WASM compilation precedes Vitest");
    let browser = test_job
        .find("just test-signup-browser")
        .expect("sign-up browser step");
    assert!(
        vitest < browser,
        "browser tests run after vitest: {test_job}"
    );
    assert!(
        test_job.contains("playwright: 'true'"),
        "the Test job installs Playwright's Chromium: {test_job}"
    );
}

#[test]
fn test_job_keeps_vitest_module_cache_on_the_cache_volume() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let start = yaml.find("name: Test\n").expect("Test job");
    let end = yaml[start..]
        .find("name: Cycles Import Check")
        .map_or(yaml.len(), |offset| start + offset);
    let test_job = &yaml[start..end];
    let mounted = format!("  {}\n", vars::VITEST_MODULE_CACHE_VOLUME_DIR);
    assert!(
        test_job.contains(&mounted),
        "the cache volume mounts the Vitest module cache: {test_job}"
    );
    assert!(
        test_job.contains(&format!(
            "VITEST_MODULE_CACHE_DIR: {}",
            vars::VITEST_MODULE_CACHE_VOLUME_DIR
        )),
        "vitest writes its module cache to the mounted path: {test_job}"
    );
}

/// Exercise Git's actual HTTP header handling with and without checkout's
/// persisted credentials. The local endpoint records the request, then rejects
/// it: fetching repository objects is irrelevant to this authentication test.
#[test]
fn native_tree_fetch_sends_one_authorization_header() {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::process::Command;

    for persisted in [false, true] {
        let repo = tempfile::tempdir().expect("temporary checkout");
        let listener = TcpListener::bind("127.0.0.1:0").expect("local HTTP endpoint");
        let url = format!(
            "http://{}/",
            listener.local_addr().expect("endpoint address")
        );
        let script =
            include_str!("../scripts/ios_native_tree.sh").replace("https://github.com/", &url);
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("Git HTTP request");
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                .expect("request timeout");
            let mut headers = Vec::new();
            for line in BufReader::new(&socket).lines() {
                let line = line.expect("HTTP request line");
                if line.is_empty() {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("authorization:") {
                    headers.push(line);
                }
            }
            socket
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .expect("reject request after capturing headers");
            sender.send(headers).expect("send captured headers");
        });
        let output = Command::new("bash")
            .arg("-c")
            .arg(format!(
                r#"set -euo pipefail
git init -q
git remote add origin "$TEST_URL"
if [[ "$TEST_PERSISTED" == true ]]; then
  git config "http.${{TEST_URL}}.extraheader" "AUTHORIZATION: basic checkout-token"
fi
{script}
native_tree_fetch HEAD
"#
            ))
            .current_dir(repo.path())
            // CI's BASH_ENV reloads the Nix dev shell; its library path can
            // make the runner's host git-remote-http fail before connecting.
            .env_remove("BASH_ENV")
            .env_remove("LD_LIBRARY_PATH")
            .env("TEST_URL", &url)
            .env("TEST_PERSISTED", persisted.to_string())
            .env("GH_TOKEN", "test-token")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("NO_PROXY", "127.0.0.1")
            .output()
            .expect("run native tree fetch");
        assert!(!output.status.success(), "fixture rejects the fetch");
        assert_eq!(
            receiver
                .recv_timeout(std::time::Duration::from_secs(10))
                .unwrap_or_else(|error| panic!(
                    "Git must send an HTTP request: {error}; stderr: {}",
                    String::from_utf8_lossy(&output.stderr)
                )),
            ["AUTHORIZATION: basic eC1hY2Nlc3MtdG9rZW46dGVzdC10b2tlbg=="],
            "persisted credentials: {persisted}"
        );
    }
}

#[test]
fn ios_gate_comment_runs_after_failures_and_only_for_same_repo_prs() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let gate = job(&yaml, "ios-native-check", "status-check");
    assert!(gate.contains("pull-requests: write"));
    assert!(gate.contains(
        "!cancelled() && github.event.pull_request.head.repo.full_name == github.repository"
    ));
    assert!(gate.contains("IOS_GATE_STEPS: ${{ toJSON(steps) }}"));
    for id in ["checkout", "bun", "bump", "credentials", "live"] {
        assert!(gate.contains(&format!("id: {id}")), "missing step id: {id}");
    }
}

#[test]
fn ios_gate_status_and_comment_scenarios() {
    let output = std::process::Command::new("node")
        .arg("--test")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../../apps/web/scripts/ios-app-store.test.mjs"
        ))
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts/ios_native_check_comment.test.cjs"
        ))
        .output()
        .expect("run iOS gate scenarios with Node");
    assert!(
        output.status.success(),
        "iOS gate scenarios failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
