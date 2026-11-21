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
    copy_entities_onto_recipient_rows(&pool).await?;
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

/// Copy each notification's entity onto its recipient rows, as notification
/// ingress does; the fixtures insert recipient rows without it. Reads of
/// known items (`only`) find their notifications through these copies.
async fn copy_entities_onto_recipient_rows(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE user_notification un \
         SET event_item_type = n.event_item_type, \
             event_item_id = n.event_item_id, \
             notification_event_type = n.notification_event_type \
         FROM notification n WHERE n.id = un.notification_id",
    )
    .execute(pool)
    .await?;
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
            pending = format!(
                include_str!("pending.sql"),
                thread_keyed = thread_keyed(AttentionKeying::ThreadScoped),
                probe_skips_pending = "",
            ),
            own_work_latest = format!(
                include_str!("own_work_latest.sql"),
                own_work_ae = own_work("ae"),
                own_work_newer = own_work("newer"),
            ),
            own_work_ae = own_work("ae"),
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
            team_gate = team_gate(),
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
async fn filed_entity_only_matches_the_whole_feed_for_every_item(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    copy_entities_onto_recipient_rows(&pool).await?;
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    for own_work in [ATTENTION, WORK] {
        let mut whole = req(own_work, &link_ids, &sources);
        whole.keying = AttentionKeying::FiledEntity;
        let feed = attention_soup_page(&pool, whole).await?;
        assert!(
            feed.iter()
                .any(|candidate| candidate.attention_at.is_some())
        );

        // Every item of the feed, and two the feed does not hold: one only
        // ever opened and one that does not exist.
        let mut only: Vec<Entity<'static>> = feed
            .iter()
            .map(|candidate| candidate.entity.clone())
            .collect();
        only.push(EntityType::Document.with_entity_string(DOC_F.to_string()));
        only.push(EntityType::Channel.with_entity_string(Uuid::nil().to_string()));
        let mut known = req(own_work, &link_ids, &sources);
        known.keying = AttentionKeying::FiledEntity;
        known.only = Some(&only);

        assert_eq!(attention_soup_page(&pool, known).await?, feed);
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn filed_entity_only_reads_one_item_of_the_feed(pool: Pool<Postgres>) -> anyhow::Result<()> {
    copy_entities_onto_recipient_rows(&pool).await?;
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let mut whole = req(ATTENTION, &link_ids, &sources);
    whole.keying = AttentionKeying::FiledEntity;
    let feed = attention_soup_page(&pool, whole).await?;

    for candidate in &feed {
        let only = vec![candidate.entity.clone()];
        let mut known = req(ATTENTION, &link_ids, &sources);
        known.keying = AttentionKeying::FiledEntity;
        known.only = Some(&only);
        assert_eq!(
            attention_soup_page(&pool, known).await?,
            vec![candidate.clone()]
        );
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_probe_lists_what_a_new_notification_would_place(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    copy_entities_onto_recipient_rows(&pool).await?;
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
    copy_entities_onto_recipient_rows(&pool).await?;
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

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed", "attention_teams")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn team_notifications_are_candidates_only_for_members(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let mut request = req(ATTENTION, &link_ids, &sources);
    request.types = &[EntityType::Team];
    request.keying = AttentionKeying::FiledEntity;
    let page = attention_soup_page(&pool, request).await?;

    // team-2's request stays out: user-1 is not a member. The invite is filed
    // under an invite id, which names no team.
    assert_eq!(
        keys(&page),
        vec![(
            EntityType::Team,
            "bbbbbbbb-0000-0000-0000-000000000001".to_string()
        )]
    );

    // Membership alone never lists a team: user-2 is in team-2, whose request
    // notification is user-1's, not theirs.
    let mut teammate = req(ATTENTION, &link_ids, &sources);
    teammate.types = &[EntityType::Team];
    teammate.keying = AttentionKeying::FiledEntity;
    teammate.user_id = MacroUserIdStr::parse_from_str("macro|user-2@example.com")?;
    assert!(attention_soup_page(&pool, teammate).await?.is_empty());
    Ok(())
}

// A bulk clear marks a team request done and owns it through `done_by`; its
// undo reopens it, but a state change made in between takes ownership back, so
// the undo leaves that notification alone. The UPDATEs mirror the clear and
// undo statements in `notification::outbound::bulk_action`.
#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed", "attention_teams")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_cleared_team_request_leaves_attention_until_undone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const TEAM_1: &str = "bbbbbbbb-0000-0000-0000-000000000001";
    const REQUEST: &str = "0190b000-0000-7000-8000-000000000060";
    let action_id = Uuid::parse_str("0190b000-0000-7000-8000-0000000000aa")?;
    let request_id = Uuid::parse_str(REQUEST)?;
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let team_page = || {
        let mut request = req(ATTENTION, &link_ids, &sources);
        request.types = &[EntityType::Team];
        request.keying = AttentionKeying::FiledEntity;
        attention_soup_page(&pool, request)
    };
    let clear = || {
        sqlx::query!(
            "UPDATE user_notification SET state = 'done', done_by = $1 \
             WHERE user_id = $2 AND notification_id = $3",
            action_id,
            USER_1,
            request_id,
        )
        .execute(&pool)
    };
    let undo = || {
        sqlx::query!(
            "UPDATE user_notification SET state = 'unseen', done_by = NULL \
             WHERE user_id = $2 AND notification_id = $3 AND done_by = $1 \
             AND state = 'done' AND deleted_at IS NULL",
            action_id,
            USER_1,
            request_id,
        )
        .execute(&pool)
    };
    let listed = vec![(EntityType::Team, TEAM_1.to_string())];

    clear().await?;
    assert!(team_page().await?.is_empty());
    assert_eq!(undo().await?.rows_affected(), 1);
    assert_eq!(keys(&team_page().await?), listed);

    // A writer that knows nothing of bulk actions reopens it after a clear.
    clear().await?;
    sqlx::query!(
        "UPDATE user_notification SET state = 'seen' \
         WHERE user_id = $1 AND notification_id = $2",
        USER_1,
        request_id,
    )
    .execute(&pool)
    .await?;
    let done_by = sqlx::query_scalar!(
        "SELECT done_by FROM user_notification WHERE user_id = $1 AND notification_id = $2",
        USER_1,
        request_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(done_by, None);
    assert_eq!(keys(&team_page().await?), listed);
    assert_eq!(undo().await?.rows_affected(), 0);

    // Leaving the team drops its request from attention.
    sqlx::query!(
        "DELETE FROM team_user WHERE user_id = $1 AND team_id = $2",
        USER_1,
        Uuid::parse_str(TEAM_1)?,
    )
    .execute(&pool)
    .await?;
    assert!(team_page().await?.is_empty());
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
    let page = req(ATTENTION, &link_ids, &sources);

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

/// One pending notification on a channel that names no thread, so it stays
/// on the channel under thread-scoped keying.
async fn notify_on_channel(
    pool: &Pool<Postgres>,
    id: &str,
    channel_id: &str,
    at: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        "WITH n AS (
            INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, created_at)
            VALUES ($2::text::uuid, 'channel_message_send', $3, 'channel', 'test', $4::text::timestamp)
            RETURNING id, created_at
        )
        INSERT INTO user_notification (user_id, notification_id, created_at, sent, state, event_item_type, event_item_id, notification_event_type)
        SELECT $1, id, created_at, TRUE, 'unseen', 'channel', $3, 'channel_message_send' FROM n",
        USER_1,
        id,
        channel_id,
        at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_channel_keying")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_read_of_known_items_matches_the_whole_feed_for_every_item(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    copy_entities_onto_recipient_rows(&pool).await?;
    // Older than channel-Y's three thread notifications (T30-T32), which
    // place their threads under thread-scoped keying: the channel itself is
    // placed by this one.
    notify_on_channel(
        &pool,
        "0190b000-0000-7000-8000-000000000029",
        CHANNEL_Y,
        "2024-06-01 10:29:00",
    )
    .await?;
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let channel_y = EntityType::Channel.with_entity_string(CHANNEL_Y.to_string());
    for keying in [AttentionKeying::ThreadScoped, AttentionKeying::FiledEntity] {
        for own_work in [ATTENTION, WORK] {
            let mut whole = req(own_work, &link_ids, &sources);
            whole.keying = keying;
            let feed = attention_soup_page(&pool, whole).await?;
            if keying == AttentionKeying::ThreadScoped {
                let placed = feed
                    .iter()
                    .find(|candidate| candidate.entity == channel_y)
                    .expect("the send places channel-Y");
                assert_eq!(placed.attention_at.map(|at| at.minute()), Some(29));
            }

            // Every item of the feed, and some the feed does not hold: one
            // only ever opened, a channel whose one notification names a
            // thread, an email thread only ever archived, and a channel and
            // a thread that do not exist.
            let mut only: Vec<Entity<'static>> = feed
                .iter()
                .map(|candidate| candidate.entity.clone())
                .collect();
            for extra in [
                EntityType::Document.with_entity_string(DOC_F.to_string()),
                EntityType::Channel.with_entity_string(CHANNEL_X.to_string()),
                EntityType::EmailThread.with_entity_string(THREAD_A.to_string()),
                EntityType::Channel.with_entity_string(Uuid::nil().to_string()),
                EntityType::ChannelMessage.with_entity_string(Uuid::nil().to_string()),
            ] {
                if !only.contains(&extra) {
                    only.push(extra);
                }
            }
            let mut known = req(own_work, &link_ids, &sources);
            known.keying = keying;
            known.only = Some(&only);
            assert_eq!(
                attention_soup_page(&pool, known).await?,
                feed,
                "{keying:?} own_work={own_work}"
            );

            // And each item alone reads back as itself, with its attention
            // and its latest own work.
            for candidate in &feed {
                let only = vec![candidate.entity.clone()];
                let mut known = req(own_work, &link_ids, &sources);
                known.keying = keying;
                known.only = Some(&only);
                assert_eq!(
                    attention_soup_page(&pool, known).await?,
                    vec![candidate.clone()],
                    "{keying:?} own_work={own_work}"
                );
            }
        }
    }
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../fixtures",
        scripts("work_feed", "attention_channel_keying")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn the_whole_feed_holds_own_work_and_thread_scoped_items(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    copy_entities_onto_recipient_rows(&pool).await?;
    notify_on_channel(
        &pool,
        "0190b000-0000-7000-8000-000000000029",
        CHANNEL_Y,
        "2024-06-01 10:29:00",
    )
    .await?;
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    // The items the equivalence above is worth checking on: a channel placed
    // by a send, a thread, and own work whose latest touch is not its newest
    // event (doc-A was opened after the edit that places it; thread-S was
    // archived after the send that places it).
    let feed = attention_soup_page(&pool, req(WORK, &link_ids, &sources)).await?;
    for key in [
        (EntityType::Channel, CHANNEL_Y.to_string()),
        (EntityType::ChannelMessage, ROOT_R2.to_string()),
        (EntityType::Document, DOC_A.to_string()),
        (EntityType::EmailThread, THREAD_S.to_string()),
    ] {
        assert!(keys(&feed).contains(&key), "{key:?} not in {feed:?}");
    }
    Ok(())
}

/// The shared buffers the attention query of `request` reads when it runs.
async fn blocks_read(pool: &Pool<Postgres>, request: &AttentionCandidateRequest<'_>) -> i64 {
    let types = requested_types(request);
    let only = request.only.unwrap_or_default();
    let only_types: Vec<&str> = only.iter().map(|e| e.entity_type.into()).collect();
    let only_ids: Vec<&str> = only.iter().map(|e| e.entity_id.as_ref()).collect();
    let plan: serde_json::Value = sqlx::QueryBuilder::<Postgres>::new(format!(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {}",
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
    .bind(request.only.map(|_| only_types))
    .bind(request.only.map(|_| only_ids))
    .persistent(false)
    .fetch_one(pool)
    .await
    .unwrap();
    let top = &plan[0]["Plan"];
    top["Shared Hit Blocks"].as_i64().unwrap() + top["Shared Read Blocks"].as_i64().unwrap()
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_recompute_of_a_busy_shared_item_reads_only_the_viewers_work_on_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // The viewer's own history, so the planner expects their rows anywhere,
    // and a document 200 other people edited 20,000 times since the viewer
    // last did.
    sqlx::query!(
        "INSERT INTO activity_events (id, actor_id, subject_id, action, entity_type, entity_id, occurred_at)
        SELECT gen_random_uuid(), $1, $1, 'edited', 'document', gen_random_uuid()::text,
               timestamptz '2024-01-01' + i * interval '1 minute'
        FROM generate_series(1, 50000) AS i",
        USER_1,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO activity_events (id, actor_id, subject_id, action, entity_type, entity_id, occurred_at)
        SELECT gen_random_uuid(), 'macro|busy-' || (i % 200) || '@example.com',
               'macro|busy-' || (i % 200) || '@example.com', 'edited', 'document', $1,
               timestamptz '2026-03-01' + i * interval '1 minute'
        FROM generate_series(1, 20000) AS i",
        DOC_F,
    )
    .execute(&pool)
    .await?;
    sqlx::query!("ANALYZE").execute(&pool).await?;

    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let only = vec![EntityType::Document.with_entity_string(DOC_F.to_string())];
    for keying in [AttentionKeying::ThreadScoped, AttentionKeying::FiledEntity] {
        let mut recompute = req(WORK, &link_ids, &sources);
        recompute.keying = keying;
        recompute.only = Some(&only);
        let blocks = blocks_read(&pool, &recompute).await;
        eprintln!("recompute {keying:?} of a busy document: {blocks} blocks");
        assert!(
            blocks < 500,
            "{keying:?} recompute of a busy document read {blocks} blocks"
        );
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_recompute_costs_the_same_however_much_the_viewer_holds(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // A viewer with a long history of their own: 50,000 edits, one item each.
    sqlx::query!(
        "INSERT INTO activity_events (id, actor_id, subject_id, action, entity_type, entity_id, occurred_at)
        SELECT gen_random_uuid(), $1, $1, 'edited', 'document', gen_random_uuid()::text,
               timestamptz '2024-01-01' + i * interval '1 minute'
        FROM generate_series(1, 50000) AS i",
        USER_1,
    )
    .execute(&pool)
    .await?;
    // And a large inbox: 50,000 pending notifications, a fifth of them on
    // channels and naming a thread.
    sqlx::query!(
        "WITH n AS (
            INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, secondary_event_item_id, secondary_event_item_type)
            SELECT gen_random_uuid(),
                   CASE WHEN i % 5 = 0 THEN 'channel_message_reaction' ELSE 'document_mention' END,
                   gen_random_uuid()::text,
                   CASE WHEN i % 5 = 0 THEN 'channel' ELSE 'document' END,
                   'test',
                   CASE WHEN i % 5 = 0 THEN gen_random_uuid()::text END,
                   CASE WHEN i % 5 = 0 THEN 'channel_message' END
            FROM generate_series(1, 50000) AS i
            RETURNING id, event_item_id, event_item_type, notification_event_type
        )
        INSERT INTO user_notification (user_id, notification_id, state, event_item_type, event_item_id, notification_event_type)
        SELECT $1, id, 'unseen', event_item_type, event_item_id, notification_event_type FROM n",
        USER_1,
    )
    .execute(&pool)
    .await?;
    sqlx::query!("ANALYZE").execute(&pool).await?;

    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let only = vec![
        EntityType::Document.with_entity_string(DOC_F.to_string()),
        EntityType::Channel.with_entity_string(CHANNEL_X.to_string()),
        EntityType::ChannelMessage.with_entity_string(THREAD_M.to_string()),
    ];
    let page_cost = planned_cost(&pool, &req(ATTENTION, &link_ids, &sources)).await;
    assert!(page_cost > 10_000.0, "page planned at {page_cost}");

    // A recompute of known items reads only their notifications and the
    // viewer's work on them, under either keying, so its plan grows with
    // neither the inbox nor the history.
    for keying in [AttentionKeying::ThreadScoped, AttentionKeying::FiledEntity] {
        for own_work in [ATTENTION, WORK] {
            let mut recompute = req(own_work, &link_ids, &sources);
            recompute.keying = keying;
            recompute.only = Some(&only);
            let cost = planned_cost(&pool, &recompute).await;
            eprintln!("recompute {keying:?} own_work={own_work}: {cost} (page {page_cost})");
            assert!(
                cost < 2_000.0,
                "{keying:?} recompute planned at {cost}, page at {page_cost}"
            );
        }
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn an_agent_session_recompute_reads_its_grants_not_the_viewers_sources(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // A viewer in 15,000 channels, notified about a session they reach only
    // through the last of them.
    let session = Uuid::from_u128(0xa5e5_0001);
    let channel = "77777777-0000-7000-8000-000000015000";
    sqlx::query(
        "INSERT INTO comms_channels (id, channel_type, owner_id, created_at, updated_at)
        SELECT ('77777777-0000-7000-8000-' || lpad(i::text, 12, '0'))::uuid, 'private', $1,
               timestamptz '2024-01-01', timestamptz '2024-01-01'
        FROM generate_series(1, 15000) AS i",
    )
    .bind(USER_1)
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO comms_channel_participants (channel_id, role, user_id, joined_at)
        SELECT ('77777777-0000-7000-8000-' || lpad(i::text, 12, '0'))::uuid, 'member', $1,
               timestamptz '2024-01-01'
        FROM generate_series(1, 15000) AS i",
    )
    .bind(USER_1)
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO agent_session (
            id, owner_id, bot_id, model, harness, repo_url, workspace, name,
            status, status_event_name, created_at, modified_at
        )
        VALUES ($1, 'macro|owner@example.com', $2, 'model', 'harness', NULL, '/workspace',
                'Session', 'event', 'acp_ready', '2024-06-01 09:00:00+00', '2024-06-01 09:00:00+00')",
    )
    .bind(session)
    .bind(Uuid::from_u128(0xa9e7))
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'agent_session', 'macro|owner@example.com', 'user', 'owner'),
               ($1, 'agent_session', $2, 'channel', 'view')",
    )
    .bind(session)
    .bind(channel)
    .execute(&pool)
    .await?;
    let notification = Uuid::from_u128(0xa5e5_0051);
    sqlx::query(
        "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type,
                                   service_sender, created_at, metadata)
        VALUES ($1, 'agent_session_settled', $2, 'agent_session', 'test',
                '2026-06-01 10:21:00', '{}')",
    )
    .bind(notification)
    .bind(session.to_string())
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO user_notification (user_id, notification_id, created_at, sent, state,
                                        event_item_type, event_item_id, notification_event_type)
        VALUES ($1, $2, '2026-06-01 10:21:00', TRUE, 'unseen', 'agent_session', $3,
                'agent_session_settled')",
    )
    .bind(USER_1)
    .bind(notification)
    .bind(session.to_string())
    .execute(&pool)
    .await?;
    // Other people's sessions, so `entity_access` is big enough that an
    // unanalyzed estimate expects several grants on any one session.
    sqlx::query(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT gen_random_uuid(), 'agent_session', 'macro|owner-' || (i % 2000) || '@example.com',
               'user', 'owner'
        FROM generate_series(1, 400000) AS i",
    )
    .execute(&pool)
    .await?;
    // Statistics from before the grants and memberships landed.
    sqlx::query(
        "DELETE FROM pg_statistic
        WHERE starelid IN ('comms_channel_participants'::regclass, 'entity_access'::regclass)",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "UPDATE pg_class SET reltuples = 0, relpages = 0
        WHERE oid IN ('comms_channel_participants'::regclass, 'entity_access'::regclass)",
    )
    .execute(&pool)
    .await?;

    let filter = EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::val(
            item_filters::ast::agent_session::AgentSessionLiteral::Include,
        ))),
        ..EntityFilterAst::default()
    };
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let only = vec![EntityType::AgentSession.with_entity_string(session.to_string())];
    let recompute = || {
        let mut recompute = req(WORK, &link_ids, &sources);
        recompute.filter = Some(&filter);
        recompute.only = Some(&only);
        recompute
    };
    let page = attention_soup_page(&pool, recompute()).await?;
    assert_eq!(
        keys(&page),
        vec![(EntityType::AgentSession, session.to_string())]
    );
    let blocks = blocks_read(&pool, &recompute()).await;
    eprintln!("recompute of an agent session: {blocks} blocks");
    assert!(
        blocks < 1_000,
        "recompute of an agent session read {blocks} blocks"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("work_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_thread_recompute_looks_up_its_root_not_every_channels_roots(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    copy_entities_onto_recipient_rows(&pool).await?;
    // Other people's channels, holding root messages the viewer can't read.
    sqlx::query(
        "INSERT INTO comms_channels (id, channel_type, owner_id, created_at, updated_at)
        SELECT ('77777777-0000-7000-8000-' || lpad(i::text, 12, '0'))::uuid, 'private',
               'macro|someone@example.com', timestamptz '2024-01-01', timestamptz '2024-01-01'
        FROM generate_series(0, 499) AS i",
    )
    .execute(&pool)
    .await?;
    sqlx::query(
        "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, sender_id,
                                     content, created_at, updated_at)
        SELECT gen_random_uuid(), 'channel',
               '77777777-0000-7000-8000-' || lpad((i % 500)::text, 12, '0'),
               'macro|someone@example.com', 'm', timestamptz '2024-01-01', timestamptz '2024-01-01'
        FROM generate_series(1, 50000) AS i",
    )
    .execute(&pool)
    .await?;
    // Statistics from before the messages landed.
    sqlx::query("DELETE FROM pg_statistic WHERE starelid = 'comms_messages'::regclass")
        .execute(&pool)
        .await?;
    sqlx::query(
        "UPDATE pg_class SET reltuples = 0, relpages = 0 WHERE oid = 'comms_messages'::regclass",
    )
    .execute(&pool)
    .await?;

    let link_ids = [Uuid::parse_str(LINK_1)?];
    let sources = sources();
    let only = vec![EntityType::ChannelMessage.with_entity_string(THREAD_M.to_string())];
    let recompute = || {
        let mut recompute = req(WORK, &link_ids, &sources);
        recompute.only = Some(&only);
        recompute
    };
    let page = attention_soup_page(&pool, recompute()).await?;
    assert_eq!(
        keys(&page),
        vec![(EntityType::ChannelMessage, THREAD_M.to_string())]
    );
    let blocks = blocks_read(&pool, &recompute()).await;
    eprintln!("recompute of a channel thread: {blocks} blocks");
    assert!(
        blocks < 1_000,
        "recompute of a channel thread read {blocks} blocks"
    );
    Ok(())
}
