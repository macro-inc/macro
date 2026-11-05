use super::*;

fn yaml() -> String {
    main_rust_check().to_string().expect("workflow yaml")
}

/// A path the pull request workflow treats as Rust but this one ignored would
/// let a break reach `main` with no run to catch it.
#[test]
fn watches_every_path_the_pull_request_filter_does() {
    let pull_request = code_check_cloud_storage::code_check_cloud_storage()
        .to_string()
        .expect("workflow yaml");
    let filter = &pull_request[pull_request.find("should_run:\n").expect("filter")..];
    let filter = &filter[..filter.find("doppler_candidates:").expect("filter end")];
    let expected: Vec<&str> = filter
        .lines()
        .skip(1)
        .filter_map(|line| line.trim().strip_prefix("- "))
        .map(|path| path.trim_matches('\''))
        .filter(|path| !path.contains("code_check_cloud_storage"))
        .collect();
    let watched: Vec<&str> = RUST_PATHS
        .iter()
        .copied()
        .filter(|path| !path.contains("main_rust_check"))
        .collect();
    assert_eq!(watched, expected);
}

#[test]
fn tests_and_lints_the_whole_workspace() {
    let yaml = yaml();
    assert_eq!(yaml.matches("RUST_PACKAGES: all").count(), 2, "{yaml}");
    assert!(!yaml.contains("needs.path-check"), "{yaml}");
}

/// Cancelling would starve the run, since merges arrive faster than it finishes.
#[test]
fn a_new_push_waits_instead_of_cancelling() {
    let yaml = yaml();
    assert!(yaml.contains("cancel-in-progress: false"), "{yaml}");
}
