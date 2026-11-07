use super::*;

#[test]
fn round_trips_through_display_and_from_str() {
    let id = HarnessId::TEST_A;
    let text = id.to_string();
    let parsed: HarnessId = text.parse().expect("display output parses");
    assert_eq!(parsed, id);
}

#[test]
fn rejects_non_uuid_input() {
    let error = HarnessId::parse_uuid_str("not-a-uuid").unwrap_err();
    assert_eq!(error.to_string(), "invalid harness id: not-a-uuid");
}

#[test]
fn serde_is_transparent() {
    let id = HarnessId::TEST_B;
    let json = serde_json::to_string(&id).expect("serializes");
    assert_eq!(json, format!("\"{}\"", id.as_uuid()));
    let back: HarnessId = serde_json::from_str(&json).expect("deserializes");
    assert_eq!(back, id);
}

// Wire characterization: these pin what the hand-written impls produced, so
// switching the implementation cannot change the OpenAPI schema or the
// Postgres encoding.

#[cfg(feature = "schema")]
#[test]
fn openapi_schema_is_a_plain_string_named_harness_id() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<HarnessId as ToSchema>::name(), "HarnessId");
    let schema =
        serde_json::to_string(&<HarnessId as PartialSchema>::schema()).expect("serializes");
    assert_eq!(schema, r#"{"type":"string"}"#);
}

#[cfg(feature = "sqlx")]
#[test]
fn postgres_type_is_uuid() {
    use sqlx::postgres::PgHasArrayType;
    use sqlx::{Postgres, Type};

    assert_eq!(
        <HarnessId as Type<Postgres>>::type_info(),
        <Uuid as Type<Postgres>>::type_info()
    );
    assert!(<HarnessId as Type<Postgres>>::compatible(&<Uuid as Type<
        Postgres,
    >>::type_info(
    )));
    assert_eq!(
        <HarnessId as PgHasArrayType>::array_type_info(),
        <Uuid as PgHasArrayType>::array_type_info()
    );
}

#[cfg(feature = "sqlx")]
#[test]
fn postgres_encoding_is_the_uuid_bytes() {
    use sqlx::postgres::PgArgumentBuffer;
    use sqlx::{Encode, Postgres};

    let id = HarnessId::TEST_A;
    let mut id_buffer = PgArgumentBuffer::default();
    let mut uuid_buffer = PgArgumentBuffer::default();
    let _ = <HarnessId as Encode<Postgres>>::encode_by_ref(&id, &mut id_buffer).expect("encodes");
    let _ = <Uuid as Encode<Postgres>>::encode_by_ref(&id.as_uuid(), &mut uuid_buffer)
        .expect("encodes");
    assert_eq!(*id_buffer, *uuid_buffer);
    assert_eq!(id_buffer.len(), 16);
}
