use super::*;

#[test]
fn bootstrap_defers_preview_until_activation_without_hiding_paused_services() {
    let dir = tempfile::tempdir().unwrap();
    let github = dir.path().join(".github");
    std::fs::create_dir_all(github.join("outputs")).unwrap();
    std::fs::write(
        github.join("outputs/all_modified_files.json"),
        r#"[".github/services-config.json"]"#,
    )
    .unwrap();
    let mut config = serde_json::json!({"services": {
        "ready": {},
        "pending": {"bootstrap_pending": "Requires first-time setup"},
        "paused": {"deploy_enabled": false}
    }});
    for expected in [
        serde_json::json!(["paused", "ready"]),
        serde_json::json!(["paused", "pending", "ready"]),
    ] {
        std::fs::write(github.join("services-config.json"), config.to_string()).unwrap();
        let output_path = dir.path().join("output");
        std::fs::write(&output_path, "").unwrap();
        let output = std::process::Command::new("bash")
            .args([
                "-euo",
                "pipefail",
                "-c",
                &detect_affected_services().value.run.unwrap(),
            ])
            .current_dir(dir.path())
            .env("GITHUB_OUTPUT", &output_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let result = std::fs::read_to_string(output_path).unwrap();
        assert!(
            result
                .lines()
                .any(|line| line == format!("services={expected}")),
            "{result}"
        );
        config["services"]["pending"]
            .as_object_mut()
            .unwrap()
            .remove("bootstrap_pending");
    }
}

#[test]
fn sqlx_changes_preview_every_service() {
    let detect = detect_affected_services();
    let run = detect
        .value
        .run
        .expect("detect step should be a run script");
    assert!(
        run.contains(r#"$file" == .sqlx/*"#),
        "a root-only .sqlx change must fan out to every stack, not services=[]: {run}"
    );
}

#[test]
fn detect_reads_the_json_changed_file_list() {
    let run = detect_affected_services()
        .value
        .run
        .expect("detect step should be a run script");
    assert!(
        !run.contains("all_changed_files.txt"),
        "the space-joined .txt output has no newline, so `while read` sees no files: {run}"
    );
    assert!(
        run.contains(r#"jq -r '.[]' .github/outputs/all_modified_files.json > "$changed_files""#)
            && run.matches(r#"done < "$changed_files""#).count() == 3,
        "every matching loop must read the JSON list, deletions included: {run}"
    );
    let with = serde_json::to_string(&changed_files().value.with).expect("with serializes");
    assert!(
        with.contains(r#""json":"true""#) && with.contains(r#""escape_json":"false""#),
        "{with}"
    );
}
