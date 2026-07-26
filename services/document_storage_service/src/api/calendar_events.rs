use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use calendar_events::domain::{
    models::{
        CalendarEvent, CalendarOccurrence, CalendarOccurrenceCoverageError,
        CalendarOccurrenceCursor, OccurrenceRange,
    },
    service::CalendarValidationError,
};
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use models_pagination::Base64Str;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalendarOccurrenceQuery {
    /// Inclusive UTC viewport start.
    start: DateTime<Utc>,
    /// Exclusive UTC viewport end.
    end: DateTime<Utc>,
    /// Inclusive local date boundary for all-day events.
    start_date: Option<NaiveDate>,
    /// Exclusive local date boundary for all-day events.
    end_date: Option<NaiveDate>,
    /// Maximum number of occurrences, from 1 through 2,000.
    limit: Option<u16>,
    /// Opaque continuation cursor returned by the previous page.
    cursor: Option<String>,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalendarOccurrenceItem {
    event: CalendarEvent,
    occurrence: CalendarOccurrence,
}

#[derive(Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalendarOccurrenceResponse {
    items: Vec<CalendarOccurrenceItem>,
    has_more: bool,
    next_cursor: Option<String>,
}

#[derive(Debug)]
pub(super) struct CalendarApiError {
    status: StatusCode,
    message: &'static str,
}

impl std::fmt::Display for CalendarApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl IntoResponse for CalendarApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "message": self.message })),
        )
            .into_response()
    }
}

#[tracing::instrument(skip(ctx, user), fields(user_id = %user.authorization.user.macro_user_id), err)]
#[utoipa::path(
    get,
    path = "/calendar-events",
    params(CalendarOccurrenceQuery),
    responses(
        (status = 200, description = "Calendar occurrences in the requested viewport", body = CalendarOccurrenceResponse),
        (status = 400, description = "Invalid or unsupported calendar viewport"),
        (status = 401, description = "Authentication required"),
        (status = 500, description = "Calendar query failed"),
    )
)]
pub(super) async fn list_occurrences(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Query(query): Query<CalendarOccurrenceQuery>,
) -> Result<Json<CalendarOccurrenceResponse>, CalendarApiError> {
    let default_end_date = default_end_date(query.end);
    let range = OccurrenceRange {
        starts_at: query.start,
        ends_at: query.end,
        start_date: query.start_date.unwrap_or_else(|| query.start.date_naive()),
        end_date: query
            .end_date
            .or(default_end_date)
            .ok_or(CalendarApiError {
                status: StatusCode::BAD_REQUEST,
                message: "calendar end is outside the supported date range",
            })?,
    };
    let (limit, repository_limit) = query_limits(query.limit)?;
    let cursor = decode_cursor(query.cursor)?;
    let mut occurrences = ctx
        .calendar_service
        .list_occurrences(
            user.authorization.user.macro_user_id.as_ref(),
            range,
            cursor,
            repository_limit,
        )
        .await
        .map_err(|error| {
            let error_context = error.as_ref();
            if error_context
                .downcast_current_context::<CalendarValidationError>()
                .is_some()
                || error_context
                    .downcast_current_context::<CalendarOccurrenceCoverageError>()
                    .is_some()
            {
                return CalendarApiError {
                    status: StatusCode::BAD_REQUEST,
                    message: "calendar range must be positive, at most 370 days, inside persisted one-year-history/two-year-future recurrence coverage, with limit 1–2000",
                };
            }
            tracing::error!(error = ?error, "failed to query calendar occurrences");
            CalendarApiError {
                status: StatusCode::INTERNAL_SERVER_ERROR,
                message: "unable to query calendar occurrences",
            }
        })?;
    let has_more = occurrences.len() > usize::from(limit);
    occurrences.truncate(usize::from(limit));
    let next_cursor = has_more
        .then(|| occurrences.last())
        .flatten()
        .map(|(_, occurrence)| {
            Base64Str::encode_json(CalendarOccurrenceCursor::from_occurrence(occurrence))
                .type_erase()
        });
    let items = occurrences
        .into_iter()
        .map(|(event, occurrence)| CalendarOccurrenceItem { event, occurrence })
        .collect();

    Ok(Json(CalendarOccurrenceResponse {
        items,
        has_more,
        next_cursor,
    }))
}

fn decode_cursor(
    cursor: Option<String>,
) -> Result<Option<CalendarOccurrenceCursor>, CalendarApiError> {
    cursor
        .map(|cursor| {
            Base64Str::new_from_string(cursor)
                .decode_json()
                .map_err(|_| CalendarApiError {
                    status: StatusCode::BAD_REQUEST,
                    message: "calendar cursor is invalid",
                })
        })
        .transpose()
}

fn query_limits(requested: Option<u16>) -> Result<(u16, u16), CalendarApiError> {
    let limit = requested.unwrap_or(1000);
    if !(1..=2000).contains(&limit) {
        return Err(CalendarApiError {
            status: StatusCode::BAD_REQUEST,
            message: "calendar limit must be between 1 and 2000",
        });
    }
    Ok((limit, limit + 1))
}

fn default_end_date(end: DateTime<Utc>) -> Option<NaiveDate> {
    if end.time() == NaiveTime::MIN {
        Some(end.date_naive())
    } else {
        end.date_naive().succ_opt()
    }
}

#[cfg(test)]
mod test;
