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
    let mut query =
        QueryBuilder::<Postgres>::new(format!("{} WHERE (event.owner_id = ", select_sql()));
    query.push_bind(req.user_id.as_ref().to_string());
    query.push(" OR EXISTS (SELECT 1 FROM macro_user_links link WHERE link.link_id = event.source_link_id AND link.primary_macro_id = ");
    query.push_bind(req.user_id.as_ref().to_string());
    query.push("))");
    if let Some(filter) = &parts.filter {
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
    query.push(") ORDER BY event.updated_at DESC, event.id DESC");
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
        event.updated_at
    FROM calendar_events event
    "#
}

fn sort_sql(sort: SimpleSortMethod) -> &'static str {
    match sort {
        SimpleSortMethod::CreatedAt => "event.created_at",
        SimpleSortMethod::UpdatedAt | SimpleSortMethod::ViewedUpdated => "event.updated_at",
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
        Expr::Literal(CalendarEventLiteral::NotificationDone(done)) => {
            builder.push(super::expanded::dynamic::build_notification_done_clause(
                "event.id",
                "calendar_event",
                *done,
            ));
        }
        Expr::Literal(CalendarEventLiteral::NotificationSeen(seen)) => {
            builder.push(super::expanded::dynamic::build_notification_seen_clause(
                "event.id",
                "calendar_event",
                *seen,
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
        extra: (),
    }))
}
