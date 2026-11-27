use super::*;
use crate::local::inventory::RUST_SERVICES;
use crate::local::test_support::TempDir;
use std::process::Command;

#[test]
fn service_resolution_previews_cold_builds_but_checks_real_outputs() {
    if let Some(case) = macro_env_var::maybe_read_env("MACRO_LOCAL_BINARY_TEST_CHILD") {
        let stage = Stage::from_env();
        let target = super::super::arch::detect().unwrap();
        let outlook = RUST_SERVICES
            .iter()
            .find(|service| service.cargo_bin == "outlook_emulator")
            .unwrap();
        let result = resolve_services(&stage, target, case != "build", None, vec![outlook]);
        if stage.is_dry_run() {
            let dir = result.expect("a preview must not require the output it skipped building");
            assert_eq!(
                dir.host_dir(),
                super::super::workspace_root().join(target.debug_dir())
            );
        } else {
            assert!(result.is_err(), "a real run must reject missing binaries");
        }
        return;
    }

    let root = TempDir::new("cold-service-resolution");
    for existing_target in [false, true] {
        if existing_target {
            std::fs::create_dir_all(root.path().join("target/debug")).unwrap();
        }
        for (case, dry_run) in [("build", "1"), ("no-build", "1"), ("no-build", "0")] {
            // Isolate process-wide root and dry-run settings from parallel tests.
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "local::build::test::service_resolution_previews_cold_builds_but_checks_real_outputs",
                    "--nocapture",
                ])
                .env("MACRO_LOCAL_BINARY_TEST_CHILD", case)
                .env("MACRO_REPO_ROOT", root.path())
                .env("MACRO_LOCAL_DRY_RUN", dry_run)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "target exists={existing_target}, case={case}, dry_run={dry_run}:\n{}\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
}
