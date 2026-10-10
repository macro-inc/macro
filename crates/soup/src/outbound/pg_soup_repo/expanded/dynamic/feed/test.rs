use super::super::{
    ExpandedDynamicCursorArgs, ItemSource, build_query, expanded_dynamic_cursor_soup_hydrated,
};
use crate::domain::models::{SoupDocumentServerFacts, SoupProjectionHydration};
use chrono::{DateTime, TimeZone, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::{
    NotificationState,
    ast::{
        EntityFilterAst, LiteralTree,
        chat::ChatLiteral,
        date::DateLiteral,
        document::DocumentLiteral,
        project::ProjectLiteral,
        properties::{EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
    },
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_owner::Owner;
use models_pagination::{Cursor, Identify, Query, SimpleSortMethod, SortOn};
use models_soup::item::SoupItem;
use sqlx::PgPool;
use std::sync::Arc;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};
use uuid::Uuid;

const USER: &str = "macro|user-1@test.com";

/// Small enough that page boundaries land inside the fixture's ties.
const PAGE: u16 = 5;

/// The sorts `source_items` serves. `CreatedAt` reads the item tables either way.
const SORTS: [SimpleSortMethod; 3] = [
    SimpleSortMethod::UpdatedAt,
    SimpleSortMethod::ViewedUpdated,
    SimpleSortMethod::ViewedAt,
];

fn numbered(prefix: &str, n: u32) -> Uuid {
    Uuid::parse_str(&format!("{prefix}-0000-4000-8000-{n:012}")).unwrap()
}

fn document(i: u32) -> Uuid {
    numbered("11111111", i)
}

fn chat(i: u32) -> Uuid {
    numbered("22222222", i)
}

fn project(n: u32) -> Uuid {
    numbered("aaaaaaaa", n)
}

fn tree<T>(expr: Expr<T>) -> LiteralTree<T> {
    Some(Arc::new(expr))
}

fn february(day: u32, hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2024, 2, day, hour, 0, 0).unwrap()
}

fn property(
    property_definition_id: Uuid,
    entity_type: Option<PropertyEntityType>,
    value: PropertyMatchValue,
) -> PropertiesLiteral {
    PropertiesLiteral {
        property_definition_id,
        entity_type,
        value,
    }
}

fn low_priority(entity_type: Option<PropertyEntityType>) -> PropertiesLiteral {
    property(
        SystemPropertyKey::PRIORITY_UUID,
        entity_type,
        PropertyMatchValue::SelectOption(PriorityOption::LOW_UUID),
    )
}

/// Filters that reach every driver, phase and kind pruning `FeedArm` chooses between.
fn shapes() -> Vec<(&'static str, EntityFilterAst)> {
    let user = Owner::from_principal_str(USER).unwrap();
    let no_projects = Expr::val(ProjectLiteral::ProjectId(Uuid::nil()));
    vec![
        ("everything", EntityFilterAst::default()),
        (
            "updated since",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::UpdatedAt(
                    DateLiteral::GreaterThanOrEqual(february(1, 10)),
                ))),
                chat_filter: tree(Expr::val(ChatLiteral::UpdatedAt(
                    DateLiteral::GreaterThanOrEqual(february(1, 4)),
                ))),
                project_filter: tree(Expr::val(ProjectLiteral::UpdatedAt(
                    DateLiteral::GreaterThan(february(1, 5)),
                ))),
                ..Default::default()
            },
        ),
        (
            "updated between",
            EntityFilterAst {
                document_filter: tree(Expr::and(
                    Expr::val(DocumentLiteral::UpdatedAt(DateLiteral::GreaterThan(
                        february(1, 4),
                    ))),
                    Expr::val(DocumentLiteral::UpdatedAt(DateLiteral::LessThanOrEqual(
                        february(1, 20),
                    ))),
                )),
                chat_filter: tree(Expr::val(ChatLiteral::UpdatedAt(DateLiteral::LessThan(
                    february(1, 8),
                )))),
                ..Default::default()
            },
        ),
        (
            "created after",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::CreatedAt(
                    DateLiteral::GreaterThan(Utc.with_ymd_and_hms(2024, 1, 1, 0, 30, 0).unwrap()),
                ))),
                ..Default::default()
            },
        ),
        (
            "tasks",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::SubType(DocumentSubType::Task))),
                chat_filter: tree(Expr::val(ChatLiteral::Importance(false))),
                project_filter: tree(no_projects.clone()),
                ..Default::default()
            },
        ),
        (
            "not tasks",
            EntityFilterAst {
                document_filter: tree(Expr::is_not(Expr::val(DocumentLiteral::SubType(
                    DocumentSubType::Task,
                )))),
                ..Default::default()
            },
        ),
        (
            "snippets",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::SubType(
                    DocumentSubType::Snippet,
                ))),
                ..Default::default()
            },
        ),
        (
            "important",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::Importance(true))),
                ..Default::default()
            },
        ),
        (
            "unimportant",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::Importance(false))),
                ..Default::default()
            },
        ),
        (
            "created by me, assigned to me, not completed",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::IncludeCbmAtmNc(true))),
                ..Default::default()
            },
        ),
        (
            "my documents",
            EntityFilterAst {
                document_filter: tree(Expr::and(
                    Expr::and(
                        Expr::is_not(Expr::val(DocumentLiteral::SubType(DocumentSubType::Task))),
                        Expr::is_not(Expr::val(DocumentLiteral::IsEmailAttachment(true))),
                    ),
                    Expr::val(DocumentLiteral::Owner(user.clone())),
                )),
                chat_filter: tree(Expr::val(ChatLiteral::Importance(false))),
                project_filter: tree(no_projects),
                ..Default::default()
            },
        ),
        (
            "my tasks",
            EntityFilterAst {
                document_filter: tree(Expr::and(
                    Expr::val(DocumentLiteral::SubType(DocumentSubType::Task)),
                    Expr::val(DocumentLiteral::Owner(user.clone())),
                )),
                ..Default::default()
            },
        ),
        (
            "mine or tasks",
            EntityFilterAst {
                document_filter: tree(Expr::or(
                    Expr::val(DocumentLiteral::Owner(user.clone())),
                    Expr::val(DocumentLiteral::SubType(DocumentSubType::Task)),
                )),
                ..Default::default()
            },
        ),
        (
            "not mine",
            EntityFilterAst {
                document_filter: tree(Expr::is_not(Expr::val(DocumentLiteral::Owner(
                    user.clone(),
                )))),
                chat_filter: tree(Expr::is_not(Expr::val(ChatLiteral::Owner(user.clone())))),
                project_filter: tree(Expr::val(ProjectLiteral::Owner(user))),
                ..Default::default()
            },
        ),
        (
            "in progress",
            EntityFilterAst {
                properties_filter: tree(Expr::val(property(
                    SystemPropertyKey::STATUS_UUID,
                    Some(PropertyEntityType::Task),
                    PropertyMatchValue::SelectOption(StatusOption::IN_PROGRESS_UUID),
                ))),
                ..Default::default()
            },
        ),
        (
            "assigned to me",
            EntityFilterAst {
                properties_filter: tree(Expr::val(property(
                    SystemPropertyKey::ASSIGNEES_UUID,
                    Some(PropertyEntityType::Task),
                    PropertyMatchValue::EntityRef(EntityRefId::new(USER.into()).unwrap()),
                ))),
                ..Default::default()
            },
        ),
        (
            "low priority",
            EntityFilterAst {
                properties_filter: tree(Expr::val(low_priority(None))),
                ..Default::default()
            },
        ),
        (
            "low priority documents",
            EntityFilterAst {
                properties_filter: tree(Expr::val(low_priority(Some(
                    PropertyEntityType::Document,
                )))),
                ..Default::default()
            },
        ),
        (
            "low priority or completed",
            EntityFilterAst {
                properties_filter: tree(Expr::or(
                    Expr::val(low_priority(None)),
                    Expr::val(property(
                        SystemPropertyKey::STATUS_UUID,
                        Some(PropertyEntityType::Task),
                        PropertyMatchValue::SelectOption(StatusOption::COMPLETED_UUID),
                    )),
                )),
                ..Default::default()
            },
        ),
        (
            "low priority document property",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::Property(low_priority(None)))),
                ..Default::default()
            },
        ),
        (
            "unseen notifications",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::NotificationState(
                    NotificationState::Unseen,
                ))),
                chat_filter: tree(Expr::val(ChatLiteral::NotificationState(
                    NotificationState::Unseen,
                ))),
                project_filter: tree(Expr::val(ProjectLiteral::NotificationState(
                    NotificationState::Unseen,
                ))),
                ..Default::default()
            },
        ),
        (
            "seen document notifications",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::NotificationState(
                    NotificationState::Seen,
                ))),
                ..Default::default()
            },
        ),
        (
            "mixed notification states",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::NotificationState(
                    NotificationState::Unseen,
                ))),
                chat_filter: tree(Expr::val(ChatLiteral::NotificationState(
                    NotificationState::Seen,
                ))),
                ..Default::default()
            },
        ),
        (
            "in P1",
            EntityFilterAst {
                document_filter: tree(Expr::val(DocumentLiteral::ProjectId(project(1)))),
                chat_filter: tree(Expr::val(ChatLiteral::ProjectId(project(1)))),
                project_filter: tree(Expr::val(ProjectLiteral::ProjectId(project(1)))),
                ..Default::default()
            },
        ),
        (
            "by id",
            EntityFilterAst {
                document_filter: tree(Expr::or(
                    Expr::or(
                        Expr::val(DocumentLiteral::Id(document(5))),
                        Expr::val(DocumentLiteral::Id(document(6))),
                    ),
                    Expr::val(DocumentLiteral::ProjectId(project(3))),
                )),
                chat_filter: tree(Expr::or(
                    Expr::val(ChatLiteral::ChatId(chat(6))),
                    Expr::val(ChatLiteral::ChatId(chat(7))),
                )),
                project_filter: tree(Expr::or(
                    Expr::val(ProjectLiteral::ProjectIdSelf(project(2))),
                    Expr::val(ProjectLiteral::ProjectIdSelf(project(4))),
                )),
                ..Default::default()
            },
        ),
    ]
}

/// What a caller sees of one item.
#[derive(Debug, PartialEq)]
struct Shown {
    item: serde_json::Value,
    facts: Option<SoupDocumentServerFacts>,
}

impl From<SoupProjectionHydration> for Shown {
    fn from(hydration: SoupProjectionHydration) -> Self {
        Shown {
            item: serde_json::to_value(&hydration.item).unwrap(),
            facts: hydration.document_server_facts,
        }
    }
}

fn label(item: &SoupItem<()>) -> String {
    let kind = match item {
        SoupItem::Document(_) => "document",
        SoupItem::Chat(_) => "chat",
        SoupItem::Project(_) => "project",
        _ => "other",
    };
    format!("{kind} {}", item.id())
}

/// Every page a caller walks through, following each full page's cursor as the service does.
struct Walk {
    labels: Vec<Vec<String>>,
    ids: Vec<Uuid>,
    shown: Vec<Shown>,
}

async fn walk(
    pool: &PgPool,
    filter: &EntityFilterAst,
    sort: SimpleSortMethod,
    exclude_frecency: bool,
    item_source: ItemSource,
) -> anyhow::Result<Walk> {
    let user_id = MacroUserIdStr::parse_from_str(USER).unwrap();
    let mut query = Query::Sort(sort, filter.clone());
    let mut walk = Walk {
        labels: Vec::new(),
        ids: Vec::new(),
        shown: Vec::new(),
    };
    loop {
        let page = expanded_dynamic_cursor_soup_hydrated(
            pool,
            ExpandedDynamicCursorArgs {
                user_id: user_id.copied(),
                limit: PAGE,
                cursor: query,
                exclude_frecency,
            },
            item_source,
        )
        .await?;
        let next = page
            .last()
            .filter(|_| page.len() == usize::from(PAGE))
            .map(|last| {
                Query::Cursor(Cursor {
                    id: last.item.id(),
                    limit: usize::from(PAGE),
                    val: <SoupItem<()> as SortOn<SimpleSortMethod>>::sort_on(sort)(&last.item),
                    filter: filter.clone(),
                })
            });
        walk.labels.push(
            page.iter()
                .map(|hydration| label(&hydration.item))
                .collect(),
        );
        walk.ids
            .extend(page.iter().map(|hydration| hydration.item.id()));
        walk.shown.extend(page.into_iter().map(Shown::from));
        match next {
            Some(next) => query = next,
            None => return Ok(walk),
        }
        anyhow::ensure!(walk.labels.len() < 100, "pagination did not end");
    }
}

/// Walks every shape under every sort both ways and requires the same pages. Returns what
/// "everything" shows under `UpdatedAt`.
async fn assert_pages_match_item_tables(pool: &PgPool) -> anyhow::Result<Vec<Uuid>> {
    let mut everything = Vec::new();
    for (shape, filter) in shapes() {
        let mut rows = 0;
        for sort in SORTS {
            for exclude_frecency in [false, true] {
                let expected = walk(
                    pool,
                    &filter,
                    sort,
                    exclude_frecency,
                    ItemSource::ItemTables,
                )
                .await?;
                let actual = walk(
                    pool,
                    &filter,
                    sort,
                    exclude_frecency,
                    ItemSource::SourceItems,
                )
                .await?;
                assert_eq!(
                    actual.labels, expected.labels,
                    "{shape}, {sort:?}, exclude_frecency={exclude_frecency}"
                );
                assert!(
                    actual.shown == expected.shown,
                    "{shape}, {sort:?}, exclude_frecency={exclude_frecency}: same items, different contents"
                );
                rows += actual.ids.len();
                if shape == "everything"
                    && matches!(sort, SimpleSortMethod::UpdatedAt)
                    && !exclude_frecency
                {
                    everything = actual.ids;
                }
            }
        }
        assert!(rows > 0, "{shape} shows nothing, so it compares nothing");
    }
    Ok(everything)
}

/// Fails unless `source_items` holds exactly the rows `entity_access` and the item tables imply.
async fn assert_source_items_match_grants(pool: &PgPool) -> anyhow::Result<()> {
    let drift = sqlx::query!(
        r#"
        WITH want AS (
            SELECT ea.source_id, ea.entity_type, i.kind, i.entity_id, i.sort_ts, count(*)::int AS grants
            FROM entity_access ea
            JOIN (
                SELECT 'document' AS entity_type, d.id AS entity_id,
                       CASE WHEN st.sub_type = 'task' THEN 'task' ELSE 'document' END AS kind,
                       CASE WHEN d."deletedAt" IS NULL THEN d."updatedAt" END AS sort_ts
                FROM "Document" d
                LEFT JOIN document_sub_type st ON st.document_id = d.id
                UNION ALL
                SELECT 'chat', c.id, 'chat', CASE WHEN c."deletedAt" IS NULL THEN c."updatedAt" END
                FROM "Chat" c
                UNION ALL
                SELECT 'project', p.id, 'project', CASE WHEN p."deletedAt" IS NULL THEN p."updatedAt" END
                FROM "Project" p
            ) i ON i.entity_type = ea.entity_type AND i.entity_id = ea.entity_id::text
            GROUP BY ea.source_id, ea.entity_type, i.kind, i.entity_id, i.sort_ts
        ), have AS (
            SELECT source_id, entity_type, kind, entity_id, sort_ts, grants FROM source_items
        )
        SELECT 'missing' AS "side!", * FROM (SELECT * FROM want EXCEPT ALL SELECT * FROM have) missing
        UNION ALL
        SELECT 'extra', * FROM (SELECT * FROM have EXCEPT ALL SELECT * FROM want) extra
        "#
    )
    .fetch_all(pool)
    .await?;
    assert!(drift.is_empty(), "source_items drifted: {drift:#?}");
    Ok(())
}

#[test]
fn shapes_reach_every_driver_and_phase() {
    let candidates: Vec<String> = shapes()
        .iter()
        .flat_map(|(_, filter)| {
            SORTS.map(|sort| {
                let query = build_query(filter, false, sort, ItemSource::SourceItems);
                let (candidates, _) = query.sql().split_once("Combined AS").unwrap();
                candidates.to_owned()
            })
        })
        .collect();
    for (reach, marker) in [
        ("sources", "FROM user_source_ids s"),
        ("updated_at bounds", "AND si.sort_ts >= '"),
        ("owner", r#"ORDER BY d."updatedAt" DESC, d.id DESC"#),
        ("notifications", "FROM NotificationItems ni"),
        ("lookup", r#"WHERE c."deletedAt" IS NULL"#),
        ("viewed items", "ViewedItems AS MATERIALIZED"),
        ("never viewed tail", "ORDER BY si.entity_id DESC"),
        ("unviewed", r#"SELECT 1 FROM "UserHistory" seen"#),
        ("tasks only", "AND g.kind IN ('task')"),
        ("documents only", "CROSS JOIN (VALUES ('document')) k(kind)"),
    ] {
        assert!(
            candidates.iter().any(|sql| sql.contains(marker)),
            "no shape reaches {reach}"
        );
    }
}

#[sqlx::test(
    fixtures(path = "../../../../../../fixtures", scripts("source_items_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn source_items_pages_like_the_item_tables(pool: PgPool) -> anyhow::Result<()> {
    assert_source_items_match_grants(&pool).await?;
    let everything = assert_pages_match_item_tables(&pool).await?;

    for shown in [
        document(6),
        document(7),
        document(27),
        chat(1),
        project(1),
        project(7),
    ] {
        assert!(everything.contains(&shown), "{shown} should show");
    }
    // Granted only to user-2, team T2 or channel C2, which user-1 left, or soft-deleted.
    for hidden in [
        document(3),
        document(5),
        document(13),
        document(22),
        chat(3),
        project(4),
        project(5),
        project(6),
    ] {
        assert!(!everything.contains(&hidden), "{hidden} should not show");
    }
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../fixtures",
        scripts("source_items_feed", "source_items_feed_changes")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn source_items_follow_writes(pool: PgPool) -> anyhow::Result<()> {
    assert_source_items_match_grants(&pool).await?;
    let everything = assert_pages_match_item_tables(&pool).await?;

    assert_eq!(
        &everything[..2],
        [chat(6), document(8)],
        "the tied newest items lead"
    );
    for shown in [
        document(1),
        document(3),
        document(4),
        document(5),
        document(10),
        document(22),
        document(26),
        document(31),
        document(73),
        document(74),
        document(75),
        project(6),
        project(8),
    ] {
        assert!(everything.contains(&shown), "{shown} should show");
    }
    for hidden in [document(12), document(19), document(41), chat(2)] {
        assert!(!everything.contains(&hidden), "{hidden} should not show");
    }

    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", USER)
        .execute(&pool)
        .await?;
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now()
        WHERE user_id = $1 AND channel_id = 'cccccccc-0000-4000-8000-000000000001'",
        USER
    )
    .execute(&pool)
    .await?;
    let everything = assert_pages_match_item_tables(&pool).await?;
    for hidden in [
        document(1),
        document(5),
        document(14),
        document(74),
        document(75),
        chat(1),
        chat(8),
        project(2),
        project(3),
        project(8),
    ] {
        assert!(
            !everything.contains(&hidden),
            "{hidden} should not show without team T1 and channel C1"
        );
    }
    for shown in [document(2), document(3), document(6), document(22)] {
        assert!(everything.contains(&shown), "{shown} should still show");
    }
    Ok(())
}
