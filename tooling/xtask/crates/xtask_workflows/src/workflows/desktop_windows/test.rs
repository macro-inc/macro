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
