use super::*;
use uuid::Uuid;

#[test]
fn a_message_id_is_its_uuid_string_on_the_wire() {
    let id = MessageId::from_uuid(Uuid::from_u128(0x3e5));
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, r#""00000000-0000-0000-0000-0000000003e5""#);
    assert_eq!(serde_json::from_str::<MessageId>(&json).unwrap(), id);
}

#[cfg(feature = "schema")]
#[test]
fn the_openapi_schema_is_a_documented_uuid_string() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<MessageId as ToSchema>::name(), "MessageId");
    assert_eq!(
        serde_json::to_string(&<MessageId as PartialSchema>::schema()).unwrap(),
        r#"{"type":"string","format":"uuid","description":"The id of a message."}"#
    );
}

#[cfg(feature = "sqlx")]
#[test]
fn postgres_stores_a_message_id_as_its_uuid() {
    use sqlx::postgres::PgArgumentBuffer;
    use sqlx::{Encode, Postgres, Type};

    assert_eq!(
        <MessageId as Type<Postgres>>::type_info(),
        <Uuid as Type<Postgres>>::type_info()
    );
    let id = MessageId::from_uuid(Uuid::from_u128(0x3e5));
    let mut id_buffer = PgArgumentBuffer::default();
    let mut uuid_buffer = PgArgumentBuffer::default();
    let _ = <MessageId as Encode<Postgres>>::encode_by_ref(&id, &mut id_buffer).unwrap();
    let _ = <Uuid as Encode<Postgres>>::encode_by_ref(id.as_uuid(), &mut uuid_buffer).unwrap();
    assert_eq!(*id_buffer, *uuid_buffer);
}
