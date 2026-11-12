use super::*;

#[test]
fn a_channel_id_is_its_uuid_string_on_the_wire() {
    let id = ChannelId(Uuid::from_u128(0xc4a));
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, r#""00000000-0000-0000-0000-000000000c4a""#);
    assert_eq!(serde_json::from_str::<ChannelId>(&json).unwrap(), id);
}

#[cfg(feature = "schema")]
#[test]
fn the_openapi_schema_is_unchanged() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<ChannelId as ToSchema>::name(), "ChannelId");
    assert_eq!(
        serde_json::to_string(&<ChannelId as PartialSchema>::schema()).unwrap(),
        r#"{"type":"string","format":"uuid","description":"Channel id for soup channel payloads."}"#
    );
}
