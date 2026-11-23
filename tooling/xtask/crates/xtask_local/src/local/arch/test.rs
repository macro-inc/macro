use super::*;

#[test]
fn macos_gets_an_actionable_error_instead_of_a_broken_stack() {
    let message = ensure_linux("macos").unwrap_err().to_string();
    assert!(message.contains("--binaries-dir"), "{message}");
    assert!(message.contains("bun run dev"), "{message}");
}

#[test]
fn linux_passes() {
    ensure_linux("linux").unwrap();
}
