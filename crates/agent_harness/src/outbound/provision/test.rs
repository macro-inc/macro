use super::*;

/// The script and the Rust constant have to agree, because the harness dials
/// the sidecar on the port the script started it on.
#[test]
fn the_sidecar_port_matches_the_script() {
    assert!(
        ENSURE_READY_SCRIPT.contains(&format!("sidecar_port={SIDECAR_PORT}")),
        "provision::SIDECAR_PORT must match the port in ensure_ready.sh"
    );
}

/// Regression: `git clone <url> <dir>` used to be what created the workspace,
/// so making the clone conditional left a repo-less persona starting its
/// harness in a directory that did not exist. opencode exits immediately, and
/// the session hangs on "waiting for harness" until it is reaped.
#[test]
fn the_workspace_is_created_even_without_a_repo() {
    let script = ENSURE_READY_SCRIPT;
    let mkdir = script
        .find(r#"mkdir -p "$workspace_dir""#)
        .expect("the workspace is created unconditionally");
    let clone = script
        .find("git clone --depth 1")
        .expect("the repo is still cloned when there is one");
    assert!(
        mkdir < clone,
        "the workspace must exist before anything tries to clone into it"
    );
}

#[test]
fn the_clone_is_skipped_when_no_repo_was_named() {
    assert!(
        ENSURE_READY_SCRIPT.contains(r#"[ -n "${REPO_URL:-}" ]"#),
        "an absent REPO_URL must not reach git"
    );
}

/// The prompt file is written on every boot, and the harness config is told to
/// read it. Both matter: writing a file nothing reads would leave the agent
/// answering as itself rather than as the persona, with nothing failing.
#[test]
fn the_persona_prompt_is_written_and_actually_read() {
    let script = ENSURE_READY_SCRIPT;
    assert!(
        script.contains(r#"printf %s "${MACRO_PERSONA_PROMPT:-}""#),
        "the prompt is written from the environment, unset or not"
    );
    assert!(
        script.contains("config.instructions.push(file)"),
        "the harness config must name the prompt file, whatever snapshot this is"
    );
}
