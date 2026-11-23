//! OR'ed select options of one definition share one `?|` membership test;
//! these run it against the database.

use super::*;
use crate::domain::models::{DynamicSort, grouping::ItemGroupingInfo};
use document_sub_type::DocumentSubType;
use item_filters::ast::{
    calendar_event::CalendarEventLiteral,
    chat::ChatLiteral,
    document::DocumentLiteral,
    project::ProjectLiteral,
    properties::{EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use macro_user_id::cowlike::CowLike;
use models_pagination::{Identify, Query, SimpleSortMethod};
use serde_json::{Value, json};
use std::collections::BTreeSet;

const A: Uuid = uuid::uuid!("11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const B: Uuid = uuid::uuid!("11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const C: Uuid = uuid::uuid!("11111111-cccc-cccc-cccc-cccccccccccc");
const D: Uuid = uuid::uuid!("11111111-dddd-dddd-dddd-dddddddddddd");
const STATUS: Uuid = uuid::uuid!("00000001-0000-0000-0000-000000000002");
const NOT_STARTED: Uuid = uuid::uuid!("00000001-0000-0000-0002-000000000001");
const IN_PROGRESS: Uuid = uuid::uuid!("00000001-0000-0000-0002-000000000002");
const BLOCKED: Uuid = uuid::uuid!("00000001-0000-0000-0002-000000000003");
const X: Uuid = uuid::uuid!("22222222-0000-0000-0000-00000000000a");
const Y: Uuid = uuid::uuid!("22222222-0000-0000-0000-00000000000b");
const Z: Uuid = uuid::uuid!("22222222-0000-0000-0000-00000000000c");
const REFERENCED: &str = "33333333-0000-0000-0000-000000000001";

/// A multi-select definition: A holds X and Y, B holds Z, C holds Y, and D
/// holds an entity reference instead of options. Status: A not started, B in
/// progress, C blocked, on their task rows.
async fn seed(pool: &PgPool) -> anyhow::Result<Uuid> {
    let multi = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO property_definitions (id, user_id, display_name, data_type, is_multi_select)
           SELECT $1, owner, $2, $3::text::property_data_type, true FROM "Document" WHERE id = $4"#,
        multi,
        format!("Options {multi}"),
        "SELECT_STRING",
        A.to_string(),
    )
    .execute(pool)
    .await?;
    for (order, id) in [X, Y, Z].into_iter().enumerate() {
        sqlx::query!(
            "INSERT INTO property_options (id, property_definition_id, display_order, string_value) VALUES ($1, $2, $3, $4)",
            id,
            multi,
            i32::try_from(order)?,
            id.to_string(),
        )
        .execute(pool)
        .await?;
    }
    let options = |ids: &[Uuid]| json!({"type": "SelectOption", "value": ids});
    let rows: [(Uuid, &str, Uuid, Value); 7] = [
        (A, "DOCUMENT", multi, options(&[X, Y])),
        (B, "DOCUMENT", multi, options(&[Z])),
        (C, "DOCUMENT", multi, options(&[Y])),
        (
            D,
            "DOCUMENT",
            multi,
            json!({"type": "EntityReference", "value": [{"entity_type": "COMPANY", "entity_id": REFERENCED}]}),
        ),
        (A, "TASK", STATUS, options(&[NOT_STARTED])),
        (B, "TASK", STATUS, options(&[IN_PROGRESS])),
        (C, "TASK", STATUS, options(&[BLOCKED])),
    ];
    for (entity_id, entity_type, definition, value) in rows {
        sqlx::query!(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values) VALUES ($1, $2, $3::text::property_entity_type, $4, $5)",
            Uuid::now_v7(),
            entity_id.to_string(),
            entity_type,
            definition,
            value,
        )
        .execute(pool)
        .await?;
    }
    Ok(multi)
}

fn option(definition: Uuid, id: Uuid) -> Expr<DocumentLiteral> {
    Expr::val(DocumentLiteral::Property(PropertiesLiteral {
        property_definition_id: definition,
        entity_type: None,
        value: PropertyMatchValue::SelectOption(id),
    }))
}

fn status(id: Uuid) -> Expr<DocumentLiteral> {
    Expr::val(DocumentLiteral::Property(PropertiesLiteral {
        property_definition_id: STATUS,
        entity_type: Some(PropertyEntityType::Task),
        value: PropertyMatchValue::SelectOption(id),
    }))
}

/// Documents A to D that also match `properties`.
fn filter(properties: Expr<DocumentLiteral>) -> EntityFilterAst {
    let documents = [A, B, C, D]
        .into_iter()
        .map(|id| Expr::val(DocumentLiteral::Id(id)))
        .reduce(Expr::or)
        .expect("four documents");
    EntityFilterAst {
        document_filter: Some(Arc::new(Expr::and(documents, properties))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    }
}

async fn user_id(pool: &PgPool) -> anyhow::Result<MacroUserIdStr<'static>> {
    let owner = sqlx::query_scalar!(
        r#"SELECT owner FROM "Document" WHERE id = $1"#,
        A.to_string()
    )
    .fetch_one(pool)
    .await?;
    Ok(MacroUserIdStr::parse_from_str(&owner)?.into_owned())
}

fn first_page(properties: Expr<DocumentLiteral>) -> Query<Uuid, DynamicSort, EntityFilterAst> {
    Query::Sort(
        DynamicSort::Timestamp(SimpleSortMethod::UpdatedAt),
        filter(properties),
    )
}

/// The ids a flat page returns, in order, duplicates kept.
async fn matching(pool: &PgPool, properties: Expr<DocumentLiteral>) -> anyhow::Result<Vec<Uuid>> {
    Ok(expanded_dynamic_cursor_soup_with_projection(
        pool,
        ExpandedDynamicCursorArgs {
            user_id: user_id(pool).await?,
            limit: 20,
            cursor: first_page(properties),
            exclude_frecency: false,
        },
        false,
    )
    .await?
    .iter()
    .map(|item| item.item.id())
    .collect())
}

fn set(ids: &[Uuid]) -> BTreeSet<Uuid> {
    ids.iter().copied().collect()
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn ored_options_match_like_one_exists_per_option(pool: PgPool) -> anyhow::Result<()> {
    let multi = seed(&pool).await?;

    // A holds both requested options and comes back once.
    let both = matching(&pool, Expr::or(option(multi, X), option(multi, Y))).await?;
    assert_eq!(both.len(), 2, "{both:?}");
    assert_eq!(set(&both), set(&[A, C]));

    // A repeated option is the lone option.
    assert_eq!(
        matching(&pool, Expr::or(option(multi, X), option(multi, X))).await?,
        [A]
    );

    // NOT over the OR keeps the documents holding neither, and the one
    // holding no options at all.
    let neither = matching(
        &pool,
        Expr::is_not(Expr::or(option(multi, X), option(multi, Y))),
    )
    .await?;
    assert_eq!(set(&neither), set(&[B, D]));

    // An option and an entity reference of one definition in one OR.
    let reference = Expr::val(DocumentLiteral::Property(PropertiesLiteral {
        property_definition_id: multi,
        entity_type: None,
        value: PropertyMatchValue::EntityRef(EntityRefId::new(REFERENCED.to_string())?),
    }));
    let mixed = matching(&pool, Expr::or(option(multi, X), reference)).await?;
    assert_eq!(set(&mixed), set(&[A, D]));

    // The status definition on task rows, which its partial index serves.
    let statuses = matching(&pool, Expr::or(status(NOT_STARTED), status(IN_PROGRESS))).await?;
    assert_eq!(set(&statuses), set(&[A, B]));
    Ok(())
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn grouped_totals_count_each_match_of_ored_options_once(pool: PgPool) -> anyhow::Result<()> {
    let multi = seed(&pool).await?;
    let items: Vec<ItemGroupingInfo> = expanded_dynamic_cursor_soup_grouped(
        &pool,
        GroupedDynamicCursorArgs {
            user_id: user_id(&pool).await?,
            limit: 20,
            cursor: first_page(Expr::or(option(multi, X), option(multi, Y))),
            exclude_frecency: false,
            grouping: GroupingConfig {
                field: GroupByField::EntityType,
                group_key: None,
                per_group_limit: None,
            },
        },
    )
    .await?
    .collect();
    let placed = items
        .iter()
        .map(|item| (item.key.as_str(), item.total_group_count, item.item.id()))
        .collect::<Vec<_>>();
    assert_eq!(placed.len(), 2, "{placed:?}");
    assert!(placed.iter().all(|(_, total, _)| *total == 2), "{placed:?}");
    assert_eq!(
        placed.iter().map(|(_, _, id)| *id).collect::<BTreeSet<_>>(),
        set(&[A, C])
    );
    Ok(())
}

/// Whether each `ep_prop` scan under `node` runs inside a subplan.
fn property_probes(node: &Value, in_subplan: bool, probes: &mut Vec<bool>) {
    let in_subplan = in_subplan || node.get("Subplan Name").is_some();
    if node["Alias"] == "ep_prop" {
        probes.push(in_subplan);
    }
    for child in node["Plans"].as_array().into_iter().flatten() {
        property_probes(child, in_subplan, probes);
    }
}

/// The Tasks view lists every task with OR'ed statuses. Pulled up into a
/// semi-join, their one `?|` test drove the page from every matching status
/// row in the table; fenced, it stays a probe of each candidate's row.
#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("mixed_items_expanded")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn ored_statuses_probe_each_task_of_a_broad_list(pool: PgPool) -> anyhow::Result<()> {
    seed(&pool).await?;
    let status = |id| {
        Expr::val(PropertiesLiteral {
            property_definition_id: STATUS,
            entity_type: Some(PropertyEntityType::Task),
            value: PropertyMatchValue::SelectOption(id),
        })
    };
    let tasks = EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            DocumentSubType::Task,
        )))),
        properties_filter: Some(Arc::new(Expr::or(
            status(NOT_STARTED),
            Expr::or(status(IN_PROGRESS), status(BLOCKED)),
        ))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::Importance(false)))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::Importance(false)))),
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        ..EntityFilterAst::mock_empty()
    };
    let viewer = user_id(&pool).await?;
    let plan = explain_first_page(&pool, &viewer.to_string(), &tasks).await?;
    let mut probes = Vec::new();
    property_probes(&plan[0]["Plan"], false, &mut probes);
    assert!(
        !probes.is_empty() && probes.iter().all(|in_subplan| *in_subplan),
        "the status test joined the page instead of probing each task: {plan}"
    );
    Ok(())
}
