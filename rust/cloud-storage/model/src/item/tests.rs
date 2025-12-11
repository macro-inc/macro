/**
 * Item type needs to generate good types for the frontend
 * using reference schemas.
 *
 * It is imortant that it references schemas _and_ can be used
 * as a normal rust type.
 */
use super::*;
use utoipa::ToSchema;
#[test]
fn test_expected_schema() {
    // very good schema ok yes!
    #[derive(Serialize, Deserialize, ToSchema)]
    #[serde(untagged)]
    #[schema(
        discriminator(property_name = "type", mapping(
         ("document" = "#/components/schemas/BasicDocument"),
         ("chat" = "#/components/schemas/Chat"),
         ("project" = "#/components/schemas/Project"),
    )))]
    enum ItemDerivedSchema {
        Document(BasicDocument),
        Chat(Chat),
        Project(Project),
    }

    let expected_schema = serde_json::to_string_pretty(&ItemDerivedSchema::schema()).unwrap();
    let mut expected_schemas = Vec::new();
    ItemDerivedSchema::schemas(&mut expected_schemas);

    let actual_schema = serde_json::to_string_pretty(&Item::schema()).unwrap();
    let mut actual_schemas = Vec::new();
    Item::schemas(&mut actual_schemas);

    expected_schemas.sort_by(|a, b| a.0.cmp(&b.0));
    actual_schemas.sort_by(|a, b| a.0.cmp(&b.0));
    let expected_schemas = expected_schemas
        .iter()
        .map(|e| serde_json::to_string_pretty(e).unwrap())
        .collect::<Vec<_>>()
        .join("\n");

    let actual_schemas = actual_schemas
        .iter()
        .map(|e| serde_json::to_string_pretty(e).unwrap())
        .collect::<Vec<_>>()
        .join("\n");

    assert_eq!(expected_schemas, actual_schemas, "all");
    assert_eq!(expected_schema, actual_schema, "single");
}

#[test]
fn test_reference() {
    let schema = Item::schema();

    match schema {
        utoipa::openapi::RefOr::T(utoipa::openapi::Schema::OneOf(one_of)) => {
            let discriminator = one_of
                .discriminator
                .as_ref()
                .expect("Discriminator should exist");
            assert_eq!(discriminator.property_name, "type");

            assert_eq!(discriminator.mapping.len(), 3);
            assert_eq!(
                discriminator.mapping.get("document"),
                Some(&"#/components/schemas/BasicDocument".to_string())
            );
            assert_eq!(
                discriminator.mapping.get("chat"),
                Some(&"#/components/schemas/Chat".to_string())
            );
            assert_eq!(
                discriminator.mapping.get("project"),
                Some(&"#/components/schemas/Project".to_string())
            );

            // Check that we have exactly 3 items in the OneOf
            assert_eq!(one_of.items.len(), 3);

            let refs: Vec<String> = one_of
                .items
                .iter()
                .filter_map(|item| match item {
                    utoipa::openapi::RefOr::Ref(r) => Some(r.ref_location.clone()),
                    _ => None,
                })
                .collect();

            assert!(refs.contains(&"#/components/schemas/BasicDocument".to_string()));
            assert!(refs.contains(&"#/components/schemas/Chat".to_string()));
            assert!(refs.contains(&"#/components/schemas/Project".to_string()));
        }
        _ => panic!("Expected OneOf schema"),
    }

    // Verify that schemas() includes all subschemas
    let mut schemas = Vec::new();
    Item::schemas(&mut schemas);

    let schema_names: Vec<String> = schemas.iter().map(|(name, _)| name.clone()).collect();
    assert!(schema_names.contains(&"BasicDocument".to_string()));
    assert!(schema_names.contains(&"Chat".to_string()));
    assert!(schema_names.contains(&"Project".to_string()));
}

#[test]
fn test_document_serde() {
    let doc = BasicDocument {
        document_id: "doc123".to_string(),
        document_version_id: 1,
        owner: "user1".to_string(),
        document_name: "Test Document".to_string(),
        file_type: Some("pdf".to_string()),
        sha: Some("abc123".to_string()),
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: Some(chrono::Utc::now()),
        updated_at: Some(chrono::Utc::now()),
        deleted_at: None,
        sub_type: None,
    };

    let item = Item::Document(doc.clone());

    let json = serde_json::to_string(&item).expect("Serialization should succeed");

    let deserialized: Item = serde_json::from_str(&json).expect("Deserialization should succeed");

    match deserialized {
        Item::Document(d) => {
            assert_eq!(doc.document_id, d.document_id);
            assert_eq!(doc.document_name, d.document_name);
        }
        _ => panic!("expected document"),
    }
}

#[test]
fn test_chat_serde() {
    let chat = Chat {
        id: "chat123".to_string(),
        name: "Test Chat".to_string(),
        user_id: "user1".to_string(),
        model: Some("claude-3".to_string()),
        project_id: None,
        created_at: Some(chrono::Utc::now()),
        updated_at: Some(chrono::Utc::now()),
        token_count: Some(100),
        is_persistent: true,
        deleted_at: None,
    };

    let item = Item::Chat(chat.clone());
    let json = serde_json::to_string(&item).expect("Serialization should succeed");

    assert!(json.contains("\"type\":\"chat\""));

    let deserialized: Item = serde_json::from_str(&json).expect("Deserialization should succeed");

    match deserialized {
        Item::Chat(c) => {
            assert_eq!(chat.id, c.id);
            assert_eq!(chat.name, c.name);
        }
        _ => panic!("expected chat"),
    }
}

#[test]
fn test_project_serde() {
    // Create a sample Project
    let project = Project {
        id: "proj123".to_string(),
        name: "Test Project".to_string(),
        user_id: "user1".to_string(),
        parent_id: None,
        created_at: Some(chrono::Utc::now()),
        updated_at: Some(chrono::Utc::now()),
        deleted_at: None,
    };

    let item = Item::Project(project.clone());
    let json = serde_json::to_string(&item).expect("Serialization should succeed");

    println!("{}", json);
    let deserialized: Item = serde_json::from_str(&json).expect("Deserialization should succeed");

    match deserialized {
        Item::Project(p) => {
            assert_eq!(project.id, p.id);
            assert_eq!(project.name, p.name);
        }
        _ => panic!("expecte project"),
    }
}
