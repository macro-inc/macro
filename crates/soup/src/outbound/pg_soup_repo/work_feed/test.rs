use super::*;
use crate::domain::models::{NotifiedHydratableTypes, WorkFeedPagePosition};
use chrono::Timelike;
use foreign_entity::domain::models::SourceId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const USER_1: &str = "macro|user-1@test.com";
const DOC_A: &str = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_B: &str = "11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const DOC_C: &str = "11111111-cccc-cccc-cccc-cccccccccccc";
const DOC_E: &str = "11111111-eeee-eeee-eeee-eeeeeeeeeeee";
const DOC_F: &str = "11111111-ffff-ffff-ffff-ffffffffffff";
const DOC_G: &str = "11111111-0000-0000-0000-000000000000";
const CHAT_A: &str = "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CHANNEL_X: &str = "33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_M: &str = "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_Z: &str = "44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_S: &str = "44444444-5555-5555-5555-555555555555";
const LINK_1: &str = "55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const EVERYTHING: NotifiedHydratableTypes = NotifiedHydratableTypes {
    channels: true,
    channel_threads: true,
    email_threads: true,
    foreign_entities: true,
};

const ALL_TYPES: &[EntityType] = &[
    EntityType::Document,
    EntityType::Chat,
    EntityType::Project,
    EntityType::Channel,
    EntityType::ChannelMessage,
    EntityType::EmailThread,
    EntityType::CalendarEvent,
    EntityType::ForeignEntity,
    EntityType::AgentSession,
];

fn req<'a>(
    mode: WorkFeedSoupMode,
    link_ids: &'a [Uuid],
    sources: &'a [SourceId],
) -> WorkFeedCandidateRequest<'a> {
    WorkFeedCandidateRequest {
        user_id: MacroUserIdStr::parse_from_str(USER_1).unwrap(),
        limit: 50,
        mode,
        after: None,
        types: ALL_TYPES,
        filter: None,
        link_ids,
        foreign_entity_sources: sources,
        hydratable: EVERYTHING,
        only: None,
    }
}

fn keys(page: &[WorkFeedCandidate]) -> Vec<(EntityType, String)> {
    page.iter()
        .map(|c| (c.entity.entity_type, c.entity.entity_id.to_string()))
        .collect()
}

/// `(sort, attention, touched)` minutes past 10:00 per candidate.
fn minutes(page: &[WorkFeedCandidate]) -> Vec<(u32, Option<u32>, Option<u32>)> {
    page.iter()
        .map(|c| {
            (
                c.sort_at.minute(),
                c.attention_at.map(|t| t.minute()),
                c.touched_at.map(|t| t.minute()),
            )
        })
        .collect()
}

fn sources() -> Vec<SourceId> {
    vec![SourceId::user(USER_1)]
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn work_mode_merges_attention_and_own_work(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let page = work_feed_soup_page(&pool, req(WorkFeedSoupMode::Work, &link_ids, &sources)).await?;

    assert_eq!(
        keys(&page),
        vec![
            (EntityType::EmailThread, THREAD_S.to_string()),
            (EntityType::EmailThread, THREAD_Z.to_string()),
            (EntityType::Channel, CHANNEL_X.to_string()),
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Document, DOC_B.to_string()),
            (EntityType::Document, DOC_G.to_string()),
            (EntityType::Document, DOC_C.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::Document, DOC_E.to_string()),
            (EntityType::ChannelMessage, THREAD_M.to_string()),
        ]
    );
    assert_eq!(
        minutes(&page),
        vec![
            // thread-S: its notification does not count outside the inbox,
            // and archiving it after the send is not own work. Archived
            // thread-A has nothing else, so it stays out.
            (13, None, Some(13)),
            (12, Some(12), None),
            // channel-X: the thread mention belongs to thread-M.
            (11, None, Some(11)),
            // doc-A: the later opened row does not count as own work.
            (9, Some(5), Some(9)),
            // doc-B: user-2's later edit is not user-1's own work.
            (8, Some(8), Some(3)),
            (8, Some(8), None),
            // doc-C: own work alone admits it.
            (7, None, Some(7)),
            (4, Some(4), None),
            // doc-E: its only notification is done.
            (2, None, Some(2)),
            (1, Some(1), None),
        ]
    );

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn attention_mode_ignores_own_work(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let page =
        work_feed_soup_page(&pool, req(WorkFeedSoupMode::Attention, &link_ids, &sources)).await?;

    assert_eq!(
        keys(&page),
        vec![
            (EntityType::EmailThread, THREAD_Z.to_string()),
            (EntityType::Document, DOC_B.to_string()),
            (EntityType::Document, DOC_G.to_string()),
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::ChannelMessage, THREAD_M.to_string()),
        ]
    );
    assert!(page.iter().all(|c| c.touched_at.is_none()));
    assert_eq!(page[3].sort_at.minute(), 5);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn keyset_paginates_across_both_streams(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();

    let mut all = Vec::new();
    let mut after = None;
    loop {
        let mut request = req(WorkFeedSoupMode::Work, &link_ids, &sources);
        request.limit = 3;
        request.after = after;
        let page = work_feed_soup_page(&pool, request).await?;
        let full = page.len() == 3;
        all.extend(page);
        if !full {
            break;
        }
        let last = all.last().unwrap();
        after = Some(WorkFeedPagePosition {
            sort_at: last.sort_at,
            entity_id: last.entity.entity_id.to_string(),
        });
    }

    // Pages of three — including a boundary inside the doc-B/doc-G tie —
    // yield the same feed as one page: nothing repeats and nothing is lost.
    let one_page =
        work_feed_soup_page(&pool, req(WorkFeedSoupMode::Work, &link_ids, &sources)).await?;
    assert_eq!(keys(&all), keys(&one_page));
    assert_eq!(all.len(), 10);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn only_restricts_to_known_items(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let only: Vec<Entity<'static>> = vec![
        EntityType::Document.with_entity_string(DOC_A.to_string()),
        // Only ever opened: recomputing it finds nothing.
        EntityType::Document.with_entity_string(DOC_F.to_string()),
        EntityType::ChannelMessage.with_entity_string(THREAD_M.to_string()),
    ];
    let mut request = req(WorkFeedSoupMode::Work, &link_ids, &sources);
    request.only = Some(&only);
    let page = work_feed_soup_page(&pool, request).await?;

    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::ChannelMessage, THREAD_M.to_string()),
        ]
    );

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn types_narrow_both_streams(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let mut request = req(WorkFeedSoupMode::Work, &link_ids, &sources);
    request.types = &[EntityType::EmailThread, EntityType::Chat];
    let page = work_feed_soup_page(&pool, request).await?;

    assert_eq!(
        keys(&page),
        vec![
            (EntityType::EmailThread, THREAD_S.to_string()),
            (EntityType::EmailThread, THREAD_Z.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
        ]
    );

    Ok(())
}
