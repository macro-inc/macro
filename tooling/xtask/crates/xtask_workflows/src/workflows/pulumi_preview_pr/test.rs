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
