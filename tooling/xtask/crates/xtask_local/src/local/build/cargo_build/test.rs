use super::*;

#[test]
fn build_args_pass_local_features_package_qualified() {
    let args = build_args();
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
    let args = build_args();
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
    let root = std::env::temp_dir().join(format!("xtask-js-deps-{}", std::process::id()));
    std::fs::create_dir_all(root.join("packages/sdk")).unwrap();
    assert_eq!(missing_js_dependency_dirs(&root), vec![".", "packages/sdk"]);

    std::fs::create_dir_all(root.join("node_modules")).unwrap();
    std::fs::create_dir_all(root.join("packages/sdk/node_modules")).unwrap();
    assert!(missing_js_dependency_dirs(&root).is_empty());

    std::fs::remove_dir_all(&root).unwrap();
}
