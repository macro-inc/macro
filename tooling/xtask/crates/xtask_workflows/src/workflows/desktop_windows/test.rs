use super::*;

fn smoke_yaml() -> String {
    desktop_windows_smoke()
        .to_string()
        .expect("smoke workflow should serialize")
}

#[test]
fn smoke_build_is_never_signed_or_published() {
    let yaml = smoke_yaml();
    assert!(yaml.contains("SIGN: 'false'"), "{yaml}");
    assert!(!yaml.contains("id-token"), "{yaml}");
    assert!(!yaml.contains("environment:"), "{yaml}");
    assert!(!yaml.contains("secrets.POSTHOG_API_KEY"), "{yaml}");
    assert!(!yaml.contains("vars.WINDOWS_"), "{yaml}");
}

#[test]
fn smoke_launches_on_a_runner_that_can_start_webview2() {
    let yaml = smoke_yaml();
    assert!(yaml.contains("runs-on: windows-2025"), "{yaml}");
    assert!(yaml.contains("LAUNCH: 'true'"), "{yaml}");
    assert!(
        yaml.contains("EXPECT_SIGNED: ${{ needs.build-windows.outputs.signed }}"),
        "{yaml}"
    );
}
