//! Change notification subscriptions.

use axum::response::Response;
use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};

use super::{Call, Ctx, Handled, Reply, Served, logged, open, response};
use crate::OutlookEmulator;
use crate::error::GraphError;
use crate::fault::Route;
use crate::render;
use crate::state::Subscription;

/// Graph keeps a subscription to Outlook messages for at most this long.
const MAX_LIFETIME_MINUTES: i64 = 10_080;
const MAX_CLIENT_STATE_LENGTH: usize = 128;

fn subscription_json(subscription: &Subscription, creator: &str) -> Value {
    json!({
        "id": subscription.id,
        "resource": subscription.resource,
        "applicationId": "00000000-0000-4000-8000-0e0e0e0e0e0e",
        "changeType": subscription.change_type,
        "clientState": subscription.client_state,
        "notificationUrl": subscription.notification_url,
        "notificationQueryOptions": null,
        "lifecycleNotificationUrl": subscription.lifecycle_url,
        "expirationDateTime": render::time(subscription.expires_at),
        "creatorId": creator,
        "includeResourceData": null,
        "latestSupportedTlsVersion": "v1_2",
        "encryptionCertificate": null,
        "encryptionCertificateId": null,
        "notificationUrlAppId": null,
    })
}

fn expiration(value: &Value, now: DateTime<Utc>) -> Result<DateTime<Utc>, GraphError> {
    let expires_at = value
        .as_str()
        .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
        .map(|at| at.with_timezone(&Utc))
        .ok_or_else(|| GraphError::invalid_request("expirationDateTime is required."))?;
    if expires_at <= now {
        return Err(GraphError::invalid_request(
            "Subscription expiration date must be in the future.",
        ));
    }
    if expires_at > now + Duration::minutes(MAX_LIFETIME_MINUTES) {
        return Err(GraphError::invalid_request(&format!(
            "Subscription expiration can only be {MAX_LIFETIME_MINUTES} minutes in the future."
        )));
    }
    Ok(expires_at)
}

/// Reads and checks a create request, without storing anything.
fn prepare(ctx: &mut Ctx<'_>) -> Result<Subscription, GraphError> {
    let body = ctx.json_body()?;
    let required = |name: &str| {
        body[name]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| GraphError::invalid_request(&format!("{name} is required.")))
    };
    let resource = required("resource")?;
    let lowered = resource.to_lowercase();
    if !lowered.ends_with("messages") {
        return Err(GraphError::invalid_request(&format!(
            "The emulator notifies only about messages; unsupported resource '{resource}'."
        )));
    }
    let client_state = body["clientState"].as_str().map(str::to_string);
    if client_state
        .as_ref()
        .is_some_and(|state| state.len() > MAX_CLIENT_STATE_LENGTH)
    {
        return Err(GraphError::invalid_request(
            "clientState cannot be longer than 128 characters.",
        ));
    }

    let notification_url = required("notificationUrl")?;
    let lifecycle_url = body["lifecycleNotificationUrl"]
        .as_str()
        .map(str::to_string);
    let insecure_allowed = ctx.state.allow_http_notification_urls;
    for url in std::iter::once(&notification_url).chain(&lifecycle_url) {
        if !url.starts_with("https://") && !insecure_allowed {
            return Err(GraphError::invalid_request(
                "Subscription validation request failed. Notification endpoint must be an HTTPS URL.",
            ));
        }
    }

    Ok(Subscription {
        id: uuid::Uuid::now_v7().to_string(),
        email: ctx.email.clone(),
        resource,
        change_type: required("changeType")?,
        notification_url,
        lifecycle_url,
        client_state,
        expires_at: expiration(&body["expirationDateTime"], ctx.now)?,
    })
}

/// `POST /subscriptions`. Before storing the subscription, Graph posts a
/// validation token to the notification URL and to the lifecycle URL, and
/// each must echo it; that happens with the state unlocked.
pub(crate) async fn create(
    emulator: &OutlookEmulator,
    token: Option<&str>,
    call: &Call,
) -> Response {
    let (served, date) = emulator.with_state(|state| {
        let date = state.now();
        let served = match open(state, token, call) {
            Ok(mut ctx) => {
                let prepared = ctx
                    .enter(Route::SubscriptionsCreate)
                    .and_then(|()| prepare(&mut ctx));
                let failure = prepared.as_ref().err().cloned();
                (
                    ctx.served(failure.map_or(Ok(Reply::Empty(201)), Err)),
                    prepared.ok(),
                )
            }
            Err((mailbox, error)) => (
                Served {
                    route: Some(Route::SubscriptionsCreate),
                    mailbox,
                    delay: None,
                    result: Err(error),
                },
                None,
            ),
        };
        (served, date)
    });
    let (served, prepared) = served;
    if let Some(delay) = served.delay {
        tokio::time::sleep(delay).await;
    }
    let Some(subscription) = prepared else {
        return logged(response(served.result, date), served.route, served.mailbox);
    };

    let urls = std::iter::once(&subscription.notification_url).chain(&subscription.lifecycle_url);
    for url in urls {
        if let Err(reason) = emulator.validate_endpoint(&subscription.id, url).await {
            let refused = GraphError::invalid_request(&format!(
                "Subscription validation request failed. {reason}"
            ));
            return logged(response(Err(refused), date), served.route, served.mailbox);
        }
    }

    let body = emulator.with_state(|state| {
        let creator = state
            .mailboxes
            .get(&subscription.email)
            .map(|mailbox| mailbox.user_id.clone())
            .unwrap_or_default();
        let body = subscription_json(&subscription, &creator);
        state
            .subscriptions
            .insert(subscription.id.clone(), subscription);
        body
    });
    let created = Ok(Reply::Json(201, body));
    logged(response(created, date), served.route, served.mailbox)
}

pub(crate) fn list(ctx: &mut Ctx<'_>) -> Handled {
    let creator = ctx.mailbox()?.user_id.clone();
    let values: Vec<Value> = ctx
        .state
        .subscriptions
        .values()
        .filter(|subscription| subscription.email == ctx.email)
        .map(|subscription| subscription_json(subscription, &creator))
        .collect();
    Ok(ctx.collection("subscriptions", values, None))
}

fn owned<'a>(ctx: &'a mut Ctx<'_>, id: &str) -> Result<&'a mut Subscription, GraphError> {
    let email = ctx.email.clone();
    ctx.state
        .subscriptions
        .get_mut(id)
        .filter(|subscription| subscription.email == email)
        .ok_or_else(|| GraphError::resource_not_found("subscription"))
}

/// Renews a subscription.
pub(crate) fn update(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    let body = ctx.json_body()?;
    let expires_at = expiration(&body["expirationDateTime"], ctx.now)?;
    let creator = ctx.mailbox()?.user_id.clone();
    let subscription = owned(ctx, id)?;
    subscription.expires_at = expires_at;
    Ok(Reply::Json(200, subscription_json(subscription, &creator)))
}

pub(crate) fn delete(ctx: &mut Ctx<'_>, id: &str) -> Handled {
    owned(ctx, id)?;
    ctx.state.subscriptions.remove(id);
    Ok(Reply::Empty(204))
}
