use super::*;
use crate::domain::models::{AttentionKeying, AttentionPagePosition, NotifiedHydratableTypes};
use chrono::Timelike;
use foreign_entity::domain::models::SourceId;
use item_filters::ast::EntityFilterAst;
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
const DOC_H: &str = "11111111-9999-9999-9999-999999999999";
const CHAT_A: &str = "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CHANNEL_X: &str = "33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_M: &str = "99999999-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_Z: &str = "44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_S: &str = "44444444-5555-5555-5555-555555555555";
const LINK_1: &str = "55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_1: &str = "66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_1: &str = "88888888-0000-0000-0000-000000000001";
const CONTACT_1: &str = "88888888-1111-0000-0000-000000000001";
const DISCUSSION_TYPES: &[EntityType] = &[
    EntityType::Initiative,
    EntityType::CrmCompany,
    EntityType::CrmContact,
];

/// Admit own work, as Home's work feed does.
const WORK: bool = true;
/// Attention only.
const ATTENTION: bool = false;

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
    own_work: bool,
    link_ids: &'a [Uuid],
    sources: &'a [SourceId],
) -> AttentionCandidateRequest<'a> {
    AttentionCandidateRequest {
        user_id: MacroUserIdStr::parse_from_str(USER_1).unwrap(),
        limit: 50,
        own_work,
        keying: AttentionKeying::ThreadScoped,
        after: None,
        types: ALL_TYPES,
        filter: None,
        link_ids,
        foreign_entity_sources: sources,
        hydratable: EVERYTHING,
        crm: false,
        only: None,
    }
}

fn keys(page: &[AttentionCandidate]) -> Vec<(EntityType, String)> {
    page.iter()
        .map(|c| (c.entity.entity_type, c.entity.entity_id.to_string()))
        .collect()
}

/// `(sort, attention, touched)` minutes past 10:00 per candidate.
fn minutes(page: &[AttentionCandidate]) -> Vec<(u32, Option<u32>, Option<u32>)> {
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

/// The fixture's whole work-mode feed, newest first.
fn work_feed_order() -> Vec<(EntityType, String)> {
    vec![
        (EntityType::EmailThread, THREAD_S.to_string()),
        (EntityType::EmailThread, THREAD_Z.to_string()),
        (EntityType::Channel, CHANNEL_X.to_string()),
        (EntityType::Document, DOC_H.to_string()),
        (EntityType::Document, DOC_A.to_string()),
        (EntityType::Document, DOC_B.to_string()),
        (EntityType::Document, DOC_G.to_string()),
        (EntityType::Document, DOC_C.to_string()),
        (EntityType::Chat, CHAT_A.to_string()),
        (EntityType::Document, DOC_E.to_string()),
        (EntityType::ChannelMessage, THREAD_M.to_string()),
    ]
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn work_mode_merges_attention_and_own_work(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let page = attention_soup_page(&pool, req(WORK, &link_ids, &sources)).await?;

    assert_eq!(keys(&page), work_feed_order());
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
            // doc-H: attention is its newest pending notification; the newer
            // done one neither places it nor outranks the edit.
            (10, Some(6), Some(10)),
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
    let page = attention_soup_page(&pool, req(ATTENTION, &link_ids, &sources)).await?;

    assert_eq!(
        keys(&page),
        vec![
            (EntityType::EmailThread, THREAD_Z.to_string()),
            (EntityType::Document, DOC_B.to_string()),
            (EntityType::Document, DOC_G.to_string()),
            (EntityType::Document, DOC_H.to_string()),
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::ChannelMessage, THREAD_M.to_string()),
        ]
    );
    assert!(page.iter().all(|c| c.touched_at.is_none()));
    // doc-H sits at its pending notification, not its newer done one.
    assert_eq!(page[3].sort_at.minute(), 6);
    assert_eq!(page[4].sort_at.minute(), 5);

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
        let mut request = req(WORK, &link_ids, &sources);
        request.limit = 3;
        request.after = after;
        let page = attention_soup_page(&pool, request).await?;
        let full = page.len() == 3;
        all.extend(page);
        if !full {
            break;
        }
        let last = all.last().unwrap();
        after = Some(AttentionPagePosition {
            sort_at: last.sort_at,
            entity_id: last.entity.entity_id.to_string(),
        });
    }

    // Pages of three — including a boundary inside the doc-B/doc-G tie —
    // yield the same feed as one page: nothing repeats and nothing is lost.
    let one_page = attention_soup_page(&pool, req(WORK, &link_ids, &sources)).await?;
    assert_eq!(keys(&all), keys(&one_page));
    assert_eq!(all.len(), 11);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn every_page_size_matches_the_whole_feed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let whole = work_feed_order();

    // A full page of own work bounds how far back attention is read; each
    // smaller page must still be the head of the whole feed.
    for limit in 1..=whole.len() {
        let mut request = req(WORK, &link_ids, &sources);
        request.limit = u16::try_from(limit)?;
        let page = attention_soup_page(&pool, request).await?;
        assert_eq!(keys(&page), whole[..limit], "limit {limit}");
    }

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
    let mut request = req(WORK, &link_ids, &sources);
    request.only = Some(&only);
    let page = attention_soup_page(&pool, request).await?;

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
    let mut request = req(WORK, &link_ids, &sources);
    request.types = &[EntityType::EmailThread, EntityType::Chat];
    let page = attention_soup_page(&pool, request).await?;

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

#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_discussions")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn discussions_on_visible_projects_and_crm_records_are_candidates(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let filter = EntityFilterAst {
        initiative_filter: Some(std::sync::Arc::new(filter_ast::Expr::val(
            item_filters::ast::initiative::InitiativeLiteral::Include,
        ))),
        ..Default::default()
    };
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.types = DISCUSSION_TYPES;
    request.filter = Some(&filter);
    request.crm = true;
    let page = attention_soup_page(&pool, request).await?;

    // Hidden company-2 and contact-2 and company-3 on another team stay out.
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Initiative, PROJECT_1.to_string()),
            (EntityType::CrmContact, CONTACT_1.to_string()),
            (EntityType::CrmCompany, COMPANY_1.to_string()),
        ]
    );

    // Without a CRM receipt to hydrate them, CRM records are not candidates.
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.types = DISCUSSION_TYPES;
    request.filter = Some(&filter);
    let page = attention_soup_page(&pool, request).await?;
    assert_eq!(
        keys(&page),
        vec![(EntityType::Initiative, PROJECT_1.to_string())]
    );

    Ok(())
}

const CHANNEL_Y: &str = "33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ROOT_R1: &str = "99999999-1111-1111-1111-111111111111";
const ROOT_R2: &str = "99999999-2222-2222-2222-222222222222";
const ROOT_R3: &str = "99999999-3333-3333-3333-333333333333";
const CHANNEL_TYPES: &[EntityType] = &[EntityType::Channel, EntityType::ChannelMessage];

#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_channel_keying")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn thread_scoped_keying_places_channel_notifications_on_their_threads(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.types = CHANNEL_TYPES;
    let page = attention_soup_page(&pool, request).await?;

    assert_eq!(
        keys(&page),
        vec![
            (EntityType::ChannelMessage, ROOT_R3.to_string()),
            (EntityType::ChannelMessage, ROOT_R2.to_string()),
            (EntityType::ChannelMessage, ROOT_R1.to_string()),
            (EntityType::ChannelMessage, THREAD_M.to_string()),
        ]
    );

    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_channel_keying")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn filed_entity_keying_places_a_channel_and_its_threads_together(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.keying = AttentionKeying::FiledEntity;
    request.types = CHANNEL_TYPES;
    let page = attention_soup_page(&pool, request).await?;

    // Channel-Y's three notifications place it once, at the newest (T32);
    // channel-X carries the thread-M mention (T1).
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Channel, CHANNEL_Y.to_string()),
            (EntityType::Channel, CHANNEL_X.to_string()),
        ]
    );
    assert_eq!(
        minutes(&page),
        vec![(32, Some(32), None), (1, Some(1), None)]
    );

    // Recomputing a thread finds nothing: no notification keys to it.
    let only: Vec<Entity<'static>> = vec![
        EntityType::Channel.with_entity_string(CHANNEL_Y.to_string()),
        EntityType::ChannelMessage.with_entity_string(ROOT_R2.to_string()),
    ];
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.keying = AttentionKeying::FiledEntity;
    request.only = Some(&only);
    let page = attention_soup_page(&pool, request).await?;
    assert_eq!(
        keys(&page),
        vec![(EntityType::Channel, CHANNEL_Y.to_string())]
    );

    Ok(())
}
