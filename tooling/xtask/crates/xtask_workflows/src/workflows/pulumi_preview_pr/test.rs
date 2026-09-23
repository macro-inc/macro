use super::*;

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
    let with = serde_json::to_string(&changed_files().value.with).expect("with serializes");
    assert!(
        with.contains(r#""json":"true""#) && with.contains(r#""escape_json":"false""#),
        "{with}"
    );
}
