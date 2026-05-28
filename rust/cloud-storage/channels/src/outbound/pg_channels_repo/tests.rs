use crate::domain::models::{
    AttachmentEntityReference, ChannelMessageFilters, MessagePageDirection, NotificationFilters,
    ParticipantRole,
};
use crate::domain::ports::ChannelRepo;
use crate::outbound::pg_channels_repo::PgChannelsRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Cursor, CursorVal, Query};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const NO_FILTERS: ChannelMessageFilters = ChannelMessageFilters {
    message_ids: Vec::new(),
    created_after: None,
    created_before: None,
    activity_after: None,
    activity_before: None,
    notification_filters: NotificationFilters {
        done: None,
        seen: None,
    },
};

const CH1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c01);
const CH2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c02);
const MSG1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000001);
const MSG2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000002);
const MSG3: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000003);
const REPLY1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b001);
const REPLY2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b002);
const REPLY3: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b003);
const REPLY5: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000b005);
const DELETED_MSG_ATTACHMENT: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_00000000a004);
const USER_A: &str = "macro|user-a@test.com";
const USER_B: &str = "macro|user-b@test.com";
const NON_MEMBER: &str = "macro|user-d@test.com";
const LEFT_USER: &str = "macro|left-user@test.com";

fn repo(pool: Pool<Postgres>) -> PgChannelsRepo {
    PgChannelsRepo::new(pool)
}

fn macro_user_id(user_id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(user_id.to_owned()).expect("valid macro user id")
}

async fn insert_channel_message_notification(
    pool: &Pool<Postgres>,
    user_id: &str,
    channel_id: Uuid,
    message_id: Uuid,
    done: bool,
    seen: bool,
) -> anyhow::Result<()> {
    let notification_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO notification (
            id,
            notification_event_type,
            event_item_id,
            event_item_type,
            service_sender,
            metadata
        )
        VALUES (
            $1,
            'channel_message_send',
            $2,
            'channel',
            'channels-test',
            jsonb_build_object('messageId', $3::text)
        )
        "#,
    )
    .bind(notification_id)
    .bind(channel_id.to_string())
    .bind(message_id.to_string())
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO user_notification (user_id, notification_id, created_at, seen_at, done)
        VALUES (
            $1,
            $2,
            '2024-01-02 00:00:00'::timestamp,
            CASE WHEN $3::bool THEN '2024-01-02 00:00:00'::timestamp ELSE NULL END,
            $4
        )
        "#,
    )
    .bind(user_id)
    .bind(notification_id)
    .bind(seen)
    .bind(done)
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_excludes_thread_replies_and_fully_deleted(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    // msg1, msg2 (deleted but has active reply), msg3 — but NOT msg4 (fully deleted)
    assert_eq!(ids.len(), 3);
    assert!(ids.contains(&MSG1));
    assert!(ids.contains(&MSG2));
    assert!(ids.contains(&MSG3));
    // msg4 (fully deleted, no active replies) must not appear
    let msg4 = Uuid::from_u128(0x00000000_0000_0000_0000_000000000004);
    assert!(!ids.contains(&msg4));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_ordered_newest_first(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn message_context_returns_chronological_window(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let messages = repo.get_messages_with_context(CH1, REPLY2, 2, 1).await?;

    let ids = messages
        .iter()
        .map(|message| message.id)
        .collect::<Vec<_>>();
    assert_eq!(ids, vec![MSG1, REPLY1, REPLY2, REPLY3]);
    assert_eq!(messages[2].thread_id, Some(MSG1));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn message_context_is_bound_to_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let messages = repo.get_messages_with_context(CH2, MSG1, 1, 1).await?;

    assert!(messages.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_cursor_skips_earlier_messages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // First fetch all to get cursor values
    let all = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;
    assert_eq!(all.len(), 3);

    // Use msg3 (newest) as cursor → should skip msg3, return msg2 + msg1
    let cursor = Query::Cursor(Cursor {
        id: MSG3,
        limit: 50,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: all[0].created_at,
        },
        filter: (),
    });
    let page2 = repo
        .get_top_level_messages(
            CH1,
            &cursor,
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;
    let ids: Vec<Uuid> = page2.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG2, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_newer_direction_returns_nearest_newer_page(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;

    let oldest = all.last().expect("at least one message");
    let cursor = Query::Cursor(Cursor {
        id: oldest.id,
        limit: 2,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: oldest.created_at,
        },
        filter: (),
    });
    let page = repo
        .get_top_level_messages(
            CH1,
            &cursor,
            MessagePageDirection::Newer,
            2,
            &NO_FILTERS,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = page.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2]);
    assert!(!page.has_more_newer);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_newer_direction_sets_has_more_newer_with_overfetch(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?
        .rows;

    let oldest = all.last().expect("at least one message");
    let cursor = Query::Cursor(Cursor {
        id: oldest.id,
        limit: 1,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: oldest.created_at,
        },
        filter: (),
    });
    let page = repo
        .get_top_level_messages(
            CH1,
            &cursor,
            MessagePageDirection::Newer,
            1,
            &NO_FILTERS,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = page.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG2], "nearest newer message is returned");
    assert!(page.has_more_newer, "there is still a newer page (MSG3)");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_limit_is_respected(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            2,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    assert_eq!(rows.len(), 2);
    // Should be the 2 newest
    assert_eq!(rows[0].id, MSG3);
    assert_eq!(rows[1].id, MSG2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_scoped_to_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let result = repo
        .get_top_level_messages(
            CH2,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &NO_FILTERS,
            None,
        )
        .await?;
    let rows = result.rows;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].content, "other channel msg");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_message_ids_filter_limits_to_subset(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let filters = ChannelMessageFilters {
        message_ids: vec![MSG1, MSG3],
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_data_preview_count_limits_replies(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // msg1 has 4 replies; ask for preview of 2
    let map = repo.get_thread_data(&[MSG1], 2).await?;
    let thread = map.get(&MSG1).expect("thread data for msg1");

    assert_eq!(
        thread.reply_count, 4,
        "reply_count reflects total, not preview"
    );
    assert_eq!(
        thread.preview_replies.len(),
        2,
        "only 2 preview replies returned"
    );
    // Preview should be the 2 oldest replies, in chronological order
    assert_eq!(thread.preview_replies[0].content, "reply 1");
    assert_eq!(thread.preview_replies[1].content, "reply 2");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_data_latest_reply_at_is_most_recent(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_thread_data(&[MSG1], 10).await?;
    let thread = map.get(&MSG1).unwrap();

    // reply 4 is at 10:04 — should be the latest
    let last = thread.preview_replies.last().unwrap();
    assert_eq!(thread.latest_reply_at, Some(last.created_at));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_data_multiple_parents(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_thread_data(&[MSG1, MSG2], 10).await?;

    assert!(map.contains_key(&MSG1));
    assert!(map.contains_key(&MSG2));
    assert_eq!(map[&MSG1].reply_count, 4);
    assert_eq!(map[&MSG2].reply_count, 1);
    assert_eq!(map[&MSG2].preview_replies[0].content, "reply to deleted");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_replies_returns_all_active_replies_oldest_first(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let replies = repo.get_thread_replies(MSG1).await?;

    let ids: Vec<Uuid> = replies.iter().map(|r| r.id).collect();
    assert_eq!(ids.len(), 4);
    assert_eq!(ids[0], REPLY1);
    assert_eq!(
        ids[3],
        Uuid::from_u128(0x00000000_0000_0000_0000_00000000b004)
    );
    let content: Vec<&str> = replies.iter().map(|r| r.content.as_str()).collect();
    assert_eq!(content, vec!["reply 1", "reply 2", "reply 3", "reply 4"]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_replies_returns_non_null_edited_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE comms_messages
        SET edited_at = '2024-01-01 10:05:00'
        WHERE id = '00000000-0000-0000-0000-00000000b003'
        "#,
    )
    .execute(&pool)
    .await?;

    let repo = repo(pool);
    let replies = repo.get_thread_replies(MSG1).await?;
    let edited_reply = replies
        .into_iter()
        .find(|r| r.id == Uuid::from_u128(0x00000000_0000_0000_0000_00000000b003))
        .expect("expected fixture reply");

    assert!(edited_reply.edited_at.is_some());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_replies_excludes_deleted_rows(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let fully_deleted_parent = Uuid::from_u128(0x00000000_0000_0000_0000_000000000004);
    let deleted_parent_replies = repo.get_thread_replies(fully_deleted_parent).await?;
    assert!(
        deleted_parent_replies.is_empty(),
        "deleted replies should not be returned"
    );

    let active_replies = repo.get_thread_replies(MSG2).await?;
    assert_eq!(active_replies.len(), 1);
    assert_eq!(active_replies[0].id, REPLY5);
    assert_eq!(active_replies[0].content, "reply to deleted");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn reactions_grouped_by_emoji(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_reactions_batch(&[MSG1, MSG3]).await?;

    // msg1 has thumbsup (2 users) and tada (1 user)
    let msg1_reactions = map.get(&MSG1).unwrap();
    let thumbsup = msg1_reactions
        .iter()
        .find(|r| r.emoji == "\u{1f44d}")
        .unwrap();
    assert_eq!(thumbsup.users.len(), 2);
    let tada = msg1_reactions
        .iter()
        .find(|r| r.emoji == "\u{1f389}")
        .unwrap();
    assert_eq!(tada.users.len(), 1);

    // msg3 has thumbsup (1 user)
    let msg3_reactions = map.get(&MSG3).unwrap();
    assert_eq!(msg3_reactions.len(), 1);
    assert_eq!(msg3_reactions[0].users.len(), 1);

    // msg2 has no reactions
    assert!(!map.contains_key(&MSG2));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachments_batch_grouped_by_message(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let map = repo.get_attachments_batch(&[MSG1, MSG2, MSG3]).await?;

    assert_eq!(map[&MSG1].len(), 2);
    assert_eq!(map[&MSG2].len(), 1);
    assert_eq!(map[&MSG3].len(), 1);
    assert_eq!(map[&MSG2][0].id, DELETED_MSG_ATTACHMENT);
    Ok(())
}

// -- get_channel_attachments -----------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_attachments_cursor_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // ch1 has 3 attachments total (a001, a002 on msg1, a003 on msg3)
    let page1 = repo
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 2, None)
        .await?;
    assert_eq!(page1.len(), 2, "limit respected");

    // Use last item as cursor for next page
    let last = &page1[1];
    let cursor = Query::Cursor(Cursor {
        id: last.id,
        limit: 2,
        val: CursorVal {
            sort_type: CreatedAt,
            last_val: last.created_at,
        },
        filter: (),
    });
    let page2 = repo.get_channel_attachments(CH1, &cursor, 2, None).await?;
    assert_eq!(page2.len(), 1, "remaining attachment");

    // No overlap between pages
    let p1_ids: Vec<Uuid> = page1.iter().map(|a| a.id).collect();
    let p2_ids: Vec<Uuid> = page2.iter().map(|a| a.id).collect();
    assert!(p1_ids.iter().all(|id| !p2_ids.contains(id)));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_attachments_include_dimensions(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 50, None)
        .await?;

    let img = all.iter().find(|a| a.entity_type == "image").unwrap();
    assert_eq!(img.width, Some(800));
    assert_eq!(img.height, Some(600));

    let doc = all.iter().find(|a| a.entity_id == "doc-1").unwrap();
    assert_eq!(doc.width, None);
    assert_eq!(doc.height, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_attachments_exclude_deleted_messages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let all = repo
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 50, None)
        .await?;

    let ids: Vec<Uuid> = all.iter().map(|a| a.id).collect();
    assert_eq!(
        ids.len(),
        3,
        "only attachments from non-deleted messages are returned"
    );
    assert!(!ids.contains(&DELETED_MSG_ATTACHMENT));
    assert!(all.iter().all(|a| a.message_id != MSG2));
    Ok(())
}

// -- get_channel_participants ----------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn participants_excludes_left_users(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let participants = repo.get_channel_participants(CH1).await?;

    let user_ids: Vec<&str> = participants.iter().map(|p| p.user_id.as_str()).collect();
    assert_eq!(participants.len(), 3);
    assert!(!user_ids.contains(&"macro|left-user@test.com"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn participants_roles_parsed_correctly(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let participants = repo.get_channel_participants(CH1).await?;

    let owner = participants
        .iter()
        .find(|p| p.user_id == "macro|user-a@test.com")
        .unwrap();
    assert_eq!(owner.role, ParticipantRole::Owner);

    let admin = participants
        .iter()
        .find(|p| p.user_id == "macro|user-b@test.com")
        .unwrap();
    assert_eq!(admin.role, ParticipantRole::Admin);

    let member = participants
        .iter()
        .find(|p| p.user_id == "macro|user-c@test.com")
        .unwrap();
    assert_eq!(member.role, ParticipantRole::Member);
    Ok(())
}

// -- resolve_top_level_parent -------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_returns_self_for_top_level(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let row = repo.resolve_top_level_parent(CH1, MSG1).await?;

    let row = row.expect("top-level message should resolve to itself");
    assert_eq!(row.id, MSG1);
    assert_eq!(row.content, "first message");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_follows_thread_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // REPLY1 (b001) is a reply to MSG1
    let row = repo.resolve_top_level_parent(CH1, REPLY1).await?;

    let row = row.expect("thread reply should resolve to parent");
    assert_eq!(row.id, MSG1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_follows_reply_to_deleted_parent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    // REPLY5 (b005) is a reply to MSG2 (which is soft-deleted but has active reply)
    let row = repo.resolve_top_level_parent(CH1, REPLY5).await?;

    let row = row.expect("reply to deleted parent should still resolve");
    assert_eq!(row.id, MSG2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_returns_none_for_nonexistent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let missing = Uuid::from_u128(0xdeadbeef);
    let row = repo.resolve_top_level_parent(CH1, missing).await?;

    assert!(row.is_none(), "nonexistent message should return None");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn resolve_top_level_parent_returns_none_for_wrong_channel(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    // MSG1 is in CH1, query it against CH2
    let row = repo.resolve_top_level_parent(CH2, MSG1).await?;

    assert!(
        row.is_none(),
        "message in different channel should return None"
    );
    Ok(())
}

// -- get_top_level_messages_around --------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn around_middle_message_returns_both_sides(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // Anchor on MSG2 (11:00). Before should have MSG1, after should have MSG3.
    let anchor = repo
        .resolve_top_level_parent(CH1, MSG2)
        .await?
        .expect("msg2 exists");

    let (before, after) = repo
        .get_top_level_messages_around(CH1, anchor.created_at, anchor.id, 50)
        .await?;

    let before_ids: Vec<Uuid> = before.iter().map(|r| r.id).collect();
    let after_ids: Vec<Uuid> = after.iter().map(|r| r.id).collect();

    assert_eq!(before_ids, vec![MSG1], "MSG1 is older than anchor");
    assert_eq!(after_ids, vec![MSG3], "MSG3 is newer than anchor");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn around_oldest_message_has_no_before(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let anchor = repo
        .resolve_top_level_parent(CH1, MSG1)
        .await?
        .expect("msg1 exists");

    let (before, after) = repo
        .get_top_level_messages_around(CH1, anchor.created_at, anchor.id, 50)
        .await?;

    assert!(before.is_empty(), "nothing older than MSG1");
    let after_ids: Vec<Uuid> = after.iter().map(|r| r.id).collect();
    assert_eq!(after_ids, vec![MSG2, MSG3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn around_newest_message_has_no_after(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let anchor = repo
        .resolve_top_level_parent(CH1, MSG3)
        .await?
        .expect("msg3 exists");

    let (before, after) = repo
        .get_top_level_messages_around(CH1, anchor.created_at, anchor.id, 50)
        .await?;

    let before_ids: Vec<Uuid> = before.iter().map(|r| r.id).collect();
    assert_eq!(before_ids, vec![MSG2, MSG1]);
    assert!(after.is_empty(), "nothing newer than MSG3");
    Ok(())
}

// -- last_activity filter -----------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn last_activity_filters_by_message_created_at(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // msg3 created at 12:00 — only it was created after 11:30
    let filters = ChannelMessageFilters {
        activity_after: Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-01T11:30:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn last_activity_includes_messages_with_recent_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    // msg1 created at 10:00 but has replies up to 10:04.
    // msg2 (deleted) has reply at 11:01.
    // msg3 created at 12:00.
    // last_activity = 10:05 excludes msg1 (created 10:00, last reply 10:04),
    // but includes msg2 (reply at 11:01) and msg3 (created 12:00).
    let filters = ChannelMessageFilters {
        activity_after: Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-01T10:05:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn last_activity_combined_with_message_ids(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // Ask for msg1 and msg3, but with last_activity that excludes msg1
    let filters = ChannelMessageFilters {
        message_ids: vec![MSG1, MSG3],
        activity_after: Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-01T11:00:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
        ..Default::default()
    };
    let result = repo
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3]);
    Ok(())
}

// -- notification filters -----------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_done_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, true, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, true, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG2, false, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(true),
            seen: None,
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_not_done_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG2, true, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: None,
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_seen_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, true).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, false, true).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY5, false, true).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: None,
            seen: Some(true),
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_not_seen_filter_matches_top_level_messages_and_thread_replies(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, REPLY1, false, false).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG2, false, true).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: None,
            seen: Some(false),
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_done_and_seen_filters_match_soup_independent_exists_semantics(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, false, true).await?;
    insert_channel_message_notification(&pool, USER_A, CH1, MSG3, true, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: Some(false),
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    let ids: Vec<Uuid> = result.rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn notification_filter_is_scoped_to_requesting_user(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, USER_B, CH1, MSG3, false, false).await?;

    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: None,
        },
        ..Default::default()
    };
    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            Some(macro_user_id(USER_A)),
        )
        .await?;

    assert!(result.rows.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_filter_requires_requesting_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let filters = ChannelMessageFilters {
        notification_filters: NotificationFilters {
            done: Some(false),
            seen: None,
        },
        ..Default::default()
    };

    let result = repo(pool)
        .get_top_level_messages(
            CH1,
            &Query::Sort(CreatedAt, ()),
            MessagePageDirection::Older,
            50,
            &filters,
            None,
        )
        .await;

    let Err(err) = result else {
        anyhow::bail!("notification filters require a user id");
    };
    assert_eq!(
        err.to_string(),
        "notification_user_id is required when notification_filters are set"
    );
    Ok(())
}

// --- get_attachment_references ---
//
// The query is a byte-identical port of comms_db_client::get_attachment_references;
// these cover the three source paths (direct attachment, message mention, generic
// mention), participation gating, deleted-message exclusion, and the merged sort —
// rather than re-porting the full original suite.

fn channel_refs(
    refs: &[AttachmentEntityReference],
) -> Vec<&crate::domain::models::AttachmentChannelReference> {
    refs.iter()
        .filter_map(|r| match r {
            AttachmentEntityReference::Channel(c) => Some(c),
            AttachmentEntityReference::Generic(_) => None,
        })
        .collect()
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_returns_channel_reference_for_participant(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let refs = repo(pool)
        .get_attachment_references("document", "doc-1", USER_A)
        .await?;

    assert_eq!(refs.len(), 1);
    let channel = channel_refs(&refs);
    assert_eq!(channel.len(), 1);
    assert_eq!(channel[0].channel_id, CH1);
    assert_eq!(channel[0].message_id, MSG1);
    assert_eq!(channel[0].message_content, "first message");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_hidden_from_non_and_former_participants(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // user never in the channel
    let refs = repo
        .get_attachment_references("document", "doc-1", NON_MEMBER)
        .await?;
    assert!(refs.is_empty());

    // user who left the channel (left_at IS NOT NULL)
    let refs = repo
        .get_attachment_references("document", "doc-1", LEFT_USER)
        .await?;
    assert!(refs.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_excludes_deleted_message(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // img-deleted is attached to msg2, which is soft-deleted.
    let refs = repo(pool)
        .get_attachment_references("image", "img-deleted", USER_A)
        .await?;
    assert!(refs.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_returns_message_mention(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // doc-mention is mentioned inside msg3 (source_entity_type = 'message').
    let refs = repo(pool)
        .get_attachment_references("document", "doc-mention", USER_A)
        .await?;

    assert_eq!(refs.len(), 1);
    let channel = channel_refs(&refs);
    assert_eq!(channel.len(), 1);
    assert_eq!(channel[0].channel_id, CH1);
    assert_eq!(channel[0].message_id, MSG3);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_returns_generic_reference(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // doc-generic is mentioned by a non-message source; generic refs are not gated
    // by channel participation, so any user resolves them.
    let refs = repo(pool)
        .get_attachment_references("document", "doc-generic", NON_MEMBER)
        .await?;

    assert_eq!(refs.len(), 1);
    let AttachmentEntityReference::Generic(generic) = &refs[0] else {
        anyhow::bail!("expected a generic reference");
    };
    assert_eq!(generic.source_entity_type, "doc");
    assert_eq!(generic.source_entity_id, "src-doc");
    assert_eq!(generic.entity_id, "doc-generic");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attachment_references_merges_channel_and_generic_newest_first(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // doc-2 has a direct attachment on msg3 (12:00) and a newer generic mention
    // (2024-01-04); the merged result must be sorted newest-first.
    let refs = repo(pool)
        .get_attachment_references("document", "doc-2", USER_A)
        .await?;

    assert_eq!(refs.len(), 2);
    assert!(
        matches!(refs[0], AttachmentEntityReference::Generic(_)),
        "newer generic reference should come first"
    );
    assert!(
        matches!(refs[1], AttachmentEntityReference::Channel(_)),
        "older channel reference should come second"
    );
    Ok(())
}
