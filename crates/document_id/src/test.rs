use super::*;

#[test]
fn strings_are_preserved_and_empty_is_rejected() {
    for text in ["legacy-id", "ü", "A936AD5C-957D-4C79-9F20-71EE894DF23F"] {
        let id: DocumentId = text.parse().unwrap();
        assert_eq!(id.as_str(), text);
        assert_eq!(id.to_string(), text);
        assert_eq!(
            serde_json::to_string(&id).unwrap(),
            serde_json::to_string(text).unwrap()
        );
        assert_eq!(
            serde_json::from_str::<DocumentId>(&serde_json::to_string(text).unwrap()).unwrap(),
            id
        );
        let map = std::collections::HashMap::from([(id, 1)]);
        assert_eq!(map.get(text), Some(&1));
    }
    assert_eq!(
        "".parse::<DocumentId>(),
        Err(DocumentIdError::PredicateViolated)
    );
    assert!(serde_json::from_str::<DocumentId>("\"\"").is_err());
}

#[cfg(feature = "sqlx")]
#[test]
fn sqlx_type_is_text() {
    use sqlx::{Type, postgres::PgHasArrayType};
    assert_eq!(
        <DocumentId as Type<sqlx::Postgres>>::type_info(),
        <String as Type<sqlx::Postgres>>::type_info()
    );
    assert_eq!(
        <DocumentId as PgHasArrayType>::array_type_info(),
        <String as PgHasArrayType>::array_type_info()
    );
}

#[cfg(feature = "schema")]
#[test]
fn openapi_schema_is_string() {
    use utoipa::PartialSchema;
    assert_eq!(
        serde_json::to_value(DocumentId::schema()).unwrap()["type"],
        "string"
    );
}

#[test]
fn document_validation_and_uuid_conversion() {
    assert_eq!(
        DocumentIdError::PredicateViolated.to_string(),
        "invalid document id"
    );
    assert_eq!(
        DocumentId::try_from("legacy-id").unwrap().as_str(),
        "legacy-id"
    );
    for text in ["", " a", "a\n", "a\u{7}", "a "] {
        assert!(text.parse::<DocumentId>().is_err());
        assert!(serde_json::from_str::<DocumentId>(&serde_json::to_string(text).unwrap()).is_err());
    }
    let legacy: DocumentId = "legacy-id".parse().unwrap();
    assert!(legacy.is_legacy());
    assert_eq!(legacy.as_uuid(), None);
    let upper: DocumentId = "A936AD5C-957D-4C79-9F20-71EE894DF23F".parse().unwrap();
    assert!(!upper.is_legacy());
    assert_eq!(
        DocumentId::from_uuid(upper.as_uuid().unwrap()).as_str(),
        "a936ad5c-957d-4c79-9f20-71ee894df23f"
    );
}
