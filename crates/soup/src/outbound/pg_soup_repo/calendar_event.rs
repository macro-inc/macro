use chrono::{DateTime, NaiveDate, Utc};
use filter_ast::Expr;
use item_filters::ast::{
    calendar_event::CalendarEventLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, properties_filter_can_apply_to},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{
    calendar_event::{SoupCalendarEvent, SoupCalendarEventTime},
    item::SoupItem,
};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use super::candidate_gates::UUID_PATTERN;
use super::expanded::dynamic::{NotificationPredicate, strip_notification_conjunction};
use crate::domain::models::{AdvancedSortParams, SimpleSortQuery, SimpleSortRequest};

#[derive(FromRow)]
struct CalendarEventRow {
    id: Uuid,
    owner_id: String,
    ical_uid: String,
    title: String,
    description: Option<String>,
    location: Option<String>,
    status: String,
    visibility: String,
    transparency: String,
    starts_at: Option<DateTime<Utc>>,
    ends_at: Option<DateTime<Utc>>,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    time_zone: Option<String>,
    organizer_email: Option<String>,
    organizer_name: Option<String>,
    conference_url: Option<String>,
    conference_provider: Option<String>,
    is_read_only: bool,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_reminder_fired_at: Option<DateTime<Utc>>,
}

struct CursorParts {
    sort: SimpleSortMethod,
    id: Option<Uuid>,
    timestamp: Option<DateTime<Utc>>,
    filter: Option<Expr<CalendarEventLiteral>>,
    property_filter: Option<Expr<PropertiesLiteral>>,
}

#[tracing::instrument(err, skip_all, fields(limit = req.limit))]
pub(super) async fn cursor_soup(
    db: &PgPool,
    req: SimpleSortRequest<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let parts = cursor_parts(req.cursor);
    if parts.property_filter.as_ref().is_some_and(|filter| {
        !properties_filter_can_apply_to(filter, &[PropertyEntityType::CalendarEvent])
    }) {
        return Ok(Vec::new());
    }

    // A notification-state conjunct bounds the page to events the caller was
    // notified about, a set the viewer index answers directly; folding it per
    // event instead scanned every calendar event in the table.
    let notification = parts.filter.as_ref().and_then(|filter| {
        strip_notification_conjunction(filter, |literal| match literal {
            CalendarEventLiteral::NotificationState(state) => {
                Some(NotificationPredicate::state(*state))
            }
            _ => None,
        })
    });
    let (notified, filter) = match &notification {
        Some((predicate, rest)) => (Some(*predicate), rest.as_ref()),
        None => (None, parts.filter.as_ref()),
    };

    let sort = sort_sql(parts.sort);
    let mut query = QueryBuilder::<Postgres>::new(format!("{} WHERE ", select_sql()));
    push_access(&mut query, req.user_id);
    if let Some(predicate) = notified {
        query.push(format!(
            " AND event.id IN ({})",
            notified_event_ids_sql(predicate)
        ));
    }
    if let Some(filter) = filter {
        query.push(" AND (");
        push_filter(&mut query, filter);
        query.push(")");
    }
    query.push(super::expanded::dynamic::build_properties_filter(
        parts.property_filter.as_ref(),
        "event.id::text",
    ));
    if let (Some(timestamp), Some(id)) = (parts.timestamp, parts.id) {
        query.push(format!(" AND ({sort}, event.id) < ("));
        query.push_bind(timestamp);
        query.push(", ");
        query.push_bind(id);
        query.push(")");
    }
    query.push(format!(" ORDER BY {sort} DESC, event.id DESC LIMIT "));
    query.push_bind(i64::from(req.limit));

    query
        .build_query_as::<CalendarEventRow>()
        .fetch_all(db)
        .await?
        .into_iter()
        .map(row_to_item)
        .collect()
}

pub(super) async fn by_ids(
    db: &PgPool,
    req: AdvancedSortParams<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let ids = req
        .entities
        .iter()
        .filter(|entity| entity.entity_type == EntityType::CalendarEvent)
        .filter_map(|entity| entity.entity_id.parse::<Uuid>().ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut query = QueryBuilder::<Postgres>::new(format!("{} WHERE ", select_sql()));
    push_access(&mut query, req.user_id);
    query.push(" AND event.id = ANY(");
    query.push_bind(ids);
    query.push(
        ") ORDER BY GREATEST(event.updated_at, event.last_reminder_fired_at) DESC, event.id DESC",
    );
    query
        .build_query_as::<CalendarEventRow>()
        .fetch_all(db)
        .await?
        .into_iter()
        .map(row_to_item)
        .collect()
}

/// Calendar events are owner- or delegation-scoped, never `entity_access`
/// rows: visible iff the caller owns the event or is delegated the inbox it
/// was synced from. Binds the caller first, so `$1` is the requesting user
/// for every clause rendered after it. The delegated links are collected once
/// rather than probed per event, which lets the planner index both sides of
/// the OR.
fn push_access(query: &mut QueryBuilder<'_, Postgres>, user_id: MacroUserIdStr<'_>) {
    query.push("(event.owner_id = ");
    query.push_bind(user_id.as_ref().to_string());
    query.push(
        " OR event.source_link_id = ANY(ARRAY(SELECT link.link_id FROM macro_user_links link WHERE link.primary_macro_id = $1)))",
    );
}

/// Ids of the events the caller holds a non-deleted notification for in the
/// predicate's states. Each recipient row carries its notification's entity,
/// so `idx_user_notification_viewer_entity` answers this without touching
/// `notification`. The id column is unconstrained text: a malformed id is
/// filtered out before the projection casts it.
fn notified_event_ids_sql(predicate: NotificationPredicate) -> String {
    format!(
        "SELECT un.event_item_id::uuid FROM user_notification un \
         WHERE un.user_id = $1 AND un.deleted_at IS NULL \
         AND un.event_item_type = 'calendar_event' AND {} \
         AND un.event_item_id ~ '{UUID_PATTERN}'",
        predicate.sql()
    )
}

fn cursor_parts(cursor: SimpleSortQuery) -> CursorParts {
    match cursor {
        SimpleSortQuery::NoFilter(query) => parts_from_query(&query, None, None),
        // CalendarEvent is not emitted by the primary frecency query yet, so
        // it must remain in the timestamp fallback even if an aggregate exists.
        SimpleSortQuery::FilterFrecency(query) => parts_from_query(&query, None, None),
        SimpleSortQuery::ItemsFilter(query) => {
            let ast = query.filter();
            parts_from_query(
                &query,
                ast.calendar_event_filter.as_deref().cloned(),
                ast.properties_filter.as_deref().cloned(),
            )
        }
        SimpleSortQuery::ItemsAndFrecencyFilter(query) => {
            let ast = &query.filter().1;
            parts_from_query(
                &query,
                ast.calendar_event_filter.as_deref().cloned(),
                ast.properties_filter.as_deref().cloned(),
            )
        }
    }
}

fn parts_from_query<F>(
    query: &Query<Uuid, SimpleSortMethod, F>,
    filter: Option<Expr<CalendarEventLiteral>>,
    property_filter: Option<Expr<PropertiesLiteral>>,
) -> CursorParts {
    let (id, timestamp) = query.vals();
    CursorParts {
        sort: *query.sort_method(),
        id: id.copied(),
        timestamp: timestamp.copied(),
        filter,
        property_filter,
    }
}

#[cfg(test)]
mod test;

fn select_sql() -> &'static str {
    r#"
    SELECT
        event.id,
        event.owner_id,
        event.ical_uid,
        event.title,
        event.description,
        event.location,
        event.status,
        event.visibility,
        event.transparency,
        event.starts_at,
        event.ends_at,
        event.start_date,
        event.end_date,
        event.time_zone,
        event.organizer_email,
        event.organizer_name,
        event.conference_url,
        event.conference_provider,
        event.is_read_only,
        event.created_at,
        event.updated_at,
        event.last_reminder_fired_at
    FROM calendar_events event
    "#
}

fn sort_sql(sort: SimpleSortMethod) -> &'static str {
    match sort {
        SimpleSortMethod::CreatedAt => "event.created_at",
        // A fired alarm counts as the event's latest activity, so the inbox
        // row a reminder surfaces sorts at delivery time rather than at the
        // event's Google last-modified time. GREATEST ignores the NULL when
        // no reminder has fired. Must mirror `cursor_timestamp` in
        // models_soup or keyset pagination breaks.
        SimpleSortMethod::UpdatedAt | SimpleSortMethod::ViewedUpdated => {
            "GREATEST(event.updated_at, event.last_reminder_fired_at)"
        }
        SimpleSortMethod::ViewedAt => "'1970-01-01 00:00:00+00'::timestamptz",
    }
}

pub(super) fn push_filter(
    builder: &mut QueryBuilder<'_, Postgres>,
    expression: &Expr<CalendarEventLiteral>,
) {
    match expression {
        Expr::And(left, right) => {
            builder.push("(");
            push_filter(builder, left);
            builder.push(" AND ");
            push_filter(builder, right);
            builder.push(")");
        }
        Expr::Or(left, right) => {
            builder.push("(");
            push_filter(builder, left);
            builder.push(" OR ");
            push_filter(builder, right);
            builder.push(")");
        }
        Expr::Not(inner) => {
            builder.push("NOT (");
            push_filter(builder, inner);
            builder.push(")");
        }
        Expr::Literal(CalendarEventLiteral::Id(id)) => {
            builder.push("event.id = ");
            builder.push_bind(*id);
        }
        Expr::Literal(CalendarEventLiteral::Status(status)) => {
            builder.push("event.status = ");
            builder.push_bind(status.clone());
        }
        Expr::Literal(CalendarEventLiteral::StartsBefore(value)) => {
            builder.push(
                "COALESCE(event.starts_at, event.start_date::timestamp AT TIME ZONE 'UTC') < ",
            );
            builder.push_bind(*value);
        }
        Expr::Literal(CalendarEventLiteral::EndsAfter(value)) => {
            builder
                .push("COALESCE(event.ends_at, event.end_date::timestamp AT TIME ZONE 'UTC') > ");
            builder.push_bind(*value);
        }
        Expr::Literal(CalendarEventLiteral::Attendee(email)) => {
            builder.push(
                "EXISTS (SELECT 1 FROM calendar_event_attendees attendee \
                 WHERE attendee.event_id = event.id AND attendee.email = lower(",
            );
            builder.push_bind(email.clone());
            builder.push("))");
        }
        Expr::Literal(CalendarEventLiteral::Organizer(email)) => {
            builder.push("lower(event.organizer_email) = lower(");
            builder.push_bind(email.clone());
            builder.push(")");
        }
        // Bind-free on purpose: `$1` is the requesting user in every query
        // that renders this clause (`cursor_soup` binds it first; the grouped
        // dynamic query renders the whole filter bind-free via
        // `build_calendar_event_filter` for the same reason), the contract
        // the other arms' notification clauses rely on.
        Expr::Literal(CalendarEventLiteral::NotificationState(state)) => {
            builder.push(super::expanded::dynamic::build_notification_state_clause(
                "event.id",
                "calendar_event",
                *state,
            ));
        }
    }
}

fn row_to_item(row: CalendarEventRow) -> Result<SoupItem<()>, sqlx::Error> {
    let time = match (row.starts_at, row.ends_at, row.start_date, row.end_date) {
        (Some(starts_at), Some(ends_at), None, None) => SoupCalendarEventTime::Timed {
            starts_at,
            ends_at,
            time_zone: row.time_zone,
        },
        (None, None, Some(start_date), Some(end_date)) => SoupCalendarEventTime::AllDay {
            start_date,
            end_date,
        },
        _ => {
            return Err(sqlx::Error::Decode(
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "calendar event has an invalid time shape",
                )
                .into(),
            ));
        }
    };

    Ok(SoupItem::CalendarEvent(SoupCalendarEvent {
        id: row.id,
        owner_id: row.owner_id,
        ical_uid: row.ical_uid,
        title: row.title,
        description: row.description,
        location: row.location,
        status: row.status,
        visibility: row.visibility,
        transparency: row.transparency,
        time,
        organizer_email: row.organizer_email,
        organizer_name: row.organizer_name,
        conference_url: row.conference_url,
        conference_provider: row.conference_provider,
        is_read_only: row.is_read_only,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_reminder_fired_at: row.last_reminder_fired_at,
        extra: (),
    }))
}
