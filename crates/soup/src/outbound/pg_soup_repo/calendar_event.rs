use chrono::{DateTime, NaiveDate, Utc};
use filter_ast::Expr;
use item_filters::ast::{
    calendar_event::CalendarEventLiteral,
    properties::{PropertiesLiteral, PropertyEntityType, properties_filter_can_apply_to},
};
use model_entity::EntityType;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{
    calendar_event::{SoupCalendarEvent, SoupCalendarEventTime},
    item::SoupItem,
};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

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

    let sort = sort_sql(parts.sort);
    // A filter that is only notification states can name its events from
    // `user_notification` first. The per-event EXISTS form seq-scans
    // `calendar_events`: the owner-or-delegated OR hides the activity index,
    // and Postgres prices the notification hash against every event rather
    // than the page. MATERIALIZED keeps that id set from being inlined back
    // into the scan. Joining on `event.id::text` cannot use the primary key,
    // so the id is cast to uuid after a lowercase-uuid guard. Any other
    // literal, or a NOT, stays on the old shape.
    let notified_ids = parts.filter.as_ref().and_then(notification_event_ids_sql);
    let mut query = match &notified_ids {
        Some(ids_sql) => QueryBuilder::<Postgres>::new(format!(
            "WITH notified AS MATERIALIZED ({ids_sql}) {select} INNER JOIN notified ON event.id = notified.event_item_id::uuid WHERE (event.owner_id = ",
            select = select_sql(),
        )),
        None => QueryBuilder::<Postgres>::new(format!("{} WHERE (event.owner_id = ", select_sql())),
    };
    query.push_bind(req.user_id.as_ref().to_string());
    query.push(" OR EXISTS (SELECT 1 FROM macro_user_links link WHERE link.link_id = event.source_link_id AND link.primary_macro_id = ");
    query.push_bind(req.user_id.as_ref().to_string());
    query.push("))");
    if notified_ids.is_none()
        && let Some(filter) = &parts.filter
    {
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

    let mut query =
        QueryBuilder::<Postgres>::new(format!("{} WHERE (event.owner_id = ", select_sql()));
    query.push_bind(req.user_id.as_ref().to_string());
    query.push(" OR EXISTS (SELECT 1 FROM macro_user_links link WHERE link.link_id = event.source_link_id AND link.primary_macro_id = ");
    query.push_bind(req.user_id.as_ref().to_string());
    query.push(")) AND event.id = ANY(");
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

/// Event ids for a filter that is only positive notification states.
/// `None` when the tree contains any other literal or a NOT: those stay on
/// the per-event `EXISTS` so the two shapes cannot disagree.
///
/// AND is `INTERSECT` because two states can be witnessed by different
/// notification rows. OR is `UNION`. Each arm fences the user's rows with
/// `OFFSET 0` so Postgres cannot start from every `calendar_event`
/// notification in the table. `$1` is the requesting user, the same bind
/// `cursor_soup` pushes first.
fn notification_event_ids_sql(expr: &Expr<CalendarEventLiteral>) -> Option<String> {
    match expr {
        Expr::Literal(CalendarEventLiteral::NotificationState(state)) => {
            let predicate = super::expanded::dynamic::NotificationPredicate::state(*state).sql();
            Some(format!(
                r#"SELECT DISTINCT n.event_item_id
                   FROM (
                       SELECT un.notification_id
                       FROM user_notification un
                       WHERE un.user_id = $1
                         AND un.deleted_at IS NULL
                         AND {predicate}
                       OFFSET 0
                   ) un
                   JOIN notification n ON n.id = un.notification_id
                   WHERE n.event_item_type = 'calendar_event'
                     AND n.event_item_id ~ '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'"#
            ))
        }
        Expr::And(left, right) => Some(format!(
            "({}) INTERSECT ({})",
            notification_event_ids_sql(left)?,
            notification_event_ids_sql(right)?
        )),
        Expr::Or(left, right) => Some(format!(
            "({}) UNION ({})",
            notification_event_ids_sql(left)?,
            notification_event_ids_sql(right)?
        )),
        Expr::Not(_) | Expr::Literal(_) => None,
    }
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
