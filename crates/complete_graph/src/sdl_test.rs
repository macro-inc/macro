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
        "input EmailThreadInput {",
        "threadId: ID!",
        "emailLabels: [GraphqlSoupEmailLabel!]!",
        "emailLinks: [GraphqlEmailLink!]!",
        "emailThread(input: EmailThreadInput!): GraphqlSoupEmailThread",
        "type GraphqlSoupEmailThread implements GraphqlSoupEntity {",
        "providerId: String",
        "inboxVisible: Boolean!",
        "linkId: ID!",
        "latestInboundMessageTs: String",
        "senderPhotoUrl: String",
        "participants: [GraphqlSoupEmailParticipant!]!",
        "attachments: [GraphqlSoupEmailAttachment!]!",
        "labels: [GraphqlSoupEmailLabel!]!",
        "type GraphqlEmailLink {",
        "macroId: String!",
        "emailAddress: String!",
        "photoUrl: String",
        "provider: GraphqlEmailProvider!",
        "isSyncActive: Boolean!",
        "syncStatus: GraphqlEmailSyncStatus!",
        "needsReauth: Boolean!",
        "settings: GraphqlEmailLinkSettings!",
        "isPrimary: Boolean!",
        "type GraphqlEmailLinkSettings {",
        "signatureOnRepliesForwards: Boolean!",
        "signature: String",
        "properties: [GraphqlProperty!]!",
        "messages(offset: Int, limit: Int): [GraphqlSoupEmailMessage!]!",
        "latestContentMessage: GraphqlSoupEmailMessage",
        "type GraphqlSoupEmailMessage {",
        "replyingToId: ID",
        "scheduledSendTime: String",
        "isDraft: Boolean!",
        "bodyParsed: String",
        "bodyHtmlSanitized: String",
        "bodyReplyless: String",
        "attachments: [GraphqlSoupEmailMessageAttachment!]!",
        "attachmentsDraft: [GraphqlSoupEmailDraftAttachment!]!",
        "attachmentsForwarded: [GraphqlSoupEmailForwardedAttachment!]!",
        "type GraphqlSoupEmailMessageAttachment {",
        "sfsId: ID",
        "type GraphqlSoupEmailDraftAttachment {",
        "type GraphqlSoupEmailForwardedAttachment {",
        "type GraphqlSoupCall implements GraphqlSoupEntity {",
        "channelName: String",
        "customName: String",
        "status: String!",
        "participantIds: [String!]!",
        "participants: [GraphqlSoupCallParticipant!]!",
        "type GraphqlSoupChat implements GraphqlSoupEntity {",
        "deletedAt: String",
        "type GraphqlSoupProject implements GraphqlSoupEntity {",
        "parent: GraphqlEntity",
        "type GraphqlCacheDeletion {",
        "graphqlTypeName: String!",
        "entityId: ID!",
        "type SoupUpdated {",
        "item: GraphqlSoupEntity",
        "union SoupPatch = SoupUpdated | GraphqlCacheDeletion",
        "type GraphqlMutationSuccess {",
        "effects: [SoupPatch!]!",
        "setEntityFavorite(entity: EntityRefInput!, favorite: Boolean!): GraphqlEntityMutationResult!",
        "reorderFavorites(input: ReorderFavoritesInput!): [GraphqlFavorite!]!",
        "input ReorderFavoritesInput {",
        "favorites: [EntityRefInput!]!",
        "type GraphqlFavorite {",
        "entityType: GraphqlEntityType!",
        "entityId: ID!",
        "sortOrder: Float!",
        "recordChannelActivity(input: RecordChannelActivityInput!): GraphqlChannelActivity!",
        "updateNotifications(input: UpdateNotificationsInput!): [GraphqlNotification!]!",
        "updateNotificationsForEntity(input: UpdateNotificationsForEntityInput!): [GraphqlNotification!]!",
        "input UpdateNotificationsForEntityInput {",
        "entities: [NotificationEntityInput!]!",
        "input NotificationEntityInput {",
        "entityType: GraphqlEntityType!",
        "entityId: ID!",
        "markEmailThreadSeen(input: MarkEmailThreadSeenInput!): GraphqlSoupEmailThread!",
        "updateEmailThreadLabel(input: UpdateEmailThreadLabelInput!): GraphqlSoupEmailThread!",
        "input MarkEmailThreadSeenInput {",
        "input UpdateEmailThreadLabelInput {",
        "labelId: ID!",
        "value: Boolean!",
        "enum ChannelActivityType {",
        "enum NotificationUpdateOperation {",
        "MARK_SEEN",
        "MARK_DONE",
        "MARK_UNDONE",
        "type CompleteSubscriptionRoot {",
        "soupUpdates: [SoupPatch!]!",
        "notificationUpdates: GraphqlNotificationPatch!",
        "union GraphqlNotificationPatch = GraphqlNewNotification | GraphqlUpdatedNotification | GraphqlCacheDeletion",
        "type GraphqlNewNotification {",
        "notification: GraphqlNotification!",
        "type GraphqlUpdatedNotification {",
        "type GraphqlNotification {",
        "metadata: GraphqlNotifEvent!",
    ] {
        assert_sdl_line(&sdl, expected);
    }
    assert!(
        sdl.contains("union GraphqlNotifEvent = GraphqlChannelMentionMetadata |"),
        "notification metadata must be represented by the typed event union"
    );
    assert_eq!(
        sdl.lines()
            .filter(|line| line.trim() == "metadata: GraphqlNotifEvent!")
            .count(),
        1,
        "stored and realtime notifications must share one typed metadata field"
    );
    assert!(!sdl.contains("GraphqlRealtimeNotification"));
    assert!(!sdl.contains("GraphqlSoupNotification"));
    assert!(
        !sdl.lines()
            .any(|line| line.trim() == "type GraphqlEntityRef {"),
        "Soup metadata must reuse the canonical GraphqlEntity object"
    );
    assert_eq!(
        sdl.matches("type GraphqlSoupEmailLabel {").count(),
        1,
        "thread labels and the user catalog must share one normalized typename"
    );
    assert!(
        !sdl.to_ascii_lowercase().contains("fusionauth"),
        "internal FusionAuth identifiers must not enter the GraphQL contract"
    );
}

#[test]
fn activity_overview_is_a_user_scoped_embedded_value() {
    use apollo_compiler::schema::ExtendedType;

    let schema =
        apollo_compiler::Schema::parse_and_validate(crate::build_schema().sdl(), "schema.graphql")
            .expect("generated SDL is valid");
    let ExtendedType::Object(user) = schema.types.get("GraphqlUser").expect("user type exists")
    else {
        panic!("GraphqlUser must be an object");
    };
    assert!(user.fields.contains_key("activityOverview"));

    for name in [
        "GraphqlActivityOverview",
        "GraphqlActivityDay",
        "GraphqlActivityEntityRank",
    ] {
        let ExtendedType::Object(value) =
            schema.types.get(name).expect("overview value type exists")
        else {
            panic!("{name} must be an object");
        };
        assert!(
            !value.fields.contains_key("id"),
            "{name} must remain embedded under GraphqlUser"
        );
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
        "cacheProjection",
        "activity",
    ] {
        assert!(
            entity.fields.contains_key(shared_field),
            "Soup interface missing shared field {shared_field}"
        );
    }
    let cache_projection = entity
        .fields
        .get("cacheProjection")
        .expect("Soup interface cache projection field exists");
    assert!(
        cache_projection.arguments.is_empty(),
        "cacheProjection must remain argument-free"
    );
    assert_eq!(cache_projection.ty.to_string(), "SoupCacheProjection");

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
        "cacheProjection",
        "activity",
    ] {
        assert!(
            document.fields.contains_key(shared_field),
            "Soup document missing shared field {shared_field}"
        );
    }
    assert!(
        !document.fields.contains_key("isEmailAttachment"),
        "relation-backed projection facts must not become document business fields"
    );

    for name in [
        "GraphqlSoupCalendarEvent",
        "GraphqlSoupDocument",
        "GraphqlSoupChat",
        "GraphqlSoupProject",
        "GraphqlSoupEmailThread",
        "GraphqlSoupChannel",
        "GraphqlSoupChannelMessage",
        "GraphqlSoupCall",
        "GraphqlSoupCrmCompany",
        "GraphqlSoupForeignEntity",
        "GraphqlSoupReminder",
    ] {
        let ExtendedType::Object(object) = schema.types.get(name).expect("Soup object exists")
        else {
            panic!("{name} must be an object");
        };
        assert!(
            object.fields.contains_key("cacheProjection"),
            "{name} must implement the shared cacheProjection field"
        );
    }

    for name in ["SoupPage", "SoupUpdated"] {
        let ExtendedType::Object(object) = schema.types.get(name).expect("Soup wrapper exists")
        else {
            panic!("{name} must be an object");
        };
        assert!(
            !object.fields.contains_key("cacheProjection"),
            "{name} must not carry entity projection metadata"
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
