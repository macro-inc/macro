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
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
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

use crate::domain::models::GroupedSoupItem;
use crate::outbound::pg_soup_repo::grouping::{
    GroupJoinClause, group_join_clause, group_select_expr,
};
use crate::outbound::pg_soup_repo::{populate_properties, type_err};
use models_grouping::{GroupByField, GroupingConfig, date_bucket_sql_order};

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
                FROM AccessibleItems ai
                INNER JOIN "Document" d ON d.id = ai.item_id AND ai.item_type = 'document'
                LEFT JOIN document_sub_type dt ON dt.document_id = d.id
"#;

static DOCUMENT_TASK_PROPERTY_JOINS: &str = r#"
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
"#;

static DOCUMENT_TOP_WHERE_CLAUSE: &str = r#"
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
                FROM AccessibleItems ai
                INNER JOIN "Chat" c ON c.id = ai.item_id AND ai.item_type = 'chat'
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
                FROM AccessibleItems ai
                INNER JOIN "Project" p ON p.id = ai.item_id AND ai.item_type = 'project'
                LEFT JOIN "UserHistory" uh
                    ON uh."itemId" = p.id
                    AND uh."itemType" = 'project'
                    AND uh."userId" = $1
                WHERE p."deletedAt" IS NULL
"#;

// -- Grouped top clauses: include project_id for grouping support --

static GROUPED_DOCUMENT_TOP_CLAUSE: &str = r#"
                SELECT
                    'document'::text as item_type,
                    d.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN d."createdAt"
                        ELSE d."updatedAt"
                    END::timestamptz as sort_ts,
                    d."projectId"::text as project_id
                FROM AccessibleItems ai
                INNER JOIN "Document" d ON d.id = ai.item_id AND ai.item_type = 'document'
                LEFT JOIN document_sub_type dt ON dt.document_id = d.id
"#;

static GROUPED_CHAT_TOP_CLAUSE: &str = r#"
                SELECT
                    'chat'::text as item_type,
                    c.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN c."createdAt"
                        ELSE c."updatedAt"
                    END::timestamptz as sort_ts,
                    c."projectId"::text as project_id
                FROM AccessibleItems ai
                INNER JOIN "Chat" c ON c.id = ai.item_id AND ai.item_type = 'chat'
                LEFT JOIN "UserHistory" uh ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
                WHERE c."deletedAt" IS NULL
"#;

static GROUPED_PROJECT_TOP_CLAUSE: &str = r#"
                SELECT
                    'project'::text as item_type,
                    p.id,
                    CASE $2
                        WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", p."updatedAt")
                        WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
                        WHEN 'created_at' THEN p."createdAt"
                        ELSE p."updatedAt"
                    END::timestamptz as sort_ts,
                    p."parentId"::text as project_id
                FROM AccessibleItems ai
                INNER JOIN "Project" p ON p.id = ai.item_id AND ai.item_type = 'project'
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

// -- Grouped detail clauses: join from GroupedItems, include group columns --

static GROUPED_DOCUMENT_DETAIL_CLAUSE: &str = r#"
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
            gi.sort_ts as "sort_ts",
            CASE
                WHEN dt.sub_type = 'task'
                    AND ep_status.values->'value' ? $6
                THEN true
                WHEN dt.sub_type = 'task'
                THEN false
                ELSE NULL
            END as "is_completed",
            d."deletedAt"::timestamptz as "deleted_at",
            gi.group_key as "group_key",
            gi.group_total_count as "group_total_count",
            gi.row_in_group as "row_in_group"
        FROM GroupedItems gi
        INNER JOIN "Document" d ON d.id = gi.id
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
        WHERE gi.item_type = 'document'
"#;

static GROUPED_CHAT_DETAIL_CLAUSE: &str = r#"
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
            gi.sort_ts as "sort_ts",
            NULL as "is_completed",
            c."deletedAt"::timestamptz as "deleted_at",
            gi.group_key as "group_key",
            gi.group_total_count as "group_total_count",
            gi.row_in_group as "row_in_group"
        FROM GroupedItems gi
        INNER JOIN "Chat" c ON c.id = gi.id
        LEFT JOIN "UserHistory" uh
            ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
        WHERE gi.item_type = 'chat'
"#;

static GROUPED_PROJECT_DETAIL_CLAUSE: &str = r#"
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
            gi.sort_ts as "sort_ts",
            NULL as "is_completed",
            p."deletedAt"::timestamptz as "deleted_at",
            gi.group_key as "group_key",
            gi.group_total_count as "group_total_count",
            gi.row_in_group as "row_in_group"
        FROM GroupedItems gi
        INNER JOIN "Project" p ON p.id = gi.id
        LEFT JOIN "UserHistory" uh
            ON uh."itemId" = p.id
            AND uh."itemType" = 'project'
            AND uh."userId" = $1
        WHERE gi.item_type = 'project'
"#;

static GROUPED_EMPTY_COMBINED_CLAUSE: &str = r#"
        SELECT
            'document' as "item_type",
            NULL::text as "id",
            NULL::text as "document_version_id",
            NULL::text as "user_id",
            NULL::text as "name",
            NULL::text as "branched_from_id",
            NULL::bigint as "branched_from_version_id",
            NULL::bigint as "document_family_id",
            NULL::text as "file_type",
            NULL::timestamptz as "created_at",
            NULL::timestamptz as "updated_at",
            NULL::text as "project_id",
            NULL::boolean as "is_persistent",
            NULL::text as "sha",
            NULL::document_sub_type_value as "sub_type",
            NULL::timestamptz as "viewed_at",
            NULL::timestamptz as "sort_ts",
            NULL::boolean as "is_completed",
            NULL::timestamptz as "deleted_at",
            NULL::text as "group_key",
            NULL::bigint as "group_total_count",
            NULL::bigint as "row_in_group"
        WHERE false
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
        filter_ast::ExprFrame::Literal(ProjectLiteral::ProjectIdSelf(p)) => {
            format!(r#"p.id = '{p}'"#)
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

fn document_filter_needs_task_property_joins(ast: Option<&Expr<DocumentLiteral>>) -> bool {
    ast.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a || b,
            filter_ast::ExprFrame::Not(a) => a,
            filter_ast::ExprFrame::Literal(DocumentLiteral::Importance(_))
            | filter_ast::ExprFrame::Literal(DocumentLiteral::IncludeCbmAtmNc(true)) => true,
            filter_ast::ExprFrame::Literal(_) => false,
        })
    })
}

fn properties_filter_can_apply_to(
    ast: Option<&Expr<PropertiesLiteral>>,
    entity_types: &[PropertyEntityType],
) -> bool {
    ast.is_none_or(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) => a && b,
            filter_ast::ExprFrame::Or(a, b) => a || b,
            // Be conservative: NOT can turn an inapplicable predicate into a match.
            filter_ast::ExprFrame::Not(_) => true,
            filter_ast::ExprFrame::Literal(PropertiesLiteral { entity_type, .. }) => {
                entity_type.is_none_or(|entity_type| entity_types.contains(&entity_type))
            }
        })
    })
}

fn chat_filter_is_impossible(ast: Option<&Expr<ChatLiteral>>) -> bool {
    ast.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) => a || b,
            filter_ast::ExprFrame::Or(a, b) => a && b,
            filter_ast::ExprFrame::Not(_) => false,
            filter_ast::ExprFrame::Literal(ChatLiteral::ChatId(id)) => id.is_nil(),
            filter_ast::ExprFrame::Literal(ChatLiteral::Importance(false)) => true,
            filter_ast::ExprFrame::Literal(_) => false,
        })
    })
}

fn document_filter_is_impossible(ast: Option<&Expr<DocumentLiteral>>) -> bool {
    ast.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) => a || b,
            filter_ast::ExprFrame::Or(a, b) => a && b,
            filter_ast::ExprFrame::Not(_) => false,
            filter_ast::ExprFrame::Literal(DocumentLiteral::Id(id)) => id.is_nil(),
            filter_ast::ExprFrame::Literal(_) => false,
        })
    })
}

fn project_filter_is_impossible(ast: Option<&Expr<ProjectLiteral>>) -> bool {
    ast.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) => a || b,
            filter_ast::ExprFrame::Or(a, b) => a && b,
            filter_ast::ExprFrame::Not(_) => false,
            filter_ast::ExprFrame::Literal(ProjectLiteral::Importance(false)) => true,
            filter_ast::ExprFrame::Literal(_) => false,
        })
    })
}

fn push_union_separator(builder: &mut QueryBuilder<'_, Postgres>, needs_separator: &mut bool) {
    if *needs_separator {
        builder.push(" UNION ALL ");
    }
    *needs_separator = true;
}

fn push_accessible_items_cte(
    builder: &mut QueryBuilder<'_, Postgres>,
    include_documents: bool,
    include_chats: bool,
    include_projects: bool,
) {
    let mut entity_types = Vec::with_capacity(3);
    if include_documents {
        entity_types.push("'document'");
    }
    if include_chats {
        entity_types.push("'chat'");
    }
    if include_projects {
        entity_types.push("'project'");
    }

    if entity_types.is_empty() {
        return;
    }

    let entity_types = entity_types.join(", ");
    builder.push(format!(
        r#"AccessibleItems AS MATERIALIZED (
        SELECT DISTINCT item_id, item_type
        FROM (
            SELECT
                ea.entity_id::text as item_id,
                ea.entity_type as item_type
            FROM entity_access ea
            WHERE ea.source_id = $1
              AND ea.entity_type IN ({entity_types})

            UNION ALL

            SELECT
                ea.entity_id::text as item_id,
                ea.entity_type as item_type
            FROM comms_channel_participants cp
            CROSS JOIN LATERAL (
                SELECT ea.entity_id, ea.entity_type
                FROM entity_access ea
                WHERE ea.source_id = cp.channel_id::text
                  AND ea.entity_type IN ({entity_types})
                OFFSET 0
            ) ea
            WHERE cp.user_id = $1
              AND cp.left_at IS NULL

            UNION ALL

            SELECT
                ea.entity_id::text as item_id,
                ea.entity_type as item_type
            FROM team_user t
            CROSS JOIN LATERAL (
                SELECT ea.entity_id, ea.entity_type
                FROM entity_access ea
                WHERE ea.source_id = t.team_id::text
                  AND ea.entity_type IN ({entity_types})
                OFFSET 0
            ) ea
            WHERE t.user_id = $1
        ) accessible
    ),
"#
    ));
}

fn build_query(filter_ast: &EntityFilterAst, exclude_frecency: bool) -> QueryBuilder<'_, Postgres> {
    let mut builder = sqlx::QueryBuilder::new(PREFIX);

    let include_documents = !document_filter_is_impossible(filter_ast.document_filter.as_deref())
        && properties_filter_can_apply_to(
            filter_ast.properties_filter.as_deref(),
            &[PropertyEntityType::Document, PropertyEntityType::Task],
        );
    let include_chats = !chat_filter_is_impossible(filter_ast.chat_filter.as_deref())
        && properties_filter_can_apply_to(
            filter_ast.properties_filter.as_deref(),
            &[PropertyEntityType::Chat],
        );
    let include_projects = !project_filter_is_impossible(filter_ast.project_filter.as_deref())
        && properties_filter_can_apply_to(
            filter_ast.properties_filter.as_deref(),
            &[PropertyEntityType::Project],
        );

    push_accessible_items_cte(
        &mut builder,
        include_documents,
        include_chats,
        include_projects,
    );

    // TopItems CTE: lightweight id + sort_ts with filters, cursor, and limit
    builder.push("TopItems AS (");
    builder.push("SELECT all_items.item_type, all_items.id, all_items.sort_ts FROM (");

    let mut needs_separator = false;

    if include_documents {
        push_union_separator(&mut builder, &mut needs_separator);
        // Document top clause (lightweight)
        builder.push(DOCUMENT_TOP_CLAUSE);
        if document_filter_needs_task_property_joins(filter_ast.document_filter.as_deref()) {
            builder.push(DOCUMENT_TASK_PROPERTY_JOINS);
        }
        builder.push(DOCUMENT_TOP_WHERE_CLAUSE);
        builder.push(build_document_filter(filter_ast.document_filter.as_deref()));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "d.id",
        ));
    }

    if include_chats {
        push_union_separator(&mut builder, &mut needs_separator);
        // Chat top clause (lightweight)
        builder.push(CHAT_TOP_CLAUSE);
        builder.push(build_chat_filter(filter_ast.chat_filter.as_deref()));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "c.id",
        ));
    }

    if include_projects {
        push_union_separator(&mut builder, &mut needs_separator);
        // Project top clause (lightweight)
        builder.push(PROJECT_TOP_CLAUSE);
        builder.push(build_project_filter(filter_ast.project_filter.as_deref()));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "p.id",
        ));
    }

    if !needs_separator {
        builder.push(
            "SELECT 'document'::text as item_type, NULL::text as id, NULL::timestamptz as sort_ts WHERE false",
        );
    }

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

    // Combined CTE: full detail joins back from TopItems. Keep this in sync
    // with the TopItems branches so task-only/property-specific filters do not
    // pay planning/execution cost for impossible entity types.
    builder.push("Combined AS (");

    let mut needs_separator = false;
    if include_documents {
        push_union_separator(&mut builder, &mut needs_separator);
        builder.push(DOCUMENT_DETAIL_CLAUSE);
    }
    if include_chats {
        push_union_separator(&mut builder, &mut needs_separator);
        builder.push(CHAT_DETAIL_CLAUSE);
    }
    if include_projects {
        push_union_separator(&mut builder, &mut needs_separator);
        builder.push(PROJECT_DETAIL_CLAUSE);
    }
    if !needs_separator {
        builder.push(
            r#"SELECT
                'document' as "item_type",
                NULL::text as "id",
                NULL::text as "document_version_id",
                NULL::text as "user_id",
                NULL::text as "name",
                NULL::text as "branched_from_id",
                NULL::bigint as "branched_from_version_id",
                NULL::bigint as "document_family_id",
                NULL::text as "file_type",
                NULL::timestamptz as "created_at",
                NULL::timestamptz as "updated_at",
                NULL::text as "project_id",
                NULL::boolean as "is_persistent",
                NULL::text as "sha",
                NULL::document_sub_type_value as "sub_type",
                NULL::timestamptz as "viewed_at",
                NULL::timestamptz as "sort_ts",
                NULL::boolean as "is_completed",
                NULL::timestamptz as "deleted_at"
            WHERE false"#,
        );
    }

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

// ============================================================================
// Grouped Query Support
// ============================================================================

/// Arguments for grouped dynamic cursor soup queries.
#[derive(Debug)]
pub struct GroupedDynamicCursorArgs<'a> {
    /// The user for which we are performing the query
    pub user_id: MacroUserIdStr<'a>,
    /// The limit of items we can return
    pub limit: u16,
    /// The Query that we are attempting to perform
    pub cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    /// Whether or not the query should explicitly remove items that DO have frecency records
    pub exclude_frecency: bool,
    /// Grouping configuration
    pub grouping: GroupingConfig,
}

/// Group metadata fields extracted from grouped query rows.
struct GroupFields {
    group_key: String,
    group_total_count: i64,
    row_in_group: i64,
}

impl GroupFields {
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        Ok(GroupFields {
            group_key: row.try_get("group_key")?,
            group_total_count: row.try_get("group_total_count")?,
            row_in_group: row.try_get("row_in_group")?,
        })
    }
}

/// Grouped row: reuses SoupRow for item data, adds group metadata.
struct GroupedSoupRow {
    item: SoupRow,
    group: GroupFields,
}

impl<'a> FromRow<'a, PgRow> for GroupedSoupRow {
    fn from_row(row: &'a PgRow) -> Result<Self, sqlx::Error> {
        Ok(GroupedSoupRow {
            item: SoupRow::from_row(row)?,
            group: GroupFields::from_row(row)?,
        })
    }
}

/// Per-group limit for initial grouped queries.
/// Each group will return at most this many items initially.
const PER_GROUP_LIMIT: i32 = 10;

/// Build the GroupedItems CTE based on the grouping configuration.
/// Returns the entity_type value to bind at $10, if property grouping with entity_type filter.
fn build_grouped_items_cte(
    builder: &mut QueryBuilder<'_, Postgres>,
    grouping: &GroupingConfig,
) -> Option<String> {
    let select_expr = group_select_expr(&grouping.field);

    builder.push("GroupedItems AS (SELECT t.*, (");
    builder.push(&select_expr);
    builder.push(") as group_key, COUNT(*) OVER (PARTITION BY ");
    builder.push(&select_expr);
    builder.push(") as group_total_count, ROW_NUMBER() OVER (PARTITION BY ");
    builder.push(&select_expr);
    builder.push(" ORDER BY t.sort_ts DESC, t.id DESC) as row_in_group FROM TopItems t ");

    let entity_type_bind = if let Some(GroupJoinClause {
        sql,
        entity_type_bind,
    }) = group_join_clause(&grouping.field)
    {
        builder.push(&sql);
        builder.push(" ");
        entity_type_bind
    } else {
        None
    };

    if grouping.group_key.is_some() {
        // Single group mode: fetch items for a specific group (for "load more")
        // Uses $9 parameter for group_key to prevent SQL injection
        builder.push("WHERE (");
        builder.push(&select_expr);
        builder.push(") = $9 ");
    }

    builder.push("), ");

    // FilteredGroupedItems: apply per-group limit when not fetching a specific group
    if grouping.group_key.is_none() {
        builder.push("FilteredGroupedItems AS (SELECT * FROM GroupedItems WHERE row_in_group <= ");
        builder.push(PER_GROUP_LIMIT.to_string());
        builder.push("), ");
    }

    entity_type_bind
}

/// Build the grouped query with grouping CTE.
/// Returns (QueryBuilder, entity_type_bind) where entity_type_bind is Some when
/// property grouping with entity_type filter is used (bind at $10).
fn build_grouped_query<'a>(
    filter_ast: &'a EntityFilterAst,
    exclude_frecency: bool,
    grouping: &'a GroupingConfig,
) -> (QueryBuilder<'a, Postgres>, Option<String>) {
    let mut builder = sqlx::QueryBuilder::new(PREFIX);

    // Determine which entity types to include based on filters (same logic as build_query)
    let include_documents = !document_filter_is_impossible(filter_ast.document_filter.as_deref())
        && properties_filter_can_apply_to(
            filter_ast.properties_filter.as_deref(),
            &[PropertyEntityType::Document, PropertyEntityType::Task],
        );
    let include_chats = !chat_filter_is_impossible(filter_ast.chat_filter.as_deref())
        && properties_filter_can_apply_to(
            filter_ast.properties_filter.as_deref(),
            &[PropertyEntityType::Chat],
        );
    let include_projects = !project_filter_is_impossible(filter_ast.project_filter.as_deref())
        && properties_filter_can_apply_to(
            filter_ast.properties_filter.as_deref(),
            &[PropertyEntityType::Project],
        );

    push_accessible_items_cte(
        &mut builder,
        include_documents,
        include_chats,
        include_projects,
    );

    // TopItems CTE: lightweight id + sort_ts + project_id with filters, cursor, and limit
    builder.push("TopItems AS (");
    builder.push(
        "SELECT all_items.item_type, all_items.id, all_items.sort_ts, all_items.project_id FROM (",
    );

    let mut needs_separator = false;

    if include_documents {
        push_union_separator(&mut builder, &mut needs_separator);
        builder.push(GROUPED_DOCUMENT_TOP_CLAUSE);
        if document_filter_needs_task_property_joins(filter_ast.document_filter.as_deref()) {
            builder.push(DOCUMENT_TASK_PROPERTY_JOINS);
        }
        builder.push(DOCUMENT_TOP_WHERE_CLAUSE);
        builder.push(build_document_filter(filter_ast.document_filter.as_deref()));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "d.id",
        ));
    }

    if include_chats {
        push_union_separator(&mut builder, &mut needs_separator);
        builder.push(GROUPED_CHAT_TOP_CLAUSE);
        builder.push(build_chat_filter(filter_ast.chat_filter.as_deref()));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "c.id",
        ));
    }

    if include_projects {
        push_union_separator(&mut builder, &mut needs_separator);
        builder.push(GROUPED_PROJECT_TOP_CLAUSE);
        builder.push(build_project_filter(filter_ast.project_filter.as_deref()));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "p.id",
        ));
    }

    // Fallback when all entity types are filtered out
    if !needs_separator {
        builder.push(
            "SELECT 'document'::text as item_type, NULL::text as id, NULL::timestamptz as sort_ts, NULL::text as project_id WHERE false",
        );
    }

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

    // Note: we don't limit TopItems here for grouped queries - limit is applied at the end
    builder.push(" ORDER BY all_items.sort_ts DESC, all_items.id DESC");
    builder.push("), ");

    // GroupedItems CTE: adds group metadata (and FilteredGroupedItems if not single-group mode)
    let entity_type_bind = build_grouped_items_cte(&mut builder, grouping);

    // Combined CTE: full detail joins from GroupedItems (or FilteredGroupedItems)
    // When fetching a specific group, use GroupedItems directly; otherwise use FilteredGroupedItems
    let source_table = if grouping.group_key.is_some() {
        "GroupedItems"
    } else {
        "FilteredGroupedItems"
    };

    builder.push("Combined AS (");

    let mut combined_needs_separator = false;
    if include_documents {
        push_union_separator(&mut builder, &mut combined_needs_separator);
        builder.push(
            GROUPED_DOCUMENT_DETAIL_CLAUSE
                .replace("GroupedItems gi", &format!("{} gi", source_table)),
        );
    }
    if include_chats {
        push_union_separator(&mut builder, &mut combined_needs_separator);
        builder.push(
            GROUPED_CHAT_DETAIL_CLAUSE.replace("GroupedItems gi", &format!("{} gi", source_table)),
        );
    }
    if include_projects {
        push_union_separator(&mut builder, &mut combined_needs_separator);
        builder.push(
            GROUPED_PROJECT_DETAIL_CLAUSE
                .replace("GroupedItems gi", &format!("{} gi", source_table)),
        );
    }
    if !combined_needs_separator {
        builder.push(GROUPED_EMPTY_COMBINED_CLAUSE);
    }
    builder.push(") ");

    // Final SELECT with group-aware ordering
    builder.push("SELECT * FROM Combined ORDER BY ");

    match &grouping.field {
        GroupByField::Date => {
            builder.push(date_bucket_sql_order("sort_ts"));
        }
        _ => {
            builder.push("\"group_key\"");
        }
    }
    builder.push(", \"sort_ts\" DESC, \"id\" DESC LIMIT $3");

    (builder, entity_type_bind)
}

/// Execute a grouped dynamic cursor soup query.
#[tracing::instrument(skip(db), err)]
pub async fn expanded_dynamic_cursor_soup_grouped(
    db: &PgPool,
    args: GroupedDynamicCursorArgs<'_>,
) -> Result<Vec<GroupedSoupItem>, sqlx::Error> {
    let GroupedDynamicCursorArgs {
        user_id,
        limit,
        cursor,
        exclude_frecency,
        grouping,
    } = args;

    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();
    let cursor_id_str = cursor_id.as_ref().map(|u| u.to_string());
    let status_property_id = SystemPropertyKey::STATUS_UUID;
    let assignees_property_id = SystemPropertyKey::ASSIGNEES_UUID;
    let completed_option_id = StatusOption::COMPLETED_UUID.to_string();

    let (mut query_builder, entity_type_bind) =
        build_grouped_query(cursor.filter(), exclude_frecency, &grouping);

    let mut query = query_builder
        .build()
        .bind(user_id.as_ref())
        .bind(sort_method_str)
        .bind(query_limit)
        .bind(cursor_timestamp)
        .bind(cursor_id_str)
        .bind(completed_option_id)
        .bind(status_property_id)
        .bind(assignees_property_id);

    // Bind group_key as $9 when filtering by specific group
    if let Some(ref key) = grouping.group_key {
        query = query.bind(key.clone());
    }

    // Bind entity_type as $10 when property grouping with entity_type filter
    if let Some(ref et) = entity_type_bind {
        query = query.bind(et.clone());
    }

    let rows: Vec<GroupedSoupRow> = query
        .try_map(|row| GroupedSoupRow::from_row(&row))
        .fetch_all(db)
        .await?;

    // Convert rows to (SoupItem, GroupFields) pairs and unzip
    let (mut soup_items, groups): (Vec<SoupItem>, Vec<GroupFields>) = rows
        .into_iter()
        .map(|row| {
            let item = row.item.into_soup_item()?;
            Ok((item, row.group))
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?
        .into_iter()
        .unzip();

    populate_properties(db, &mut soup_items).await?;

    let items = soup_items
        .into_iter()
        .zip(groups)
        .map(|(item, group)| GroupedSoupItem {
            item,
            frecency_score: None,
            group_key: group.group_key,
            group_total_count: group.group_total_count as u32,
            row_in_group: group.row_in_group as u32,
            group_label: None,
            group_display_order: None,
        })
        .collect();

    Ok(items)
}
