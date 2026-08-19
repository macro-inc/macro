use super::*;
use crate::domain::models::TouchedPagePosition;
use item_filters::ast::EntityFilterAst;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const USER_1: &str = "macro|user-1@test.com";
const DOC_A: &str = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DOC_B: &str = "11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CHAT_A: &str = "22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_A: &str = "aaaaaaaa-ffff-ffff-ffff-ffffffffffff";
const CHANNEL_X: &str = "33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const THREAD_Z: &str = "44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const LINK_1: &str = "55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

fn req<'a>(
    user_id: &'a str,
    filter: Option<&'a EntityFilterAst>,
    link_ids: &'a [uuid::Uuid],
) -> TouchedSoupRequest<'a> {
    TouchedSoupRequest {
        user_id: MacroUserIdStr::parse_from_str(user_id).unwrap(),
        limit: 50,
        after: None,
        filter,
        include_projects: false,
        link_ids,
    }
}

fn keys(page: &[TouchedEntity]) -> Vec<(EntityType, String)> {
    page.iter()
        .map(|t| (t.entity.entity_type, t.entity.entity_id.to_string()))
        .collect()
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("touched_by_me")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn expanded_feed_orders_by_own_latest_mutation(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let page = touched_soup_page(&pool, req(USER_1, None, &link_ids)).await?;

    // Exactly the touchable, visible entities — the deleted doc, isolated
    // doc, opened-only doc, left channel, foreign-inbox thread, and (in
    // expanded feeds) the project are all absent — ordered by user-1's own
    // latest mutation. user-2's newer edit of doc-B must not move it, and
    // chat-A's later `opened` must not outrank doc-A's edit.
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::Channel, CHANNEL_X.to_string()),
            (EntityType::EmailThread, THREAD_Z.to_string()),
            (EntityType::Document, DOC_B.to_string()),
        ]
    );

    // The timestamps are each entity's own-mutation max.
    let minutes: Vec<u32> = page
        .iter()
        .map(|t| {
            use chrono::Timelike;
            t.touched_at.minute()
        })
        .collect();
    assert_eq!(minutes, vec![9, 8, 6, 4, 2]);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("touched_by_me")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn unexpanded_feed_includes_projects(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];
    let mut request = req(USER_1, None, &link_ids);
    request.include_projects = true;
    let page = touched_soup_page(&pool, request).await?;

    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::Project, PROJECT_A.to_string()),
            (EntityType::Channel, CHANNEL_X.to_string()),
            (EntityType::EmailThread, THREAD_Z.to_string()),
            (EntityType::Document, DOC_B.to_string()),
        ]
    );

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("touched_by_me")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn keyset_paginates_without_overlap_or_gaps(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];

    let mut all = Vec::new();
    let mut after = None;
    loop {
        let mut request = req(USER_1, None, &link_ids);
        request.limit = 2;
        request.after = after;
        let page = touched_soup_page(&pool, request).await?;
        let full = page.len() == 2;
        all.extend(page);
        if !full {
            break;
        }
        let last = all.last().unwrap();
        after = Some(TouchedPagePosition {
            occurred_at: last.touched_at,
            entity_id: last.entity.entity_id.to_string(),
        });
    }

    // Walking in pages of 2 yields the same feed as one big page.
    let one_page = touched_soup_page(&pool, req(USER_1, None, &link_ids)).await?;
    assert_eq!(keys(&all), keys(&one_page));
    assert_eq!(all.len(), 5);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("touched_by_me")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn entity_filters_compose_with_the_touch_gate(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_ids = [Uuid::parse_str(LINK_1)?];

    // Restricting documents to pdf drops doc-B (docx) but nothing else.
    let filter = EntityFilterAst {
        document_filter: Some(std::sync::Arc::new(filter_ast::Expr::val(
            item_filters::ast::document::DocumentLiteral::FileType("pdf".parse().unwrap()),
        ))),
        ..EntityFilterAst::default()
    };
    let page = touched_soup_page(&pool, req(USER_1, Some(&filter), &link_ids)).await?;
    assert_eq!(
        keys(&page),
        vec![
            (EntityType::Document, DOC_A.to_string()),
            (EntityType::Chat, CHAT_A.to_string()),
            (EntityType::Channel, CHANNEL_X.to_string()),
            (EntityType::EmailThread, THREAD_Z.to_string()),
        ]
    );

    Ok(())
}

#[test]
fn view_tags_render_as_quoted_list() {
    assert_eq!(view_tags_sql(), "'opened'");
}

#[test]
fn no_filter_includes_every_expanded_type_with_inboxes() {
    let link_ids = [uuid::Uuid::from_u128(1)];
    let types = included_types(&req("macro|user@example.com", None, &link_ids));
    assert_eq!(types, vec!["document", "chat", "channel", "email_thread"]);
}

#[test]
fn projects_join_only_unexpanded_feeds() {
    let link_ids = [uuid::Uuid::from_u128(1)];
    let mut request = req("macro|user@example.com", None, &link_ids);
    request.include_projects = true;
    let types = included_types(&request);
    assert!(types.contains(&"project"));
}

#[test]
fn no_inboxes_drops_email_threads() {
    let types = included_types(&req("macro|user@example.com", None, &[]));
    assert!(!types.contains(&"email_thread"));
}

#[test]
fn positive_properties_filter_drops_propertyless_channels() {
    let link_ids = [uuid::Uuid::from_u128(1)];
    // A bare tag literal (no entity type) can never match a channel, which
    // carries no properties — the type is settled wholesale, not per row.
    let filter = EntityFilterAst {
        properties_filter: Some(std::sync::Arc::new(filter_ast::Expr::val(
            item_filters::ast::properties::PropertiesLiteral {
                property_definition_id: uuid::Uuid::from_u128(9),
                entity_type: None,
                value: item_filters::ast::properties::PropertyMatchValue::SelectOption(
                    uuid::Uuid::from_u128(10),
                ),
            },
        ))),
        ..EntityFilterAst::default()
    };
    let types = included_types(&req("macro|user@example.com", Some(&filter), &link_ids));
    assert!(!types.contains(&"channel"));
    assert!(types.contains(&"document"));
}

#[test]
fn negated_properties_filter_keeps_propertyless_channels() {
    let link_ids = [uuid::Uuid::from_u128(1)];
    // NOT(tag) is satisfied by an entity with no properties at all, so
    // channels stay in the feed.
    let filter = EntityFilterAst {
        properties_filter: Some(std::sync::Arc::new(filter_ast::Expr::is_not(
            filter_ast::Expr::val(item_filters::ast::properties::PropertiesLiteral {
                property_definition_id: uuid::Uuid::from_u128(9),
                entity_type: None,
                value: item_filters::ast::properties::PropertyMatchValue::SelectOption(
                    uuid::Uuid::from_u128(10),
                ),
            }),
        ))),
        ..EntityFilterAst::default()
    };
    let types = included_types(&req("macro|user@example.com", Some(&filter), &link_ids));
    assert!(types.contains(&"channel"));
}

#[test]
fn impossible_document_filter_drops_documents() {
    let link_ids = [uuid::Uuid::from_u128(1)];
    let filter = EntityFilterAst {
        document_filter: Some(std::sync::Arc::new(filter_ast::Expr::val(
            item_filters::ast::document::DocumentLiteral::Id(uuid::Uuid::nil()),
        ))),
        ..EntityFilterAst::default()
    };
    let types = included_types(&req("macro|user@example.com", Some(&filter), &link_ids));
    assert!(!types.contains(&"document"));
    assert!(types.contains(&"chat"));
}

#[test]
fn keyset_position_is_optional() {
    let link_ids = [uuid::Uuid::from_u128(1)];
    let mut request = req("macro|user@example.com", None, &link_ids);
    request.after = Some(TouchedPagePosition {
        occurred_at: chrono::DateTime::UNIX_EPOCH,
        entity_id: uuid::Uuid::from_u128(2).to_string(),
    });
    // The request stays constructible with a position; the SQL binds it as
    // ($3, $4). Query execution is covered by the pg tests.
    assert!(request.after.is_some());
}
