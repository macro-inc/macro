use std::io::Write;

/// Run the privacy scan over `body` as a PR body and say whether it passed.
fn passes(body: &str) -> bool {
    let mut file = tempfile::NamedTempFile::new().expect("body file");
    file.write_all(body.as_bytes()).expect("write body");
    let output = std::process::Command::new("bash")
        .arg("-c")
        .arg(include_str!("../scripts/pr_privacy_check.sh"))
        .env_remove("BASH_ENV")
        .env_remove("PR_NUMBER")
        .env_remove("PR_TITLE")
        .env_remove("PR_BODY")
        .env("PR_BODY_FILE", file.path())
        // No commits to scan: only the body.
        .env("CHECK_BASE", "HEAD")
        .output()
        .expect("run privacy scan");
    output.status.success()
}

const CHANNEL: &str = "https://macro.com/app/channel/0198a1b2-0000-7000-8000-000000000001?channel_message_id=0198a1b2-0000-7000-8000-000000000002&channel_thread_id=0198a1b2-0000-7000-8000-000000000003";
const ROUTINE: &str = "https://macro.com/app/routines/0198a1b2-0000-7000-8000-000000000004";
const SESSION: &str = "https://macro.com/app/agent/0198a1b2-0000-7000-8000-000000000005";

fn block(lines: &str) -> String {
    format!("<!-- macro-agent-links -->\n{lines}\n<!-- /macro-agent-links -->\n")
}

#[test]
fn channel_and_routine_links_pass_only_inside_a_closed_links_block() {
    let inside = block(&format!(
        "Macro agent session: {SESSION}\n\nSource (channel message): {CHANNEL}\n\nSource (routine): {ROUTINE}"
    ));
    assert!(passes(&format!("## Why\n\nText.\n\n{inside}")));
    // GitHub's web editor saves descriptions with CRLF line endings.
    assert!(passes(&inside.replace('\n', "\r\n")));
    // Task and agent-session links are fine anywhere.
    assert!(passes(&format!(
        "See {SESSION} and https://macro.com/app/task/abc-1"
    )));

    assert!(!passes(&format!("Started from {CHANNEL}")));
    assert!(!passes(&format!("Started from {ROUTINE}")));
    // A block that never closes does not exempt what follows it.
    assert!(!passes(&format!(
        "<!-- macro-agent-links -->\nSource: {CHANNEL}\n"
    )));
    // Inside the block, only the exact id-only shapes pass.
    assert!(!passes(&block(&format!("Source: {ROUTINE}?customer=Name"))));
    assert!(!passes(&block("Source: https://macro.com/app/md/abc-1")));
}
