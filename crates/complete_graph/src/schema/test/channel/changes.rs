use messages::domain::{
    api::{MessageReader, MockMessageReader},
    changes::{ChannelChangeKind, ChannelChanges, ChannelMessageChange},
};

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_page_watermarks_are_read_before_page_queries(pool: PgPool) {
    let reads = fixture(pool).await;
    let harness = harness();
    let thread = reads
        .thread_page(access(), message_id(2), MessageThreadQuery::default())
        .await
        .expect("real thread page for mapping");
    let mut sequence = mockall::Sequence::new();
    let mut mock = MockMessageReader::new();
    mock.expect_channel_seq()
        .withf(|id| *id == CHANNEL_ID)
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_| Ok(41));
    mock.expect_timeline_entries()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_, _| {
            Ok(MessageTimelinePage {
                entries: Vec::new(),
                next_cursor: None,
                previous_cursor: None,
            })
        });
    mock.expect_channel_seq()
        .withf(|id| *id == CHANNEL_ID)
        .times(1)
        .in_sequence(&mut sequence)
        .returning(|_| Ok(41));
    mock.expect_thread_page()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(move |_, _, _| Ok(thread));
    harness
        .state
        .entity_access
        .viewable_channels
        .lock()
        .expect("channel access lock")
        .insert(CHANNEL_ID);
    let context =
        ChannelGraphqlContext::new(Arc::new(mock), Arc::clone(&harness.state.entity_access));
    let timeline = execute(
        &harness,
        &context,
        &format!("channelTimeline(input: {{ channelId: \"{CHANNEL_ID}\" }}) {{ seq }}"),
    )
    .await;
    assert_eq!(timeline["channelTimeline"]["seq"], "41");
    let thread = execute(
        &harness,
        &context,
        &format!(
            "channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{}\" }}) {{ seq }}",
            message_id(2),
        ),
    )
    .await;
    assert_eq!(thread["channelThread"]["seq"], "41");
}

fn expected_changes(page: &ChannelChanges) -> Value {
    json!({
        "resetRequired": page.reset_required,
        "seq": page.seq.to_string(),
        "hasMore": page.has_more,
        "messages": page.messages.iter().map(|change| match change {
            ChannelMessageChange::Root { message, call } => expected_message(
                &message.message, Some((&message.state, &message.thread)), *call,
            ),
            ChannelMessageChange::Reply { message } => expected_message(message, None, None),
        }).collect::<Vec<_>>(),
        "activities": page.activities.iter().map(|activity| expected_entry(
            &MessageTimelineEntry::Activity { activity: activity.clone() },
        )).collect::<Vec<_>>(),
        "removedIds": page.removed_ids.iter().map(Uuid::to_string).collect::<Vec<_>>(),
    })
}

async fn read_changes(
    harness: &TestHarness,
    context: &ChannelGraphqlContext,
    reads: &Reads,
    after: i64,
) -> (Value, ChannelChanges) {
    let data = execute(
        harness,
        context,
        &format!(
            "channelChanges(input: {{ channelId: \"{CHANNEL_ID}\", after: \"{after}\" }}) {{
             resetRequired seq hasMore removedIds messages {{ {} }}
             activities {{ __typename id channelId sortKey actorId occurredAt action payload }} }}",
            message_selection(),
        ),
    )
    .await["channelChanges"]
        .clone();
    let domain = MessageReader::channel_changes(reads, access(), CHANNEL_ID, after)
        .await
        .expect("shared channel change read");
    assert_eq!(data, expected_changes(&domain));
    (data, domain)
}

/// Replace only this test channel's history, retaining the same current entities.
async fn set_log(pool: &PgPool, counter: i64, first_seq: i64, changes: Vec<ChannelChangeKind>) {
    let mut sequences = Vec::with_capacity(changes.len());
    let mut kinds = Vec::with_capacity(changes.len());
    let mut messages = Vec::with_capacity(changes.len());
    let mut activities = Vec::with_capacity(changes.len());
    for (index, change) in changes.into_iter().enumerate() {
        sequences.push(first_seq + i64::try_from(index).expect("bounded fixture length"));
        let (kind, message, activity) = match change {
            ChannelChangeKind::Message(id) => (1i16, Some(id), None),
            ChannelChangeKind::Activity(id) => (2, None, Some(id)),
            ChannelChangeKind::Reset => (3, None, None),
        };
        kinds.push(kind);
        messages.push(message);
        activities.push(activity);
    }
    let mut tx = pool.begin().await.expect("fixture transaction");
    sqlx::query!(
        "DELETE FROM channel_change_log WHERE channel_id = $1",
        CHANNEL_ID,
    )
    .execute(&mut *tx)
    .await
    .expect("replace isolated channel log");
    sqlx::query!(
        "INSERT INTO channel_change_counters(channel_id, seq) VALUES ($1, $2)
         ON CONFLICT(channel_id) DO UPDATE SET seq = EXCLUDED.seq",
        CHANNEL_ID,
        counter,
    )
    .execute(&mut *tx)
    .await
    .expect("set isolated channel counter");
    sqlx::query!(
        "INSERT INTO channel_change_log(channel_id, seq, kind, message_id, activity_id)
         SELECT $1, entry.seq, entry.kind, entry.message_id, entry.activity_id
         FROM unnest($2::bigint[], $3::smallint[], $4::uuid[], $5::uuid[])
             AS entry(seq, kind, message_id, activity_id)",
        CHANNEL_ID,
        &sequences,
        &kinds,
        &messages as &[Option<Uuid>],
        &activities as &[Option<Uuid>],
    )
    .execute(&mut *tx)
    .await
    .expect("seed bounded change rows");
    tx.commit().await.expect("commit isolated channel log");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_changes_match_domain_current_states_tombstones_and_removed_ids(pool: PgPool) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let context = context(&harness, &reads);
    let foreign_message = message_id(9000);
    let foreign_activity = message_id(9001);
    sqlx::query!(
        "INSERT INTO comms_messages(id, parent_entity_type, parent_entity_id, sender_id, content)
         VALUES ($1, 'channel', $2, $3, 'private to another channel')",
        foreign_message,
        OTHER_CHANNEL_ID.to_string(),
        VALID_USER_ID,
    )
    .execute(&pool)
    .await
    .expect("seed foreign message");
    sqlx::query!(
        "INSERT INTO activity_events(id, actor_id, subject_id, action, entity_type, entity_id, occurred_at)
         VALUES ($1, $2, $2, 'picture_changed', 'channel', $3, now())",
        foreign_activity,
        VALID_USER_ID,
        OTHER_CHANNEL_ID.to_string(),
    )
    .execute(&pool)
    .await
    .expect("seed foreign activity");
    let changes = vec![
        ChannelChangeKind::Message(message_id(2)),
        ChannelChangeKind::Message(message_id(101)),
        ChannelChangeKind::Message(message_id(105)),
        ChannelChangeKind::Message(message_id(3)),
        ChannelChangeKind::Message(message_id(4)),
        ChannelChangeKind::Message(message_id(204)),
        ChannelChangeKind::Message(message_id(5)),
        ChannelChangeKind::Message(message_id(6)),
        ChannelChangeKind::Message(message_id(8)),
        ChannelChangeKind::Message(message_id(9)),
        ChannelChangeKind::Message(message_id(10)),
        ChannelChangeKind::Activity(message_id(600)),
        ChannelChangeKind::Activity(message_id(602)),
        ChannelChangeKind::Message(message_id(12)),
        ChannelChangeKind::Activity(message_id(601)),
        ChannelChangeKind::Message(foreign_message),
        ChannelChangeKind::Activity(foreign_activity),
        ChannelChangeKind::Message(message_id(2)),
    ];
    let counter = i64::try_from(changes.len()).expect("small fixture log");
    set_log(&pool, counter, 1, changes).await;
    // Replay hydrates the current row, even when it changed after this log entry.
    sqlx::query!(
        "UPDATE comms_messages SET content = 'current body after logged change' WHERE id = $1",
        message_id(2),
    )
    .execute(&pool)
    .await
    .expect("update current message");
    sqlx::query!("DELETE FROM comms_messages WHERE id = $1", message_id(12))
        .execute(&pool)
        .await
        .expect("hard-delete logged message");
    sqlx::query!("DELETE FROM activity_events WHERE id = $1", message_id(601))
        .execute(&pool)
        .await
        .expect("hard-delete logged activity");

    let (data, domain) = read_changes(&harness, &context, &reads, 0).await;
    assert!(!domain.reset_required && !domain.has_more);
    assert_eq!(domain.seq, counter);
    assert_eq!(
        domain.removed_ids,
        vec![
            message_id(12),
            foreign_message,
            message_id(601),
            foreign_activity
        ]
    );
    let messages = data["messages"].as_array().expect("message changes");
    assert_eq!(
        messages.len(),
        11,
        "roots are coalesced across changed replies"
    );
    let find = |id: Uuid| {
        messages
            .iter()
            .find(|message| message["id"] == id.to_string())
            .expect("changed message exists")
    };
    assert_eq!(
        find(message_id(2))["content"],
        "current body after logged change"
    );
    assert_eq!(
        find(message_id(2))["attachments"]
            .as_array()
            .expect("attachments")
            .len(),
        1
    );
    assert_eq!(find(message_id(2))["thread"]["replyCount"], 10);
    assert_eq!(
        find(message_id(2))["reactions"]
            .as_array()
            .expect("reactions")
            .len(),
        2
    );
    assert!(find(message_id(105))["deletedAt"].is_string());
    assert!(find(message_id(105))["thread"].is_null());
    assert!(find(message_id(4))["thread"]["deletedAt"].is_string());
    assert_eq!(find(message_id(4))["thread"]["replyCount"], 0);
    assert!(find(message_id(5))["deletedAt"].is_string());
    assert_eq!(find(message_id(8))["call"]["state"], "ENDED");
    assert_eq!(find(message_id(9))["call"]["state"], "LIVE");
    assert_eq!(find(message_id(10))["call"]["state"], "RECORD_DELETED");
    assert_eq!(
        data["activities"]
            .as_array()
            .expect("activity changes")
            .len(),
        2
    );
    assert_eq!(find(message_id(6))["botProfile"]["name"], "Archived helper");

    let pages = execute(
        &harness,
        &context,
        &format!(
            "channelTimeline(input: {{ channelId: \"{CHANNEL_ID}\" }}) {{ seq }}
         channelThread(input: {{ channelId: \"{CHANNEL_ID}\", rootId: \"{}\" }}) {{ seq }}",
            message_id(2),
        ),
    )
    .await;
    assert_eq!(pages["channelTimeline"]["seq"], counter.to_string());
    assert_eq!(pages["channelThread"]["seq"], counter.to_string());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_changes_page_200_log_rows_and_hydrate_each_id_once(pool: PgPool) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let context = context(&harness, &reads);
    let log = (0..450)
        .map(|index| ChannelChangeKind::Message(message_id([1, 2, 6][index % 3])))
        .collect();
    set_log(&pool, 450, 1, log).await;
    let mut after = 0;
    for (reached, more) in [(200, true), (400, true), (450, false)] {
        let (data, page) = read_changes(&harness, &context, &reads, after).await;
        assert_eq!(
            (page.seq, page.has_more, page.reset_required),
            (reached, more, false)
        );
        let ids = data["messages"]
            .as_array()
            .expect("messages")
            .iter()
            .map(|message| message["id"].as_str().expect("message ID"))
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(page.messages.len(), 3);
        assert_eq!(ids.len(), 3);
        after = reached;
    }
    let (_, current) = read_changes(&harness, &context, &reads, after).await;
    assert_eq!(current.seq, 450);
    assert!(!current.has_more && !current.reset_required);
    assert!(
        current.messages.is_empty()
            && current.activities.is_empty()
            && current.removed_ids.is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_changes_reset_for_pruned_future_reset_and_lagged_cursors(pool: PgPool) {
    let reads = fixture(pool.clone()).await;
    let harness = harness();
    let context = context(&harness, &reads);
    let message = ChannelChangeKind::Message(message_id(2));
    for (counter, first, count, after, reset) in [
        (8, 4, 5, 2, true),  // Cursor below floor 3.
        (8, 4, 5, 3, false), // Cursor exactly at floor.
        (8, 1, 8, 9, true),  // Cursor ahead of current counter.
        (8, 9, 0, 7, true),  // Entire retained history pruned.
        (8, 9, 0, 8, false),
        (1001, 1, 1001, 0, true),
        (1001, 1, 1001, 1, false), // Exactly 1000 changes behind is supported.
    ] {
        set_log(&pool, counter, first, vec![message; count]).await;
        let (_, page) = read_changes(&harness, &context, &reads, after).await;
        assert_eq!(
            page.reset_required, reset,
            "counter={counter}, after={after}"
        );
        if reset {
            assert_eq!(page.seq, counter);
            assert!(!page.has_more);
            assert!(
                page.messages.is_empty()
                    && page.activities.is_empty()
                    && page.removed_ids.is_empty()
            );
        }
    }
    let mut log = vec![message; 300];
    log[249] = ChannelChangeKind::Reset;
    set_log(&pool, 300, 1, log).await;
    let (_, before_reset) = read_changes(&harness, &context, &reads, 0).await;
    assert!(
        before_reset.reset_required,
        "reset after the first 200 rows still invalidates replay"
    );
    assert_eq!(before_reset.seq, 300);
    assert!(before_reset.messages.is_empty());
    let (_, after_reset) = read_changes(&harness, &context, &reads, 250).await;
    assert!(!after_reset.reset_required && !after_reset.has_more);
    assert_eq!(after_reset.seq, 300);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_changes_validate_sequences_and_preserve_access_scope(pool: PgPool) {
    let reads = fixture(pool).await;
    let harness = harness();
    let context = context(&harness, &reads);
    for after in ["", "-1", "+1", "1.5", "18446744073709551616", "1 "] {
        let response = harness.schema.execute(harness.request(&format!(
            "{{ user {{ channelChanges(input: {{ channelId: \"{CHANNEL_ID}\", after: \"{after}\" }}) {{ seq }} }} }}",
        ), authenticated_parts()).data(context.clone())).await;
        assert_eq!(response.errors.len(), 1, "invalid cursor {after:?}");
        assert_eq!(
            response.errors[0]
                .extensions
                .as_ref()
                .expect("input error code")
                .get("code"),
            Some(&async_graphql::Value::from("BAD_USER_INPUT"))
        );
    }
    let denied = harness.schema.execute(harness.request(&format!(
        "{{ user {{ channelChanges(input: {{ channelId: \"{OTHER_CHANNEL_ID}\", after: \"0\" }}) {{ seq }} }} }}",
    ), authenticated_parts()).data(context.clone())).await;
    assert_eq!(denied.errors.len(), 1);
    assert_eq!(
        denied.errors[0]
            .extensions
            .as_ref()
            .expect("access error code")
            .get("code"),
        Some(&async_graphql::Value::from("FORBIDDEN"))
    );
    harness
        .state
        .entity_access
        .viewable_channels
        .lock()
        .expect("channel access lock")
        .insert(OTHER_CHANNEL_ID);
    let empty = execute(
        &harness,
        &context,
        &format!(
            "channelChanges(input: {{ channelId: \"{OTHER_CHANNEL_ID}\", after: \"0\" }})
         {{ resetRequired seq hasMore messages {{ id }} activities {{ id }} removedIds }}",
        ),
    )
    .await;
    assert_eq!(
        empty["channelChanges"],
        json!({
            "resetRequired": false, "seq": "0", "hasMore": false,
            "messages": [], "activities": [], "removedIds": [],
        })
    );
}
