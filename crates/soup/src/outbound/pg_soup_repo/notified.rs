//! The notified-at candidate query: one keyset-paginated page of entities the
//! user holds a live notification for, newest notification first.
//!
//! Every candidate is gated on existence, deletion and access, and on the
//! request's filters where soup owns the fold (documents, chats, projects,
//! calendar events, properties). Channel, channel-thread, email,
//! foreign-entity and reminder candidates are gated on access (plus the
//! notification-state and, for emails, importance conjuncts their trees
//! imply): their filter trees fold in their own domains' query
//! builders, so the service applies them in full when it hydrates the page
//! through those legs and drops the candidates that fail, refilling from the
//! next candidate page. A short page from this query therefore still means
//! the feed is exhausted, but a short hydrated page does not.
//!
//! A channel notification that names a message as its secondary event item
//! (mentions and thread replies) is keyed as a `channel_message` candidate on
//! that message — the thread root — because that is the row the client
//! attributes the notification to; the channel row keeps only channel-level
//! notifications.

use filter_ast::Expr;
use item_filters::ast::EntityFilterAst;
use item_filters::ast::calendar_event::CalendarEventLiteral;
use item_filters::ast::foreign_entity::ForeignEntityLiteral;
use item_filters::ast::properties::{PropertyEntityType, properties_filter_matches_propertyless};
use model_entity::EntityType;
use recursion::CollapsibleExt;
use sqlx::{PgPool, Row};
use std::str::FromStr;

use crate::domain::models::{NotifiedEntity, NotifiedSoupRequest};
use crate::outbound::pg_soup_repo::candidate_gates::{
    channel_gate, channel_thread_gate, chat_gate, document_gate, email_gate, implied_conjuncts_sql,
    includes_channels, includes_chats, includes_documents, includes_email_threads,
    includes_projects, project_gate, uuid_guarded,
};
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    build_notification_done_clause, build_notification_seen_clause, build_properties_filter,
    calendar_event_filter_is_impossible, properties_filter_can_apply_to,
};
use crate::outbound::pg_soup_repo::type_err;

/// The candidate row's entity id, as the gates see it: the `notified` CTE's
/// derived key (thread root for thread-scoped channel notifications).
const ID_SQL: &str = "nc.entity_id";

/// Folds a calendar filter into SQL over the `event` alias. Only the literals
/// [`calendar_filter_supported_by_notified`] admits have a fold; anything
/// else fails closed, since the service already rejected such trees.
///
/// [`calendar_filter_supported_by_notified`]: crate::domain::models::calendar_filter_supported_by_notified
fn build_calendar_event_filter(tree: Option<&Expr<CalendarEventLiteral>>) -> String {
    let Some(tree) = tree else {
        return String::new();
    };
    let sql = tree.collapse_frames(|frame| match frame {
        filter_ast::ExprFrame::And(a, b) => format!("({a} AND {b})"),
        filter_ast::ExprFrame::Or(a, b) => format!("({a} OR {b})"),
        filter_ast::ExprFrame::Not(a) => format!("NOT ({a})"),
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::Id(id)) => {
            format!("event.id = '{id}'")
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::NotificationDone(done)) => {
            build_notification_done_clause("event.id", "calendar_event", done)
        }
        filter_ast::ExprFrame::Literal(CalendarEventLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("event.id", "calendar_event", seen)
        }
        filter_ast::ExprFrame::Literal(_) => "FALSE".to_string(),
    });
    format!(" AND {sql}")
}

/// Calendar events are owner- or delegation-scoped, never `entity_access`
/// rows: visible iff the caller owns the event or is delegated the inbox it
/// was synced from. Mirrors the calendar by-ids hydration's access check.
fn calendar_event_gate(filter: Option<&EntityFilterAst>) -> String {
    let calendar_filter = filter.and_then(|f| f.calendar_event_filter.as_deref());
    let props_filter = filter.and_then(|f| f.properties_filter.as_deref());
    uuid_guarded(
        ID_SQL,
        format!(
            r#"EXISTS (
                SELECT 1 FROM calendar_events event
                WHERE event.id = {ID_SQL}::uuid
                AND (
                    event.owner_id = $1
                    OR EXISTS (
                        SELECT 1 FROM macro_user_links link
                        WHERE link.link_id = event.source_link_id
                        AND link.primary_macro_id = $1
                    )
                )
                {calendar_fold}
                {props_fold}
            )"#,
            calendar_fold = build_calendar_event_filter(calendar_filter),
            props_fold = build_properties_filter(props_filter, "event.id::text"),
        ),
    )
}

/// Foreign entities are visible through the source they were stored for:
/// the caller themselves or a team they belong to (`$7`/`$8` are the
/// parallel id / auth-entity arrays of those sources). The foreign-entity
/// tree folds in its own crate, which hydration applies in full; the
/// notification-state conjuncts it implies are pre-applied here.
fn foreign_entity_gate(filter: Option<&EntityFilterAst>) -> String {
    let implied =
        implied_conjuncts_sql(
            filter.and_then(|f| f.foreign_entity_filter.as_deref()),
            |literal| match literal {
                ForeignEntityLiteral::NotificationDone(done) => Some(
                    build_notification_done_clause("fe.id", "foreign_entity", *done),
                ),
                ForeignEntityLiteral::NotificationSeen(seen) => Some(
                    build_notification_seen_clause("fe.id", "foreign_entity", *seen),
                ),
                _ => None,
            },
        );
    uuid_guarded(
        ID_SQL,
        format!(
            r#"EXISTS (
                SELECT 1 FROM foreign_entity fe
                WHERE fe.id = {ID_SQL}::uuid
                AND EXISTS (
                    SELECT 1 FROM unnest($7::text[], $8::text[]) AS source(id, auth_entity)
                    WHERE source.id = fe.stored_for_id
                    AND source.auth_entity = fe.stored_for_auth_entity
                )
                {implied}
            )"#
        ),
    )
}

/// Reminders are private to their owner, which is the whole access check.
fn reminder_gate() -> String {
    uuid_guarded(
        ID_SQL,
        format!(
            r#"EXISTS (
                SELECT 1 FROM reminder r
                WHERE r.id = {ID_SQL}::uuid
                AND r.user_id = $1
            )"#
        ),
    )
}

/// A foreign-entity tree that can never match: the nil-id opt-out the client
/// sends for entity types a view does not reference.
fn foreign_entity_filter_is_impossible(tree: Option<&Expr<ForeignEntityLiteral>>) -> bool {
    tree.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) => a || b,
            filter_ast::ExprFrame::Or(a, b) => a && b,
            filter_ast::ExprFrame::Not(_) => false,
            filter_ast::ExprFrame::Literal(ForeignEntityLiteral::Id(id)) => id.is_nil(),
            filter_ast::ExprFrame::Literal(_) => false,
        })
    })
}

/// Which entity types this request can include. Soup-folded types drop when
/// their own filter can never match or an active properties filter can never
/// match them; domain-hydrated types additionally need their leg to be
/// active for the request.
fn included_types(req: &NotifiedSoupRequest<'_>) -> Vec<&'static str> {
    let props = req.filter.and_then(|f| f.properties_filter.as_deref());
    let propertyless_ok = props.is_none_or(properties_filter_matches_propertyless);
    let mut types = Vec::with_capacity(8);
    if includes_documents(req.filter) {
        types.push(EntityType::Document.into());
    }
    if includes_chats(req.filter) {
        types.push(EntityType::Chat.into());
    }
    if includes_projects(req.filter) {
        types.push(EntityType::Project.into());
    }
    if req.hydratable.channels && includes_channels(req.filter) {
        types.push(EntityType::Channel.into());
    }
    if req.hydratable.channel_threads && propertyless_ok {
        types.push(EntityType::ChannelMessage.into());
    }
    if req.hydratable.email_threads && includes_email_threads(req.filter, req.link_ids) {
        types.push(EntityType::EmailThread.into());
    }
    if !calendar_event_filter_is_impossible(
        req.filter.and_then(|f| f.calendar_event_filter.as_deref()),
    ) && properties_filter_can_apply_to(props, &[PropertyEntityType::CalendarEvent])
    {
        types.push(EntityType::CalendarEvent.into());
    }
    // Foreign entities and reminders carry no properties, so the filter is
    // settled type-wide like it is for channels.
    if req.hydratable.foreign_entities
        && propertyless_ok
        && !req.foreign_entity_sources.is_empty()
        && !foreign_entity_filter_is_impossible(
            req.filter.and_then(|f| f.foreign_entity_filter.as_deref()),
        )
    {
        types.push(EntityType::ForeignEntity.into());
    }
    if req.hydratable.reminders && propertyless_ok {
        types.push(EntityType::Reminder.into());
    }
    types
}

/// Fetches one page of notified-at candidates.
///
/// Shape: the user's live notifications collapse to one row per derived
/// entity key, its newest notification (the `latest` window's first row per
/// partition), which the fenced subquery orders and keysets; the outer query
/// gates those per entity type on existence/deletion/access and the
/// soup-owned filters in that order until `LIMIT` is met. The `OFFSET 0`
/// fence keeps the gates outside the dedupe and the inner order intact, so
/// the planner neither pushes the gates down onto every notification nor
/// re-sorts after them.
///
/// `user_notification.created_at` is a naive `TIMESTAMP` written in UTC, so
/// the keyset binds and the returned value stay naive and are re-tagged as
/// UTC here rather than round-tripped through the session time zone.
#[tracing::instrument(err, skip(db, req))]
pub(super) async fn notified_soup_page(
    db: &PgPool,
    req: NotifiedSoupRequest<'_>,
) -> Result<Vec<NotifiedEntity>, sqlx::Error> {
    let types = included_types(&req);
    if types.is_empty() {
        return Ok(Vec::new());
    }

    let sql = format!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        ),
        notified AS NOT MATERIALIZED (
            SELECT
                un.created_at,
                n.id AS notification_id,
                CASE WHEN n.event_item_type = 'channel'
                        AND n.secondary_event_item_type = 'channel_message'
                    THEN 'channel_message' ELSE n.event_item_type
                END AS entity_type,
                CASE WHEN n.event_item_type = 'channel'
                        AND n.secondary_event_item_type = 'channel_message'
                    THEN n.secondary_event_item_id ELSE n.event_item_id
                END AS entity_id
            FROM user_notification un
            JOIN notification n ON n.id = un.notification_id
            WHERE un.user_id = $1
            AND un.deleted_at IS NULL
        ),
        latest AS NOT MATERIALIZED (
            SELECT
                entity_type,
                entity_id,
                created_at,
                row_number() OVER (
                    PARTITION BY entity_type, entity_id
                    ORDER BY created_at DESC, notification_id DESC
                ) AS rn
            FROM notified
            WHERE entity_type = ANY($2)
        )
        SELECT nc.entity_type, nc.entity_id, nc.notified_at
        FROM (
            SELECT entity_type, entity_id, created_at AS notified_at
            FROM latest
            WHERE rn = 1
            AND ($3::timestamp IS NULL OR (created_at, entity_id) < ($3, $4))
            ORDER BY created_at DESC, entity_id DESC
            OFFSET 0
        ) nc
        WHERE CASE nc.entity_type
            WHEN 'document' THEN {document_gate}
            WHEN 'chat' THEN {chat_gate}
            WHEN 'project' THEN {project_gate}
            WHEN 'channel' THEN {channel_gate}
            WHEN 'channel_message' THEN {channel_thread_gate}
            WHEN 'email_thread' THEN {email_gate}
            WHEN 'calendar_event' THEN {calendar_event_gate}
            WHEN 'foreign_entity' THEN {foreign_entity_gate}
            WHEN 'reminder' THEN {reminder_gate}
            ELSE FALSE
        END
        ORDER BY nc.notified_at DESC, nc.entity_id DESC
        LIMIT $6
        "#,
        document_gate = document_gate(ID_SQL, req.filter),
        chat_gate = chat_gate(ID_SQL, req.filter),
        project_gate = project_gate(ID_SQL, req.filter),
        channel_gate = channel_gate(ID_SQL, req.filter),
        channel_thread_gate = channel_thread_gate(ID_SQL, req.filter),
        email_gate = email_gate(ID_SQL, req.filter),
        calendar_event_gate = calendar_event_gate(req.filter),
        foreign_entity_gate = foreign_entity_gate(req.filter),
        reminder_gate = reminder_gate(),
    );

    let after_ts = req.after.as_ref().map(|a| a.notified_at.naive_utc());
    let after_id = req.after.map(|a| a.entity_id);
    let source_ids: Vec<&str> = req
        .foreign_entity_sources
        .iter()
        .map(|source| source.id.as_str())
        .collect();
    let source_auth_entities: Vec<&str> = req
        .foreign_entity_sources
        .iter()
        .map(|source| source.auth_entity.as_str())
        .collect();

    sqlx::QueryBuilder::<sqlx::Postgres>::new(sql)
        .build()
        .bind(req.user_id.as_ref())
        .bind(&types)
        .bind(after_ts)
        .bind(after_id)
        .bind(req.link_ids)
        .bind(req.limit as i64)
        .bind(&source_ids)
        .bind(&source_auth_entities)
        // Unnamed statement, same reasoning as the expanded dynamic query:
        // the SQL text varies per filter shape, so a cached prepared
        // statement is rarely reused but would flip to a generic plan.
        .persistent(false)
        .try_map(|row: sqlx::postgres::PgRow| {
            let entity_type: String = row.try_get("entity_type")?;
            let entity_id: String = row.try_get("entity_id")?;
            let notified_at: chrono::NaiveDateTime = row.try_get("notified_at")?;
            let entity_type = EntityType::from_str(&entity_type).map_err(type_err)?;
            Ok(NotifiedEntity {
                entity: entity_type.with_entity_string(entity_id),
                notified_at: notified_at.and_utc(),
            })
        })
        .fetch_all(db)
        .await
}

#[cfg(test)]
mod test;
