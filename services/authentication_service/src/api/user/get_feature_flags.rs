use std::collections::BTreeMap;

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use feature_flags::{FeatureFlags, FlagValue};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::user_id::MacroUserIdStr;
use model::response::ErrorResponse;
use serde::Serialize;
use utoipa::ToSchema;

use crate::api::context::{ApiContext, AuthorizationService};

#[cfg(test)]
mod test;

/// The caller's web feature flags, evaluated here so the web client still has
/// them when its own PostHog request times out or is blocked.
#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
pub struct WebFeatureFlags {
    /// Every client-runtime flag PostHog evaluated for the caller, by key.
    pub flags: BTreeMap<String, WebFlagValue>,
}

/// A boolean flag, or the variant assigned by an enabled multivariate flag.
#[derive(Debug, Serialize, ToSchema, PartialEq, Eq)]
#[serde(untagged)]
pub enum WebFlagValue {
    Boolean(bool),
    Variant(String),
}

/// Evaluates the caller's web feature flags.
///
/// A fallback for the web client: it reads PostHog's own answer first. Returns
/// 503 when flags can't be evaluated, so the client falls back further
/// instead of reading every flag as off.
#[utoipa::path(
        get,
        path = "/user/feature_flags",
        operation_id = "get_user_feature_flags",
        responses(
            (status = 200, body=WebFeatureFlags),
            (status = 401, body=String),
            (status = 503, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip_all, fields(flags.outcome = tracing::field::Empty, flags.count = tracing::field::Empty))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Response {
    respond(
        ctx.web_feature_flags.as_ref(),
        &authorization.authorization.user.macro_user_id,
    )
    .await
}

async fn respond<F: FeatureFlags>(flags: Option<&F>, user: &MacroUserIdStr<'_>) -> Response {
    let span = tracing::Span::current();
    let Some(flags) = flags else {
        span.record("flags.outcome", "unconfigured");
        return unavailable();
    };
    match flags.load(user).await {
        Ok(snapshot) => {
            let flags: BTreeMap<_, _> = snapshot
                .iter()
                .map(|(key, value)| {
                    let value = match value {
                        FlagValue::Boolean(enabled) => WebFlagValue::Boolean(*enabled),
                        FlagValue::Variant(variant) => WebFlagValue::Variant(variant.clone()),
                    };
                    (key.to_owned(), value)
                })
                .collect();
            span.record("flags.outcome", "ok");
            span.record("flags.count", flags.len() as i64);
            (StatusCode::OK, Json(WebFeatureFlags { flags })).into_response()
        }
        Err(error) => {
            span.record("flags.outcome", "error");
            tracing::warn!(error = ?error, "failed to evaluate web feature flags");
            unavailable()
        }
    }
}

fn unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse {
            message: "feature flags are unavailable".into(),
        }),
    )
        .into_response()
}
