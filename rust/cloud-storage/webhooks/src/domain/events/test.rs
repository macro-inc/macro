use super::*;

#[test]
fn known_events_resolve() {
    assert!(is_known("channel.message.created"));
    assert!(!is_known("channel.message.exploded"));
}

#[test]
fn envelope_fields_are_always_allowed() {
    let schema = lookup("channel.message.created").unwrap();
    for field in ENVELOPE_FIELDS {
        assert!(schema.allows_field(field), "{field} should be allowed");
    }
}

#[test]
fn channel_id_maps_to_channel_resource() {
    let schema = lookup("channel.message.created").unwrap();
    assert_eq!(
        schema.resource_entity_for("data.channel_id"),
        Some(EntityType::Channel)
    );
    assert_eq!(schema.resource_entity_for("data.message_id"), None);
}
