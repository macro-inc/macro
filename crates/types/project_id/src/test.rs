use super::*;

#[test]
fn a_project_id_is_its_string_on_the_wire() {
    let id = ProjectId::from("10000000-0000-0000-0000-000000000006");
    let json = serde_json::to_string(&id).unwrap();
    assert_eq!(json, r#""10000000-0000-0000-0000-000000000006""#);
    assert_eq!(serde_json::from_str::<ProjectId>(&json).unwrap(), id);
    assert_eq!(id.to_string(), "10000000-0000-0000-0000-000000000006");
    assert_eq!(id.as_str(), "10000000-0000-0000-0000-000000000006");
}

#[test]
fn historical_ids_need_not_be_uuids() {
    assert_eq!(ProjectId::from("root-project").as_str(), "root-project");
}

#[cfg(feature = "schema")]
#[test]
fn the_openapi_schema_is_a_documented_string() {
    use utoipa::{PartialSchema, ToSchema};

    assert_eq!(<ProjectId as ToSchema>::name(), "ProjectId");
    let schema = serde_json::to_value(<ProjectId as PartialSchema>::schema()).unwrap();
    assert_eq!(schema["type"], "string");
    assert!(schema.get("format").is_none());
}

#[cfg(feature = "sqlx")]
#[test]
fn postgres_stores_a_project_id_as_text() {
    use sqlx::postgres::PgArgumentBuffer;
    use sqlx::{Encode, Postgres, Type};

    assert_eq!(
        <ProjectId as Type<Postgres>>::type_info(),
        <String as Type<Postgres>>::type_info()
    );
    let id = ProjectId::from("root-project");
    let mut id_buffer = PgArgumentBuffer::default();
    let mut text_buffer = PgArgumentBuffer::default();
    let _ = <ProjectId as Encode<Postgres>>::encode_by_ref(&id, &mut id_buffer).unwrap();
    let _ = <&str as Encode<Postgres>>::encode_by_ref(&"root-project", &mut text_buffer).unwrap();
    assert_eq!(*id_buffer, *text_buffer);
}
