//! This module provides dynamic query building for frecency queries with filters

use crate::domain::models::{AggregateFrecency, AggregateId, FrecencyData, TimestampWeight};
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst, chat::ChatLiteral, document::DocumentLiteral, project::ProjectLiteral,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use recursion::CollapsibleExt;
use sqlx::{PgPool, Postgres, QueryBuilder, postgres::PgRow, prelude::FromRow};
use std::collections::VecDeque;

use super::FrecencyStorageErr;

static DOCUMENT_CLAUSE: &str = r#"
    SELECT
        fa.entity_id,
        'document' as entity_type,
        fa.user_id,
        fa.event_count,
        fa.frecency_score,
        fa.first_event,
        fa.recent_events
    FROM frecency_aggregates fa
    WHERE fa.user_id = $1 AND fa.entity_type = 'document'
"#;

static CHAT_CLAUSE: &str = r#"
    SELECT
        entity_id,
        'chat' as entity_type,
        user_id,
        event_count,
        frecency_score,
        first_event,
        recent_events
    FROM frecency_aggregates
    WHERE user_id = $1 AND entity_type = 'chat'
"#;

static PROJECT_CLAUSE: &str = r#"
    SELECT
        entity_id,
        'project' as entity_type,
        user_id,
        event_count,
        frecency_score,
        first_event,
        recent_events
    FROM frecency_aggregates
    WHERE user_id = $1 AND entity_type = 'project'
"#;

static SUFFIX: &str = r#"
    SELECT * FROM Combined
    WHERE ($2::float8 IS NULL OR frecency_score < $2)
    ORDER BY frecency_score DESC
    LIMIT $3
"#;

const ASSIGNEES_PROPERTY_ID: &str = "00000001-0000-0000-0000-000000000001";
const STATUS_PROPERTY_ID: &str = "00000001-0000-0000-0000-000000000002";
const COMPLETED_STATUS_OPTION_ID: &str = "00000001-0000-0000-0002-000000000004";

fn build_notification_exists_clause(
    entity_id_sql: &str,
    entity_type: &str,
    predicate_sql: &str,
) -> String {
    format!(
        r#"EXISTS (
            SELECT 1
            FROM notification n
            JOIN user_notification un ON un.notification_id = n.id
            WHERE un.user_id = $1
              AND un.deleted_at IS NULL
              AND n.event_item_type = '{entity_type}'
              AND n.event_item_id = {entity_id_sql}
              AND {predicate_sql}
        )"#
    )
}

fn build_notification_done_clause(entity_id_sql: &str, entity_type: &str, done: bool) -> String {
    build_notification_exists_clause(
        entity_id_sql,
        entity_type,
        if done {
            "un.done = true"
        } else {
            "un.done = false"
        },
    )
}

fn build_notification_seen_clause(entity_id_sql: &str, entity_type: &str, seen: bool) -> String {
    build_notification_exists_clause(
        entity_id_sql,
        entity_type,
        if seen {
            "un.seen_at IS NOT NULL"
        } else {
            "un.seen_at IS NULL"
        },
    )
}

fn build_task_include_cbm_atm_nc_clause(entity_id_sql: &str) -> String {
    format!(
        r#"entity_id IN (
            SELECT d.id::text
            FROM "Document" d
            LEFT JOIN document_sub_type dt ON dt.document_id = d.id
            LEFT JOIN entity_properties ep_assignees
                ON dt.sub_type = 'task'
                AND ep_assignees.entity_id = d.id
                AND ep_assignees.entity_type = 'TASK'
                AND ep_assignees.property_definition_id = '{ASSIGNEES_PROPERTY_ID}'
            LEFT JOIN entity_properties ep_status
                ON dt.sub_type = 'task'
                AND ep_status.entity_id = d.id
                AND ep_status.entity_type = 'TASK'
                AND ep_status.property_definition_id = '{STATUS_PROPERTY_ID}'
            WHERE d.id::text = {entity_id_sql}
              AND d."deletedAt" IS NULL
              AND dt.sub_type = 'task'
              AND d.owner = $1
              AND ep_assignees.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', $1))
              AND NOT COALESCE(ep_status.values->'value' ? '{COMPLETED_STATUS_OPTION_ID}', false)
        )"#
    )
}

fn build_document_filter(ast: Option<&Expr<DocumentLiteral>>) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
        filter_ast::ExprFrame::Literal(DocumentLiteral::FileType(f)) => {
            format!(r#"entity_id IN (SELECT id FROM "Document" WHERE "fileType" = '{f}' AND "deletedAt" IS NULL)"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Id(i)) => format!("entity_id = '{i}'"),
        filter_ast::ExprFrame::Literal(DocumentLiteral::ProjectId(p)) => {
            format!(r#"entity_id IN (SELECT id FROM "Document" WHERE "projectId" = '{p}' AND "deletedAt" IS NULL)"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Owner(o)) => {
            format!(r#"entity_id IN (SELECT id FROM "Document" WHERE owner = '{o}' AND "deletedAt" IS NULL)"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Importance(true)) => {
            // "Important" documents: non-tasks OR tasks where user is an assignee
            r#"(
                dt.sub_type IS NULL
                OR dt.sub_type != 'task'
                OR ep_assignees.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', $1))
            )"#
                .to_string()
        }
        // filter_ast::ExprFrame::Literal(DocumentLiteral::Importance(false)) => String::new()
        filter_ast::ExprFrame::Literal(DocumentLiteral::Importance(false)) => {
            // "Unimportant" documents: tasks where user is NOT an assignee
            r#"(
                dt.sub_type = 'task'
                -- special null handling for jsonb column
                AND (ep_assignees.values = 'null'
                OR NOT ep_assignees.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', $1)))
            )"#
                .to_string()
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::NotificationDone(done)) => {
            build_notification_done_clause("fa.entity_id", "document", done)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("fa.entity_id", "document", seen)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::IncludeCbmAtmNc(true)) => {
            build_task_include_cbm_atm_nc_clause("fa.entity_id")
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::IncludeCbmAtmNc(false)) => String::new(),
        filter_ast::ExprFrame::Literal(DocumentLiteral::SubType(st)) => {
            format!("dt.sub_type = '{st}'")
        }
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

fn build_chat_filter(ast: Option<&Expr<ChatLiteral>>) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let formatting =
        expr.collapse_frames(|frame: filter_ast::ExprFrame<String, _>| match frame {
            filter_ast::ExprFrame::And(a, b) => match (a.is_empty(), b.is_empty()) {
                (true, true) => String::new(),
                (true, false) => b,
                (false, true) => a,
                (false, false) => format!("({a} AND {b})"),
            },
            filter_ast::ExprFrame::Or(a, b) => match (a.is_empty(), b.is_empty()) {
                (true, true) => String::new(),
                (true, false) => b,
                (false, true) => a,
                (false, false) => format!("({a} OR {b})"),
            },
            filter_ast::ExprFrame::Not(a) => {
                if a.is_empty() {
                    String::new()
                } else {
                    format!("(NOT {a})")
                }
            }
            filter_ast::ExprFrame::Literal(ChatLiteral::ProjectId(p)) => {
                format!(r#"entity_id IN (SELECT id FROM "Chat" WHERE "projectId" = '{p}' AND "deletedAt" IS NULL)"#)
            }
            filter_ast::ExprFrame::Literal(ChatLiteral::Role(_r)) => {
                // Chat role filtering doesn't apply to frecency aggregates
                String::new()
            }
            filter_ast::ExprFrame::Literal(ChatLiteral::ChatId(i)) => format!("entity_id = '{i}'"),
            filter_ast::ExprFrame::Literal(ChatLiteral::Owner(o)) => {
                format!(r#"entity_id IN (SELECT id FROM "Chat" WHERE "userId" = '{o}' AND "deletedAt" IS NULL)"#)
            }
            // all chats are important, so if importance is false, exclude them
            filter_ast::ExprFrame::Literal(ChatLiteral::Importance(true)) => String::new(),
            filter_ast::ExprFrame::Literal(ChatLiteral::Importance(false)) => "1=0".to_string(),
            filter_ast::ExprFrame::Literal(ChatLiteral::NotificationDone(done)) => {
                build_notification_done_clause("entity_id", "chat", done)
            }
            filter_ast::ExprFrame::Literal(ChatLiteral::NotificationSeen(seen)) => {
                build_notification_seen_clause("entity_id", "chat", seen)
            }
        });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

fn build_project_filter(ast: Option<&Expr<ProjectLiteral>>) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
        filter_ast::ExprFrame::Literal(ProjectLiteral::ProjectId(p)) => {
            format!("entity_id = '{p}'")
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::Owner(o)) => {
            format!(r#"entity_id IN (SELECT id FROM "Project" WHERE "userId" = '{o}' AND "deletedAt" IS NULL)"#)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::Importance(true)) => String::new(),
        // all projects are important, so if importance is false, exclude them
        filter_ast::ExprFrame::Literal(ProjectLiteral::Importance(false)) => "1=0".to_string(),
        filter_ast::ExprFrame::Literal(ProjectLiteral::NotificationDone(done)) => {
            build_notification_done_clause("entity_id", "project", done)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("entity_id", "project", seen)
        }
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

fn build_query(filter_ast: &EntityFilterAst) -> QueryBuilder<'_, Postgres> {
    let mut builder = sqlx::QueryBuilder::new("WITH Combined AS (");

    // Document clause
    builder.push(DOCUMENT_CLAUSE);
    builder.push(build_document_filter(filter_ast.document_filter.as_deref()));

    builder.push(" UNION ALL ");

    // Chat clause
    builder.push(CHAT_CLAUSE);
    builder.push(build_chat_filter(filter_ast.chat_filter.as_deref()));

    builder.push(" UNION ALL ");

    // Project clause
    builder.push(PROJECT_CLAUSE);
    builder.push(build_project_filter(filter_ast.project_filter.as_deref()));

    builder.push(") ");
    builder.push(SUFFIX);

    builder
}

#[derive(FromRow)]
struct AggregateRow {
    entity_id: String,
    #[sqlx(try_from = "String")]
    entity_type: EntityType,
    user_id: String,
    #[sqlx(try_from = "i32")]
    event_count: usize,
    frecency_score: f64,
    first_event: chrono::DateTime<chrono::Utc>,
    recent_events: sqlx::types::Json<VecDeque<TimestampWeight>>,
}

impl AggregateRow {
    fn into_aggregate_frecency(self) -> Result<AggregateFrecency, sqlx::Error> {
        let AggregateRow {
            entity_id,
            entity_type,
            user_id,
            event_count,
            frecency_score,
            first_event,
            recent_events,
        } = self;

        let user_id = MacroUserIdStr::parse_from_str(&user_id)
            .map(|id| id.into_owned())
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

        Ok(AggregateFrecency {
            id: AggregateId {
                entity: entity_type.with_entity_string(entity_id.to_string()),
                user_id,
            },
            data: FrecencyData {
                event_count,
                frecency_score,
                first_event,
                recent_events: recent_events.0,
            },
        })
    }
}

#[tracing::instrument(err, skip(db, filter))]
pub async fn dynamic_get_top_entities(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    from_score: Option<f64>,
    limit: u32,
    filter: EntityFilterAst,
) -> Result<Vec<AggregateFrecency>, FrecencyStorageErr> {
    let rows = build_query(&filter)
        .build()
        .bind(user_id.as_ref())
        .bind(from_score)
        .bind(limit as i64)
        .try_map(|row: PgRow| AggregateRow::from_row(&row)?.into_aggregate_frecency())
        .fetch_all(db)
        .await?;

    Ok(rows)
}
