use super::*;

#[test]
fn query_root_is_present() {
    let root = type_meta(QUERY_ROOT_TYPE).expect("query root type");
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
    let name = MUTATION_ROOT_TYPE.expect("schema has a mutation root");
    let root = type_meta(name).expect("mutation root type");
    assert_eq!(root.kind, TypeKind::Object);
    assert!(root.key_fields.is_none());
    assert!(root.fields.iter().any(|f| f.name == "setEntityProperty"));
}

#[test]
fn subscription_root_is_present() {
    let name = SUBSCRIPTION_ROOT_TYPE.expect("schema has a subscription root");
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
fn frontend_artifact_matches_validated_sdl_metadata() {
    let schema = Schema::from_json(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../apps/web/src/lib/graphql-cache/schema-artifact.json"
    )))
    .unwrap();
    assert_eq!(schema.hash(), bundled_schema_ref().hash());
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
