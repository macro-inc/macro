use super::*;

#[test]
fn strings_are_preserved_and_empty_is_rejected() {
    for text in ["legacy-id", "ü", "A936AD5C-957D-4C79-9F20-71EE894DF23F"] {
        let id: LexicalNodeId = text.parse().unwrap();
        assert_eq!(id.as_str(), text);
        assert_eq!(id.to_string(), text);
        assert_eq!(
            serde_json::to_string(&id).unwrap(),
            serde_json::to_string(text).unwrap()
        );
        assert_eq!(
            serde_json::from_str::<LexicalNodeId>(&serde_json::to_string(text).unwrap()).unwrap(),
            id
        );
        let map = std::collections::HashMap::from([(id, 1)]);
        assert_eq!(map.get(text), Some(&1));
    }
    assert_eq!(
        "".parse::<LexicalNodeId>(),
        Err(LexicalNodeIdError::PredicateViolated)
    );
    assert!(serde_json::from_str::<LexicalNodeId>("\"\"").is_err());
}

#[cfg(feature = "sqlx")]
#[test]
fn sqlx_type_is_text() {
    use sqlx::{Type, postgres::PgHasArrayType};
    assert_eq!(
        <LexicalNodeId as Type<sqlx::Postgres>>::type_info(),
        <String as Type<sqlx::Postgres>>::type_info()
    );
    assert_eq!(
        <LexicalNodeId as PgHasArrayType>::array_type_info(),
        <String as PgHasArrayType>::array_type_info()
    );
}

#[cfg(feature = "schema")]
#[test]
fn openapi_schema_is_string() {
    use utoipa::PartialSchema;
    assert_eq!(
        serde_json::to_value(LexicalNodeId::schema()).unwrap()["type"],
        "string"
    );
}

#[test]
fn stored_ids_and_generated_diagnostics() {
    assert_eq!(LexicalNodeId::from_stored(""), None);
    for value in ["  x ", "a", "ü", "\n", "x".repeat(64).as_str()] {
        assert_eq!(LexicalNodeId::from_stored(value).unwrap().as_str(), value);
    }
    for (text, expected) in [
        ("Ab3_-xY9", true),
        ("Ab3_-xY9123", true),
        ("Ab3_+xY9", false),
        ("123456789012345678901", false),
    ] {
        assert_eq!(
            text.parse::<LexicalNodeId>().unwrap().is_generated_form(),
            expected
        );
    }
    assert_eq!(
        NANOID_URL_ALPHABET,
        b"useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"
    );
}
