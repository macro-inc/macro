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
