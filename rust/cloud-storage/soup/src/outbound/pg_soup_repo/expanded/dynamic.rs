//! This module exposes a expanded dynamic query builder which is able to build specific soup queries
//! which filter out content basd on some input ast

use std::str::FromStr;

use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst,
    chat::ChatLiteral,
    date::DateLiteral,
    document::DocumentLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyMatchValue},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{
    chat::SoupChat,
    document::{SoupDocument, SoupDocumentSubType},
    item::SoupItem,
    project::SoupProject,
};
use recursion::CollapsibleExt;
use sqlx::{PgPool, Postgres, QueryBuilder, Row, postgres::PgRow, prelude::FromRow};
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

use crate::outbound::pg_soup_repo::{populate_properties, type_err};

static PREFIX: &str = r#"
    WITH user_source_ids AS (
        SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
        UNION ALL
        SELECT t.team_id::text FROM team_user t
            WHERE t.user_id = $1
        UNION ALL
        SELECT $1
    ),
    UserAccessibleItems AS (
        SELECT DISTINCT
            ea.entity_id::text as item_id,
            ea.entity_type as item_type
        FROM entity_access ea
        WHERE ea.source_id = ANY(SELECT source_id FROM user_source_ids)
    ),
"#;

// -- Lightweight top clauses: only id + sort_ts (plus filter-required joins) --

static DOCUMENT_TOP_CLAUSE: &str = r#"
                SELECT
                    'document'::text as item_type,
                    d.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN d."createdAt"
                        ELSE d."updatedAt"
                    END::timestamptz as sort_ts
                FROM "Document" d
                LEFT JOIN document_sub_type dt ON dt.document_id = d.id
                LEFT JOIN entity_properties ep_assignees
                    ON dt.sub_type = 'task'
                    AND ep_assignees.entity_id = d.id
                    AND ep_assignees.entity_type = 'TASK'
                    AND ep_assignees.property_definition_id = $8
                LEFT JOIN entity_properties ep_status
                    ON dt.sub_type = 'task'
                    AND ep_status.entity_id = d.id
                    AND ep_status.entity_type = 'TASK'
                    AND ep_status.property_definition_id = $7
                INNER JOIN UserAccessibleItems uai ON uai.item_id = d.id AND uai.item_type = 'document'
                LEFT JOIN "UserHistory" uh ON uh."itemId" = d.id AND uh."itemType" = 'document' AND uh."userId" = $1
                WHERE d."deletedAt" IS NULL
"#;

static CHAT_TOP_CLAUSE: &str = r#"
                SELECT
                    'chat'::text as item_type,
                    c.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN c."createdAt"
                        ELSE c."updatedAt"
                    END::timestamptz as sort_ts
                FROM "Chat" c
                INNER JOIN UserAccessibleItems uai ON uai.item_id = c.id AND uai.item_type = 'chat'
                LEFT JOIN "UserHistory" uh ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
                WHERE c."deletedAt" IS NULL
"#;

static PROJECT_TOP_CLAUSE: &str = r#"
                SELECT
                    'project'::text as item_type,
                    p.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", p."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN p."createdAt"
                        ELSE p."updatedAt"
                    END::timestamptz as sort_ts
                FROM "Project" p
                INNER JOIN UserAccessibleItems uai
                    ON uai.item_id = p.id
                    AND uai.item_type = 'project'
                LEFT JOIN "UserHistory" uh
                    ON uh."itemId" = p.id
                    AND uh."itemType" = 'project'
                    AND uh."userId" = $1
                WHERE p."deletedAt" IS NULL
"#;

// -- Detail clauses: full columns, joined back from TopItems --

static DOCUMENT_DETAIL_CLAUSE: &str = r#"
        SELECT
            'document' as "item_type",
            d.id as "id",
            CAST(COALESCE(di.id, db.id) as TEXT) as "document_version_id",
            d.owner as "user_id",
            d.name as "name",
            d."branchedFromId" as "branched_from_id",
            d."branchedFromVersionId" as "branched_from_version_id",
            d."documentFamilyId" as "document_family_id",
            d."fileType" as "file_type",
            d."createdAt"::timestamptz as "created_at",
            d."updatedAt"::timestamptz as "updated_at",
            d."projectId" as "project_id",
            NULL as "is_persistent",
            di.sha as "sha",
            dt.sub_type as "sub_type",
            uh."updatedAt"::timestamptz as "viewed_at",
            t.sort_ts as "sort_ts",
            CASE
                WHEN dt.sub_type = 'task'
                    AND ep_status.values->'value' ? $6
                THEN true
                WHEN dt.sub_type = 'task'
                THEN false
                ELSE NULL
            END as "is_completed",
            d."deletedAt"::timestamptz as "deleted_at"
        FROM TopItems t
        INNER JOIN "Document" d ON d.id = t.id
        LEFT JOIN document_sub_type dt ON dt.document_id = d.id
        LEFT JOIN entity_properties ep_status
            ON dt.sub_type = 'task'
            AND ep_status.entity_id = d.id
            AND ep_status.entity_type = 'TASK'
            AND ep_status.property_definition_id = $7
        LEFT JOIN "UserHistory" uh
            ON uh."itemId" = d.id AND uh."itemType" = 'document' AND uh."userId" = $1
        LEFT JOIN LATERAL (
            SELECT b.id
            FROM "DocumentBom" b
            WHERE b."documentId" = d.id
            ORDER BY b."createdAt" DESC
            LIMIT 1
        ) db ON true
        LEFT JOIN LATERAL (
            SELECT i.id, i.sha
            FROM "DocumentInstance" i
            WHERE i."documentId" = d.id
            ORDER BY i."updatedAt" DESC
            LIMIT 1
        ) di ON true
        WHERE t.item_type = 'document'
"#;

static CHAT_DETAIL_CLAUSE: &str = r#"
        SELECT
            'chat' as "item_type",
            c.id as "id",
            NULL as "document_version_id",
            c."userId" as "user_id",
            c.name as "name",
            NULL as "branched_from_id",
            NULL as "branched_from_version_id",
            NULL as "document_family_id",
            NULL as "file_type",
            c."createdAt"::timestamptz as "created_at",
            c."updatedAt"::timestamptz as "updated_at",
            c."projectId" as "project_id",
            c."isPersistent" as "is_persistent",
            NULL as "sha",
            NULL as "sub_type",
            uh."updatedAt"::timestamptz as "viewed_at",
            t.sort_ts as "sort_ts",
            NULL as "is_completed",
            c."deletedAt"::timestamptz as "deleted_at"
        FROM TopItems t
        INNER JOIN "Chat" c ON c.id = t.id
        LEFT JOIN "UserHistory" uh
            ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
        WHERE t.item_type = 'chat'
"#;

static PROJECT_DETAIL_CLAUSE: &str = r#"
        SELECT
            'project' as "item_type",
            p.id as "id",
            NULL as "document_version_id",
            p."userId" as "user_id",
            p.name as "name",
            NULL as "branched_from_id",
            NULL as "branched_from_version_id",
            NULL as "document_family_id",
            NULL as "file_type",
            p."createdAt"::timestamptz as "created_at",
            p."updatedAt"::timestamptz as "updated_at",
            p."parentId" as "project_id",
            NULL as "is_persistent",
            NULL as "sha",
            NULL as "sub_type",
            uh."updatedAt"::timestamptz as "viewed_at",
            t.sort_ts as "sort_ts",
            NULL as "is_completed",
            p."deletedAt"::timestamptz as "deleted_at"
        FROM TopItems t
        INNER JOIN "Project" p ON p.id = t.id
        LEFT JOIN "UserHistory" uh
            ON uh."itemId" = p.id
            AND uh."itemType" = 'project'
            AND uh."userId" = $1
        WHERE t.item_type = 'project'
"#;

static DETAIL_SUFFIX: &str = r#"
    )
    SELECT * FROM Combined
    ORDER BY "sort_ts" DESC, "id" DESC
    LIMIT $3
"#;

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
              AND n.event_item_id = ({entity_id_sql})::text
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

fn build_task_include_cbm_atm_nc_clause() -> String {
    r#"(
        dt.sub_type = 'task'
        AND d.owner = $1
        AND ep_assignees.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', $1))
        AND NOT COALESCE(ep_status.values->'value' ? $6, false)
    )"#
    .to_string()
}

fn date_predicate(col: &str, lit: &DateLiteral) -> String {
    match lit {
        DateLiteral::GreaterThan(dt) => format!("{col} > '{}'::timestamptz", dt.to_rfc3339()),
        DateLiteral::LessThan(dt) => format!("{col} < '{}'::timestamptz", dt.to_rfc3339()),
        DateLiteral::GreaterThanOrEqual(dt) => {
            format!("{col} >= '{}'::timestamptz", dt.to_rfc3339())
        }
        DateLiteral::LessThanOrEqual(dt) => format!("{col} <= '{}'::timestamptz", dt.to_rfc3339()),
    }
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
            format!(r#"d."fileType" = '{f}'"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Id(i)) => format!("d.id = '{i}'"),
        filter_ast::ExprFrame::Literal(DocumentLiteral::ProjectId(p)) => {
            format!(r#"d."projectId" = '{p}'"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Owner(o)) => format!("d.owner = '{o}'"),
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
            build_notification_done_clause("d.id", "document", done)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("d.id", "document", seen)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::IncludeCbmAtmNc(true)) => {
            build_task_include_cbm_atm_nc_clause()
        }
        // false is equivalent to disabled/no-op.
        filter_ast::ExprFrame::Literal(DocumentLiteral::IncludeCbmAtmNc(false)) => String::new(),
        filter_ast::ExprFrame::Literal(DocumentLiteral::SubType(st)) => {
            format!("(dt.sub_type IS NOT NULL AND dt.sub_type = '{st}')")
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::IsEmailAttachment(true)) => {
            r#"EXISTS(SELECT 1 FROM document_email WHERE document_id = d.id)"#
                .to_string()
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::IsEmailAttachment(false)) => {
            r#"NOT EXISTS(SELECT 1 FROM document_email WHERE document_id = d.id)"#
                .to_string()
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::CreatedAt(lit)) => {
            date_predicate(r#"d."createdAt""#, &lit)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::UpdatedAt(lit)) => {
            date_predicate(r#"d."updatedAt""#, &lit)
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
            format!(r#"c."projectId" = '{p}'"#)
        }
        // todo? I'm not sure what a chat role filter looks like
        filter_ast::ExprFrame::Literal(ChatLiteral::Role(_r)) => String::new(),
        filter_ast::ExprFrame::Literal(ChatLiteral::ChatId(i)) => format!("c.id = '{i}'"),
        filter_ast::ExprFrame::Literal(ChatLiteral::Owner(o)) => {
            format!(r#"c."userId" = '{o}'"#)
        }
        filter_ast::ExprFrame::Literal(ChatLiteral::Importance(true)) => String::new(),
        // all chats are important, so if importance is false, exclude them
        filter_ast::ExprFrame::Literal(ChatLiteral::Importance(false)) => "1=0".to_string(),
        filter_ast::ExprFrame::Literal(ChatLiteral::NotificationDone(done)) => {
            build_notification_done_clause("c.id", "chat", done)
        }
        filter_ast::ExprFrame::Literal(ChatLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("c.id", "chat", seen)
        }
        filter_ast::ExprFrame::Literal(ChatLiteral::CreatedAt(lit)) => {
            date_predicate(r#"c."createdAt""#, &lit)
        }
        filter_ast::ExprFrame::Literal(ChatLiteral::UpdatedAt(lit)) => {
            date_predicate(r#"c."updatedAt""#, &lit)
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
            format!(r#"p."parentId" = '{p}'"#)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::Owner(o)) => {
            format!(r#"p."userId" = '{o}'"#)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::Importance(true)) => String::new(),
        // all projects are important, so if importance is false, exclude them
        filter_ast::ExprFrame::Literal(ProjectLiteral::Importance(false)) => "1=0".to_string(),
        filter_ast::ExprFrame::Literal(ProjectLiteral::NotificationDone(done)) => {
            build_notification_done_clause("p.id", "project", done)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("p.id", "project", seen)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::CreatedAt(lit)) => {
            date_predicate(r#"p."createdAt""#, &lit)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::UpdatedAt(lit)) => {
            date_predicate(r#"p."updatedAt""#, &lit)
        }
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

fn build_properties_filter(ast: Option<&Expr<PropertiesLiteral>>, entity_id_sql: &str) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
        filter_ast::ExprFrame::Literal(PropertiesLiteral {
            property_definition_id,
            entity_type,
            value,
        }) => {
            let value_predicate = match value {
                PropertyMatchValue::SelectOption(option_id) => {
                    format!("ep_prop.values->'value' ? '{option_id}'")
                }
                PropertyMatchValue::EntityRef(entity_id) => {
                    format!(
                        "ep_prop.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', '{entity_id}'))"
                    )
                }
            };
            let entity_type_clause = match entity_type {
                Some(et) => format!("AND ep_prop.entity_type = '{et}'"),
                None => String::new(),
            };
            format!(
                r#"EXISTS (
                    SELECT 1 FROM entity_properties ep_prop
                    WHERE ep_prop.entity_id = {entity_id_sql}
                    {entity_type_clause}
                    AND ep_prop.property_definition_id = '{property_definition_id}'
                    AND {value_predicate}
                )"#
            )
        }
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

fn build_query(filter_ast: &EntityFilterAst, exclude_frecency: bool) -> QueryBuilder<'_, Postgres> {
    let mut builder = sqlx::QueryBuilder::new(PREFIX);

    // TopItems CTE: lightweight id + sort_ts with filters, cursor, and limit
    builder.push("TopItems AS (");
    builder.push("SELECT all_items.item_type, all_items.id, all_items.sort_ts FROM (");

    // Document top clause (lightweight)
    builder.push(DOCUMENT_TOP_CLAUSE);
    builder.push(build_document_filter(filter_ast.document_filter.as_deref()));
    builder.push(build_properties_filter(
        filter_ast.properties_filter.as_deref(),
        "d.id",
    ));

    builder.push(" UNION ALL ");

    // Chat top clause (lightweight)
    builder.push(CHAT_TOP_CLAUSE);
    builder.push(build_chat_filter(filter_ast.chat_filter.as_deref()));
    builder.push(build_properties_filter(
        filter_ast.properties_filter.as_deref(),
        "c.id",
    ));

    builder.push(" UNION ALL ");

    // Project top clause (lightweight)
    builder.push(PROJECT_TOP_CLAUSE);
    builder.push(build_project_filter(filter_ast.project_filter.as_deref()));
    builder.push(build_properties_filter(
        filter_ast.properties_filter.as_deref(),
        "p.id",
    ));

    builder.push(") all_items ");

    // Frecency exclusion join (only when exclude_frecency is true)
    if exclude_frecency {
        builder.push(
            r#"LEFT JOIN frecency_aggregates fa
                ON fa.entity_id = all_items.id
                AND fa.entity_type = all_items.item_type
                AND fa.user_id = $1
            WHERE fa.id IS NULL AND ("#,
        );
    } else {
        builder.push("WHERE ");
    }

    // Cursor condition
    builder.push(
        r#"($4::timestamptz IS NULL)
            OR
            (all_items.sort_ts, all_items.id::text) < ($4, $5)"#,
    );

    if exclude_frecency {
        builder.push(")");
    }

    builder.push(" ORDER BY all_items.sort_ts DESC, all_items.id DESC LIMIT $3");
    builder.push("), ");

    // Combined CTE: full detail joins back from TopItems
    builder.push("Combined AS (");

    builder.push(DOCUMENT_DETAIL_CLAUSE);
    builder.push(" UNION ALL ");
    builder.push(CHAT_DETAIL_CLAUSE);
    builder.push(" UNION ALL ");
    builder.push(PROJECT_DETAIL_CLAUSE);

    builder.push(DETAIL_SUFFIX);

    builder
}

#[derive(Debug, FromRow)]
struct DocumentRow {
    id: String,
    user_id: String,
    document_version_id: String,
    name: String,
    sha: Option<String>,
    file_type: Option<String>,
    document_family_id: Option<i64>,
    branched_from_id: Option<String>,
    branched_from_version_id: Option<i64>,
    project_id: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
    sub_type: Option<DocumentSubType>,
    is_completed: Option<bool>,
    deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct ChatRow {
    id: String,
    user_id: String,
    name: String,
    project_id: Option<String>,
    #[sqlx(default)]
    is_persistent: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
    deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct ProjectRow {
    id: String,
    user_id: String,
    name: String,
    project_id: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
    deleted_at: Option<DateTime<Utc>>,
}

#[derive(Debug)]
enum SoupRow {
    Document(DocumentRow),
    Chat(ChatRow),
    Project(ProjectRow),
}

impl<'a> FromRow<'a, PgRow> for SoupRow {
    fn from_row(row: &'a PgRow) -> Result<Self, sqlx::Error> {
        let item_type: &'a str = row.try_get("item_type")?;
        match item_type {
            "document" => Ok(SoupRow::Document(DocumentRow::from_row(row)?)),
            "chat" => Ok(SoupRow::Chat(ChatRow::from_row(row)?)),
            "project" => Ok(SoupRow::Project(ProjectRow::from_row(row)?)),
            _ => Err(sqlx::Error::TypeNotFound {
                type_name: item_type.to_string(),
            }),
        }
    }
}

impl SoupRow {
    fn into_soup_item(self) -> Result<SoupItem, sqlx::Error> {
        Ok(match self {
            SoupRow::Document(DocumentRow {
                id,
                user_id,
                document_version_id,
                name,
                sha,
                file_type,
                document_family_id,
                branched_from_id,
                branched_from_version_id,
                project_id,
                created_at,
                updated_at,
                viewed_at,
                sub_type,
                is_completed,
                deleted_at,
            }) => SoupItem::Document(SoupDocument {
                id: Uuid::parse_str(&id).map_err(type_err)?,
                document_version_id: document_version_id
                    .parse()
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
                owner_id: MacroUserIdStr::parse_from_str(&user_id)
                    .map_err(type_err)?
                    .into_owned(),
                name,
                file_type,
                sha,
                project_id: project_id
                    .as_deref()
                    .map(Uuid::from_str)
                    .transpose()
                    .map_err(type_err)?,
                branched_from_id: branched_from_id
                    .as_deref()
                    .map(Uuid::from_str)
                    .transpose()
                    .map_err(type_err)?,
                branched_from_version_id,
                document_family_id,
                created_at,
                updated_at,
                viewed_at,
                sub_type: SoupDocumentSubType::from_db(sub_type, is_completed),
                deleted_at,
                properties: Default::default(),
            }),
            SoupRow::Chat(ChatRow {
                id,
                user_id,
                name,
                project_id,
                is_persistent,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
            }) => SoupItem::Chat(SoupChat {
                id: Uuid::parse_str(&id).map_err(type_err)?,
                name,
                owner_id: MacroUserIdStr::parse_from_str(&user_id)
                    .map_err(type_err)?
                    .into_owned(),
                project_id: project_id
                    .as_deref()
                    .map(Uuid::parse_str)
                    .transpose()
                    .map_err(type_err)?,
                is_persistent,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
                properties: Default::default(),
            }),
            SoupRow::Project(ProjectRow {
                id,
                user_id,
                name,
                project_id,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
            }) => SoupItem::Project(SoupProject {
                id: Uuid::parse_str(&id).map_err(type_err)?,
                name,
                owner_id: MacroUserIdStr::parse_from_str(&user_id)
                    .map_err(type_err)?
                    .into_owned(),
                parent_id: project_id
                    .as_deref()
                    .map(Uuid::from_str)
                    .transpose()
                    .map_err(type_err)?,
                created_at,
                updated_at,
                viewed_at,
                deleted_at,
                properties: Default::default(),
            }),
        })
    }
}

#[derive(Debug)]
pub(crate) struct ExpandedDynamicCursorArgs<'a> {
    /// the user for which we are performing the query
    pub user_id: MacroUserIdStr<'a>,
    /// the limit of items we can return
    pub limit: u16,
    /// the Query that we are attempting to perform
    pub cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    /// whether or not the query should explicitly remove items that DO have
    /// frecency records
    pub exclude_frecency: bool,
}

#[tracing::instrument(skip(db), err)]
pub(crate) async fn expanded_dynamic_cursor_soup(
    db: &PgPool,
    args: ExpandedDynamicCursorArgs<'_>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let ExpandedDynamicCursorArgs {
        user_id,
        limit,
        cursor,
        exclude_frecency,
    } = args;
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();
    let cursor_id_str = cursor_id.as_ref().map(|u| u.to_string());
    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let assignees_property_id = SystemPropertyKey::ASSIGNEES_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();

    let mut items = build_query(cursor.filter(), exclude_frecency)
        .build()
        .bind(user_id.as_ref())
        .bind(sort_method_str)
        .bind(query_limit)
        .bind(cursor_timestamp)
        .bind(cursor_id_str)
        .bind(completed_option_id)
        .bind(status_property_id)
        .bind(assignees_property_id)
        .try_map(|row| SoupRow::from_row(&row)?.into_soup_item())
        .fetch_all(db)
        .await?;

    populate_properties(db, &mut items).await?;

    Ok(items)
}
