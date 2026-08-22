use super::*;

#[test]
fn repo_urls_normalize_every_remote_form() {
    for remote in [
        "git@github.com:macro-inc/macro.git",
        "git@github.com:macro-inc/macro",
        "ssh://git@github.com/macro-inc/macro.git",
        "https://github.com/macro-inc/macro.git",
        "https://github.com/macro-inc/macro",
        "  https://github.com/macro-inc/macro\n",
    ] {
        let parsed = RepoUrl::parse(remote).unwrap_or_else(|| panic!("{remote:?} should parse"));
        assert_eq!(parsed.as_str(), "https://github.com/macro-inc/macro");
    }
}

#[test]
fn non_https_remotes_are_rejected_not_guessed() {
    assert_eq!(RepoUrl::parse("/local/path/repo"), None);
    assert_eq!(RepoUrl::parse("ftp://example.com/repo"), None);
    assert_eq!(RepoUrl::parse(""), None);
}

#[test]
fn run_statuses_round_trip_unknown_values() {
    let known: RunStatus = serde_json::from_str("\"FINISHED\"").expect("known status");
    assert_eq!(known, RunStatus::Finished);
    let unknown: RunStatus = serde_json::from_str("\"PAUSED\"").expect("unknown status");
    assert_eq!(unknown, RunStatus::Unknown("PAUSED".to_owned()));
}
