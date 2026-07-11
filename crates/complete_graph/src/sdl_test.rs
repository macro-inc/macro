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
        "properties: [GraphqlSoupProperty!]!",
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
