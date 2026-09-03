//! This module exposes a expanded dynamic query builder which is able to build specific soup queries
//! which filter out content basd on some input ast

use std::str::FromStr;

use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst,
    calendar_event::CalendarEventLiteral,
    chat::ChatLiteral,
    date::DateLiteral,
    document::DocumentLiteral,
    project::ProjectLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{
    calendar_event::SoupCalendarEvent,
    chat::SoupChat,
    document::{SoupDocument, SoupDocumentSubType},
    item::SoupItem,
    project::SoupProject,
};
use recursion::CollapsibleExt;
use sqlx::{PgPool, Postgres, QueryBuilder, Row, postgres::PgRow, prelude::FromRow};
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::Uuid;

use crate::domain::models::{
    SoupDocumentServerFacts, SoupProjectionHydration, grouping::ItemGroupingInfo,
};
use crate::outbound::pg_soup_repo::grouping::{
    GroupJoinClause, group_join_clause, group_select_expr,
};
use crate::outbound::pg_soup_repo::type_err;
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
                    d."projectId"::text as project_id,
                    CASE
                        WHEN dt.sub_type = 'task' THEN 'TASK'::property_entity_type
                        ELSE 'DOCUMENT'::property_entity_type
                    END as property_entity_type
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
                    c."projectId"::text as project_id,
                    'CHAT'::property_entity_type as property_entity_type
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
                    p."parentId"::text as project_id,
                    'PROJECT'::property_entity_type as property_entity_type
                FROM AccessibleItems ai
                INNER JOIN "Project" p ON p.id = ai.item_id AND ai.item_type = 'project'
                LEFT JOIN "UserHistory" uh
                    ON uh."itemId" = p.id
                    AND uh."itemType" = 'project'
                    AND uh."userId" = $1
                WHERE p."deletedAt" IS NULL
"#;

static GROUPED_CALENDAR_EVENT_TOP_CLAUSE: &str = r#"
                SELECT
                    'calendar_event'::text as item_type,
                    event.id::text as id,
                    CASE $2
                        WHEN 'created_at' THEN event.created_at
                        WHEN 'viewed_at' THEN '1970-01-01 00:00:00+00'::timestamptz
                        ELSE GREATEST(event.updated_at, event.last_reminder_fired_at)
                    END::timestamptz as sort_ts,
                    NULL::text as project_id,
                    'CALENDAR_EVENT'::property_entity_type as property_entity_type
                FROM calendar_events event
                WHERE (
                      event.owner_id = $1
                      OR EXISTS (
                          SELECT 1
                          FROM macro_user_links link
                          WHERE link.link_id = event.source_link_id
                            AND link.primary_macro_id = $1
                      )
                  )
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
            EXISTS (
                SELECT 1
                FROM document_email de
                WHERE de.document_id = d.id
            ) as "is_email_attachment",
            (
                dt.sub_type IS DISTINCT FROM 'task'
                OR EXISTS (
                    SELECT 1
                    FROM entity_properties ep_assignees_projection
                    WHERE ep_assignees_projection.entity_id = d.id
                        AND ep_assignees_projection.entity_type = 'TASK'
                        AND ep_assignees_projection.property_definition_id = $8
                        AND ep_assignees_projection.values->'value' @> jsonb_build_array(
                            jsonb_build_object('entity_id', $1)
                        )
                )
            ) as "is_important",
            ARRAY(
                SELECT status_option_id::uuid
                FROM jsonb_array_elements_text(
                    CASE
                        WHEN jsonb_typeof(ep_status.values->'value') = 'array'
                        THEN ep_status.values->'value'
                        ELSE '[]'::jsonb
                    END
                ) AS status_option_id
            ) as "status_option_ids",
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
            false as "is_email_attachment",
            true as "is_important",
            ARRAY[]::uuid[] as "status_option_ids",
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
            false as "is_email_attachment",
            true as "is_important",
            ARRAY[]::uuid[] as "status_option_ids",
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
            NULL::boolean as "is_persistent",
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
            NULL::jsonb as "calendar_event",
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
            NULL::text as "document_version_id",
            c."userId" as "user_id",
            c.name as "name",
            NULL::text as "branched_from_id",
            NULL::bigint as "branched_from_version_id",
            NULL::bigint as "document_family_id",
            NULL::text as "file_type",
            c."createdAt"::timestamptz as "created_at",
            c."updatedAt"::timestamptz as "updated_at",
            c."projectId" as "project_id",
            c."isPersistent" as "is_persistent",
            NULL::text as "sha",
            NULL::document_sub_type_value as "sub_type",
            uh."updatedAt"::timestamptz as "viewed_at",
            gi.sort_ts as "sort_ts",
            NULL::boolean as "is_completed",
            c."deletedAt"::timestamptz as "deleted_at",
            NULL::jsonb as "calendar_event",
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
            NULL::text as "document_version_id",
            p."userId" as "user_id",
            p.name as "name",
            NULL::text as "branched_from_id",
            NULL::bigint as "branched_from_version_id",
            NULL::bigint as "document_family_id",
            NULL::text as "file_type",
            p."createdAt"::timestamptz as "created_at",
            p."updatedAt"::timestamptz as "updated_at",
            p."parentId" as "project_id",
            NULL::boolean as "is_persistent",
            NULL::text as "sha",
            NULL::document_sub_type_value as "sub_type",
            uh."updatedAt"::timestamptz as "viewed_at",
            gi.sort_ts as "sort_ts",
            NULL::boolean as "is_completed",
            p."deletedAt"::timestamptz as "deleted_at",
            NULL::jsonb as "calendar_event",
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

static GROUPED_CALENDAR_EVENT_DETAIL_CLAUSE: &str = r#"
        SELECT
            'calendar_event' as "item_type",
            event.id::text as "id",
            NULL::text as "document_version_id",
            event.owner_id as "user_id",
            event.title as "name",
            NULL::text as "branched_from_id",
            NULL::bigint as "branched_from_version_id",
            NULL::bigint as "document_family_id",
            NULL::text as "file_type",
            event.created_at as "created_at",
            event.updated_at as "updated_at",
            NULL::text as "project_id",
            NULL::boolean as "is_persistent",
            NULL::text as "sha",
            NULL::document_sub_type_value as "sub_type",
            NULL::timestamptz as "viewed_at",
            gi.sort_ts as "sort_ts",
            NULL::boolean as "is_completed",
            NULL::timestamptz as "deleted_at",
            jsonb_build_object(
                'id', event.id,
                'ownerId', event.owner_id,
                'icalUid', event.ical_uid,
                'title', event.title,
                'description', event.description,
                'location', event.location,
                'status', event.status,
                'visibility', event.visibility,
                'transparency', event.transparency,
                'time', CASE
                    WHEN event.starts_at IS NOT NULL THEN jsonb_build_object(
                        'kind', 'timed',
                        'startsAt', event.starts_at,
                        'endsAt', event.ends_at,
                        'timeZone', event.time_zone
                    )
                    ELSE jsonb_build_object(
                        'kind', 'allDay',
                        'startDate', event.start_date,
                        'endDate', event.end_date
                    )
                END,
                'organizerEmail', event.organizer_email,
                'organizerName', event.organizer_name,
                'conferenceUrl', event.conference_url,
                'conferenceProvider', event.conference_provider,
                'isReadOnly', event.is_read_only,
                'createdAt', event.created_at,
                'updatedAt', event.updated_at,
                'lastReminderFiredAt', event.last_reminder_fired_at,
                'extra', NULL
            ) as "calendar_event",
            gi.group_key as "group_key",
            gi.group_total_count as "group_total_count",
            gi.row_in_group as "row_in_group"
        FROM GroupedItems gi
        INNER JOIN calendar_events event ON event.id::text = gi.id
        WHERE gi.item_type = 'calendar_event'
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
            NULL::jsonb as "calendar_event",
            NULL::text as "group_key",
            NULL::bigint as "group_total_count",
            NULL::bigint as "row_in_group"
        WHERE false
"#;

pub(in crate::outbound::pg_soup_repo) fn build_notification_exists_clause(
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

pub(in crate::outbound::pg_soup_repo) fn build_notification_done_clause(
    entity_id_sql: &str,
    entity_type: &str,
    done: bool,
) -> String {
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

pub(in crate::outbound::pg_soup_repo) fn build_notification_seen_clause(
    entity_id_sql: &str,
    entity_type: &str,
    seen: bool,
) -> String {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::outbound::pg_soup_repo) enum NotificationPredicate {
    Done(bool),
    Seen(bool),
}

impl NotificationPredicate {
    pub(in crate::outbound::pg_soup_repo) fn sql(self) -> &'static str {
        match self {
            NotificationPredicate::Done(true) => "un.done = true",
            NotificationPredicate::Done(false) => "un.done = false",
            NotificationPredicate::Seen(true) => "un.seen_at IS NOT NULL",
            NotificationPredicate::Seen(false) => "un.seen_at IS NULL",
        }
    }
}

fn expr_contains_notification<T>(
    expr: &Expr<T>,
    notification_predicate: impl Fn(&T) -> Option<NotificationPredicate> + Copy,
) -> bool {
    match expr {
        Expr::And(a, b) | Expr::Or(a, b) => {
            expr_contains_notification(a, notification_predicate)
                || expr_contains_notification(b, notification_predicate)
        }
        Expr::Not(a) => expr_contains_notification(a, notification_predicate),
        Expr::Literal(lit) => notification_predicate(lit).is_some(),
    }
}

fn clone_expr<T: Clone>(expr: &Expr<T>) -> Expr<T> {
    match expr {
        Expr::And(a, b) => Expr::and(clone_expr(a), clone_expr(b)),
        Expr::Or(a, b) => Expr::or(clone_expr(a), clone_expr(b)),
        Expr::Not(a) => Expr::is_not(clone_expr(a)),
        Expr::Literal(lit) => Expr::val(lit.clone()),
    }
}

/// Push NOT down to the literals (De Morgan), eliminating double negation.
/// Valid under SQL three-valued logic (De Morgan holds in Kleene logic), so
/// this never changes which rows match. The payoff is plan quality: Postgres
/// only turns *syntactically* top-level `NOT EXISTS (...)` conjuncts into
/// anti-joins — a `NOT (EXISTS a OR EXISTS b)` stays a per-row SubPlan
/// filter, which both costs more and wrecks the row estimates that
/// join-order choice depends on.
fn push_not_inward<T: Clone>(expr: &Expr<T>, negated: bool) -> Expr<T> {
    match expr {
        Expr::Not(inner) => push_not_inward(inner, !negated),
        Expr::And(a, b) => {
            let (a, b) = (push_not_inward(a, negated), push_not_inward(b, negated));
            if negated {
                Expr::or(a, b)
            } else {
                Expr::and(a, b)
            }
        }
        Expr::Or(a, b) => {
            let (a, b) = (push_not_inward(a, negated), push_not_inward(b, negated));
            if negated {
                Expr::and(a, b)
            } else {
                Expr::or(a, b)
            }
        }
        Expr::Literal(lit) => {
            let lit = Expr::val(lit.clone());
            if negated { Expr::is_not(lit) } else { lit }
        }
    }
}

fn strip_notification_conjunction<T: Clone>(
    expr: &Expr<T>,
    notification_predicate: impl Fn(&T) -> Option<NotificationPredicate> + Copy,
) -> Option<(NotificationPredicate, Option<Expr<T>>)> {
    match expr {
        Expr::Literal(lit) => notification_predicate(lit).map(|pred| (pred, None)),
        Expr::And(a, b) => {
            let left = strip_notification_conjunction(a, notification_predicate);
            let right = strip_notification_conjunction(b, notification_predicate);
            match (left, right) {
                (Some((left_pred, left_expr)), Some((right_pred, right_expr)))
                    if left_pred == right_pred =>
                {
                    let stripped = match (left_expr, right_expr) {
                        (Some(left), Some(right)) => Some(Expr::and(left, right)),
                        (Some(expr), None) | (None, Some(expr)) => Some(expr),
                        (None, None) => None,
                    };
                    Some((left_pred, stripped))
                }
                (Some((pred, left_expr)), None)
                    if !expr_contains_notification(b, notification_predicate) =>
                {
                    let right_expr = clone_expr(b);
                    Some((
                        pred,
                        Some(match left_expr {
                            Some(left_expr) => Expr::and(left_expr, right_expr),
                            None => right_expr,
                        }),
                    ))
                }
                (None, Some((pred, right_expr)))
                    if !expr_contains_notification(a, notification_predicate) =>
                {
                    let left_expr = clone_expr(a);
                    Some((
                        pred,
                        Some(match right_expr {
                            Some(right_expr) => Expr::and(left_expr, right_expr),
                            None => left_expr,
                        }),
                    ))
                }
                _ => None,
            }
        }
        Expr::Or(_, _) | Expr::Not(_) => None,
    }
}

fn build_notification_items_cte(
    builder: &mut QueryBuilder<'_, Postgres>,
    predicate: NotificationPredicate,
    item_types: &[&str],
) {
    if item_types.is_empty() {
        return;
    }
    let item_types = item_types
        .iter()
        .map(|item_type| format!("'{item_type}'"))
        .collect::<Vec<_>>()
        .join(", ");
    // NOT MATERIALIZED: the set is small (a user's active notifications) and
    // inlining it lets estimates flow into the arm joins, so the planner can
    // drive an arm from the notification side instead of nested-looping the
    // full accessible corpus against it (the materialized fence defaulted the
    // CTE estimate to ~1 row, which picked a join-filter nested loop that
    // compared every accessible item against every notification).
    builder.push(format!(
        r#"NotificationItems AS NOT MATERIALIZED (
        SELECT DISTINCT n.event_item_type, n.event_item_id
        FROM user_notification un
        JOIN notification n ON n.id = un.notification_id
        WHERE un.user_id = $1
          AND un.deleted_at IS NULL
          AND {}
          AND n.event_item_type IN ({item_types})
    ),
"#,
        predicate.sql()
    ));
}

fn build_notification_join(entity_alias: &str, item_type: &str) -> String {
    format!(
        r#"                INNER JOIN NotificationItems ni_{item_type}
                    ON ni_{item_type}.event_item_type = '{item_type}'
                    AND ni_{item_type}.event_item_id = {entity_alias}.id::text
"#
    )
}

fn build_task_include_cbm_atm_nc_clause() -> String {
    // The completed-status option id is interpolated (not `$6`-bound) so this
    // clause stays usable from queries with a different parameter layout —
    // the touched-by-me page reuses these folds with its own bind positions.
    format!(
        r#"(
        dt.sub_type = 'task'
        AND d.owner = $1
        AND ep_assignees.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', $1))
        AND NOT COALESCE(ep_status.values->'value' ? '{completed}', false)
    )"#,
        completed = StatusOption::COMPLETED_UUID
    )
}

/// NULL-safe equality for nullable columns: FALSE (not UNKNOWN) on NULL, so
/// `NOT` includes NULL rows — e.g. root projects under a negated `pid` filter.
fn nullable_eq(col: &str, val: impl std::fmt::Display) -> String {
    format!("({col} = '{val}' AND {col} IS NOT NULL)")
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

pub(in crate::outbound::pg_soup_repo) fn build_document_filter(
    ast: Option<&Expr<DocumentLiteral>>,
) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let expr = push_not_inward(expr, false);
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
        filter_ast::ExprFrame::Literal(DocumentLiteral::FileType(f)) => {
            format!(r#"d."fileType" = '{f}'"#)
        }
        filter_ast::ExprFrame::Literal(DocumentLiteral::Id(i)) => format!("d.id = '{i}'"),
        filter_ast::ExprFrame::Literal(DocumentLiteral::ProjectId(p)) => {
            nullable_eq(r#"d."projectId""#, p)
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
        // false is equivalent to disabled/no-op. Rendered as TRUE (not an
        // empty string): an empty operand inside And/Or/Not produces invalid
        // SQL like `( AND x)` or `(NOT )`, and TRUE also gives NOT the right
        // meaning (a disabled predicate matches everything, its negation
        // nothing).
        filter_ast::ExprFrame::Literal(DocumentLiteral::IncludeCbmAtmNc(false)) => {
            "TRUE".to_string()
        }
        // EXISTS instead of a predicate on the LEFT-JOINed `dt` alias: this
        // keeps the top clause free of the join when only SubType literals
        // are present, and `NOT (EXISTS ...)` becomes a plannable anti-join
        // (the old `(dt.sub_type IS NOT NULL AND ...)` OR-shape collapsed row
        // estimates to ~1 on broad arms, picking pathological nested loops).
        filter_ast::ExprFrame::Literal(DocumentLiteral::SubType(st)) => {
            format!(
                "EXISTS (SELECT 1 FROM document_sub_type dst_f WHERE dst_f.document_id = d.id AND dst_f.sub_type = '{st}')"
            )
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

/// A single-quoted SQL string literal with embedded quotes doubled. The
/// calendar filter inlines caller-supplied strings (statuses, attendee and
/// organizer emails), which unlike the ids the sibling builders inline are
/// not shaped by a parser first.
fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// Renders the calendar-event filter bind-free, like every other arm of the
/// hand-numbered grouped query: `push_bind` placeholders would start at `$1`
/// and collide with the positionally-bound user id. The notification clauses
/// reference `$1` as the requesting user, which both this query and
/// `cursor_soup` guarantee.
fn build_calendar_event_filter(ast: Option<&Expr<CalendarEventLiteral>>) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let expr = push_not_inward(expr, false);
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::Id(id)) => {
            format!("event.id = '{id}'")
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::Status(status)) => {
            format!("event.status = {}", sql_string_literal(&status))
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::StartsBefore(value)) => {
            format!(
                "COALESCE(event.starts_at, event.start_date::timestamp AT TIME ZONE 'UTC') < '{}'::timestamptz",
                value.to_rfc3339()
            )
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::EndsAfter(value)) => {
            format!(
                "COALESCE(event.ends_at, event.end_date::timestamp AT TIME ZONE 'UTC') > '{}'::timestamptz",
                value.to_rfc3339()
            )
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::Attendee(email)) => {
            format!(
                "EXISTS (SELECT 1 FROM calendar_event_attendees attendee \
                 WHERE attendee.event_id = event.id AND attendee.email = lower({}))",
                sql_string_literal(&email)
            )
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::Organizer(email)) => {
            format!(
                "lower(event.organizer_email) = lower({})",
                sql_string_literal(&email)
            )
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::NotificationDone(done)) => {
            build_notification_done_clause("event.id", "calendar_event", done)
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("event.id", "calendar_event", seen)
        }
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

pub(in crate::outbound::pg_soup_repo) fn build_chat_filter(
    ast: Option<&Expr<ChatLiteral>>,
) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let expr = push_not_inward(expr, false);
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
        filter_ast::ExprFrame::Literal(ChatLiteral::ProjectId(p)) => {
            nullable_eq(r#"c."projectId""#, p)
        }
        // todo? I'm not sure what a chat role filter looks like.
        // No-op literals render as TRUE, not an empty string — an empty
        // operand inside And/Or/Not produces invalid SQL like `( AND x)`.
        filter_ast::ExprFrame::Literal(ChatLiteral::Role(_r)) => "TRUE".to_string(),
        filter_ast::ExprFrame::Literal(ChatLiteral::ChatId(i)) => format!("c.id = '{i}'"),
        filter_ast::ExprFrame::Literal(ChatLiteral::Owner(o)) => {
            format!(r#"c."userId" = '{o}'"#)
        }
        // all chats are important
        filter_ast::ExprFrame::Literal(ChatLiteral::Importance(true)) => "TRUE".to_string(),
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

pub(in crate::outbound::pg_soup_repo) fn build_project_filter(
    ast: Option<&Expr<ProjectLiteral>>,
) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let expr = push_not_inward(expr, false);
    let formatting = expr.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("(NOT {a})"),
        filter_ast::ExprFrame::Literal(ProjectLiteral::ProjectId(p)) => {
            nullable_eq(r#"p."parentId""#, p)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::ProjectIdSelf(p)) => {
            format!(r#"p.id = '{p}'"#)
        }
        filter_ast::ExprFrame::Literal(ProjectLiteral::Owner(o)) => {
            format!(r#"p."userId" = '{o}'"#)
        }
        // all projects are important; TRUE (not empty) keeps the literal
        // valid SQL inside And/Or/Not.
        filter_ast::ExprFrame::Literal(ProjectLiteral::Importance(true)) => "TRUE".to_string(),
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

pub(in crate::outbound::pg_soup_repo) fn build_properties_filter(
    ast: Option<&Expr<PropertiesLiteral>>,
    entity_id_sql: &str,
) -> String {
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

pub(in crate::outbound::pg_soup_repo) fn document_filter_needs_task_property_joins(
    ast: Option<&Expr<DocumentLiteral>>,
) -> bool {
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

pub(in crate::outbound::pg_soup_repo) fn properties_filter_can_apply_to(
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

pub(in crate::outbound::pg_soup_repo) fn chat_filter_is_impossible(
    ast: Option<&Expr<ChatLiteral>>,
) -> bool {
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

pub(in crate::outbound::pg_soup_repo) fn document_filter_is_impossible(
    ast: Option<&Expr<DocumentLiteral>>,
) -> bool {
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

pub(in crate::outbound::pg_soup_repo) fn project_filter_is_impossible(
    ast: Option<&Expr<ProjectLiteral>>,
) -> bool {
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

pub(in crate::outbound::pg_soup_repo) fn calendar_event_filter_is_impossible(
    ast: Option<&Expr<CalendarEventLiteral>>,
) -> bool {
    ast.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) => a || b,
            filter_ast::ExprFrame::Or(a, b) => a && b,
            filter_ast::ExprFrame::Not(_) => false,
            filter_ast::ExprFrame::Literal(CalendarEventLiteral::Id(id)) => id.is_nil(),
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

fn top_sort_expr(alias: &str, sort_method: SimpleSortMethod) -> String {
    match sort_method {
        SimpleSortMethod::ViewedAt => {
            r#"COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')"#.to_string()
        }
        SimpleSortMethod::ViewedUpdated => {
            format!(r#"COALESCE(uh."updatedAt", {alias}."updatedAt")"#)
        }
        SimpleSortMethod::CreatedAt => format!(r#"{alias}."createdAt""#),
        SimpleSortMethod::UpdatedAt => format!(r#"{alias}."updatedAt""#),
    }
}

fn top_needs_user_history(sort_method: SimpleSortMethod) -> bool {
    matches!(
        sort_method,
        SimpleSortMethod::ViewedAt | SimpleSortMethod::ViewedUpdated
    )
}

/// Per-arm access gate. Semantically identical to the old
/// `AccessibleItems AS MATERIALIZED` CTE + `INNER JOIN` (an item is visible
/// iff at least one `entity_access` row matches one of the user's sources;
/// IN dedupes exactly like the CTE's DISTINCT did), but expressed as a
/// flattenable semi-join so the planner can pick a direction per arm:
/// hash the user's accessible set when the arm is broad, or probe
/// `entity_access` per candidate row (via
/// `idx_entity_access_entity_text_type_source`) when the arm's own filters
/// are selective. The materialized form pinned the worst plan — the whole
/// corpus was computed and probed against the item table on every page.
pub(in crate::outbound::pg_soup_repo) fn access_semi_join(
    id_sql: &str,
    entity_type: &str,
) -> String {
    format!(
        r#"{id_sql} IN (
                    SELECT ea.entity_id::text
                    FROM entity_access ea
                    JOIN user_source_ids us ON us.source_id = ea.source_id
                    WHERE ea.entity_type = '{entity_type}'
                )"#
    )
}

fn document_top_clause(sort_method: SimpleSortMethod, needs_sub_type_join: bool) -> String {
    let sub_type_join = if needs_sub_type_join {
        r#"                LEFT JOIN document_sub_type dt ON dt.document_id = d.id
"#
    } else {
        ""
    };
    format!(
        r#"
                SELECT
                    'document'::text as item_type,
                    d.id,
                    {}::timestamptz as sort_ts
                FROM "Document" d
{}"#,
        top_sort_expr("d", sort_method),
        sub_type_join
    )
}

fn document_top_where_clause(sort_method: SimpleSortMethod) -> String {
    let user_history_join = if top_needs_user_history(sort_method) {
        r#"                LEFT JOIN "UserHistory" uh ON uh."itemId" = d.id AND uh."itemType" = 'document' AND uh."userId" = $1
"#
    } else {
        ""
    };
    format!(
        r#"{user_history_join}                WHERE d."deletedAt" IS NULL
                AND {}
"#,
        access_semi_join("d.id", "document")
    )
}

fn chat_top_clause(sort_method: SimpleSortMethod) -> String {
    let user_history_join = if top_needs_user_history(sort_method) {
        r#"                LEFT JOIN "UserHistory" uh ON uh."itemId" = c.id AND uh."itemType" = 'chat' AND uh."userId" = $1
"#
    } else {
        ""
    };
    format!(
        r#"
                SELECT
                    'chat'::text as item_type,
                    c.id,
                    {}::timestamptz as sort_ts
                FROM "Chat" c
{}"#,
        top_sort_expr("c", sort_method),
        user_history_join
    )
}

fn chat_top_where_clause() -> String {
    format!(
        r#"                WHERE c."deletedAt" IS NULL
                AND {}
"#,
        access_semi_join("c.id", "chat")
    )
}

fn project_top_clause(sort_method: SimpleSortMethod) -> String {
    let user_history_join = if top_needs_user_history(sort_method) {
        r#"                LEFT JOIN "UserHistory" uh
                    ON uh."itemId" = p.id
                    AND uh."itemType" = 'project'
                    AND uh."userId" = $1
"#
    } else {
        ""
    };
    format!(
        r#"
                SELECT
                    'project'::text as item_type,
                    p.id,
                    {}::timestamptz as sort_ts
                FROM "Project" p
{}"#,
        top_sort_expr("p", sort_method),
        user_history_join
    )
}

fn project_top_where_clause() -> String {
    format!(
        r#"                WHERE p."deletedAt" IS NULL
                AND {}
"#,
        access_semi_join("p.id", "project")
    )
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

fn build_query(
    filter_ast: &EntityFilterAst,
    exclude_frecency: bool,
    sort_method: SimpleSortMethod,
) -> QueryBuilder<'_, Postgres> {
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

    let document_notification = filter_ast.document_filter.as_deref().and_then(|expr| {
        strip_notification_conjunction(expr, |lit| match lit {
            DocumentLiteral::NotificationDone(done) => Some(NotificationPredicate::Done(*done)),
            DocumentLiteral::NotificationSeen(seen) => Some(NotificationPredicate::Seen(*seen)),
            _ => None,
        })
    });
    let chat_notification = filter_ast.chat_filter.as_deref().and_then(|expr| {
        strip_notification_conjunction(expr, |lit| match lit {
            ChatLiteral::NotificationDone(done) => Some(NotificationPredicate::Done(*done)),
            ChatLiteral::NotificationSeen(seen) => Some(NotificationPredicate::Seen(*seen)),
            _ => None,
        })
    });
    let project_notification = filter_ast.project_filter.as_deref().and_then(|expr| {
        strip_notification_conjunction(expr, |lit| match lit {
            ProjectLiteral::NotificationDone(done) => Some(NotificationPredicate::Done(*done)),
            ProjectLiteral::NotificationSeen(seen) => Some(NotificationPredicate::Seen(*seen)),
            _ => None,
        })
    });

    let notification_predicates = [
        document_notification.as_ref().map(|(pred, _)| *pred),
        chat_notification.as_ref().map(|(pred, _)| *pred),
        project_notification.as_ref().map(|(pred, _)| *pred),
    ];
    let optimized_notification_predicate = notification_predicates
        .into_iter()
        .flatten()
        .try_fold(None, |acc, pred| match acc {
            Some(acc) if acc != pred => None,
            Some(acc) => Some(Some(acc)),
            None => Some(Some(pred)),
        })
        .flatten();

    let document_filter =
        if optimized_notification_predicate.is_some() && document_notification.is_some() {
            document_notification
                .as_ref()
                .and_then(|(_, expr)| expr.as_ref())
        } else {
            filter_ast.document_filter.as_deref()
        };
    let chat_filter = if optimized_notification_predicate.is_some() && chat_notification.is_some() {
        chat_notification
            .as_ref()
            .and_then(|(_, expr)| expr.as_ref())
    } else {
        filter_ast.chat_filter.as_deref()
    };
    let project_filter =
        if optimized_notification_predicate.is_some() && project_notification.is_some() {
            project_notification
                .as_ref()
                .and_then(|(_, expr)| expr.as_ref())
        } else {
            filter_ast.project_filter.as_deref()
        };

    if let Some(predicate) = optimized_notification_predicate {
        let mut item_types = Vec::with_capacity(3);
        if include_documents && document_notification.is_some() {
            item_types.push("document");
        }
        if include_chats && chat_notification.is_some() {
            item_types.push("chat");
        }
        if include_projects && project_notification.is_some() {
            item_types.push("project");
        }
        build_notification_items_cte(&mut builder, predicate, &item_types);
    }

    // TopItems CTE: lightweight id + sort_ts with filters, cursor, and limit
    builder.push("TopItems AS (");
    builder.push("SELECT all_items.item_type, all_items.id, all_items.sort_ts FROM (");

    let mut needs_separator = false;

    if include_documents {
        push_union_separator(&mut builder, &mut needs_separator);
        // Document top clause (lightweight). The document_sub_type join is
        // only needed by filters that reference `dt` (Importance / CBM);
        // SubType literals render as their own EXISTS probes.
        let needs_task_property_joins = document_filter_needs_task_property_joins(document_filter);
        builder.push(document_top_clause(sort_method, needs_task_property_joins));
        if optimized_notification_predicate.is_some() && document_notification.is_some() {
            builder.push(build_notification_join("d", "document"));
        }
        if needs_task_property_joins {
            builder.push(DOCUMENT_TASK_PROPERTY_JOINS);
        }
        builder.push(document_top_where_clause(sort_method));
        builder.push(build_document_filter(document_filter));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "d.id",
        ));
    }

    if include_chats {
        push_union_separator(&mut builder, &mut needs_separator);
        // Chat top clause (lightweight)
        builder.push(chat_top_clause(sort_method));
        if optimized_notification_predicate.is_some() && chat_notification.is_some() {
            builder.push(build_notification_join("c", "chat"));
        }
        builder.push(chat_top_where_clause());
        builder.push(build_chat_filter(chat_filter));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "c.id",
        ));
    }

    if include_projects {
        push_union_separator(&mut builder, &mut needs_separator);
        // Project top clause (lightweight)
        builder.push(project_top_clause(sort_method));
        if optimized_notification_predicate.is_some() && project_notification.is_some() {
            builder.push(build_notification_join("p", "project"));
        }
        builder.push(project_top_where_clause());
        builder.push(build_project_filter(project_filter));
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
                false as "is_email_attachment",
                false as "is_important",
                ARRAY[]::uuid[] as "status_option_ids",
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
    #[sqlx(default)]
    is_email_attachment: bool,
    #[sqlx(default)]
    is_important: bool,
    #[sqlx(default)]
    status_option_ids: Vec<Uuid>,
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
    CalendarEvent(SoupCalendarEvent<()>),
}

impl<'a> FromRow<'a, PgRow> for SoupRow {
    fn from_row(row: &'a PgRow) -> Result<Self, sqlx::Error> {
        let item_type: &'a str = row.try_get("item_type")?;
        match item_type {
            "document" => Ok(SoupRow::Document(DocumentRow::from_row(row)?)),
            "chat" => Ok(SoupRow::Chat(ChatRow::from_row(row)?)),
            "project" => Ok(SoupRow::Project(ProjectRow::from_row(row)?)),
            "calendar_event" => {
                let value: serde_json::Value = row.try_get("calendar_event")?;
                let event = serde_json::from_value(value)
                    .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
                Ok(SoupRow::CalendarEvent(event))
            }
            _ => Err(sqlx::Error::TypeNotFound {
                type_name: item_type.to_string(),
            }),
        }
    }
}

impl SoupRow {
    fn document_server_facts(&self) -> Option<SoupDocumentServerFacts> {
        match self {
            Self::Document(row) => Some(SoupDocumentServerFacts {
                is_email_attachment: row.is_email_attachment,
                is_important: row.is_important,
                status_option_ids: row.status_option_ids.clone(),
            }),
            Self::Chat(_) | Self::Project(_) | Self::CalendarEvent(_) => None,
        }
    }

    #[tracing::instrument(err)]
    fn into_projection_hydration(self) -> Result<SoupProjectionHydration, sqlx::Error> {
        let document_server_facts = self.document_server_facts();
        Ok(SoupProjectionHydration {
            item: self.into_soup_item()?,
            document_server_facts,
        })
    }

    #[tracing::instrument(err)]
    fn into_soup_item(self) -> Result<SoupItem<()>, sqlx::Error> {
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
                is_email_attachment: _,
                is_important: _,
                status_option_ids: _,
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
                extra: (),
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
                extra: (),
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
                extra: (),
            }),
            SoupRow::CalendarEvent(event) => SoupItem::CalendarEvent(event),
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
async fn expanded_dynamic_cursor_soup_hydrated(
    db: &PgPool,
    args: ExpandedDynamicCursorArgs<'_>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
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

    let items = build_query(cursor.filter(), exclude_frecency, *cursor.sort_method())
        .build()
        .bind(user_id.as_ref())
        .bind(sort_method_str)
        .bind(query_limit)
        .bind(cursor_timestamp)
        .bind(cursor_id_str)
        .bind(completed_option_id)
        .bind(status_property_id)
        .bind(assignees_property_id)
        // Unnamed statement: the SQL text varies per filter shape and per
        // interpolated literal (dates change daily), so a cached prepared
        // statement is rarely reused but flips to a generic plan after five
        // executions — and the generic plan misestimates the CTEs badly
        // enough to run 10x slower. Planning with the real bind values every
        // time costs ~1ms and keeps the plan stable.
        .persistent(false)
        .try_map(|row| SoupRow::from_row(&row)?.into_projection_hydration())
        .fetch_all(db)
        .await?;

    Ok(items)
}

/// Execute a flat expanded dynamic query and retain document server facts.
#[tracing::instrument(skip(db), err)]
pub(crate) async fn expanded_dynamic_cursor_soup_with_projection(
    db: &PgPool,
    args: ExpandedDynamicCursorArgs<'_>,
) -> Result<Vec<SoupProjectionHydration>, sqlx::Error> {
    expanded_dynamic_cursor_soup_hydrated(db, args).await
}

/// Execute a flat expanded dynamic query without exposing projection metadata.
#[cfg(test)]
#[tracing::instrument(skip(db), err)]
pub(crate) async fn expanded_dynamic_cursor_soup(
    db: &PgPool,
    args: ExpandedDynamicCursorArgs<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    Ok(expanded_dynamic_cursor_soup_hydrated(db, args)
        .await?
        .into_iter()
        .map(|hydration| hydration.item)
        .collect())
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
#[derive(FromRow)]
struct GroupFields {
    group_key: String,
    group_total_count: i64,
    row_in_group: i64,
}

/// Grouped row: reuses SoupRow for item data, adds group metadata.
#[derive(FromRow)]
struct GroupedSoupRow {
    #[sqlx(flatten)]
    item: SoupRow,
    #[sqlx(flatten)]
    group: GroupFields,
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
    // Gated like the other three legs. Beyond skipping a union branch that can
    // never match, this keeps the NIL-id exclusion every Soup query now sends
    // from reaching `push_filter` below — see the bind-numbering note there.
    let include_calendar_events =
        !calendar_event_filter_is_impossible(filter_ast.calendar_event_filter.as_deref())
            && properties_filter_can_apply_to(
                filter_ast.properties_filter.as_deref(),
                &[PropertyEntityType::CalendarEvent],
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
        "SELECT all_items.item_type, all_items.id, all_items.sort_ts, all_items.project_id, all_items.property_entity_type FROM (",
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

    if include_calendar_events {
        push_union_separator(&mut builder, &mut needs_separator);
        builder.push(GROUPED_CALENDAR_EVENT_TOP_CLAUSE);
        builder.push(build_calendar_event_filter(
            filter_ast.calendar_event_filter.as_deref(),
        ));
        builder.push(build_properties_filter(
            filter_ast.properties_filter.as_deref(),
            "event.id::text",
        ));
    }

    // Fallback when all entity types are filtered out
    if !needs_separator {
        builder.push(
            "SELECT 'document'::text as item_type, NULL::text as id, NULL::timestamptz as sort_ts, NULL::text as project_id, NULL::property_entity_type as property_entity_type WHERE false",
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
    if include_calendar_events {
        push_union_separator(&mut builder, &mut combined_needs_separator);
        builder.push(
            GROUPED_CALENDAR_EVENT_DETAIL_CLAUSE
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
    builder.push(", \"sort_ts\" DESC, \"id\" DESC");

    // Apply LIMIT only in single-group "load more" mode. In multi-group mode the
    // result is already bounded by the per-group cap inside FilteredGroupedItems
    // (PER_GROUP_LIMIT), so a row-level LIMIT here would silently drop entire
    // groups from the response when there are many groups.
    if grouping.group_key.is_some() {
        builder.push(" LIMIT $3");
    }

    (builder, entity_type_bind)
}

/// Execute a grouped dynamic cursor soup query.
#[tracing::instrument(skip(db), err)]
pub async fn expanded_dynamic_cursor_soup_grouped(
    db: &PgPool,
    args: GroupedDynamicCursorArgs<'_>,
) -> Result<std::vec::IntoIter<ItemGroupingInfo>, sqlx::Error> {
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

    // $9 is bound unconditionally (NULL when not in single-group mode) so $10 stays aligned.
    let mut query = query_builder
        .build_query_as::<'_, GroupedSoupRow>()
        .bind(user_id.as_ref())
        .bind(sort_method_str)
        .bind(query_limit)
        .bind(cursor_timestamp)
        .bind(cursor_id_str)
        .bind(completed_option_id)
        .bind(status_property_id)
        .bind(assignees_property_id)
        .bind(grouping.group_key.clone());

    // Bind entity_type as $10 when property grouping with entity_type filter
    if let Some(ref et) = entity_type_bind {
        query = query.bind(et.clone());
    }

    let rows: Vec<GroupedSoupRow> = query
        // Unnamed statement — same rationale as expanded_dynamic_cursor_soup:
        // filter-shaped SQL text gets no reuse from the statement cache but
        // does get generic-plan flips.
        .persistent(false)
        .fetch_all(db)
        .await?;

    let items = rows
        .into_iter()
        .map(|row| {
            Ok(ItemGroupingInfo {
                item: row.item.into_soup_item()?,
                key: row.group.group_key,
                total_group_count: usize::try_from(row.group.group_total_count)
                    .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
                index_in_group: usize::try_from(row.group.row_in_group)
                    .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(items.into_iter())
}
