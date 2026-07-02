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

fn assert_sdl_line(sdl: &str, expected: &str) {
    assert!(
        sdl.lines().any(|line| line.trim() == expected),
        "schema missing exact line `{expected}`"
    );
}
