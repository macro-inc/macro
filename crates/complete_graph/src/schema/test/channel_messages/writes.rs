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

/// A mutation's whole payload: the written message and a reply's root.
fn payload(response: async_graphql::Response, field: &str) -> Value {
    assert!(response.errors.is_empty(), "{field}: {:?}", response.errors);
    response.data.into_json().expect("GraphQL JSON")[field].clone()
}

/// The written message of a mutation's payload.
fn data(response: async_graphql::Response, field: &str) -> Value {
    payload(response, field)["message"].clone()
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
        "sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\", content: \"Queued hello\", nonce: \"{id}\" }}) {{ message {{ {} }} }}",
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
            &format!("sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{root}\", content: \"Root\" }}) {{ message {{ id }} }}"),
        )
        .await,
        "sendChannelMessage",
    );
    let send_reply = format!(
        "sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", threadId: \"{root}\", content: \"Reply\" }}) {{ message {{ id threadId sortKey createdAt }} root {{ id thread {{ replyCount latestReplyAt }} }} }}"
    );
    let first_send = payload(
        mutate(&harness, &context, Some(PERSON), &send_reply).await,
        "sendChannelMessage",
    );
    let sent = first_send["message"].clone();
    assert_eq!(sent["threadId"], json!(root.to_string()));
    // The reply's root comes back counting it, so one commit updates both.
    assert_eq!(first_send["root"]["id"], json!(root.to_string()));
    assert_eq!(first_send["root"]["thread"]["replyCount"], json!(1));
    assert_eq!(
        first_send["root"]["thread"]["latestReplyAt"],
        sent["createdAt"]
    );
    // A replay answered from storage carries the root too.
    let replayed = payload(
        mutate(&harness, &context, Some(PERSON), &send_reply).await,
        "sendChannelMessage",
    );
    assert_eq!(replayed, first_send);

    let edit = format!(
        "editChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", content: \"Reply, edited\" }}) {{ message {{ content editedAt sortKey }} }}"
    );
    let edited = data(
        mutate(&harness, &context, Some(PERSON), &edit).await,
        "editChannelMessage",
    );
    // A replayed edit finds nothing to change and keeps the first edit's time.
    let replayed_edit = data(
        mutate(&harness, &context, Some(PERSON), &edit).await,
        "editChannelMessage",
    );
    assert_eq!(replayed_edit, edited);
    assert_eq!(edited["content"], json!("Reply, edited"));
    assert!(edited["editedAt"].is_string());
    assert_eq!(edited["sortKey"], sent["sortKey"]);

    let react = format!(
        "reactToChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", emoji: \"👍\", add: true }}) {{ message {{ reactions {{ emoji users }} }} }}"
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
        "deleteChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\" }}) {{ message {{ id content deletedAt }} root {{ id thread {{ replyCount }} }} }}"
    );
    let deleted = payload(
        mutate(&harness, &context, Some(PERSON), &delete).await,
        "deleteChannelMessage",
    );
    let repeated = payload(
        mutate(&harness, &context, Some(PERSON), &delete).await,
        "deleteChannelMessage",
    );
    assert_eq!(deleted, repeated);
    assert_eq!(deleted["message"]["content"], json!(""));
    assert!(deleted["message"]["deletedAt"].is_string());
    // The root no longer counts the deleted reply.
    assert_eq!(deleted["root"]["thread"]["replyCount"], json!(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writes_need_a_personal_session_write_access_and_a_valid_change(pool: PgPool) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let id = Uuid::now_v7();
    let send = format!(
        "sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\", content: \"Nope\" }}) {{ message {{ id }} }}"
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
                &format!("sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{forged}\", content: \"x\" }}) {{ message {{ id }} }}"),
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
                &format!("editChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\" }}) {{ message {{ id }} }}"),
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
                &format!("deleteChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\" }}) {{ message {{ id }} }}"),
            )
            .await
        ),
        "NOT_FOUND"
    );
}

/// Every reference is viewable.
struct AllReferences;
impl messages::domain::ports::MessageReferenceAccess for AllReferences {
    fn can_view<'a>(
        &'a self,
        _: &'a entity_access::domain::models::EntityAccessAuth,
        _: EntityType,
        _: &'a str,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = Result<bool, messages::domain::ports::MessageError>> + Send + 'a>,
    > {
        Box::pin(async { Ok(true) })
    }
}

/// `@here` reaches two people, one of whom is also mentioned by name.
struct Members;
impl messages::domain::ports::MessageGroupRecipients for Members {
    fn channel_members<'s, 'f>(&'s self, _: Uuid) -> MembersFuture<'f>
    where
        's: 'f,
        Self: 'f,
    {
        Box::pin(async {
            Ok(["macro|a@example.com", "macro|b@example.com"]
                .map(|id| MacroUserIdStr::parse_from_str(id).expect("valid member id"))
                .to_vec())
        })
    }
}
/// What `MessageGroupRecipients` returns.
type MembersFuture<'f> = std::pin::Pin<
    Box<
        dyn Future<
                Output = Result<
                    Vec<MacroUserIdStr<'static>>,
                    messages::domain::ports::MessageError,
                >,
            > + Send
            + 'f,
    >,
>;

/// The channel's committed position.
async fn channel_seq(pool: &PgPool) -> i64 {
    sqlx::query_scalar!(
        "SELECT seq FROM channel_change_counters WHERE channel_id = $1",
        CHANNEL_ID,
    )
    .fetch_one(pool)
    .await
    .expect("channel counter")
}

/// Sends a message, then applies `edit` twice and returns both answers with
/// the channel position after each.
async fn edit_twice(pool: PgPool, edit: &str) -> [(Value, i64); 2] {
    fixture(pool.clone()).await;
    let reads = Arc::new(
        MessageService::new(
            PgMessageRepository::new(pool.clone()),
            NoMessageEventPublisher,
        )
        .with_references(AllReferences)
        .with_group_recipients(Members),
    );
    let harness = harness();
    let context = writable(&harness, &reads);
    let id = Uuid::now_v7();
    let send = format!(
        "sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\", content: \"Sent\" }}) {{ message {{ id }} }}"
    );
    data(
        mutate(&harness, &context, Some(PERSON), &send).await,
        "sendChannelMessage",
    );
    let edit = format!(
        "editChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\", {edit} }}) {{ message {{ {} }} }}",
        message_selection()
    );
    let mut answers = Vec::new();
    for _ in 0..2 {
        let answer = data(
            mutate(&harness, &context, Some(PERSON), &edit).await,
            "editChannelMessage",
        );
        answers.push((answer, channel_seq(&pool).await));
    }
    answers.try_into().expect("two answers")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replayed_edit_does_not_attach_an_email_thread_again_under_its_editor_alias(
    pool: PgPool,
) {
    let [first, replay] = edit_twice(
        pool,
        r#"addAttachments: [
            { entityType: "thread", entityId: "01900000-0000-7000-8000-0000000000aa" },
            { entityType: "document", entityId: "01900000-0000-7000-8000-0000000000bb" }
        ]"#,
    )
    .await;
    assert_eq!(
        first.0["attachments"][0]["entityType"],
        json!("email_thread")
    );
    assert_eq!(first.0["attachments"].as_array().map(Vec::len), Some(2));
    assert_eq!(
        replay, first,
        "the replay changed the message or the channel"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replayed_edit_with_group_repeated_and_unsorted_mentions_writes_nothing(pool: PgPool) {
    let [first, replay] = edit_twice(
        pool,
        r#"content: "@here and others", mentions: [
            { entityType: "user", entityId: "macro|b@example.com" },
            { entityType: "group", entityId: "here" },
            { entityType: "user", entityId: "macro|a@example.com" },
            { entityType: "user", entityId: "macro|b@example.com" }
        ]"#,
    )
    .await;
    assert_eq!(
        replay, first,
        "the replay changed the message or the channel"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replayed_edit_that_only_mentions_here_writes_nothing(pool: PgPool) {
    let [first, replay] = edit_twice(
        pool,
        r#"content: "@here", mentions: [{ entityType: "group", entityId: "here" }]"#,
    )
    .await;
    assert_eq!(
        first.0["mentions"],
        json!([{ "entityType": "group", "entityId": "here" }])
    );
    assert_eq!(
        replay, first,
        "the replay changed the message or the channel"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replayed_edit_with_a_repeated_mention_writes_nothing(pool: PgPool) {
    let [first, replay] = edit_twice(
        pool,
        r#"content: "twice", mentions: [
            { entityType: "user", entityId: "macro|a@example.com" },
            { entityType: "user", entityId: "macro|a@example.com" }
        ]"#,
    )
    .await;
    assert_eq!(
        replay, first,
        "the replay changed the message or the channel"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn each_write_answers_with_the_position_it_committed_and_a_replay_with_the_channels(
    pool: PgPool,
) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let context = writable(&harness, &reads);
    let [root, reply, other] = [(); 3].map(|()| Uuid::now_v7());
    let send = |id: Uuid, thread: &str| {
        format!(
            "sendChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{id}\", content: \"Hi\"{thread} }}) {{ seq }}"
        )
    };
    let in_thread = format!(", threadId: \"{root}\"");
    let writes = [
        ("sendChannelMessage", send(root, "")),
        ("sendChannelMessage", send(reply, &in_thread)),
        (
            "editChannelMessage",
            format!(
                "editChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", content: \"Edited\" }}) {{ seq }}"
            ),
        ),
        (
            "reactToChannelMessage",
            format!(
                "reactToChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\", emoji: \"👍\", add: true }}) {{ seq }}"
            ),
        ),
        (
            "deleteChannelMessage",
            format!(
                "deleteChannelMessage(input: {{ channelId: \"{CHANNEL_ID}\", id: \"{reply}\" }}) {{ seq }}"
            ),
        ),
    ];
    let answer = async |(name, field): &(&'static str, String)| {
        let response = mutate(&harness, &context, Some(PERSON), field).await;
        payload(response, name)["seq"]
            .as_str()
            .expect("a decimal sequence")
            .parse::<i64>()
            .expect("a decimal sequence")
    };

    let mut previous = None;
    for write in &writes {
        let written = answer(write).await;
        assert_eq!(written, channel_seq(&pool).await, "{}", write.0);
        assert!(previous < Some(written), "{}", write.0);
        // Its replay writes nothing and answers with where the channel is.
        assert_eq!(answer(write).await, written, "{} replayed", write.0);
        assert_eq!(channel_seq(&pool).await, written);
        previous = Some(written);
    }

    // Another message moves the channel on; a late replay follows it.
    let moved = answer(&("sendChannelMessage", send(other, ""))).await;
    assert!(previous < Some(moved));
    for (index, write) in writes.iter().enumerate() {
        // The reply is deleted by now, so its edit and reaction are refused.
        if matches!(index, 2 | 3) {
            continue;
        }
        assert_eq!(answer(write).await, moved, "{} replayed late", write.0);
    }
    assert_eq!(channel_seq(&pool).await, moved);
}
