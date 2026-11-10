//! Noise never leaks into a reader that did not ask for it. The reader tests
//! move a stored recipient row to noise directly; the routing tests store it
//! through `create_notification`.

use super::*;
use crate::domain::models::routing::{RecipientRoute, RecipientRoutes};
use crate::domain::models::{NotificationLane, entity_query::EntityNotificationQuery};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelSend {
    message_id: String,
}

impl Notification for ChannelSend {
    const TYPE_NAME: &'static str = "channel_message_send";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelReply {
    message_id: String,
    thread_id: String,
}

impl Notification for ChannelReply {
    const TYPE_NAME: &'static str = "channel_message_reply";
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lists_read_one_lane(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("lists@example.com");
    let channel = Uuid::now_v7();
    let signal = Uuid::now_v7();
    let noise = Uuid::now_v7();
    for (id, message_id) in [(signal, "signal"), (noise, "noise")] {
        pool.create_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Channel.with_entity_string(channel.to_string()),
                secondary_notification_entity: None,
                notification: TaggedContent::new(ChannelSend {
                    message_id: message_id.to_string(),
                }),
                sender_id: None,
                recipient_ids: HashSet::from([user.clone()]),
            },
            id,
            "test_service",
            None,
            &Default::default(),
        )
        .await?;
    }
    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE user_id = $1 AND notification_id = $2",
        user.as_ref(),
        noise,
    )
    .execute(&pool)
    .await?;

    let listed = pool
        .get_user_notifications::<ChannelSend>(
            user.clone(),
            10,
            Query::Sort(CreatedAt, ()),
            NotificationListFilters::active(),
        )
        .await?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].notification_id, signal);
    assert_eq!(listed[0].lane, NotificationLane::Signal);

    let listed_noise = pool
        .get_user_notifications::<ChannelSend>(
            user.clone(),
            10,
            Query::Sort(CreatedAt, ()),
            NotificationListFilters {
                lane: NotificationLane::Noise,
                ..NotificationListFilters::active()
            },
        )
        .await?;
    assert_eq!(listed_noise.len(), 1);
    assert_eq!(listed_noise[0].notification_id, noise);
    assert_eq!(listed_noise[0].lane, NotificationLane::Noise);

    let by_item = pool
        .get_user_notifications_by_event_item_ids::<ChannelSend>(
            user,
            &[channel],
            10,
            Query::Sort(CreatedAt, ()),
            NotificationListFilters::active(),
        )
        .await?;
    assert_eq!(by_item.len(), 1);
    assert_eq!(by_item[0].notification_id, signal);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entity_edge_reads_one_lane(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("edge@example.com");
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let signal = Uuid::now_v7();
    let noise = Uuid::now_v7();
    for (id, message_id) in [(signal, "signal"), (noise, "noise")] {
        pool.create_notification(
            SendNotificationRequestBuilder {
                notification_entity: channel.clone(),
                secondary_notification_entity: None,
                notification: TaggedContent::new(ChannelSend {
                    message_id: message_id.to_string(),
                }),
                sender_id: None,
                recipient_ids: HashSet::from([user.clone()]),
            },
            id,
            "test_service",
            None,
            &Default::default(),
        )
        .await?;
    }
    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE user_id = $1 AND notification_id = $2",
        user.as_ref(),
        noise,
    )
    .execute(&pool)
    .await?;

    // The default edge is what unread indicators and feeds read.
    let default_edge = pool
        .get_entity_notifications_batch(
            user.clone(),
            vec![channel.clone()],
            EntityNotificationQuery::default(),
        )
        .await?;
    assert_eq!(default_edge[&channel].len(), 1);
    assert_eq!(default_edge[&channel][0].notification_id, signal);
    assert_eq!(default_edge[&channel][0].lane, NotificationLane::Signal);

    let noise_edge = pool
        .get_entity_notifications_batch(
            user,
            vec![channel.clone()],
            EntityNotificationQuery {
                lane: NotificationLane::Noise,
                ..Default::default()
            },
        )
        .await?;
    assert_eq!(noise_edge[&channel].len(), 1);
    assert_eq!(noise_edge[&channel][0].notification_id, noise);
    assert_eq!(noise_edge[&channel][0].lane, NotificationLane::Noise);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_noise_reply_does_not_move_a_signal_message_onto_its_thread(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let user = test_user("scope@example.com");
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let root_message = Uuid::now_v7().to_string();
    let root = Uuid::now_v7();
    pool.create_notification(
        SendNotificationRequestBuilder {
            notification_entity: channel.clone(),
            secondary_notification_entity: None,
            notification: TaggedContent::new(ChannelSend {
                message_id: root_message.clone(),
            }),
            sender_id: None,
            recipient_ids: HashSet::from([user.clone()]),
        },
        root,
        "test_service",
        None,
        &Default::default(),
    )
    .await?;
    let reply = Uuid::now_v7();
    pool.create_notification(
        SendNotificationRequestBuilder {
            notification_entity: channel.clone(),
            secondary_notification_entity: Some(
                EntityType::ChannelMessage.with_entity_string(root_message.clone()),
            ),
            notification: TaggedContent::new(ChannelReply {
                message_id: Uuid::now_v7().to_string(),
                thread_id: root_message,
            }),
            sender_id: None,
            recipient_ids: HashSet::from([user.clone()]),
        },
        reply,
        "test_service",
        None,
        &Default::default(),
    )
    .await?;
    let channel_feed = EntityNotificationQuery {
        channel_feed_only: true,
        ..Default::default()
    };

    // Both signal: the reply gives the root message to the thread's row.
    let both_signal = pool
        .get_entity_notifications_batch(user.clone(), vec![channel.clone()], channel_feed.clone())
        .await?;
    assert!(both_signal[&channel].is_empty());

    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE user_id = $1 AND notification_id = $2",
        user.as_ref(),
        reply,
    )
    .execute(&pool)
    .await?;
    let reply_is_noise = pool
        .get_entity_notifications_batch(user, vec![channel.clone()], channel_feed)
        .await?;
    assert_eq!(reply_is_noise[&channel].len(), 1);
    assert_eq!(reply_is_noise[&channel][0].notification_id, root);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opening_an_entity_marks_its_noise_seen(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("open@example.com");
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let signal = Uuid::now_v7();
    let noise = Uuid::now_v7();
    for (id, message_id) in [(signal, "signal"), (noise, "noise")] {
        pool.create_notification(
            SendNotificationRequestBuilder {
                notification_entity: channel.clone(),
                secondary_notification_entity: None,
                notification: TaggedContent::new(ChannelSend {
                    message_id: message_id.to_string(),
                }),
                sender_id: None,
                recipient_ids: HashSet::from([user.clone()]),
            },
            id,
            "test_service",
            None,
            &Default::default(),
        )
        .await?;
    }
    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE user_id = $1 AND notification_id = $2",
        user.as_ref(),
        noise,
    )
    .execute(&pool)
    .await?;

    let ids = pool
        .get_notification_ids_for_entities(&user, &[channel], &NotificationStatus::Seen)
        .await?;
    assert_eq!(
        ids.iter().copied().collect::<HashSet<_>>(),
        HashSet::from([signal, noise])
    );

    let seen = pool.mark_notifications_seen(&user, &ids).await?;
    let lanes: HashMap<Uuid, NotificationLane> = seen
        .iter()
        .map(|row| (row.notification_id, row.lane))
        .collect();
    assert_eq!(lanes[&signal], NotificationLane::Signal);
    assert_eq!(lanes[&noise], NotificationLane::Noise);

    let stored = pool
        .get_user_notification_by_id::<serde_json::Value>(user, noise)
        .await?
        .unwrap();
    assert_eq!(stored.state, NotificationState::Seen);
    assert_eq!(stored.lane, NotificationLane::Noise);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn noise_is_never_digest_eligible(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("digest@example.com");
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let signal = Uuid::now_v7();
    let noise = Uuid::now_v7();
    for (id, message_id) in [(signal, "signal"), (noise, "noise")] {
        pool.create_notification(
            SendNotificationRequestBuilder {
                notification_entity: channel.clone(),
                secondary_notification_entity: None,
                notification: TaggedContent::new(ChannelSend {
                    message_id: message_id.to_string(),
                }),
                sender_id: None,
                recipient_ids: HashSet::from([user.clone()]),
            },
            id,
            "test_service",
            None,
            &Default::default(),
        )
        .await?;
    }
    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE user_id = $1 AND notification_id = $2",
        user.as_ref(),
        noise,
    )
    .execute(&pool)
    .await?;

    let eligible = pool
        .get_digest_eligible_notification_ids(&user, &[signal, noise])
        .await?;
    assert_eq!(eligible, HashSet::from([signal]));
    Ok(())
}

fn captured_by(stack_id: Uuid) -> RecipientRoute {
    RecipientRoute {
        lane: NotificationLane::Noise,
        stack_id: Some(stack_id),
        routing: serde_json::json!({ "outcome": "captured", "stackRevision": 3 }),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_route_is_stored_on_its_recipients_row(pool: Pool<Postgres>) -> Result<(), Report> {
    let natural = test_user("route-natural@example.com");
    let captured = test_user("route-captured@example.com");
    let stack_id = Uuid::now_v7();
    let id = Uuid::now_v7();
    let routes: RecipientRoutes = HashMap::from([(captured.clone(), captured_by(stack_id))]);

    let created = pool
        .create_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Channel
                    .with_entity_string(Uuid::now_v7().to_string()),
                secondary_notification_entity: None,
                notification: TaggedContent::new(ChannelSend {
                    message_id: "message".to_string(),
                }),
                sender_id: None,
                recipient_ids: HashSet::from([natural.clone(), captured.clone()]),
            },
            id,
            "test_service",
            None,
            &routes,
        )
        .await?
        .unwrap();
    let lanes: HashMap<MacroUserIdStr<'static>, NotificationLane> = created
        .into_iter()
        .map(|row| (row.owner_id, row.lane))
        .collect();
    assert_eq!(lanes[&natural], NotificationLane::Signal);
    assert_eq!(lanes[&captured], NotificationLane::Noise);

    let stored = sqlx::query!(
        r#"SELECT user_id, lane AS "lane: NotificationLane", stack_id, routing
        FROM user_notification WHERE notification_id = $1"#,
        id,
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(stored.len(), 2);
    for row in stored {
        if row.user_id == captured.as_ref() {
            assert_eq!(row.lane, NotificationLane::Noise);
            assert_eq!(row.stack_id, Some(stack_id));
            assert_eq!(
                row.routing,
                Some(serde_json::json!({ "outcome": "captured", "stackRevision": 3 }))
            );
        } else {
            assert_eq!(row.lane, NotificationLane::Signal);
            assert_eq!(row.stack_id, None);
            assert_eq!(row.routing, None);
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_retried_publication_keeps_its_first_routing(pool: Pool<Postgres>) -> Result<(), Report> {
    let signal_user = test_user("retry-signal@example.com");
    let noise_user = test_user("retry-noise@example.com");
    let stack_id = Uuid::now_v7();
    let id = Uuid::now_v7();
    let request = || SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_string(Uuid::nil().to_string()),
        secondary_notification_entity: None,
        notification: TaggedContent::new(ChannelSend {
            message_id: "message".to_string(),
        }),
        sender_id: None,
        recipient_ids: HashSet::from([signal_user.clone(), noise_user.clone()]),
    };
    let first: RecipientRoutes = HashMap::from([(noise_user.clone(), captured_by(stack_id))]);
    pool.create_notification(request(), id, "test_service", None, &first)
        .await?;

    // Publication never completed. By the retry the stack routes the other
    // way round, and the stored routing still stands.
    let second: RecipientRoutes = HashMap::from([(signal_user.clone(), captured_by(stack_id))]);
    let retried = pool
        .create_notification(request(), id, "test_service", None, &second)
        .await?
        .unwrap();
    let lanes: HashMap<MacroUserIdStr<'static>, NotificationLane> = retried
        .into_iter()
        .map(|row| (row.owner_id, row.lane))
        .collect();
    assert_eq!(lanes[&signal_user], NotificationLane::Signal);
    assert_eq!(lanes[&noise_user], NotificationLane::Noise);

    let stacked: Vec<String> = sqlx::query_scalar!(
        "SELECT user_id FROM user_notification WHERE notification_id = $1 AND stack_id = $2",
        id,
        stack_id,
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(stacked, vec![noise_user.to_string()]);
    Ok(())
}
