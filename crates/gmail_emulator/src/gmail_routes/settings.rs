//! `users.settings`: filters and send-as aliases.

use axum::extract::{Path, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{Value, json};

use super::{mailbox, strings};
use crate::GmailEmulator;
use crate::error::ApiError;
use crate::fault::Route;
use crate::gate::mailbox_request;

type Emulator = AxumState<GmailEmulator>;

pub(super) fn router() -> Router<GmailEmulator> {
    Router::new()
        .route("/settings/filters", get(list_filters).post(create_filter))
        .route(
            "/settings/filters/{id}",
            get(get_filter).delete(delete_filter),
        )
        .route("/settings/sendAs", get(list_send_as))
}

async fn list_filters(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::FiltersList,
        |state, email| {
            let filters: Vec<Value> = mailbox(state, email)?
                .filters
                .iter()
                .map(|(_, filter)| filter.clone())
                .collect();
            Ok(Json(match filters.is_empty() {
                true => json!({}),
                false => json!({ "filter": filters }),
            }))
        },
    )
    .await
}

async fn get_filter(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::FiltersGet,
        |state, email| {
            mailbox(state, email)?
                .filters
                .iter()
                .find(|(filter_id, _)| *filter_id == id)
                .map(|(_, filter)| Json(filter.clone()))
                .ok_or_else(ApiError::not_found)
        },
    )
    .await
}

async fn create_filter(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::FiltersCreate,
        |state, email| {
            let (criteria, action) = (body["criteria"].clone(), body["action"].clone());
            let has_criteria = criteria
                .as_object()
                .is_some_and(|criteria| !criteria.is_empty());
            if !has_criteria {
                return Err(ApiError::invalid_argument("Filter must have criteria"));
            }

            let id = format!("ANe1Bm{}", state.ids.next());
            let mailbox = mailbox(state, email)?;
            let labels = strings(&action["addLabelIds"])
                .into_iter()
                .chain(strings(&action["removeLabelIds"]));
            for label in labels {
                if mailbox.label(&label).is_none() {
                    return Err(ApiError::invalid_argument(&format!(
                        "Invalid label: {label}"
                    )));
                }
            }
            let exists = mailbox
                .filters
                .iter()
                .any(|(_, filter)| filter["criteria"] == criteria && filter["action"] == action);
            if exists {
                return Err(ApiError::invalid_argument("Filter already exists"));
            }

            let filter = json!({ "id": id, "criteria": criteria, "action": action });
            mailbox.filters.push((id, filter.clone()));
            Ok(Json(filter))
        },
    )
    .await
}

async fn delete_filter(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::FiltersDelete,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            let before = mailbox.filters.len();
            mailbox.filters.retain(|(filter_id, _)| *filter_id != id);
            match mailbox.filters.len() == before {
                true => Err(ApiError::not_found()),
                false => Ok(StatusCode::NO_CONTENT),
            }
        },
    )
    .await
}

async fn list_send_as(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::SendAsList,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            let primary = json!({
                "sendAsEmail": mailbox.email,
                "displayName": mailbox.name.clone().unwrap_or_default(),
                "replyToAddress": "",
                "signature": &mailbox.signature,
                "isPrimary": true,
                "isDefault": true,
            });
            let aliases = mailbox.send_as.iter().map(|alias| {
                json!({
                    "sendAsEmail": alias.email,
                    "displayName": alias.name.clone().unwrap_or_default(),
                    "replyToAddress": "",
                    "signature": alias.signature.clone().unwrap_or_default(),
                    "isPrimary": false,
                    "isDefault": false,
                    "treatAsAlias": true,
                    "verificationStatus": match alias.verified {
                        true => "accepted",
                        false => "pending",
                    },
                })
            });
            let send_as: Vec<Value> = std::iter::once(primary).chain(aliases).collect();
            Ok(Json(json!({ "sendAs": send_as })))
        },
    )
    .await
}
