use super::*;

#[test]
fn query_root_is_present() {
    let root = type_meta(bundled_schema_ref().query_root()).expect("query root type");
    assert_eq!(root.kind, TypeKind::Object);
    assert!(root.key_fields.is_none());
    assert!(root.fields.iter().any(|f| f.name == "user"));

    // The viewer object is keyed by presence-of-id.
    let user = type_meta("GraphqlUser").expect("user type");
    assert_eq!(user.key_fields, Some(vec!["id".to_owned()]));
    assert!(user.fields.iter().any(|f| f.name == "soup"));
}

#[test]
fn mutation_root_is_present() {
    let name = bundled_schema_ref()
        .mutation_root()
        .expect("schema has a mutation root");
    let root = type_meta(name).expect("mutation root type");
    assert_eq!(root.kind, TypeKind::Object);
    assert!(root.key_fields.is_none());
    assert!(root.fields.iter().any(|f| f.name == "setEntityProperty"));
}

#[test]
fn subscription_root_is_present() {
    let name = bundled_schema_ref()
        .subscription_root()
        .expect("schema has a subscription root");
    let root = type_meta(name).expect("subscription root type");
    assert_eq!(root.kind, TypeKind::Object);
    assert!(root.key_fields.is_none());
    assert!(root.fields.iter().any(|field| field.name == "soupUpdates"));
}

#[test]
fn interface_possible_types() {
    let entity = type_meta("GraphqlSoupEntity").expect("entity interface");
    assert_eq!(entity.kind, TypeKind::Interface);
    assert!(
        entity
            .possible_types
            .contains(&"GraphqlSoupDocument".to_owned())
    );
    assert!(
        entity
            .possible_types
            .contains(&"GraphqlSoupForeignEntity".to_owned())
    );
    assert!(
        entity
            .possible_types
            .contains(&"GraphqlSoupCalendarEvent".to_owned())
    );
    assert!(
        entity
            .possible_types
            .contains(&"GraphqlSoupCrmContact".to_owned())
    );
    assert!(
        entity
            .possible_types
            .contains(&"GraphqlSoupAgentSession".to_owned())
    );
    assert!(
        entity
            .possible_types
            .contains(&"GraphqlSoupInitiative".to_owned())
    );
    assert!(
        entity
            .possible_types
            .contains(&"GraphqlSoupDatabaseRow".to_owned())
    );
    assert_eq!(entity.possible_types.len(), 14);
    assert!(type_matches("GraphqlSoupDocument", "GraphqlSoupEntity"));
    assert!(type_matches("GraphqlSoupInitiative", "GraphqlSoupEntity"));
    assert!(!type_matches("GraphqlSoupItem", "GraphqlSoupEntity"));
}

#[test]
fn presence_of_id_convention_applied() {
    assert_eq!(
        type_meta("GraphqlSoupDocument").unwrap().key_fields,
        Some(vec!["id".to_owned()])
    );
    // Renamed from `messageId` so the convention keys it.
    assert_eq!(
        type_meta("GraphqlSoupChannelMessage").unwrap().key_fields,
        Some(vec!["id".to_owned()])
    );
    // Property assignments have globally unique database ids and are
    // normalized independently from their shared definitions.
    assert_eq!(
        type_meta("GraphqlProperty").unwrap().key_fields,
        Some(vec!["id".to_owned()])
    );
    assert!(field_meta("GraphqlProperty", "propertyDefinitionId").is_some());
    // No id field → embedded.
    assert_eq!(type_meta("SoupPage").unwrap().key_fields, None);
    assert_eq!(
        type_meta("GraphqlSoupChannelParticipant")
            .unwrap()
            .key_fields,
        None
    );
}

#[test]
fn field_shapes() {
    // properties: [GraphqlProperty!]!
    let f = field_meta("GraphqlSoupDocument", "properties").unwrap();
    assert_eq!(f.ty.name, "GraphqlProperty");
    assert_eq!(f.ty.kind, FieldKind::Composite);
    assert!(!f.ty.nullable && f.ty.list && !f.ty.item_nullable);

    // viewedAt: String (nullable leaf)
    let f = field_meta("GraphqlSoupDocument", "viewedAt").unwrap();
    assert_eq!(f.ty.kind, FieldKind::Leaf);
    assert!(f.ty.nullable && !f.ty.list);

    // sourceMetadata: JSON! (opaque scalar); metadata is now the shared
    // structured interface field.
    let f = field_meta("GraphqlSoupForeignEntity", "sourceMetadata").unwrap();
    assert_eq!(f.ty.kind, FieldKind::OpaqueScalar);
    assert!(!f.ty.nullable);

    // items: [GraphqlSoupEntity!]! (composite link to the entity interface)
    let f = field_meta("SoupPage", "items").unwrap();
    assert_eq!(f.ty.kind, FieldKind::Composite);
    assert_eq!(f.ty.name, "GraphqlSoupEntity");
    assert!(f.ty.list);
}

#[test]
fn schema_hash_present() {
    assert_eq!(SCHEMA_HASH.len(), 64);
}

#[test]
fn rejects_unsupported_versions_duplicates_and_dangling_types() {
    let mut artifact = bundled_schema_ref().artifact().clone();
    artifact.format_version += 1;
    assert!(Schema::from_artifact(artifact).is_err());
    let mut artifact = bundled_schema_ref().artifact().clone();
    artifact.types.push(artifact.types[0].clone());
    assert!(Schema::from_artifact(artifact).is_err());
    let mut artifact = bundled_schema_ref().artifact().clone();
    let field = artifact
        .types
        .iter_mut()
        .flat_map(|t| &mut t.fields)
        .find(|f| f.ty.kind == FieldKind::Composite)
        .unwrap();
    field.ty.name = "MissingRuntimeType".into();
    assert!(Schema::from_artifact(artifact).is_err());
}

#[test]
fn merge_rejects_shape_changes_without_mutating_active_metadata() {
    let old = bundled_schema();
    let mut artifact = old.artifact().clone();
    let ty = artifact
        .types
        .iter_mut()
        .find(|t| t.name == "GraphqlUser")
        .unwrap();
    let field = ty.fields.iter_mut().find(|f| f.name != "id").unwrap();
    field.ty.nullable = !field.ty.nullable;
    let incoming = Schema::from_artifact(artifact).unwrap();
    let hash = old.hash().to_owned();
    assert!(old.merge(&incoming).is_err());
    assert_eq!(old.hash(), hash);
}

#[test]
fn runtime_sdl_resolves_extensions_interfaces_unions_and_field_shapes() {
    let schema = Schema::from_sdl(
        r#"
        scalar JSON
        enum Status { OPEN CLOSED }
        interface Node { id: ID! }
        interface Named implements Node { id: ID! name: String! }
        type Item implements Node & Named { id: ID! name: String! status: Status! data: JSON }
        type Embedded { value: String }
        union Result = Item | Embedded
        type Query { results: [Result!]! nodes: [Node] }
        extend type Item { labels: [String!] details: Embedded }
        "#,
    )
    .unwrap();
    assert!(schema.type_matches("Item", "Node"));
    assert!(schema.type_matches("Item", "Named"));
    assert!(schema.type_matches("Embedded", "Result"));
    assert_eq!(
        schema.type_meta("Item").unwrap().key_fields,
        Some(vec!["id".into()])
    );
    assert!(schema.type_meta("Embedded").unwrap().key_fields.is_none());
    let labels = schema.field_meta("Item", "labels").unwrap().ty;
    assert!(labels.list && labels.nullable && !labels.item_nullable);
    let nodes = schema.field_meta("Query", "nodes").unwrap().ty;
    assert!(nodes.list && nodes.nullable && nodes.item_nullable);
    let results = schema.field_meta("Query", "results").unwrap().ty;
    assert!(results.list && !results.nullable && !results.item_nullable);
    assert_eq!(
        schema.field_meta("Item", "status").unwrap().ty.kind,
        FieldKind::Leaf
    );
    assert_eq!(
        schema.field_meta("Item", "data").unwrap().ty.kind,
        FieldKind::OpaqueScalar
    );
    assert_eq!(
        schema.field_meta("Item", "details").unwrap().ty.kind,
        FieldKind::Composite
    );
    let persisted = serde_json::to_string(schema.artifact()).unwrap();
    assert_eq!(Schema::from_json(&persisted).unwrap().hash(), schema.hash());
}

#[test]
fn runtime_sdl_rejects_invalid_graphql_and_unsupported_cache_shapes() {
    for sdl in [
        "type Query {",
        "type Query { value: Missing }",
        "type Query { value: String value: Int }",
        "interface Node { id: ID! } type Item implements Node { id: String! } type Query { item: Item }",
        "type Query { values: [[String]] }",
        "type Query { id: ID! }",
        "type Query { item: Item } type Item { id: ID }",
        "type Query { item: Item } type Item { id: String! }",
    ] {
        assert!(Schema::from_sdl(sdl).is_err(), "accepted {sdl}");
    }
}

#[test]
fn runtime_sdl_identity_ignores_formatting_and_definition_order() {
    let first = Schema::from_sdl("type Query { a: String b: Item } type Item { id: ID! }").unwrap();
    let second =
        Schema::from_sdl("# new bundle\ntype Item { id: ID! } type Query { b: Item, a: String }")
            .unwrap();
    assert_eq!(first.hash(), second.hash());
}
