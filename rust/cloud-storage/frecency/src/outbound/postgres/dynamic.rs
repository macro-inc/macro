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
        entity_id,
        'document' as entity_type,
        user_id,
        event_count,
        frecency_score,
        first_event,
        recent_events
    FROM frecency_aggregates
    WHERE user_id = $1 AND entity_type = 'document'
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
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
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
    builder.push(build_document_filter(
        filter_ast.inner.document_filter.as_ref(),
    ));

    builder.push(" UNION ALL ");

    // Chat clause
    builder.push(CHAT_CLAUSE);
    builder.push(build_chat_filter(filter_ast.inner.chat_filter.as_ref()));

    builder.push(" UNION ALL ");

    // Project clause
    builder.push(PROJECT_CLAUSE);
    builder.push(build_project_filter(
        filter_ast.inner.project_filter.as_ref(),
    ));

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
