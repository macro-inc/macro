use serde_json::{Value, json};

fn variant<'a>(schema: &'a Value, tag: &str) -> &'a Value {
    schema["oneOf"]
        .as_array()
        .expect("a value schema is a oneOf of its tagged forms")
        .iter()
        .find(|form| form["properties"]["type"]["enum"] == json!([tag]))
        .unwrap_or_else(|| panic!("no {tag} form"))
}

#[test]
fn only_the_date_form_documents_has_time_beside_its_value() {
    for schema in [
        <crate::api::PropertyValue as utoipa::PartialSchema>::schema(),
        <crate::service::property_value::PropertyValue as utoipa::PartialSchema>::schema(),
    ] {
        let schema = serde_json::to_value(schema).expect("schema serializes");
        let date = variant(&schema, "Date");
        assert_eq!(date["properties"]["has_time"]["type"], json!("boolean"));
        assert_eq!(date["properties"]["value"]["format"], json!("date-time"));
        assert!(
            !date["required"]
                .as_array()
                .expect("required fields")
                .contains(&json!("has_time")),
            "has_time is optional"
        );
        for tag in [
            "Boolean",
            "Number",
            "String",
            "DateRange",
            "SelectOption",
            "EntityReference",
            "Link",
        ] {
            assert!(
                variant(&schema, tag)["properties"]
                    .get("has_time")
                    .is_none(),
                "{tag} has no has_time"
            );
        }
    }
}
