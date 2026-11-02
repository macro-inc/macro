use super::*;

#[test]
fn missing_play_status_cannot_report_a_verified_nonproduction_release() {
    let yaml = android_release_drift().to_string().expect("workflow YAML");
    let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("parsed workflow");
    let steps = workflow["jobs"]["drift"]["steps"]
        .as_sequence()
        .expect("drift steps");
    let comment = steps
        .iter()
        .find(|step| step["name"].as_str() == Some("Comment on the PR"))
        .expect("comment step");
    let script = comment["run"].as_str().expect("comment script");
    let reports = ["", "false", "true", "unexpected"].map(|promoted| {
        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(format!(
                "{}\n{script}",
                r#"gh() {
  [[ "$#" == 7 && "$1" == pr && "$2" == comment && "$3" == "$PR_NUMBER" && "$4" == --repo && "$5" == "$GH_REPO" && "$6" == --body ]] || return 1
  printf '%s' "$7"
}"#
            ))
            .env_remove("BASH_ENV")
            .env("PROMOTED", promoted)
            .env("VERSION_CODE", "20")
            .env("PR_NUMBER", "1")
            .env("GH_REPO", "example/repo")
            .output()
            .expect("run drift report");
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).expect("UTF-8 report")
    });
    assert_ne!(
        reports[0], reports[1],
        "failed or skipped authentication/lookup leaves no output; it must not claim the release is absent"
    );
    assert_ne!(reports[0], reports[2]);
    assert_ne!(reports[1], reports[2]);
    assert_eq!(
        reports[0], reports[3],
        "unrecognized status is also unknown"
    );
}

#[test]
fn drift_only_checks_play_for_a_verified_previous_version() {
    for (before_state, changed, version) in [
        ("available", "true", Some("20")),
        ("unreachable", "true", None),
        ("hash-failed", "true", None),
        ("unchanged", "false", None),
    ] {
        let outputs = tempfile::NamedTempFile::new().expect("step outputs");
        let script = include_str!("../scripts/android_release_drift.sh");
        let output = std::process::Command::new("bash")
            .arg("-c")
            .arg(format!(
                "{}\n{script}",
                r#"
gh_fetch() {
  [[ "$1" != before || "$BEFORE_STATE" != unreachable ]]
}
bun() {
  case "$2:$3" in
    hash:before)
      [[ "$BEFORE_STATE" != hash-failed ]] || return 1
      if [[ "$BEFORE_STATE" == unchanged ]]; then echo new; else echo old; fi
      ;;
    hash:after) echo new ;;
    version-code:before) echo 20 ;;
    version-code:after) echo 21 ;;
    *) return 1 ;;
  esac
}
"#
            ))
            .env_remove("BASH_ENV")
            .env("BEFORE_STATE", before_state)
            .env("BEFORE_SHA", "before")
            .env("AFTER_SHA", "after")
            .env("GITHUB_OUTPUT", outputs.path())
            .output()
            .expect("run drift detection");
        assert!(output.status.success(), "{before_state}: {output:?}");
        let outputs = std::fs::read_to_string(outputs.path()).expect("read step outputs");
        assert!(
            outputs
                .lines()
                .any(|line| line == format!("changed={changed}")),
            "{before_state}: {outputs}"
        );
        assert_eq!(
            outputs
                .lines()
                .find_map(|line| line.strip_prefix("version_code=")),
            version,
            "{before_state}: a new head's bumped code cannot identify the prior release"
        );
    }
}
