use super::*;

#[test]
fn parses_the_three_tiers() {
    assert_eq!("small".parse(), Ok(SandboxSize::Small));
    assert_eq!("default".parse(), Ok(SandboxSize::Default));
    assert_eq!("large".parse(), Ok(SandboxSize::Large));
    assert!("medium".parse::<SandboxSize>().is_err());
}

#[test]
fn round_trips_json_as_camel_case_names() {
    assert_eq!(
        serde_json::to_value(SandboxSize::Default).unwrap(),
        serde_json::json!("default")
    );
    assert_eq!(
        serde_json::from_value::<SandboxSize>(serde_json::json!("large")).unwrap(),
        SandboxSize::Large
    );
}
