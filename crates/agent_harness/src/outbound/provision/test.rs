use super::{ENSURE_READY_SCRIPT, SIDECAR_PORT};
use crate::domain::model::{EGRESS_URL_VARIABLE, SESSION_TOKEN_VARIABLE};

/// The script and the Rust constants name the same things. Asserted rather
/// than commented because the two are edited months apart, and a rename on
/// either side would otherwise show up only as a sandbox that never clones.
#[test]
fn the_script_and_the_harness_agree_on_shared_names() {
    assert!(ENSURE_READY_SCRIPT.contains(&format!("sidecar_port={SIDECAR_PORT}")));
    assert!(ENSURE_READY_SCRIPT.contains(&format!("${{{EGRESS_URL_VARIABLE}%/}}/git")));
    assert!(ENSURE_READY_SCRIPT.contains(&format!("${SESSION_TOKEN_VARIABLE}")));
}

/// The sandbox holds no GitHub credential and is told no repository: it clones
/// from the proxy, which reads both off the session's own grant.
#[test]
fn clone_uses_session_egress_without_a_github_token() {
    assert!(!ENSURE_READY_SCRIPT.contains("GITHUB_TOKEN"));
    assert!(!ENSURE_READY_SCRIPT.contains("REPO_URL"));
    assert!(!ENSURE_READY_SCRIPT.contains("gh auth"));
}
