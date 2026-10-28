//! Authenticated read adapters for original-email reminder surfaces.
use super::*;
use crate::domain::email_collection::{EmailReminderPage, EmailReminderQuery, EmailReminderViewer};
use axum_extra::extract::Query;
use email::domain::followup::ReminderThreadFilter;
use serde::Deserialize;

/// Email facets and cursor. Repeated inbox IDs select those inboxes only.
#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct EmailReminderParams {
    /// Selected inboxes; omission selects all accessible inboxes.
    pub inbox_ids: Option<Vec<Uuid>>,
    /// Explicitly empty inbox selection.
    pub no_inboxes: Option<bool>,
    /// Email archive filter, independent of reminder completion.
    pub done: Option<bool>,
    /// Email read status.
    pub read: Option<bool>,
    /// Restrict to calendar mail.
    pub calendar: Option<bool>,
    /// Repeated property-definition:select-option UUID pairs.
    pub tags: Option<Vec<String>>,
    /// Repeated attachment categories: pdf, image, document.
    pub attachments: Option<Vec<String>>,
    /// Continuation from the previous page.
    pub cursor: Option<String>,
    /// Maximum rows (1–100).
    #[param(minimum = 1, maximum = 100)]
    pub limit: Option<u32>,
}

fn viewer<Auth: MacroAuthorizationService>(
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> EmailReminderViewer {
    EmailReminderViewer {
        user_id: user.authorization.user.macro_user_id.clone(),
        org_id: user
            .authorization
            .user
            .user_context
            .organization_id
            .map(i64::from),
    }
}

/// List original email threads with caller-private reminder work.
#[utoipa::path(get, tag = "reminders", operation_id = "list_email_reminders",
    path = "/reminders/email/collection", params(EmailReminderParams),
    responses((status = 200, body = EmailReminderPage), (status = 400, body = ErrorResponse),
    (status = 401, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all)]
pub async fn list_email_reminders_handler<
    S: RemindersService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<RemindersRouterState<S, Eas, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(params): Query<EmailReminderParams>,
) -> Result<Json<EmailReminderPage>, ReminderError> {
    let tags = params
        .tags
        .unwrap_or_default()
        .into_iter()
        .map(|pair| {
            let (property, option) = pair
                .split_once(':')
                .ok_or_else(|| ReminderError::BadRequest("Invalid tag filter".into()))?;
            Ok((
                property
                    .parse()
                    .map_err(|_| ReminderError::BadRequest("Invalid tag property".into()))?,
                option
                    .parse()
                    .map_err(|_| ReminderError::BadRequest("Invalid tag option".into()))?,
            ))
        })
        .collect::<Result<Vec<_>, ReminderError>>()?;
    let attachments = params
        .attachments
        .unwrap_or_default()
        .into_iter()
        .map(|kind| {
            use email::domain::followup::ReminderAttachmentKind;
            match kind.as_str() {
                "pdf" => Ok(ReminderAttachmentKind::Pdf),
                "image" => Ok(ReminderAttachmentKind::Image),
                "document" => Ok(ReminderAttachmentKind::Document),
                _ => Err(ReminderError::BadRequest(
                    "Invalid attachment category".into(),
                )),
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    let query = EmailReminderQuery {
        filters: ReminderThreadFilter {
            inbox_ids: if params.no_inboxes == Some(true) {
                Some(Vec::new())
            } else {
                params.inbox_ids
            },
            done: params.done,
            read: params.read,
            calendar: params.calendar.unwrap_or(false),
            tags,
            attachments,
        },
        cursor: params.cursor,
        limit: params.limit,
    };
    Ok(Json(
        state
            .service
            .list_email_reminders(viewer(user), query)
            .await?,
    ))
}
