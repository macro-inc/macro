use super::*;

/// The whole point of the unified invocation: every service that *can* build
/// together does. A service silently gaining `no_default_features` costs a
/// package-scoped build and, without its own target dir, a full minute of
/// rebuild on the next `run_local`.
#[test]
fn only_services_that_drop_default_features_build_separately() {
    let isolated: Vec<&str> = isolated_services().map(|s| s.cargo_bin).collect();
    assert_eq!(isolated, vec!["search_processing_service"]);
    assert!(unified_services().any(|s| s.cargo_bin == "authentication_service"));
}

#[test]
fn unified_args_pass_local_features_package_qualified() {
    let args = unified_args();
    let features = args
        .iter()
        .position(|a| a == "--features")
        .map(|i| args[i + 1].clone())
        .expect("unified build passes features");
    for feature in features.split(',') {
        assert!(
            feature.contains('/'),
            "{feature} must be package-qualified or it applies to the wrong package"
        );
    }
    assert!(features.contains("authentication_service/no_rate_limit"));
    assert!(features.contains("authentication_service/return_passwordless_code"));
}

#[test]
fn unified_args_build_every_unified_service_bin() {
    let args = unified_args();
    for svc in unified_services() {
        assert!(
            args.windows(2)
                .any(|w| w[0] == "--bin" && w[1] == svc.cargo_bin),
            "{} is missing from the unified build",
            svc.cargo_bin
        );
    }
}

/// Isolation is the load-bearing part: sharing a target dir with the unified
/// build is exactly what invalidates it.
#[test]
fn isolated_args_use_their_own_target_dir() {
    let svc = isolated_services().next().expect("one isolated service");
    let dir = isolated_target_dir(Path::new("/ws"), svc);
    let args = isolated_args(svc, &dir);
    let target_dir = args
        .iter()
        .position(|a| a == "--target-dir")
        .map(|i| args[i + 1].clone())
        .expect("isolated build sets --target-dir");
    assert_eq!(
        target_dir,
        "/ws/target/local-isolated/search_processing_service"
    );
    assert!(args.iter().any(|a| a == "--no-default-features"));
}

#[test]
fn isolated_target_dirs_do_not_collide() {
    let dirs: std::collections::BTreeSet<PathBuf> = isolated_services()
        .map(|svc| isolated_target_dir(Path::new("/ws"), svc))
        .collect();
    assert_eq!(dirs.len(), isolated_services().count());
}
