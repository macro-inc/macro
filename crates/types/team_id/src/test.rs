use super::*;
use uuid::Uuid;

#[test]
fn a_team_id_is_its_uuid_string_on_the_wire() {
    let id = TeamId::from_uuid(Uuid::from_u128(0x7ea));
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, r#""00000000-0000-0000-0000-0000000007ea""#);
    assert_eq!(serde_json::from_str::<TeamId>(&json).unwrap(), id);
}

#[cfg(feature = "schema")]
#[test]
fn the_openapi_schema_is_a_documented_uuid_string() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<TeamId as ToSchema>::name(), "TeamId");
    assert_eq!(
        serde_json::to_string(&<TeamId as PartialSchema>::schema()).unwrap(),
        r#"{"type":"string","format":"uuid","description":"The id of a Macro team."}"#
    );
}

#[cfg(feature = "sqlx")]
#[test]
fn postgres_stores_a_team_id_as_its_uuid() {
    use sqlx::postgres::PgArgumentBuffer;
    use sqlx::{Encode, Postgres, Type};

    assert_eq!(
        <TeamId as Type<Postgres>>::type_info(),
        <Uuid as Type<Postgres>>::type_info()
    );
    let id = TeamId::from_uuid(Uuid::from_u128(0x7ea));
    let mut id_buffer = PgArgumentBuffer::default();
    let mut uuid_buffer = PgArgumentBuffer::default();
    let _ = <TeamId as Encode<Postgres>>::encode_by_ref(&id, &mut id_buffer).unwrap();
    let _ = <Uuid as Encode<Postgres>>::encode_by_ref(id.as_uuid(), &mut uuid_buffer).unwrap();
    assert_eq!(*id_buffer, *uuid_buffer);
}
