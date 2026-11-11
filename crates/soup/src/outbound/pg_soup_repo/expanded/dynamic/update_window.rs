//! A bounded shortcut for the unfiltered document, chat, and project arms of
//! the flat `TopItems` query under the `UpdatedAt` and `ViewedUpdated` sorts.
//!
//! The full arm computes a sort key for every accessible item before the top-N
//! sort, so a caller holding tens of thousands of grants reads the whole item
//! table on every page. The shortcut instead reads the `WINDOW_PAGES * limit`
//! most recently updated rows past the cursor from the `("updatedAt", id)`
//! index and keeps the accessible ones the caller has not viewed. Viewed items
//! sort by their view time, so they come from the caller's `UserHistory` rows.
//!
//! The shortcut is exact when it yields a full page of unviewed items or when
//! the window holds every row past the cursor: any unviewed item outside the
//! window was updated before every item in it. Otherwise the full arm runs.
//!
//! Only arms whose type the caller holds at least `MIN_GRANTS` grants of get
//! the shortcut. Smaller callers keep the full arm alone, which is cheap for
//! them and which a missed window would otherwise add to.

use item_filters::ast::EntityFilterAst;
use models_pagination::SimpleSortMethod;
use sqlx::PgConnection;

use crate::domain::models::DynamicSort;

#[cfg(test)]
mod test;

const MIN_GRANTS: i64 = 10_000;
const WINDOW_PAGES: usize = 100;

/// The document, chat, and project arms that take the shortcut.
#[derive(Clone, Copy, Debug, Default)]
pub(in crate::outbound::pg_soup_repo) struct WindowedArms {
    pub document: bool,
    pub chat: bool,
    pub project: bool,
}

impl WindowedArms {
    /// The arms whose query shape the shortcut reproduces: a timestamp sort
    /// keyed on `"updatedAt"` and no filter on the arm.
    pub(super) fn eligible(filter_ast: &EntityFilterAst, sort: DynamicSort) -> Self {
        let sortable = matches!(
            sort,
            DynamicSort::Timestamp(SimpleSortMethod::UpdatedAt | SimpleSortMethod::ViewedUpdated)
        ) && filter_ast.properties_filter.is_none();
        Self {
            document: sortable && filter_ast.document_filter.is_none(),
            chat: sortable && filter_ast.chat_filter.is_none(),
            project: sortable && filter_ast.project_filter.is_none(),
        }
    }

    /// Keeps the arms whose type the caller holds at least `MIN_GRANTS`
    /// grants of.
    pub(super) async fn with_many_grants(
        self,
        connection: &mut PgConnection,
        source_ids: &[String],
    ) -> Result<Self, sqlx::Error> {
        if !(self.document || self.chat || self.project) {
            return Ok(self);
        }
        let counts = sqlx::query!(
            r#"
            SELECT
                (SELECT count(*) FROM (
                    SELECT 1 FROM entity_access ea
                    WHERE ea.source_id = ANY($1) AND ea.entity_type = 'document' LIMIT $2
                ) grants) = $2 AS "document!",
                (SELECT count(*) FROM (
                    SELECT 1 FROM entity_access ea
                    WHERE ea.source_id = ANY($1) AND ea.entity_type = 'chat' LIMIT $2
                ) grants) = $2 AS "chat!",
                (SELECT count(*) FROM (
                    SELECT 1 FROM entity_access ea
                    WHERE ea.source_id = ANY($1) AND ea.entity_type = 'project' LIMIT $2
                ) grants) = $2 AS "project!"
            "#,
            source_ids,
            MIN_GRANTS,
        )
        .fetch_one(connection)
        .await?;
        Ok(Self {
            document: self.document && counts.document,
            chat: self.chat && counts.chat,
            project: self.project && counts.project,
        })
    }
}

#[derive(Clone, Copy)]
pub(super) enum WindowedArm {
    Document,
    Chat,
    Project,
}

impl WindowedArm {
    fn item_type(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Chat => "chat",
            Self::Project => "project",
        }
    }

    fn table(self) -> &'static str {
        match self {
            Self::Document => r#""Document""#,
            Self::Chat => r#""Chat""#,
            Self::Project => r#""Project""#,
        }
    }
}

/// The CTEs behind [`shortcut_rows`] and [`fallback_guard`], pushed before
/// `TopItems`. `source_ids` is the bind slot of the caller's source-id array.
pub(super) fn ctes(
    arm: WindowedArm,
    sort: SimpleSortMethod,
    exclude_frecency: bool,
    source_ids: usize,
) -> String {
    let item_type = arm.item_type();
    let table = arm.table();
    let not_frecent = |id: &str| {
        if exclude_frecency {
            format!(
                "AND NOT EXISTS (SELECT 1 FROM frecency_aggregates fa WHERE fa.user_id = $1 AND fa.entity_type = '{item_type}' AND fa.entity_id = {id})"
            )
        } else {
            String::new()
        }
    };
    let recent_not_frecent = not_frecent("w.id");
    let viewed = matches!(sort, SimpleSortMethod::ViewedUpdated);
    let not_viewed = if viewed {
        format!(
            r#"AND NOT EXISTS (SELECT 1 FROM "UserHistory" uh WHERE uh."userId" = $1 AND uh."itemType" = '{item_type}' AND uh."itemId" = w.id)"#
        )
    } else {
        String::new()
    };
    // `OFFSET 0` keeps each access check inside its subquery, so Postgres
    // filters the window or history rows by the hashed grants instead of
    // driving the join from every grant.
    let mut sql = format!(
        r#"{item_type}_access AS MATERIALIZED (
    SELECT ea.entity_id::text AS id
    FROM entity_access ea
    WHERE ea.source_id = ANY(${source_ids}::text[]) AND ea.entity_type = '{item_type}'
),
{item_type}_window AS MATERIALIZED (
    SELECT x.id, x."updatedAt"
    FROM {table} x
    WHERE $4::timestamptz IS NULL OR (x."updatedAt", x.id) < ($4::timestamp, $5)
    ORDER BY x."updatedAt" DESC, x.id DESC
    LIMIT $3 * {WINDOW_PAGES}
),
{item_type}_recent AS (
    SELECT w.id, w."updatedAt"::timestamptz AS sort_ts
    FROM (
        SELECT w.id, w."updatedAt" FROM {item_type}_window w
        WHERE w.id IN (SELECT id FROM {item_type}_access)
        OFFSET 0
    ) w
    JOIN {table} x ON x.id = w.id
    WHERE x."deletedAt" IS NULL
        {not_viewed}
        {recent_not_frecent}
    ORDER BY w."updatedAt" DESC, w.id DESC
    LIMIT $3
),
"#
    );
    if viewed {
        let viewed_not_frecent = not_frecent("uh.\"itemId\"");
        sql.push_str(&format!(
            r#"{item_type}_viewed AS (
    SELECT uh."itemId" AS id, uh."updatedAt"::timestamptz AS sort_ts
    FROM (
        SELECT uh."itemId", uh."updatedAt" FROM "UserHistory" uh
        WHERE uh."userId" = $1 AND uh."itemType" = '{item_type}'
            AND ($4::timestamptz IS NULL OR (uh."updatedAt"::timestamptz, uh."itemId") < ($4, $5))
            AND uh."itemId" IN (SELECT id FROM {item_type}_access)
        OFFSET 0
    ) uh
    JOIN {table} x ON x.id = uh."itemId"
    WHERE x."deletedAt" IS NULL
        {viewed_not_frecent}
    ORDER BY uh."updatedAt" DESC, uh."itemId" DESC
    LIMIT $3
),
"#
        ));
    }
    // `CASE` counts the window only when the page came up short.
    sql.push_str(&format!(
        r#"{item_type}_exact AS (
    SELECT CASE
        WHEN (SELECT count(*) FROM {item_type}_recent) = $3 THEN true
        ELSE (SELECT count(*) FROM {item_type}_window) < $3 * {WINDOW_PAGES}
    END AS exact
),
"#
    ));
    sql
}

/// The shortcut's rows, followed by `UNION ALL` and the full arm.
pub(super) fn shortcut_rows(arm: WindowedArm, sort: SimpleSortMethod) -> String {
    let item_type = arm.item_type();
    let mut sql = format!(
        "SELECT '{item_type}'::text as item_type, id, sort_ts FROM {item_type}_recent WHERE (SELECT exact FROM {item_type}_exact)\nUNION ALL\n"
    );
    if matches!(sort, SimpleSortMethod::ViewedUpdated) {
        sql.push_str(&format!(
            "SELECT '{item_type}'::text as item_type, id, sort_ts FROM {item_type}_viewed WHERE (SELECT exact FROM {item_type}_exact)\nUNION ALL\n"
        ));
    }
    sql
}

/// Appended to the full arm's `WHERE` so it runs only when the shortcut is
/// inexact.
pub(super) fn fallback_guard(arm: WindowedArm) -> String {
    format!(" AND NOT (SELECT exact FROM {}_exact)", arm.item_type())
}
