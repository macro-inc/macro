#[test]
fn soup_response_schema_exposes_frontend_fields() {
    let sdl = crate::build_schema().sdl();

    for expected in [
        "type GraphqlSoupChannel implements GraphqlSoupEntity {",
        "organizationId: ID",
        "interactedAt: String",
        "isParticipant: Boolean!",
        "participantIds: [String!]!",
        "participants: [GraphqlSoupChannelParticipant!]!",
        "latestMessage: GraphqlSoupChannelMessagePreview",
        "latestNonThreadMessage: GraphqlSoupChannelMessagePreview",
        "type GraphqlSoupEmailThread implements GraphqlSoupEntity {",
        "providerId: String",
        "inboxVisible: Boolean!",
        "linkId: ID",
        "senderPhotoUrl: String",
        "participants: [GraphqlSoupEmailParticipant!]!",
        "attachments: [GraphqlSoupEmailAttachment!]!",
        "labels: [GraphqlSoupEmailLabel!]!",
        "properties: [GraphqlProperty!]!",
        "latestContentMessage: GraphqlSoupEmailMessage",
        "type GraphqlSoupEmailMessage {",
        "bodyParsed: String",
        "bodyHtmlSanitized: String",
        "bodyReplyless: String",
        "type GraphqlSoupCall implements GraphqlSoupEntity {",
        "channelName: String",
        "customName: String",
        "status: String!",
        "participantIds: [String!]!",
        "participants: [GraphqlSoupCallParticipant!]!",
        "type GraphqlSoupChat implements GraphqlSoupEntity {",
        "deletedAt: String",
        "type GraphqlSoupProject implements GraphqlSoupEntity {",
        "type SoupSubscriptionRoot {",
        "soupUpdates: GraphqlSoupEntity!",
    ] {
        assert_sdl_line(&sdl, expected);
    }
}

#[test]
fn soup_interface_exposes_the_complete_shared_entity_contract() {
    use apollo_compiler::schema::ExtendedType;

    let schema =
        apollo_compiler::Schema::parse_and_validate(crate::build_schema().sdl(), "schema.graphql")
            .expect("generated SDL is valid");
    let ExtendedType::Interface(entity) = schema
        .types
        .get("GraphqlSoupEntity")
        .expect("Soup entity interface exists")
    else {
        panic!("GraphqlSoupEntity must be an interface");
    };

    for shared_field in [
        "id",
        "entityType",
        "displayName",
        "metadata",
        "properties",
        "notifications",
        "isFavorited",
        "viewerPermission",
        "frecencyScore",
    ] {
        assert!(
            entity.fields.contains_key(shared_field),
            "Soup interface missing shared field {shared_field}"
        );
    }
    assert!(
        !schema.types.contains_key("GraphqlSoupItem"),
        "soup items are entities directly; no query-scoped wrapper type"
    );
    assert!(
        !entity.fields.contains_key("content"),
        "entity-specific content must not be flattened into the shared Soup interface"
    );

    let ExtendedType::Object(document) = schema
        .types
        .get("GraphqlSoupDocument")
        .expect("Soup document type exists")
    else {
        panic!("GraphqlSoupDocument must be an object");
    };
    for shared_field in [
        "isFavorited",
        "viewerPermission",
        "properties",
        "notifications",
    ] {
        assert!(
            document.fields.contains_key(shared_field),
            "Soup document missing shared field {shared_field}"
        );
    }
}

#[test]
fn schema_types_and_fields_have_descriptions() {
    use apollo_compiler::schema::ExtendedType;

    let schema =
        apollo_compiler::Schema::parse_and_validate(crate::build_schema().sdl(), "schema.graphql")
            .expect("generated SDL is valid");

    let mut missing = Vec::new();
    for (name, graphql_type) in &schema.types {
        if graphql_type.is_built_in() {
            continue;
        }
        if graphql_type.description().is_none() {
            missing.push(format!("type {name}"));
        }

        match graphql_type {
            ExtendedType::Object(ty) => collect_undocumented(
                &mut missing,
                name,
                ty.fields
                    .iter()
                    .map(|(name, field)| (name, field.description.is_none())),
            ),
            ExtendedType::Interface(ty) => collect_undocumented(
                &mut missing,
                name,
                ty.fields
                    .iter()
                    .map(|(name, field)| (name, field.description.is_none())),
            ),
            ExtendedType::InputObject(ty) => collect_undocumented(
                &mut missing,
                name,
                ty.fields
                    .iter()
                    .map(|(name, field)| (name, field.description.is_none())),
            ),
            ExtendedType::Enum(ty) => collect_undocumented(
                &mut missing,
                name,
                ty.values
                    .iter()
                    .map(|(name, value)| (name, value.description.is_none())),
            ),
            ExtendedType::Scalar(_) | ExtendedType::Union(_) => {}
        }
    }

    assert!(
        missing.is_empty(),
        "GraphQL schema items missing descriptions: {}",
        missing.join(", ")
    );
}

fn collect_undocumented<'a>(
    missing: &mut Vec<String>,
    type_name: &str,
    items: impl Iterator<Item = (&'a apollo_compiler::Name, bool)>,
) {
    for (name, is_undocumented) in items {
        if is_undocumented {
            missing.push(format!("{type_name}.{name}"));
        }
    }
}

#[test]
fn property_values_are_a_typed_union_without_soup_names() {
    let sdl = crate::build_schema().sdl();

    assert_sdl_line(
        &sdl,
        "union GraphqlPropertyValue = GraphqlBooleanPropertyValue | GraphqlNumberPropertyValue | GraphqlStringPropertyValue | GraphqlDatePropertyValue | GraphqlSelectOptionPropertyValue | GraphqlEntityReferencePropertyValue | GraphqlLinkPropertyValue",
    );
    assert!(!sdl.contains("GraphqlSoupProperty"));
    assert!(!sdl.contains("GraphqlSoupDataType"));
}

/// The exported SDL is a frontend contract: `schema.graphql` feeds the client
/// codegen and the normalized-cache metadata. Splitting the schema across
/// crates must never change it silently — regenerate with
/// `cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql`.
#[test]
fn sdl_matches_committed_schema_graphql() {
    let sdl = crate::build_schema().sdl();
    assert_eq!(
        format!("{sdl}\n"),
        include_str!("../../../static_assets/schema.graphql"),
        "generated SDL diverges from the committed schema.graphql"
    );
}

fn assert_sdl_line(sdl: &str, expected: &str) {
    assert!(
        sdl.lines().any(|line| line.trim() == expected),
        "schema missing exact line `{expected}`"
    );
}
