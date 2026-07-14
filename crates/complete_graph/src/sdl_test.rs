#[test]
fn soup_response_schema_exposes_frontend_fields() {
    let sdl = crate::build_schema().sdl();

    for expected in [
        "type GraphqlSoupChannel {",
        "organizationId: ID",
        "interactedAt: String",
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
    ] {
        assert_sdl_line(&sdl, expected);
    }
}

#[tokio::test]
async fn schema_types_and_fields_have_descriptions() {
    let response = crate::build_schema()
        .execute(
            "{ __schema { types { kind name description fields { name description } inputFields { name description } enumValues { name description } } } }",
        )
        .await;
    assert!(
        response.errors.is_empty(),
        "introspection failed: {:?}",
        response.errors
    );

    let data = response
        .data
        .into_json()
        .expect("introspection data is JSON");
    let types = data["__schema"]["types"]
        .as_array()
        .expect("introspection returns schema types");

    let mut missing = Vec::new();
    for graphql_type in types {
        let name = graphql_type["name"].as_str().expect("type has a name");
        let kind = graphql_type["kind"].as_str().expect("type has a kind");
        if name.starts_with("__") || kind == "SCALAR" {
            continue;
        }
        if graphql_type["description"].as_str().is_none() {
            missing.push(format!("type {name}"));
        }
        for collection in ["fields", "inputFields", "enumValues"] {
            let Some(items) = graphql_type[collection].as_array() else {
                continue;
            };
            for item in items {
                if item["description"].as_str().is_none() {
                    missing.push(format!("{name}.{}", item["name"]));
                }
            }
        }
    }

    assert!(
        missing.is_empty(),
        "GraphQL schema items missing descriptions: {}",
        missing.join(", ")
    );
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
