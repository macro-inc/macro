//! This module exposes a expanded dynamic query builder which is able to build specific soup queries
//! which filter out content basd on some input ast

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst, chat::ChatLiteral, document::DocumentLiteral, project::ProjectLiteral,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{chat::SoupChat, document::SoupDocument, item::SoupItem, project::SoupProject};
use recursion::CollapsibleExt;
use sqlx::{PgPool, Postgres, QueryBuilder, Row, postgres::PgRow, prelude::FromRow};

static PREFIX: &str = r#"
    WITH RECURSIVE ProjectHierarchy AS (
        SELECT p.id, uia.access_level 
        FROM "Project" p
        JOIN "UserItemAccess" uia ON p.id = uia.item_id AND uia.item_type = 'project'
        WHERE uia.user_id = $1 AND p."deletedAt" IS NULL
        UNION ALL
        SELECT p.id, ph.access_level
        FROM "Project" p 
        JOIN ProjectHierarchy ph ON p."parentId" = ph.id
        WHERE p."deletedAt" IS NULL
    ),
    AllAccessGrants AS (
        SELECT item_id, item_type, access_level 
        FROM "UserItemAccess" 
        WHERE user_id = $1
        UNION ALL
        SELECT d.id AS item_id, 'document' AS item_type, ph.access_level
        FROM "Document" d 
        JOIN ProjectHierarchy ph ON d."projectId" = ph.id
        WHERE d."projectId" IS NOT NULL AND d."deletedAt" IS NULL
        UNION ALL
        SELECT c.id AS item_id, 'chat' AS item_type, ph.access_level
        FROM "Chat" c 
        JOIN ProjectHierarchy ph ON c."projectId" = ph.id
        WHERE c."projectId" IS NOT NULL AND c."deletedAt" IS NULL
        UNION ALL
        SELECT ph.id AS item_id, 'project' AS item_type, ph.access_level 
        FROM ProjectHierarchy ph
    ),
    UserAccessibleItems AS (
        SELECT DISTINCT ON (item_id, item_type) item_id, item_type
        FROM AllAccessGrants
        ORDER BY item_id, item_type, 
            CASE access_level
                WHEN 'owner' THEN 4
                WHEN 'edit' THEN 3 
                WHEN 'comment' THEN 2
                WHEN 'view' THEN 1
                ELSE 0
            END DESC
    ),
"#;

static DOCUMENT_CLAUSE: &str = r#"
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
        uh."updatedAt"::timestamptz as "viewed_at",
        CASE $2
            WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", d."updatedAt")
            WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
            WHEN 'created_at' THEN d."createdAt"
            ELSE d."updatedAt"
        END::timestamptz as "sort_ts"
    FROM "Document" d
    INNER JOIN UserAccessibleItems uai ON uai.item_id = d.id AND uai.item_type = 'document'
    -- This MUST be a LEFT JOIN to support all three sort methods
    LEFT JOIN "UserHistory" uh ON uh."itemId" = d.id AND uh."itemType" = 'document' AND uh."userId" = $1
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
    WHERE d."deletedAt" IS NULL
"#;

static CHAT_CLAUSE: &str = r#"
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
        uh."updatedAt"::timestamptz as "viewed_at",
        CASE $2
            WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", c."updatedAt")
            WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
            WHEN 'created_at' THEN c."createdAt"
            ELSE c."updatedAt"
        END::timestamptz as "sort_ts"
    FROM "Chat" c
    INNER JOIN UserAccessibleItems uai ON uai.item_id = c.id AND uai.item_type = 'chat'
    LEFT JOIN "UserHistory" uh ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
    WHERE c."deletedAt" IS NULL
"#;

static PROJECT_CLAUSE: &str = r#"
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
        uh."updatedAt"::timestamptz as "viewed_at",
        CASE $2
            WHEN 'viewed_updated' THEN COALESCE(uh."updatedAt", p."updatedAt")
            WHEN 'viewed_at' THEN COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')
            WHEN 'created_at'  THEN p."createdAt"
            ELSE p."updatedAt"
        END::timestamptz as "sort_ts"
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

static SUFFIX: &str = r#"
    SELECT * FROM Combined
    WHERE
        ($4::timestamptz IS NULL)
        OR
        ("sort_ts", "id") < ($4, $5)
    ORDER BY "sort_ts" DESC, "updated_at" DESC
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
            format!(r#"d."fileType" = '{f}'"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Id(i)) => format!("d.id = '{i}'"),
        filter_ast::ExprFrame::Literal(DocumentLiteral::ProjectId(p)) => {
            format!(r#"d."projectId" = '{p}'"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Owner(o)) => format!("d.owner = '{o}'"),
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
        filter_ast::ExprFrame::Literal(ChatLiteral::Owner(o)) => format!("c.owner = '{o}'"),
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
            format!("p.id = '{p}'")
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::Owner(o)) => format!("p.owner = '{o}'"),
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

fn build_query(filter_ast: &EntityFilterAst) -> QueryBuilder<'_, Postgres> {
    let mut builder = sqlx::QueryBuilder::new(PREFIX);
    builder.push("Combined AS (");

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
            }) => SoupItem::Document(SoupDocument {
                id,
                document_version_id: document_version_id
                    .parse()
                    .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
                owner_id: user_id,
                name,
                file_type,
                sha,
                project_id,
                branched_from_id,
                branched_from_version_id,
                document_family_id,
                created_at,
                updated_at,
                viewed_at,
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
            }) => SoupItem::Chat(SoupChat {
                id,
                name,
                owner_id: user_id,
                project_id,
                is_persistent,
                created_at,
                updated_at,
                viewed_at,
            }),
            SoupRow::Project(ProjectRow {
                id,
                user_id,
                name,
                project_id,
                created_at,
                updated_at,
                viewed_at,
            }) => SoupItem::Project(SoupProject {
                id,
                name,
                owner_id: user_id,
                parent_id: project_id,
                created_at,
                updated_at,
                viewed_at,
            }),
        })
    }
}

#[tracing::instrument(skip(db, limit))]
pub async fn expanded_dynamic_cursor_soup(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<String, SimpleSortMethod, EntityFilterAst>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();

    build_query(cursor.filter())
        .build()
        .bind(user_id.as_ref())
        .bind(sort_method_str)
        .bind(query_limit)
        .bind(cursor_timestamp)
        .bind(cursor_id)
        .try_map(|row| SoupRow::from_row(&row)?.into_soup_item())
        .fetch_all(db)
        .await
}
