use graphql_channel::ChannelWriteActor;

use super::*;

const PERSON: ChannelWriteActor = ChannelWriteActor {
    organization_id: None,
    human_session: true,
};

fn writable(harness: &TestHarness, reads: &Arc<Reads>) -> ChannelGraphqlContext {
    harness
        .state
        .entity_access
        .writable_channels
        .lock()
        .expect("channel access lock")
        .insert(CHANNEL_ID);
    context(harness, reads)
        .with_commands(Arc::clone(reads), Arc::clone(&harness.state.entity_access))
}

async fn mutate(
    harness: &TestHarness,
    context: &ChannelGraphqlContext,
    actor: Option<ChannelWriteActor>,
    field: &str,
) -> async_graphql::Response {
    let mut request = harness
        .request(&format!("mutation {{ {field} }}"), authenticated_parts())
        .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).expect("valid user id"))
        .data(context.clone());
    if let Some(actor) = actor {
        request = request.data(actor);
    }
    harness.schema.execute(request).await
}

fn data(response: async_graphql::Response, field: &str) -> Value {
    assert!(response.errors.is_empty(), "{field}: {:?}", response.errors);
    response.data.into_json().expect("GraphQL JSON")[field].clone()
}

fn code(response: &async_graphql::Response) -> String {
    let error = response.errors.first().expect("a GraphQL error");
    serde_json::to_value(error).expect("error JSON")["extensions"]["code"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

async fn stored(pool: &PgPool, id: Uuid) -> i64 {
    sqlx::query_scalar!("SELECT count(*) FROM comms_messages WHERE id = $1", id)
        .fetch_one(pool)
        .await
        .expect("count messages")
        .unwrap_or_default()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_send_repeated_by_the_queue_stores_one_message_and_returns_it_again(pool: PgPool) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let context = writable(&harness, &reads);
    let id = Uuid::now_v7();
    let send = format!(
        "sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\", content: \"Queued hello\", nonce: \"{id}\" }}) {{ {} }}",
        message_selection()
    );
    let first = data(
        mutate(&harness, &context, Some(PERSON), &send).await,
        "sendChannelMessage",
    );
    let second = data(
        mutate(&harness, &context, Some(PERSON), &send).await,
        "sendChannelMessage",
    );
    assert_eq!(first, second);
    assert_eq!(first["id"], json!(id.to_string()));
    assert_eq!(first["channelId"], json!(CHANNEL_ID.to_string()));
    assert_eq!(first["content"], json!("Queued hello"));
    assert_eq!(first["senderId"], json!(VALID_USER_ID));
    assert_eq!(first["thread"]["replyCount"], json!(0));
    assert_eq!(stored(&pool, id).await, 1);

    // The read path returns the same record the mutation did.
    let read = execute(
        &harness,
        &context,
        &format!(
            "channelMessage(channelId: \"{CHANNEL_ID}\", messageId: \"{id}\") {{ {} }}",
            message_selection()
        ),
    )
    .await;
    assert_eq!(read["channelMessage"], first);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reply_edit_reaction_and_repeated_delete_return_the_stored_message(pool: PgPool) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let context = writable(&harness, &reads);
    let root = Uuid::now_v7();
    let reply = Uuid::now_v7();
    data(
        mutate(
            &harness,
            &context,
            Some(PERSON),
            &format!("sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{root}\", content: \"Root\" }}) {{ id }}"),
        )
        .await,
        "sendChannelMessage",
    );
    let sent = data(
        mutate(
            &harness,
            &context,
            Some(PERSON),
            &format!("sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", threadId: \"{root}\", content: \"Reply\" }}) {{ id threadId sortKey }}"),
        )
        .await,
        "sendChannelMessage",
    );
    assert_eq!(sent["threadId"], json!(root.to_string()));

    let edited = data(
        mutate(
            &harness,
            &context,
            Some(PERSON),
            &format!("editChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", content: \"Reply, edited\" }}) {{ content editedAt sortKey }}"),
        )
        .await,
        "editChannelMessage",
    );
    assert_eq!(edited["content"], json!("Reply, edited"));
    assert!(edited["editedAt"].is_string());
    assert_eq!(edited["sortKey"], sent["sortKey"]);

    let react = format!(
        "reactToChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", emoji: \"👍\", add: true }}) {{ reactions {{ emoji users }} }}"
    );
    let reacted = data(
        mutate(&harness, &context, Some(PERSON), &react).await,
        "reactToChannelMessage",
    );
    let again = data(
        mutate(&harness, &context, Some(PERSON), &react).await,
        "reactToChannelMessage",
    );
    assert_eq!(reacted, again);
    assert_eq!(
        reacted["reactions"],
        json!([{ "emoji": "👍", "users": [VALID_USER_ID] }])
    );

    let delete = format!(
        "deleteChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\" }}) {{ id content deletedAt }}"
    );
    let deleted = data(
        mutate(&harness, &context, Some(PERSON), &delete).await,
        "deleteChannelMessage",
    );
    let repeated = data(
        mutate(&harness, &context, Some(PERSON), &delete).await,
        "deleteChannelMessage",
    );
    assert_eq!(deleted, repeated);
    assert_eq!(deleted["content"], json!(""));
    assert!(deleted["deletedAt"].is_string());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writes_need_a_personal_session_write_access_and_a_valid_change(pool: PgPool) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let id = Uuid::now_v7();
    let send = format!(
        "sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\", content: \"Nope\" }}) {{ id }}"
    );

    // A viewer without write access.
    let read_only = context(&harness, &reads)
        .with_commands(Arc::clone(&reads), Arc::clone(&harness.state.entity_access));
    assert_eq!(
        code(&mutate(&harness, &read_only, Some(PERSON), &send).await),
        "FORBIDDEN"
    );

    let context = writable(&harness, &reads);
    // A token or an agent acting for the person, and a request without a
    // verified credential kind.
    let token = ChannelWriteActor {
        organization_id: None,
        human_session: false,
    };
    assert_eq!(
        code(&mutate(&harness, &context, Some(token), &send).await),
        "FORBIDDEN"
    );
    assert_eq!(
        code(&mutate(&harness, &context, None, &send).await),
        "FORBIDDEN"
    );
    assert_eq!(stored(&pool, id).await, 0);

    // An id that is not a UUIDv7, an edit that changes nothing, and a message
    // that does not exist.
    let forged = Uuid::from_u128(1);
    assert_eq!(
        code(
            &mutate(
                &harness,
                &context,
                Some(PERSON),
                &format!("sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{forged}\", content: \"x\" }}) {{ id }}"),
            )
            .await
        ),
        "BAD_USER_INPUT"
    );
    assert_eq!(
        code(
            &mutate(
                &harness,
                &context,
                Some(PERSON),
                &format!("editChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\" }}) {{ id }}"),
            )
            .await
        ),
        "BAD_USER_INPUT"
    );
    assert_eq!(
        code(
            &mutate(
                &harness,
                &context,
                Some(PERSON),
                &format!("deleteChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\" }}) {{ id }}"),
            )
            .await
        ),
        "NOT_FOUND"
    );
}
