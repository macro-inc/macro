use super::*;
use crate::domain::models::{AttentionKeying, AttentionPagePosition, NotifiedHydratableTypes};
use chrono::Timelike;
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use foreign_entity::domain::models::SourceId;
use item_filters::ast::{EntityFilterAst, document::DocumentLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use sqlx::{Pool, Postgres};
use std::sync::Arc;
use uuid::Uuid;

const USER_1: &str = "macro|user-1@example.com";
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
const THREAD_A: &str = "44444444-0000-0000-0000-000000000000";
const LINK_1: &str = "55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_1: &str = "66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_1: &str = "88888888-0000-0000-0000-000000000001";
const CONTACT_1: &str = "88888888-1111-0000-0000-000000000001";
const CONTACT_3: &str = "88888888-1111-0000-0000-000000000003";
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
        assume_attention: false,
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

#[test]
fn only_a_probe_changes_the_query() {
    let link_ids = [];
    let sources = sources();
    let normal = build_query(&req(ATTENTION, &link_ids, &sources));
    assert_eq!(
        normal,
        format!(
            include_str!("query.sql"),
            attention_source = "pending",
            probe_skips_pending = "",
            thread_keyed = thread_keyed(AttentionKeying::ThreadScoped),
            own_work_ae = own_work("ae"),
            own_work_newer = own_work("newer"),
            email_inbox_gate = email_inbox_gate(),
            document_gate = document_gate(ID_SQL, None),
            chat_gate = chat_gate(ID_SQL, None),
            project_gate = project_gate(ID_SQL, None),
            initiative_gate = initiative_gate(ID_SQL, None),
            channel_gate = channel_gate(ID_SQL, None),
            channel_thread_gate = channel_thread_gate(ID_SQL, None),
            email_gate = email_gate(ID_SQL, None),
            calendar_event_gate = calendar_event_gate(None),
            foreign_entity_gate = foreign_entity_gate(None),
            agent_session_gate = agent_session_gate(None),
            crm_company_gate = crm_company_gate(),
            crm_contact_gate = crm_contact_gate(),
            harness_gate = harness_gate(),
        )
    );
    assert!(normal.contains("FROM pending\n            WHERE ($3::timestamptz"));

    let mut probe = req(ATTENTION, &link_ids, &sources);
    probe.assume_attention = true;
    let probe = build_query(&probe);
    assert_ne!(probe, normal);
    // A probe reads neither the viewer's pending notifications nor reads
    // its candidates from them, so its cost does not grow with them.
    assert!(probe.contains("WHERE un.user_id = $1 AND FALSE"));
    assert!(!normal.contains("AND FALSE\n    AND un.deleted_at"));
    assert!(!probe.contains("FROM pending\n            WHERE ($3::timestamptz"));
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_probe_lists_what_a_new_notification_would_place(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let only: Vec<Entity<'static>> = vec![
        // Already notified: listed once.
        EntityType::Document.with_entity_string(DOC_A.to_string()),
        // Never notified, but visible: a new notification would place it.
        EntityType::Document.with_entity_string(DOC_F.to_string()),
        // No such document.
        EntityType::Document.with_entity_string(Uuid::nil().to_string()),
        // Archived mail never places an item.
        EntityType::EmailThread.with_entity_string(THREAD_A.to_string()),
    ];
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.only = Some(&only);
    request.assume_attention = true;
    let page = attention_soup_page(&pool, request).await?;

    let mut listed = keys(&page);
    listed.sort_by(|a, b| a.1.cmp(&b.1));
    assert_eq!(
        listed,
        vec![
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Document, DOC_F.to_string()),
        ]
    );

    let mut without_probe = req(ATTENTION, &link_ids, &sources);
    without_probe.only = Some(&only);
    assert_eq!(
        keys(&attention_soup_page(&pool, without_probe).await?),
        vec![(EntityType::Document, DOC_A.to_string())]
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
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn task_subtype_narrows_documents_in_both_streams(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let is_task = || Expr::val(DocumentLiteral::SubType(DocumentSubType::Task));
    let tasks = EntityFilterAst {
        document_filter: Some(Arc::new(is_task())),
        ..Default::default()
    };
    let documents = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::is_not(is_task()))),
        ..Default::default()
    };

    let mut request = req(WORK, &link_ids, &sources);
    request.types = &[EntityType::Document];
    request.filter = Some(&tasks);
    let page = attention_soup_page(&pool, request).await?;
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Document, DOC_B.to_string()),
            (EntityType::Document, DOC_C.to_string()),
        ]
    );

    let mut request = req(WORK, &link_ids, &sources);
    request.types = &[EntityType::Document];
    request.filter = Some(&documents);
    let page = attention_soup_page(&pool, request).await?;
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Document, DOC_H.to_string()),
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Document, DOC_G.to_string()),
            (EntityType::Document, DOC_E.to_string()),
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

    // Hidden company-2 with its contact-4, hidden contact-2 and company-3 on
    // another team stay out; company-less contact-3 is in.
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::CrmContact, CONTACT_3.to_string()),
            (EntityType::Initiative, PROJECT_1.to_string()),
            (EntityType::CrmContact, CONTACT_1.to_string()),
            (EntityType::CrmCompany, COMPANY_1.to_string()),
        ]
    );

    // The retired switch is false in the fixture. Missing settings must
    // likewise preserve record visibility, without enrolling any mailbox.
    sqlx::query!("DELETE FROM team_crm_settings")
        .execute(&pool)
        .await?;
    for own_work in [ATTENTION, WORK] {
        for keying in [AttentionKeying::ThreadScoped, AttentionKeying::FiledEntity] {
            let mut request = req(own_work, &link_ids, &sources);
            request.types = DISCUSSION_TYPES;
            request.filter = Some(&filter);
            request.crm = true;
            request.keying = keying;
            assert_eq!(
                keys(&attention_soup_page(&pool, request).await?),
                keys(&page)
            );
        }
    }

    // Without a CRM receipt to hydrate them, CRM records are not candidates.
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.types = DISCUSSION_TYPES;
    request.filter = Some(&filter);
    let page = attention_soup_page(&pool, request).await?;
    assert_eq!(
        keys(&page),
        vec![(EntityType::Initiative, PROJECT_1.to_string())]
    );

    // Membership is still required even if a caller supplies the CRM flag.
    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", USER_1)
        .execute(&pool)
        .await?;
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.types = DISCUSSION_TYPES;
    request.filter = Some(&filter);
    request.crm = true;
    assert_eq!(
        keys(&attention_soup_page(&pool, request).await?),
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

#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_harnesses")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn runtime_access_notifications_are_candidates(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.types = &[EntityType::Harness];
    request.keying = AttentionKeying::FiledEntity;
    let page = attention_soup_page(&pool, request).await?;

    // runtime-3 belongs to someone on another team, and runtime-4 is deleted.
    assert_eq!(
        keys(&page),
        vec![
            (
                EntityType::Harness,
                "aaaaaaaa-0000-0000-0000-000000000002".to_string()
            ),
            (
                EntityType::Harness,
                "aaaaaaaa-0000-0000-0000-000000000001".to_string()
            ),
        ]
    );
    Ok(())
}

/// The planner's total cost for the attention query of `request`.
async fn planned_cost(pool: &Pool<Postgres>, request: &AttentionCandidateRequest<'_>) -> f64 {
    let types = requested_types(request);
    let (only_types, only_ids): (Option<Vec<&str>>, Option<Vec<&str>>) = match request.only {
        Some(only) => (
            Some(only.iter().map(|e| e.entity_type.into()).collect()),
            Some(only.iter().map(|e| e.entity_id.as_ref()).collect()),
        ),
        None => (None, None),
    };
    let plan: serde_json::Value = sqlx::QueryBuilder::<Postgres>::new(format!(
        "EXPLAIN (FORMAT JSON) {}",
        build_query(request)
    ))
    .build_query_scalar()
    .bind(request.user_id.as_ref())
    .bind(&types)
    .bind(None::<chrono::DateTime<chrono::Utc>>)
    .bind(None::<String>)
    .bind(request.link_ids)
    .bind(request.limit as i64)
    .bind(Vec::<&str>::new())
    .bind(Vec::<&str>::new())
    .bind(request.own_work)
    .bind(only_types)
    .bind(only_ids)
    .persistent(false)
    .fetch_one(pool)
    .await
    .unwrap();
    plan[0]["Plan"]["Total Cost"].as_f64().unwrap()
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_probe_costs_the_same_however_many_notifications_are_pending(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // A viewer with a large inbox: 50,000 pending notifications.
    sqlx::query!(
        "WITH n AS (
            INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender)
            SELECT gen_random_uuid(), 'document_mention', gen_random_uuid()::text, 'document', 'test'
            FROM generate_series(1, 50000)
            RETURNING id, event_item_id
        )
        INSERT INTO user_notification (user_id, notification_id, state, event_item_type, event_item_id, notification_event_type)
        SELECT $1, id, 'unseen', 'document', event_item_id, 'document_mention' FROM n",
        USER_1,
    )
    .execute(&pool)
    .await?;
    sqlx::query!("ANALYZE").execute(&pool).await?;

    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let only = vec![EntityType::Document.with_entity_string(DOC_F.to_string())];
    let mut probe = req(ATTENTION, &link_ids, &sources);
    probe.only = Some(&only);
    probe.assume_attention = true;
    let mut page = req(ATTENTION, &link_ids, &sources);
    page.only = Some(&only);

    // Postgres JIT-compiles a query planned above `jit_above_cost` (100,000
    // by default), which costs a probe hundreds of milliseconds. A probe
    // never reads the pending notifications, so it stays far below it; a
    // normal page, which reads them all, does not.
    let probe_cost = planned_cost(&pool, &probe).await;
    let page_cost = planned_cost(&pool, &page).await;
    assert!(probe_cost < 1_000.0, "probe planned at {probe_cost}");
    assert!(page_cost > 10_000.0, "page planned at {page_cost}");
    Ok(())
}
