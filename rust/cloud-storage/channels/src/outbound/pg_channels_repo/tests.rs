use crate::domain::models::ParticipantRole;
use crate::domain::ports::ChannelMessagesRepo;
use crate::outbound::pg_channels_repo::PgChannelMessagesRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_pagination::{CreatedAt, Cursor, CursorVal, Query};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const CH1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c01);
const MSG1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000001);
const MSG2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000002);
const MSG3: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000003);

fn repo(pool: Pool<Postgres>) -> PgChannelMessagesRepo {
    PgChannelMessagesRepo::new(pool)
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_excludes_thread_replies_and_fully_deleted(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let rows = repo
        .get_top_level_messages(CH1, &Query::Sort(CreatedAt, ()), 50)
        .await?;

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
    let rows = repo
        .get_top_level_messages(CH1, &Query::Sort(CreatedAt, ()), 50)
        .await?;

    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG3, MSG2, MSG1]);
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
        .get_top_level_messages(CH1, &Query::Sort(CreatedAt, ()), 50)
        .await?;
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
    let page2 = repo.get_top_level_messages(CH1, &cursor, 50).await?;
    let ids: Vec<Uuid> = page2.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![MSG2, MSG1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn top_level_limit_is_respected(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let rows = repo
        .get_top_level_messages(CH1, &Query::Sort(CreatedAt, ()), 2)
        .await?;

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
    let ch2 = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c02);
    let rows = repo
        .get_top_level_messages(ch2, &Query::Sort(CreatedAt, ()), 50)
        .await?;

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].content, "other channel msg");
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
    // Preview should be the 2 most recent, in oldest-first order
    assert_eq!(thread.preview_replies[0].content, "reply 3");
    assert_eq!(thread.preview_replies[1].content, "reply 4");
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
    assert!(map.get(&MSG2).is_none());
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
    assert_eq!(map[&MSG3].len(), 1);
    assert!(map.get(&MSG2).is_none(), "msg2 has no attachments");
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
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 2)
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
    let page2 = repo.get_channel_attachments(CH1, &cursor, 2).await?;
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
        .get_channel_attachments(CH1, &Query::Sort(CreatedAt, ()), 50)
        .await?;

    let img = all.iter().find(|a| a.entity_type == "image").unwrap();
    assert_eq!(img.width, Some(800));
    assert_eq!(img.height, Some(600));

    let doc = all.iter().find(|a| a.entity_id == "doc-1").unwrap();
    assert_eq!(doc.width, None);
    assert_eq!(doc.height, None);
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
