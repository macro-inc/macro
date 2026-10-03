use super::*;

#[test]
fn initiative_id_round_trips_uuid_strings() {
    let id = InitiativeId::generate();
    let parsed = InitiativeId::from_str(&id.to_string()).expect("uuid string");
    assert_eq!(parsed, id);
    assert_eq!(InitiativeId::from_uuid(id.as_uuid()), id);
}

#[test]
fn update_request_has_no_description_field() {
    let request: UpdateInitiativeRequest = serde_json::from_value(serde_json::json!({
        "name": "Renamed",
        "description": "edited in the collaborative editor instead"
    }))
    .expect("unknown fields are ignored");
    assert_eq!(
        request,
        UpdateInitiativeRequest {
            name: Some("Renamed".into()),
            ..Default::default()
        }
    );
    let json = serde_json::to_value(UpdateInitiativeRequest::default()).expect("json");
    assert_eq!(json, serde_json::json!({}));
}

#[test]
fn create_request_deserializes_camel_case() {
    let request: CreateInitiativeRequest = serde_json::from_value(serde_json::json!({
        "name": "Launch",
        "memberIds": ["macro|a@macro.com"],
        "shareWithTeam": true
    }))
    .expect("request");
    assert_eq!(request.name, "Launch");
    assert_eq!(
        request.member_ids.as_deref(),
        Some(["macro|a@macro.com".to_string()].as_slice())
    );
    assert_eq!(request.share_with_team, Some(true));
}
