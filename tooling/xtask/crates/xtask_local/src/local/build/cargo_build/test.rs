use super::*;
use crate::local::test_support::TempDir;

#[test]
fn build_args_pass_local_features_package_qualified() {
    let args = build_args(None);
    let features = args
        .iter()
        .position(|a| a == "--features")
        .map(|i| args[i + 1].clone())
        .expect("the build passes features");
    for feature in features.split(',') {
        assert!(
            feature.contains('/'),
            "{feature} must be package-qualified or it applies to the wrong package"
        );
    }
    assert!(features.contains("authentication_service/no_rate_limit"));
    assert!(features.contains("authentication_service/return_passwordless_code"));
    assert!(features.contains("search_processing_service/no_pdf"));
}

#[test]
fn build_args_build_every_local_service_bin_in_one_invocation() {
    let args = build_args(None);
    for svc in built_services() {
        assert!(
            args.windows(2)
                .any(|w| w[0] == "--bin" && w[1] == svc.cargo_bin),
            "{} is missing from the build",
            svc.cargo_bin
        );
    }
    assert!(!args.iter().any(|a| a == "--target"));
}

#[test]
fn a_fresh_worktree_needs_both_js_installs_and_a_ready_one_needs_none() {
    let tmp = TempDir::new("js-deps");
    let root = tmp.path();
    std::fs::create_dir_all(root.join("packages/sdk")).unwrap();
    assert_eq!(missing_js_dependency_dirs(root), vec![".", "packages/sdk"]);

    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::fs::create_dir_all(root.join("packages/sdk/node_modules")).unwrap();
    assert!(missing_js_dependency_dirs(root).is_empty());
}

#[test]
fn drops_the_variables_cargo_run_sets() {
    let names = [
        "CARGO_MANIFEST_DIR",
        "CARGO_PKG_NAME",
        "CARGO_PKG_VERSION_MAJOR",
        "CARGO",
        "CARGO_HOME",
        "CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUSTFLAGS",
        "CARGO_PROFILE_DEV_DEBUG",
        "PATH",
    ]
    .into_iter()
    .map(str::to_owned);
    assert_eq!(
        cargo_run_vars(names),
        [
            "CARGO_MANIFEST_DIR",
            "CARGO_PKG_NAME",
            "CARGO_PKG_VERSION_MAJOR",
            "CARGO"
        ]
    );
}

#[test]
fn a_build_of_some_services_keeps_every_services_features() {
    let contacts = RUST_SERVICES
        .iter()
        .find(|s| s.cargo_bin == "contacts_service")
        .unwrap();
    let args = build_args(Some(&[contacts]));
    let bins: Vec<&String> = args
        .iter()
        .zip(args.iter().skip(1))
        .filter(|(flag, _)| *flag == "--bin")
        .map(|(_, bin)| bin)
        .collect();
    assert_eq!(bins, ["contacts_service"]);
    let features = |a: &[String]| {
        a.iter()
            .position(|x| x == "--features")
            .map(|i| a[i + 1].clone())
    };
    assert_eq!(features(&args), features(&build_args(None)));
}
