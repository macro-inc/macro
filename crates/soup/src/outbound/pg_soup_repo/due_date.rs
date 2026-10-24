//! Authorized task candidates ordered by the canonical Due Date property.
use chrono::{DateTime, Utc};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{DueDateSort, Query};
use sqlx::{PgPool, QueryBuilder};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use super::expanded::dynamic::{
    DocumentIdArrays, access_semi_join, build_document_filter, build_properties_filter,
    document_filter_needs_task_property_joins,
};

/// A candidate's authoritative deadline, retained independently of hydration.
#[derive(Debug, Clone)]
pub struct DueDateCandidate {
    /// Task identifier.
    pub id: Uuid,
    /// Canonical task deadline, if set.
    pub due_at: Option<DateTime<Utc>>,
}

/// Read task deadlines before pagination and apply the document access and filter gates.
#[tracing::instrument(name = "tasks.due_date.candidates", err, skip_all, fields(limit, sort = ?cursor.sort_method()))]
pub async fn task_page(
    db: &PgPool,
    user: MacroUserIdStr<'_>,
    limit: u16,
    cursor: &Query<Uuid, DueDateSort, EntityFilterAst>,
) -> Result<Vec<DueDateCandidate>, sqlx::Error> {
    let mut ids = DocumentIdArrays::starting_at(8);
    let ast = cursor.filter();
    let mut sql = QueryBuilder::new(
        r#"WITH user_source_ids AS (
            SELECT cp.channel_id::text AS source_id FROM comms_channel_participants cp
              WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL SELECT t.team_id::text FROM team_user t WHERE t.user_id = $1
            UNION ALL SELECT $1
        ), candidates AS (
            SELECT d.id::uuid AS id, CASE WHEN ep_due.values->>'type' = 'Date'
              THEN (ep_due.values->>'value')::timestamptz END AS due_at
            FROM "Document" d
            INNER JOIN document_sub_type dt ON dt.document_id = d.id AND dt.sub_type = 'task'
            LEFT JOIN entity_properties ep_due ON ep_due.entity_id = d.id
              AND ep_due.entity_type = 'TASK' AND ep_due.property_definition_id = $4
        "#,
    );
    if document_filter_needs_task_property_joins(ast.document_filter.as_deref()) {
        sql.push(
            r#"LEFT JOIN entity_properties ep_assignees ON ep_assignees.entity_id = d.id
              AND ep_assignees.entity_type = 'TASK' AND ep_assignees.property_definition_id = $3
            LEFT JOIN entity_properties ep_status ON ep_status.entity_id = d.id
              AND ep_status.entity_type = 'TASK' AND ep_status.property_definition_id = $2 "#,
        );
    }
    sql.push("WHERE d.\"deletedAt\" IS NULL AND ");
    sql.push(access_semi_join("d.id", "document"));
    sql.push(build_document_filter(
        ast.document_filter.as_deref(),
        Some(&mut ids),
    ));
    sql.push(build_properties_filter(
        ast.properties_filter.as_deref(),
        "d.id",
    ));
    sql.push("), page AS (SELECT id, due_at FROM candidates WHERE ");
    match cursor {
        Query::Sort(_, _) => {
            sql.push("$5::timestamptz IS NULL AND $6::uuid IS NULL");
        }
        Query::Cursor(c) => {
            if c.val.last_val.is_some() {
                match c.val.sort_type {
                    DueDateSort::Earliest => {
                        sql.push("(due_at > $5 OR (due_at = $5 AND id > $6) OR due_at IS NULL)");
                    }
                    DueDateSort::Latest => {
                        sql.push("(due_at < $5 OR (due_at = $5 AND id > $6) OR due_at IS NULL)");
                    }
                }
            } else {
                sql.push("($5::timestamptz IS NULL AND due_at IS NULL AND id > $6)");
            }
        }
    }
    match cursor.sort_method() {
        DueDateSort::Earliest => {
            sql.push(" ORDER BY due_at ASC NULLS LAST, id ASC");
        }
        DueDateSort::Latest => {
            sql.push(" ORDER BY due_at DESC NULLS LAST, id ASC");
        }
    }
    sql.push(" LIMIT $7) SELECT id, due_at FROM page");
    let mut query = sql
        .build_query_as::<(Uuid, Option<DateTime<Utc>>)>()
        .bind(user.as_ref())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID)
        .bind(SystemPropertyKey::DUE_DATE_UUID);
    // An undated continuation still has an id; it is never an initial page.
    let (id, due_at) = match cursor {
        Query::Sort(_, _) => (None, None),
        Query::Cursor(c) => (Some(c.id), c.val.last_val),
    };
    query = query.bind(due_at).bind(id).bind(i64::from(limit));
    for array in ids.into_binds() {
        query = query.bind(array);
    }
    Ok(query
        .persistent(false)
        .fetch_all(db)
        .await?
        .into_iter()
        .map(|(id, due_at)| DueDateCandidate { id, due_at })
        .collect())
}

/// Select memberships before applying the keyset, so counts remain full-page totals.
#[tracing::instrument(name = "tasks.due_date.groups.candidates", err, skip_all, fields(limit = req.limit, sort = ?req.cursor.sort_method()))]
pub async fn grouped_task_page(
    db: &PgPool,
    req: crate::domain::models::due_date::GroupedDueDateRequest<'_>,
) -> Result<Vec<crate::domain::models::due_date::DueDateGroupCandidate>, sqlx::Error> {
    use crate::outbound::pg_soup_repo::grouping::{group_join_clause, group_select_expr};
    use models_grouping::GroupByField;
    let ast = req.cursor.filter();
    let mut ids = DocumentIdArrays::starting_at(12);
    let mut sql = QueryBuilder::new(
        r#"WITH user_source_ids AS (
            SELECT cp.channel_id::text AS source_id FROM comms_channel_participants cp
              WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL SELECT team_id::text FROM team_user WHERE user_id = $1
            UNION ALL SELECT $1
        ), tasks AS (
            SELECT d.id, d."projectId"::text AS project_id,
              'TASK'::property_entity_type AS property_entity_type,
              'document'::text AS item_type,
              CASE WHEN ep_due.values->>'type' = 'Date'
                THEN (ep_due.values->>'value')::timestamptz END AS due_at,
              CASE WHEN ep_due.values->>'type' = 'Date'
                THEN (ep_due.values->>'value')::timestamptz END AS sort_ts
            FROM "Document" d
            INNER JOIN document_sub_type dt ON dt.document_id = d.id AND dt.sub_type = 'task'
            LEFT JOIN entity_properties ep_due ON ep_due.entity_id = d.id
              AND ep_due.entity_type = 'TASK' AND ep_due.property_definition_id = $4
        "#,
    );
    if document_filter_needs_task_property_joins(ast.document_filter.as_deref()) {
        sql.push(
            r#"LEFT JOIN entity_properties ep_assignees ON ep_assignees.entity_id = d.id
              AND ep_assignees.entity_type = 'TASK' AND ep_assignees.property_definition_id = $3
            LEFT JOIN entity_properties ep_status ON ep_status.entity_id = d.id
              AND ep_status.entity_type = 'TASK' AND ep_status.property_definition_id = $2 "#,
        );
    }
    sql.push("WHERE d.\"deletedAt\" IS NULL AND ");
    sql.push(access_semi_join("d.id", "document"));
    sql.push(build_document_filter(
        ast.document_filter.as_deref(),
        Some(&mut ids),
    ));
    sql.push(build_properties_filter(
        ast.properties_filter.as_deref(),
        "d.id",
    ));
    sql.push("), membership AS (SELECT t.id::uuid AS id, t.due_at, ");
    let group_expression = match req.grouping.field {
        GroupByField::Deadline { boundaries } => format!(
            "CASE WHEN t.due_at IS NULL THEN '' \
             WHEN t.due_at < '{}'::timestamptz THEN 'overdue' \
             WHEN t.due_at < '{}'::timestamptz THEN 'today' \
             WHEN t.due_at < '{}'::timestamptz THEN 'tomorrow' \
             WHEN t.due_at < '{}'::timestamptz THEN 'next_7_days' ELSE 'later' END",
            boundaries.today.to_rfc3339(),
            boundaries.tomorrow.to_rfc3339(),
            boundaries.day_two.to_rfc3339(),
            boundaries.day_eight.to_rfc3339(),
        ),
        _ => group_select_expr(&req.grouping.field).into_owned(),
    };
    sql.push(group_expression);
    sql.push(" AS group_key, $6::property_entity_type AS reserved_property_type FROM tasks t ");
    let entity_type_bind = if let Some(join) = group_join_clause(&req.grouping.field) {
        sql.push(join.sql.replace("$10", "$6"));
        join.entity_type_bind
    } else {
        None
    };
    sql.push(") , counted AS (SELECT *, COUNT(*) OVER (PARTITION BY group_key) AS group_total_count, ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY due_at ");
    match req.cursor.sort_method() {
        DueDateSort::Earliest => {
            sql.push("ASC NULLS LAST");
        }
        DueDateSort::Latest => {
            sql.push("DESC NULLS LAST");
        }
    }
    sql.push(
        r#", id ASC) AS position_in_group FROM membership), eligible AS (
          SELECT * FROM counted WHERE ($5::text IS NULL OR group_key = $5)
            AND ($11::boolean = false OR
        "#,
    );
    match req.cursor.sort_method() {
        DueDateSort::Earliest => {
            sql.push("($9::timestamptz IS NULL AND due_at IS NULL AND id > $10) OR ($9 IS NOT NULL AND (due_at > $9 OR (due_at = $9 AND id > $10) OR due_at IS NULL))");
        }
        DueDateSort::Latest => {
            sql.push("($9::timestamptz IS NULL AND due_at IS NULL AND id > $10) OR ($9 IS NOT NULL AND (due_at < $9 OR (due_at = $9 AND id > $10) OR due_at IS NULL))");
        }
    }
    sql.push(")), ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY due_at ");
    match req.cursor.sort_method() {
        DueDateSort::Earliest => {
            sql.push("ASC NULLS LAST");
        }
        DueDateSort::Latest => {
            sql.push("DESC NULLS LAST");
        }
    }
    sql.push(", id ASC) AS row_in_group FROM eligible) SELECT id, due_at, group_key, group_total_count, position_in_group FROM ranked WHERE ($5::text IS NOT NULL OR row_in_group <= $7) ORDER BY group_key, due_at ");
    match req.cursor.sort_method() {
        DueDateSort::Earliest => {
            sql.push("ASC NULLS LAST");
        }
        DueDateSort::Latest => {
            sql.push("DESC NULLS LAST");
        }
    }
    sql.push(", id ASC LIMIT $8");
    let (id, due_at, has_cursor) = match &req.cursor {
        Query::Sort(_, _) => (None, None, false),
        Query::Cursor(c) => (Some(c.id), c.val.last_val, true),
    };
    let query_limit = if req.grouping.group_key.is_some() {
        i64::from(req.limit)
    } else {
        i64::MAX
    };
    let mut query = sql
        .build_query_as::<(Uuid, Option<DateTime<Utc>>, String, i64, i64)>()
        .bind(req.user_id.as_ref())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID)
        .bind(SystemPropertyKey::DUE_DATE_UUID)
        .bind(req.grouping.group_key.clone())
        .bind(entity_type_bind)
        .bind(i64::from(req.grouping.effective_limit().clamp(1, 500)))
        .bind(query_limit)
        .bind(due_at)
        .bind(id)
        .bind(has_cursor);
    for array in ids.into_binds() {
        query = query.bind(array);
    }
    query
        .persistent(false)
        .fetch_all(db)
        .await?
        .into_iter()
        .map(|(id, due_at, key, total, position)| {
            Ok(crate::domain::models::due_date::DueDateGroupCandidate {
                id,
                due_at,
                key,
                total_group_count: usize::try_from(total)
                    .map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
                index_in_group: usize::try_from(position)
                    .map_err(|err| sqlx::Error::Decode(Box::new(err)))?,
            })
        })
        .collect()
}

#[cfg(test)]
mod test;
