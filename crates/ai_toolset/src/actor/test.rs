use super::*;

#[test]
fn account_selection_is_explicit_and_never_substitutes_the_owner() {
    let owner = MacroUserIdStr::try_from_email("owner@example.com").unwrap();
    let requester = MacroUserIdStr::try_from_email("requester@example.com").unwrap();
    assert!(ToolActor::take(&json!({"query": "private"})).is_err());
    assert!(ToolActor::take(&json!({"acting_as": "somebody@example.com"})).is_err());
    let (actor, arguments) =
        ToolActor::take(&json!({"acting_as": "requester", "query": "private"})).unwrap();
    assert_eq!(arguments, json!({"query": "private"}));
    assert_eq!(actor.resolve(&owner, Some(&requester)).unwrap(), &requester);
    assert!(actor.resolve(&owner, None).is_err());
    assert_eq!(ToolActor::Owner.resolve(&owner, None).unwrap(), &owner);
}

#[test]
fn routing_schema_preserves_required_arguments_and_is_idempotent() {
    let mut schema = json!({"type":"object", "properties":{"query":{"type":"string"}}, "required":["query"], "additionalProperties":false}).as_object().unwrap().clone();
    add_actor_schema(&mut schema);
    add_actor_schema(&mut schema);
    assert_eq!(schema["required"], json!(["query", "acting_as"]));
    assert_eq!(schema["properties"]["query"], json!({"type":"string"}));
    assert_eq!(schema["additionalProperties"], false);
}

#[derive(schemars::JsonSchema)]
#[expect(dead_code, reason = "only its schema is read")]
struct Input {
    acting_as: ToolActor,
}

#[test]
fn derived_and_injected_schemas_are_the_same_plain_enum() {
    let derived = schemars::schema_for!(Input).to_value();
    let mut injected = json!({"type":"object"}).as_object().unwrap().clone();
    add_actor_schema(&mut injected);
    assert_eq!(
        derived["properties"]["acting_as"],
        injected["properties"]["acting_as"]
    );
    assert_eq!(
        derived["properties"]["acting_as"]["enum"],
        json!(["requester", "owner"])
    );
    assert!(derived.get("$defs").is_none(), "{derived}");
}

#[test]
fn only_a_role_deserializes_and_a_refusal_never_repeats_the_value() {
    assert_eq!(
        serde_json::from_value::<ToolActor>(json!("requester")).unwrap(),
        ToolActor::Requester
    );
    assert_eq!(
        serde_json::from_value::<ToolActor>(json!("owner")).unwrap(),
        ToolActor::Owner
    );
    for refused in [
        json!("macro|owner@example.com"),
        json!("owner@example.com"),
        json!("Owner"),
        json!(1),
    ] {
        let message = serde_json::from_value::<ToolActor>(refused.clone())
            .unwrap_err()
            .to_string();
        assert!(
            message.contains("expected requester or owner (a role, never a person id)"),
            "{refused}: {message}"
        );
        assert!(!message.contains("example.com"), "{refused}: {message}");
    }
    assert_eq!(
        serde_json::to_value(ToolActor::Owner).unwrap(),
        json!("owner")
    );
}
