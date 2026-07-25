#[test]
fn soup_response_schema_exposes_frontend_fields() {
    let sdl = crate::build_schema().sdl();

    for expected in [
        "type GraphqlSoupChannel {",
        "organizationId: ID",
        "interactedAt: String",
        "isParticipant: Boolean!",
        "participantIds: [String!]!",
        "participants: [GraphqlSoupChannelParticipant!]!",
        "latestMessage: GraphqlSoupChannelMessage",
        "latestNonThreadMessage: GraphqlSoupChannelMessage",
        "type GraphqlSoupEmailThread {",
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
        "type GraphqlSoupCall {",
        "channelName: String",
        "customName: String",
        "status: String!",
        "participantIds: [String!]!",
        "participants: [GraphqlSoupCallParticipant!]!",
        "type GraphqlSoupChat {",
        "deletedAt: String",
        "type GraphqlSoupProject {",
        "type SoupSubscriptionRoot {",
        "soupUpdates: GraphqlSoupItem!",
    ] {
        assert_sdl_line(&sdl, expected);
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
