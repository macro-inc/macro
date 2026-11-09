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
    // The gate runs the PR's code, so it reads the watcher's commit status
    // instead of signing in to Google Play.
    assert!(android.contains("pr_commit_statuses android-play/live"));
    assert!(android.contains("statuses: read"));
    assert!(!android.contains("id-token"));
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
    // A skipped PR never releases, so it may not raise the Android floor.
    let floor = android
        .find("--skip-release")
        .expect("skip-label floor check step");
    let floor_step = android[..floor]
        .rsplit("\n    - ")
        .next()
        .expect("floor check step body");
    assert!(
        floor_step.contains("if: steps.labels.outputs.skip == 'true'"),
        "the floor check runs only with the skip label: {android}"
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
        .split_once("codegen_inputs:")
        .expect("should_run block, then the code generation inputs")
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
    let install = typescript
        .find("name: Install SDK Documentation Dependencies")
        .expect("SDK documentation dependencies install");
    let checks = typescript
        .find("- name: Run checks\n")
        .expect("parallel checks step");
    assert!(
        install < checks,
        "the SDK documentation's dependencies install first"
    );
    assert!(typescript.contains("check 'Check SDK Documentation' 'packages/sdk-docs'"));
    assert!(typescript.contains("check 'Check Code Mode SDK' 'packages/code-mode-sdk'"));
}

#[test]
fn typecheck_compiles_no_rust() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    // The Nix seed's cache shares sccache's name; that's not a compile.
    let typescript =
        job(&yaml, "typescript", "generated-code").replace("seed-cache: sccache-ci", "");
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
        "just gen-dynamic-ui-types",
        "just gen-agent-review-types",
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
        "'apps/web/scripts/generate-api-schema.ts'",
        "'apps/web/scripts/services.ts'",
        "'packages/sdk/**'",
        "'apps/docs/**'",
    ] {
        assert!(
            codegen.contains(path),
            "the code generation filters must include {path}: {codegen}"
        );
    }
    let path_check = job(&yaml, "path-check", "android-native-check");
    for needle in [
        "utoipa|ToSchema|IntoParams|specta|schemars|JsonSchema",
        "-- Cargo.toml Cargo.lock",
        "for revision in HEAD \"$base\"",
        "-- 'crates/*.rs' 'services/*.rs'",
    ] {
        assert!(path_check.contains(needle), "{needle}: {path_check}");
    }
    assert!(
        !path_check.contains("grep -q"),
        "grep -q closes the pipe early, and pipefail reads that as no match: {path_check}"
    );
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

/// The Test legs, up to the next job.
fn test_job(yaml: &str) -> &str {
    let start = yaml
        .find("name: Test (${{ matrix.shard }}/6)")
        .expect("Test job");
    let end = yaml[start..]
        .find("name: Functional Tests\n")
        .map_or(yaml.len(), |offset| start + offset);
    &yaml[start..end]
}

fn browser_job(yaml: &str) -> &str {
    let start = yaml
        .find("name: Browser Tests\n")
        .expect("Browser Tests job");
    let end = yaml[start..]
        .find("name: Cycles Import Check")
        .map_or(yaml.len(), |offset| start + offset);
    &yaml[start..end]
}

fn functional_job(yaml: &str) -> &str {
    let start = yaml
        .find("name: Functional Tests\n")
        .expect("Functional Tests job");
    let end = yaml[start..]
        .find("name: Browser Tests\n")
        .map_or(yaml.len(), |offset| start + offset);
    &yaml[start..end]
}

#[test]
fn test_job_shards_vitest_after_building_its_wasm() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let test_job = test_job(&yaml);
    let wasm = test_job
        .find("just build-agent-fold-wasm")
        .expect("build WASM before the test setup hook");
    let vitest = test_job
        .find("bun run test --shard=${{ matrix.shard }}/6")
        .expect("vitest step runs one shard");
    assert!(wasm < vitest, "cold WASM compilation precedes Vitest");
    assert!(
        test_job.contains("fail-fast: false"),
        "a failing shard must not hide the others' failures: {test_job}"
    );
    assert!(
        test_job.contains(&format!("WASM_PKG_CACHE_DIR: {}", vars::WASM_PKG_CACHE_DIR)),
        "unchanged wasm packages are reused: {test_job}"
    );
}

#[test]
fn browser_suites_build_the_wasm_they_load_first() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let functional = functional_job(&yaml);
    let wasm = functional.find("just build-wasm").expect("wasm packages");
    let suite = functional
        .find("bun run test:functional")
        .expect("functional suite");
    assert!(
        wasm < suite,
        "the bundle imports every package: {functional}"
    );
    assert!(
        functional.contains("playwright: 'true'"),
        "the job installs Playwright's Chromium: {functional}"
    );

    let browser = browser_job(&yaml);
    let wasm = browser
        .find("just build-agent-fold-wasm")
        .expect("agent-fold package");
    for suite in [
        "just test-signup-browser",
        "just test-i18n-browser",
        "just test-database-browser",
        "just test-calendar-details-browser",
    ] {
        let at = browser
            .find(suite)
            .unwrap_or_else(|| panic!("{suite} runs: {browser}"));
        assert!(wasm < at, "{suite} needs the package: {browser}");
    }
    assert!(
        browser.contains("playwright: 'true'"),
        "the job installs Playwright's Chromium: {browser}"
    );
}

/// A browser suite that isn't required could fail without blocking a merge.
#[test]
fn status_check_requires_the_browser_jobs() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    assert!(yaml.contains(r#"[[ "${{ needs.functional.result }}" == "failure" ]]"#));
    assert!(yaml.contains(r#"[[ "${{ needs.browser.result }}" == "failure" ]]"#));
}

/// The event details fixture replaces the calendar query modules with preview
/// adapters, so a change to those modules runs the suite that would show a
/// blank page when an adapter export goes missing.
#[test]
fn calendar_details_browser_tests_run_when_the_replaced_queries_change() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let filters = yaml
        .split("filters: |")
        .nth(1)
        .and_then(|rest| rest.split("id: filter").next())
        .expect("path-check filters");
    let calendar = filters
        .split("calendar_details_changed:")
        .nth(1)
        .expect("calendar_details_changed filter");
    for path in [
        "apps/web/src/features/calendar-view/**",
        "apps/web/src/lib/queries/calendar/**",
    ] {
        assert!(calendar.contains(path), "{path} runs the suite: {calendar}");
    }
    let step = browser_job(&yaml)
        .split("- name: Calendar Event Details Browser Tests")
        .nth(1)
        .and_then(|rest| rest.split("- name:").next())
        .expect("calendar details browser step");
    assert!(
        step.contains("needs.path-check.outputs.calendar_details_changed == 'true'")
            && step.contains("just test-calendar-details-browser"),
        "the step runs the suite when calendar details change: {step}"
    );
}

#[test]
fn test_job_keeps_vitest_module_cache_on_the_cache_volume() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let test_job = test_job(&yaml);
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

/// The iOS native tree exempts desktop-only paths by name, but `desktop_update`
/// is not cfg(desktop): its commands and Status type compile into mobile, so a
/// `desktop_` prefix must stay counted while `desktop`, `desktop.*` and
/// `desktop-*` are exempt.
#[test]
fn native_tree_exclude_counts_mobile_compiled_desktop_update() {
    use std::process::Command;

    let script = include_str!("../scripts/ios_native_tree.sh");
    let output = Command::new("bash")
        .arg("-c")
        .arg(format!(
            r#"set -euo pipefail
{script}
printf '%s\n' "$@" | awk '$0 ~ ENVIRON["NATIVE_TREE_EXCLUDE"]'
"#
        ))
        .args([
            "bash",
            "src-tauri/src/desktop.rs",
            "src-tauri/src/desktop/macrod.rs",
            "src-tauri/src/desktop_update/desktop.rs",
            "src-tauri/src/desktop_update/desktop/test.rs",
            "src-tauri/capabilities/desktop.json",
            "desktop-cef/src/main.rs",
            "desktop-release.json",
            "src-tauri/src/desktop_update.rs",
            "src-tauri/src/desktop_update/state.rs",
            "src-tauri/src/lib.rs",
        ])
        .env_remove("BASH_ENV")
        .output()
        .expect("run native tree exclusion");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .collect::<Vec<_>>(),
        [
            "src-tauri/src/desktop.rs",
            "src-tauri/src/desktop/macrod.rs",
            "src-tauri/src/desktop_update/desktop.rs",
            "src-tauri/src/desktop_update/desktop/test.rs",
            "src-tauri/capabilities/desktop.json",
            "desktop-cef/src/main.rs",
            "desktop-release.json",
        ],
    );
}

/// Exercise Git's actual HTTP header handling with and without checkout's
/// persisted credentials and Android's inherited Nix build environment. The
/// local endpoint records the request, then rejects it: repository objects are
/// irrelevant to this transport test.
#[test]
fn native_fetches_send_one_authorization_header() {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::process::Command;

    for (source, fetch, persisted, build_environment) in [
        (
            include_str!("../scripts/ios_native_tree.sh"),
            "native_tree_fetch",
            false,
            false,
        ),
        (
            include_str!("../scripts/ios_native_tree.sh"),
            "native_tree_fetch",
            true,
            false,
        ),
        (
            include_str!("../scripts/android_git_fetch.sh"),
            "gh_fetch",
            false,
            false,
        ),
        (
            include_str!("../scripts/android_git_fetch.sh"),
            "gh_fetch",
            true,
            false,
        ),
        (
            include_str!("../scripts/android_git_fetch.sh"),
            "gh_fetch",
            false,
            true,
        ),
        (
            include_str!("../scripts/android_git_fetch.sh"),
            "gh_fetch",
            true,
            true,
        ),
    ] {
        let repo = tempfile::tempdir().expect("temporary checkout");
        let listener = TcpListener::bind("127.0.0.1:0").expect("local HTTP endpoint");
        let url = format!(
            "http://{}/",
            listener.local_addr().expect("endpoint address")
        );
        let script = source.replace("https://github.com/", &url);
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
build_library_path=${{LD_LIBRARY_PATH-}}
unset LD_LIBRARY_PATH
git init -q
git remote add origin "$TEST_URL"
if [[ "$TEST_PERSISTED" == true ]]; then
  git config "http.${{TEST_URL}}.extraheader" "AUTHORIZATION: basic checkout-token"
fi
{script}
if [[ "$TEST_BUILD_ENVIRONMENT" == true ]]; then
  export LD_LIBRARY_PATH="$build_library_path"
fi
{fetch} HEAD
"#
            ))
            .current_dir(repo.path())
            // Keep fixture setup outside the build environment; restore its
            // library path at the fetch boundary, as the release head guard sees it.
            .env_remove("BASH_ENV")
            .env("TEST_BUILD_ENVIRONMENT", build_environment.to_string())
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
            "fetch helper: {fetch}; persisted credentials: {persisted}; build environment: {build_environment}"
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

fn build_job(yaml: &str) -> &str {
    yaml.split("\n  build:\n")
        .nth(1)
        .and_then(|rest| rest.split("\n  ios-native-check:").next())
        .expect("build job")
}

/// A failed preview must not read as a failed build or block a merge, and a
/// `[no preview]` title or a fork skips it.
#[test]
fn preview_steps_follow_the_build_and_cannot_fail_it() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let build = build_job(&yaml);
    let build_at = build.find("just build-dev").expect("bundle");
    let deploy_at = build.find("scripts/preview/deploy.ts").expect("deploy");
    assert!(
        build_at < deploy_at,
        "the deploy reuses the bundle: {build}"
    );
    assert!(
        build.contains("--skip-build"),
        "the deploy must not rebuild: {build}"
    );
    for name in [
        "Configure AWS Credentials",
        "Get or create preview ID",
        "Validate bucket name",
        "Deploy to S3",
        "Comment on PR",
    ] {
        let step = build
            .split(&format!("name: {name}"))
            .nth(1)
            .and_then(|rest| rest.split("\n    - ").next())
            .unwrap_or_else(|| panic!("{name} step: {build}"));
        assert!(step.contains("continue-on-error: true"), "{name}: {step}");
        assert!(step.contains("[no preview]"), "{name}: {step}");
        assert!(step.contains("web_artifact_changed"), "{name}: {step}");
        assert!(step.contains("head.repo.full_name"), "{name}: {step}");
    }
}

/// A job that hits its timeout reports `cancelled`, so the required check must
/// not pass on a generated code job that never finished.
#[test]
fn status_check_rejects_a_cancelled_generated_code_job() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    assert!(yaml.contains(r#"[[ "${{ needs.generated-code.result }}" == "cancelled" ]]"#));
}

/// The checks run at once, and the step still fails, naming the check, when any
/// one of them fails; every check's output is printed either way.
#[test]
fn typecheck_runs_its_checks_together_and_fails_on_any() {
    let run = |checks: &[(&str, &str, &str)]| {
        let root = tempfile::tempdir().expect("temporary checkout");
        for (_, directory, _) in checks {
            std::fs::create_dir_all(root.path().join(directory)).expect("check directory");
        }
        let output = std::process::Command::new("bash")
            .arg("-eo")
            .arg("pipefail")
            .arg("-c")
            .arg(typecheck_script(checks))
            .current_dir(root.path())
            .env("RUNNER_TEMP", root.path())
            .output()
            .expect("run the Typecheck script");
        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).into_owned(),
        )
    };

    let (passed, log) = run(&[
        ("Check Types", "apps/web", "echo types ok"),
        ("Check Editing Worker", "services/worker", "echo worker ok"),
    ]);
    assert!(passed, "{log}");
    assert!(
        log.contains("::group::Check Types (exit 0)\ntypes ok\n::endgroup::"),
        "{log}"
    );
    assert!(log.contains("worker ok"), "{log}");

    let (passed, log) = run(&[
        ("Check Types", "apps/web", "sleep 1; echo types ok"),
        ("Check Floating Promises", ".", "echo lint failed; exit 3"),
        ("Check Editing Worker", "services/worker", "echo worker ok"),
    ]);
    assert!(!passed, "{log}");
    assert!(
        log.contains("::error::Check Floating Promises failed with exit code 3"),
        "{log}"
    );
    assert!(
        log.contains("types ok") && log.contains("worker ok"),
        "{log}"
    );
}

#[test]
fn every_former_typecheck_step_still_runs() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let typescript = job(&yaml, "typescript", "generated-code");
    for (name, directory, command) in [
        ("Check Types", "apps/web", "bun run type-check"),
        (
            "Check Lexical Assertion Boundary",
            "apps/web",
            "bun run check:lexical-exceptions",
        ),
        (
            "Check Floating Promises",
            ".",
            "bun run lint:oxlint --quiet",
        ),
        (
            "Check Functional Test Types",
            "apps/web",
            "--project tests/functional/tsconfig.json",
        ),
        (
            "Check Collaboration Package Types",
            "packages/collaboration",
            "bun run type-check",
        ),
        (
            "Check Lexical Service Types",
            "services/lexical-service",
            "bun run check",
        ),
        (
            "Test Lexical Service Endpoints",
            "services/lexical-service",
            "bun test src",
        ),
        (
            "Check SDK Documentation",
            "packages/sdk-docs",
            "bun run type-check && bun run test",
        ),
        (
            "Check Editing Worker",
            "services/ai-editing-worker",
            "bun run type-check",
        ),
        (
            "Check Code Mode SDK",
            "packages/code-mode-sdk",
            "bun run type-check && bun run test",
        ),
    ] {
        let line = typescript
            .lines()
            .find(|line| line.contains(&format!("check '{name}' '{directory}' ")))
            .unwrap_or_else(|| panic!("{name} must run in {directory}: {typescript}"));
        assert!(
            line.contains(command),
            "{name} must run `{command}`: {line}"
        );
    }
}

#[test]
fn path_check_fetches_no_blobs_up_front() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let path_check = job(&yaml, "path-check", "android-native-check");
    assert!(path_check.contains("filter: blob:none"), "{path_check}");
    assert!(
        path_check.contains("sparse-checkout: '.github'"),
        "{path_check}"
    );
}

/// PR jobs write the seed, so the job holding the preview's AWS credentials
/// doesn't read it.
#[test]
fn web_jobs_restore_the_nix_seed_except_the_build() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    for (id, next) in [
        ("typescript", "generated-code"),
        ("generated-code", "biome-check"),
        ("biome-check", "test"),
        ("test", "functional"),
        ("functional", "browser"),
        ("browser", "cycles"),
        ("cycles", "build"),
    ] {
        let job = job(&yaml, id, next);
        assert!(
            job.contains("seed-cache: sccache-ci"),
            "{id} restores the Nix seed: {job}"
        );
    }
    let build = build_job(&yaml);
    assert!(!build.contains("seed-cache"), "{build}");
    assert!(
        build.contains("aws-access-key-id"),
        "Build holds the preview credentials"
    );
}

/// Runs the schema detection step in a blobless clone, as path-check checks
/// out. `files` are written in a commit on top of a base commit. With
/// `break_blobs`, origin loses those files' blobs, so fetching them fails.
fn detect_schema_changes_in_blobless_clone(
    files: &[(&str, &str)],
    break_blobs: bool,
) -> (bool, String) {
    use std::process::Command;

    let root = tempfile::tempdir().expect("temporary directory");
    let git = |dir: &std::path::Path, args: &[&str]| {
        let output = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "test")
            .env("GIT_AUTHOR_EMAIL", "test@example.com")
            .env("GIT_COMMITTER_NAME", "test")
            .env("GIT_COMMITTER_EMAIL", "test@example.com")
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    };

    let source = root.path().join("source");
    std::fs::create_dir_all(source.join("crates/server/src")).expect("source tree");
    git(&source, &["init", "-q"]);
    std::fs::write(source.join("Cargo.toml"), "[workspace]\n").expect("manifest");
    std::fs::write(
        source.join("crates/server/src/lib.rs"),
        "pub fn serve() {}\n",
    )
    .expect("lib");
    git(&source, &["add", "-A"]);
    git(&source, &["commit", "-q", "-m", "base"]);
    for (path, contents) in files {
        let path = source.join(path);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("file directory");
        std::fs::write(path, contents).expect("changed file");
    }
    git(&source, &["add", "-A"]);
    git(&source, &["commit", "-q", "-m", "change"]);

    let origin = root.path().join("origin.git");
    git(
        root.path(),
        &[
            "clone",
            "-q",
            "--bare",
            source.to_str().expect("path"),
            origin.to_str().expect("path"),
        ],
    );
    git(&origin, &["config", "uploadpack.allowFilter", "true"]);
    git(
        &origin,
        &["config", "uploadpack.allowAnySHA1InWant", "true"],
    );
    let url = format!("file://{}", origin.display());
    let checkout = root.path().join("checkout");
    git(
        root.path(),
        &[
            "clone",
            "-q",
            "--filter=blob:none",
            "--no-checkout",
            "--depth=1",
            &url,
            checkout.to_str().expect("path"),
        ],
    );
    if break_blobs {
        for (path, _) in files {
            let blob = git(&origin, &["rev-parse", &format!("HEAD:{path}")]);
            std::fs::remove_file(origin.join("objects").join(&blob[..2]).join(&blob[2..]))
                .expect("remove the blob from origin");
        }
    }

    let output_file = root.path().join("github_output");
    let output = Command::new("bash")
        .arg("-c")
        .arg(DETECT_SCHEMA_CHANGES)
        .current_dir(&checkout)
        .env("CODEGEN_INPUTS", "false")
        .env("GITHUB_OUTPUT", &output_file)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("run schema detection");
    let outputs = std::fs::read_to_string(&output_file).unwrap_or_default();
    (
        output.status.success(),
        format!(
            "{outputs}{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ),
    )
}

#[test]
fn schema_detection_reads_blobs_on_demand_and_fails_when_it_cannot() {
    let schema_file = [(
        "crates/server/src/api.rs",
        "#[derive(utoipa::ToSchema)]\npub struct Reply;\n",
    )];

    let (passed, log) = detect_schema_changes_in_blobless_clone(&schema_file, false);
    assert!(
        passed && log.contains("codegen_changed=true"),
        "a new file naming a schema item: {log}"
    );

    let (passed, log) = detect_schema_changes_in_blobless_clone(
        &[("crates/server/src/lib.rs", "pub fn serve() { listen() }\n")],
        false,
    );
    assert!(
        passed && log.contains("codegen_changed=false"),
        "no schema item: {log}"
    );

    let (passed, log) = detect_schema_changes_in_blobless_clone(
        &[(
            "Cargo.toml",
            "[workspace]\n[workspace.dependencies]\nutoipa = \"5\"\n",
        )],
        false,
    );
    assert!(
        passed && log.contains("codegen_changed=true"),
        "a schema crate's version: {log}"
    );

    let (passed, log) = detect_schema_changes_in_blobless_clone(&schema_file, true);
    assert!(
        !passed && !log.contains("codegen_changed="),
        "a failed blob fetch must fail the step: {log}"
    );
}
