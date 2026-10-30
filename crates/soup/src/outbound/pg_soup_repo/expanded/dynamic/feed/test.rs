use super::super::{
    DocumentIdArrays, ExpandedDynamicCursorArgs, ItemSource, build_chat_filter,
    build_document_filter, build_project_filter, build_query, chat_literal_constant,
    document_literal_constant, expanded_dynamic_cursor_soup_hydrated, project_literal_constant,
};
use super::{FeedArm, OrderedScans};
use crate::domain::models::{
    SimpleSortQuery, SimpleSortRequest, SoupDocumentServerFacts, SoupProjectionHydration,
};
use crate::domain::ports::SoupRepo;
use crate::outbound::pg_soup_repo::PgSoupRepo;
use chrono::{DateTime, TimeZone, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::{
    NotificationState,
    ast::{
        EntityFilterAst, LiteralTree,
        chat::{ChatLiteral, ChatRole},
        crm_association::CrmAssociation,
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
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::sync::Arc;
use system_properties::{PriorityOption, StatusOption, SystemPropertyKey};
use uuid::Uuid;

const USER: &str = "macro|user-1@example.com";

/// Small enough that page boundaries land inside the fixture's ties.
const PAGE: u16 = 5;

/// The sorts `source_items` serves. `CreatedAt` reads the item tables either way.
const SORTS: [SimpleSortMethod; 3] = [
    SimpleSortMethod::UpdatedAt,
    SimpleSortMethod::ViewedUpdated,
    SimpleSortMethod::ViewedAt,
];

#[sqlx::test(
    fixtures(
        path = "../../../../../../fixtures",
        scripts("source_items_feed", "source_items_empty")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn source_items_rollout_defaults_to_existing_records(pool: PgPool) -> anyhow::Result<()> {
    let request = || SimpleSortRequest {
        user_id: MacroUserIdStr::parse_from_str(USER).unwrap(),
        limit: PAGE,
        cursor: SimpleSortQuery::ItemsFilter(Query::Sort(
            SimpleSortMethod::UpdatedAt,
            EntityFilterAst::default(),
        )),
    };
    let legacy = PgSoupRepo::new(readonly_pool::ReadOnlyPool(pool.clone()));
    let projection =
        PgSoupRepo::new(readonly_pool::ReadOnlyPool(pool.clone())).with_source_items_enabled(true);
    let existing = legacy.expanded_generic_cursor_soup(request()).await?;
    let pending = projection.expanded_generic_cursor_soup(request()).await?;
    assert!(
        !existing.is_empty(),
        "disabled rollout must use domain records"
    );
    assert!(pending.is_empty(), "enabled rollout must use source_items");

    // Reads with the projection disabled must not need its table.
    sqlx::query!("ALTER TABLE source_items RENAME TO source_items_pending_rollout")
        .execute(&pool)
        .await?;
    let before_migration = legacy.expanded_generic_cursor_soup(request()).await?;
    assert_eq!(
        before_migration
            .iter()
            .map(|item| item.id())
            .collect::<Vec<_>>(),
        existing.iter().map(|item| item.id()).collect::<Vec<_>>()
    );
    Ok(())
}

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
    let mismatches = source_items::audit::run(pool).await?;
    assert!(
        mismatches.is_empty(),
        "source_items drifted: {mismatches:?}"
    );
    Ok(())
}

#[test]
fn shapes_reach_every_driver_and_phase() {
    let candidates: Vec<String> = shapes()
        .iter()
        .flat_map(|(_, filter)| {
            SORTS.map(|sort| {
                let (query, _) = build_query(
                    filter,
                    false,
                    sort,
                    ItemSource::SourceItems,
                    USER,
                    &mut DocumentIdArrays::starting_at(9),
                );
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

/// Only in-order scans depend on the session's time zone and the user's sources, so only they
/// make a page ask for them.
#[test]
fn only_ordered_scans_need_the_bound() {
    let ordered = |document_filter: Expr<DocumentLiteral>| {
        let filter = EntityFilterAst {
            document_filter: tree(document_filter),
            chat_filter: tree(Expr::val(ChatLiteral::Importance(false))),
            project_filter: tree(Expr::val(ProjectLiteral::Importance(false))),
            ..Default::default()
        };
        build_query(
            &filter,
            false,
            SimpleSortMethod::UpdatedAt,
            ItemSource::SourceItems,
            USER,
            &mut DocumentIdArrays::starting_at(9),
        )
        .1
    };
    let doc = |literal| Expr::val(literal);
    assert_eq!(
        ordered(doc(DocumentLiteral::SubType(DocumentSubType::Task))),
        Some(OrderedScans::Sources)
    );
    assert_eq!(
        ordered(doc(DocumentLiteral::Owner(
            Owner::from_principal_str(USER).unwrap()
        ))),
        Some(OrderedScans::Owner)
    );
    assert_eq!(
        ordered(doc(DocumentLiteral::Id(document(1)))),
        None,
        "lookup"
    );
    assert_eq!(
        ordered(doc(DocumentLiteral::NameContains("plan".into()))),
        None,
        "item tables"
    );
}

/// Each literal a `*_literal_constant` function fixes renders as that constant, so an arm it
/// finds empty is one Postgres folds away on the item tables.
#[test]
fn literal_constants_match_their_sql() {
    let renders = |sql: String, value: bool| {
        let constants: &[&str] = if value {
            &[" AND TRUE"]
        } else {
            &[" AND 1=0", " AND FALSE"]
        };
        constants.contains(&sql.as_str())
    };
    for literal in [
        ChatLiteral::Role(ChatRole::User),
        ChatLiteral::Importance(true),
        ChatLiteral::Importance(false),
    ] {
        let value = chat_literal_constant(&literal).unwrap();
        let sql = build_chat_filter(Some(&Expr::val(literal.clone())));
        assert!(renders(sql, value), "{literal:?}");
    }
    for literal in [
        ProjectLiteral::Importance(true),
        ProjectLiteral::Importance(false),
    ] {
        let value = project_literal_constant(&literal).unwrap();
        let sql = build_project_filter(Some(&Expr::val(literal.clone())));
        assert!(renders(sql, value), "{literal:?}");
    }
    for literal in [
        DocumentLiteral::IncludeCbmAtmNc(false),
        DocumentLiteral::CrmAssociated(CrmAssociation::Activity),
    ] {
        let value = document_literal_constant(&literal).unwrap();
        let sql = build_document_filter(Some(&Expr::val(literal.clone())), None);
        assert!(renders(sql, value), "{literal:?}");
    }
}

/// Projected scans order the stored timestamps, which sort like the item tables' `timestamptz`
/// casts only in UTC. In New York, 02:30 on 2018-03-11 does not exist and reads as 07:30Z, after
/// 03:00 (07:00Z), so a session there must read the item tables. sqlx opens every session in
/// UTC; only an explicit setting moves one.
#[sqlx::test(
    fixtures(path = "../../../../../../fixtures", scripts("source_items_feed")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn non_utc_sessions_read_the_item_tables(
    pool_options: PgPoolOptions,
    connect_options: PgConnectOptions,
) -> anyhow::Result<()> {
    let pool = pool_options
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query!("SELECT set_config('TimeZone', 'America/New_York', false)")
                    .fetch_one(connection)
                    .await?;
                Ok(())
            })
        })
        .connect_with(connect_options)
        .await?;
    let (gap, after) = (document(101), document(102));
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType", "createdAt", "updatedAt")
        VALUES ($1, 'In the gap', $3, 'md', '2018-03-11 02:30', '2018-03-11 02:30'),
               ($2, 'After the gap', $3, 'md', '2018-03-11 03:00', '2018-03-11 03:00')"#,
        gap.to_string(),
        after.to_string(),
        USER
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "DocumentInstance" ("documentId", sha, "createdAt", "updatedAt")
        SELECT id, 'sha-' || id, "createdAt", "updatedAt" FROM "Document" WHERE id IN ($1, $2)"#,
        gap.to_string(),
        after.to_string()
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'document', $3, 'user', 'owner'), ($2, 'document', $3, 'user', 'owner')"#,
        gap,
        after,
        USER
    )
    .execute(&pool)
    .await?;
    assert_source_items_match_grants(&pool).await?;

    // The excluded ids bind as an array, which the item-table rebuild must bind afresh.
    let filter = EntityFilterAst {
        document_filter: tree(Expr::and(
            Expr::val(DocumentLiteral::UpdatedAt(DateLiteral::LessThan(
                Utc.with_ymd_and_hms(2019, 1, 1, 0, 0, 0).unwrap(),
            ))),
            Expr::and(
                Expr::is_not(Expr::val(DocumentLiteral::Id(document(1)))),
                Expr::is_not(Expr::val(DocumentLiteral::Id(document(2)))),
            ),
        )),
        chat_filter: tree(Expr::val(ChatLiteral::Importance(false))),
        project_filter: tree(Expr::val(ProjectLiteral::ProjectId(Uuid::nil()))),
        ..Default::default()
    };
    // A one-item page: each source's scan keeps only its newest row.
    let newest = |item_source| {
        expanded_dynamic_cursor_soup_hydrated(
            &pool,
            ExpandedDynamicCursorArgs {
                user_id: MacroUserIdStr::parse_from_str(USER).unwrap(),
                limit: 1,
                cursor: Query::Sort(SimpleSortMethod::UpdatedAt, filter.clone()),
                exclude_frecency: false,
            },
            item_source,
        )
    };
    let ids = |page: Vec<SoupProjectionHydration>| {
        page.into_iter()
            .map(|hydration| hydration.item.id())
            .collect::<Vec<_>>()
    };
    let expected = ids(newest(ItemSource::ItemTables).await?);
    assert_eq!(expected, [gap], "07:30Z is newer than 07:00Z");
    assert_eq!(ids(newest(ItemSource::SourceItems).await?), expected);
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../fixtures",
        scripts("source_items_feed", "source_items_feed_changes")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn source_items_pages_match_after_writes(pool: PgPool) -> anyhow::Result<()> {
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

/// Arms whose filter a source scan cannot stop early on read the item tables; the rest read
/// `source_items`. Each case: (description, document filter, properties filter, notified, projected).
#[test]
fn selective_filters_read_the_item_tables() {
    let user = || Owner::from_principal_str(USER).unwrap();
    let other = || Owner::from_principal_str("macro|user-2@example.com").unwrap();
    let doc = |literal| Expr::val(literal);
    let later = DateLiteral::GreaterThan(february(1, 0));
    let cases: Vec<(
        &str,
        Option<Expr<DocumentLiteral>>,
        Option<Expr<PropertiesLiteral>>,
        bool,
        bool,
    )> = vec![
        ("unfiltered", None, None, false, true),
        (
            "tasks",
            Some(doc(DocumentLiteral::SubType(DocumentSubType::Task))),
            None,
            false,
            true,
        ),
        (
            "not tasks",
            Some(Expr::is_not(doc(DocumentLiteral::SubType(
                DocumentSubType::Task,
            )))),
            None,
            false,
            true,
        ),
        (
            "owned by the viewer",
            Some(doc(DocumentLiteral::Owner(user()))),
            None,
            false,
            true,
        ),
        (
            "owned by someone else",
            Some(doc(DocumentLiteral::Owner(other()))),
            None,
            false,
            false,
        ),
        (
            "not owned by the viewer",
            Some(Expr::is_not(doc(DocumentLiteral::Owner(user())))),
            None,
            false,
            true,
        ),
        (
            "owned by anyone",
            Some(Expr::or(
                doc(DocumentLiteral::Owner(user())),
                Expr::is_not(doc(DocumentLiteral::Owner(user()))),
            )),
            None,
            false,
            true,
        ),
        (
            "not snippets and not attachments",
            Some(Expr::and(
                Expr::is_not(doc(DocumentLiteral::SubType(DocumentSubType::Snippet))),
                Expr::is_not(doc(DocumentLiteral::IsEmailAttachment(true))),
            )),
            None,
            false,
            true,
        ),
        (
            "snippets",
            Some(doc(DocumentLiteral::SubType(DocumentSubType::Snippet))),
            None,
            false,
            false,
        ),
        (
            "attachments",
            Some(doc(DocumentLiteral::IsEmailAttachment(true))),
            None,
            false,
            false,
        ),
        (
            "created after",
            Some(doc(DocumentLiteral::CreatedAt(later.clone()))),
            None,
            false,
            false,
        ),
        (
            "updated after",
            Some(doc(DocumentLiteral::UpdatedAt(later))),
            None,
            false,
            true,
        ),
        (
            "named",
            Some(doc(DocumentLiteral::NameContains("plan".into()))),
            None,
            false,
            false,
        ),
        (
            "one id",
            Some(doc(DocumentLiteral::Id(document(1)))),
            None,
            false,
            true,
        ),
        (
            "low priority",
            None,
            Some(Expr::val(low_priority(None))),
            false,
            false,
        ),
        (
            "not low priority",
            None,
            Some(Expr::is_not(Expr::val(low_priority(None)))),
            false,
            true,
        ),
        (
            "notified, someone else's",
            Some(doc(DocumentLiteral::Owner(other()))),
            None,
            true,
            true,
        ),
    ];
    for (description, filter, properties, notified, projected) in cases {
        let arm = FeedArm::document(
            filter.as_ref(),
            properties.as_ref(),
            notified,
            USER,
            &mut DocumentIdArrays::starting_at(9),
        );
        assert_eq!(arm.is_some(), projected, "{description}");
    }
    assert!(FeedArm::chat(None, None, false).is_some());
    assert!(
        FeedArm::chat(Some(&Expr::val(ChatLiteral::Owner(user()))), None, false).is_none(),
        "chats have no owner driver"
    );
    assert!(
        FeedArm::chat(
            Some(&Expr::is_not(Expr::val(ChatLiteral::Importance(true)))),
            None,
            false
        )
        .is_none(),
        "every chat is important"
    );
    assert!(
        FeedArm::chat(
            Some(&Expr::is_not(Expr::val(ChatLiteral::Role(ChatRole::User)))),
            None,
            false
        )
        .is_none(),
        "role filters match every chat"
    );
    assert!(
        FeedArm::document(
            Some(&Expr::is_not(doc(DocumentLiteral::IncludeCbmAtmNc(false)))),
            None,
            false,
            USER,
            &mut DocumentIdArrays::starting_at(9),
        )
        .is_none(),
        "a disabled CBM filter matches every document"
    );
    assert!(
        FeedArm::project(
            Some(&Expr::and(
                Expr::val(ProjectLiteral::UpdatedAt(DateLiteral::GreaterThan(
                    february(1, 0)
                ))),
                Expr::is_not(Expr::val(ProjectLiteral::Importance(true))),
            )),
            None,
            false
        )
        .is_none(),
        "every project is important"
    );
    assert!(
        FeedArm::project(
            Some(&Expr::or(
                Expr::val(ProjectLiteral::Importance(false)),
                Expr::is_not(Expr::val(ProjectLiteral::UpdatedAt(
                    DateLiteral::GreaterThan(february(1, 0))
                ))),
            )),
            None,
            false
        )
        .is_some(),
        "a disjunct can still match"
    );
}
