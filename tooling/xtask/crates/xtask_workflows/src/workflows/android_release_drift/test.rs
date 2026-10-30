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
