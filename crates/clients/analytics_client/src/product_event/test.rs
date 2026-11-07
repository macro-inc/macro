use super::*;
use serde_json::json;

#[test]
fn team_member_events_carry_environment_and_team_group() {
    let team_id = uuid::Uuid::parse_str("7f9c2b1e-3d4a-4c5b-8e6f-1a2b3c4d5e6f").unwrap();

    let properties = ProductEventProperties::new(
        json!({ "provider": "linear" }),
        Environment::Production,
        Some(team_id),
    );

    assert_eq!(
        serde_json::to_value(properties).unwrap(),
        json!({
            "provider": "linear",
            "env": "PROD",
            "macro_environment": "prod",
            "team_id": "7f9c2b1e-3d4a-4c5b-8e6f-1a2b3c4d5e6f",
            "$groups": { "team": "7f9c2b1e-3d4a-4c5b-8e6f-1a2b3c4d5e6f" },
        })
    );
}

#[test]
fn events_without_a_team_omit_the_group() {
    let properties =
        ProductEventProperties::new(json!({ "provider": "linear" }), Environment::Develop, None);

    assert_eq!(
        serde_json::to_value(properties).unwrap(),
        json!({ "provider": "linear", "env": "DEV", "macro_environment": "dev" })
    );
}
