//! The environment `calendar_service` runs with: the email services' servers,
//! providers and stand-ins, plus its own settings.

use std::collections::BTreeMap;

/// The secret Google sends back with every push to the calendar webhook.
pub(crate) const WATCH_TOKEN: &str = "email-e2e-calendar-watch";
/// The switch that lets teammates see each other's shared calendars. The
/// in-process read routes follow it too.
pub(crate) const TEAM_SHARING: &str = "CALENDAR_TEAM_SHARING_ENABLED";

/// What `calendar_service` shares with the email services, by name.
const SHARED: &[&str] = &[
    "ENVIRONMENT",
    "RUST_MIN_STACK",
    "RUST_LOG",
    "NO_COLOR",
    "MACRO_DB_URL",
    "REDIS_URI",
    "KAFKA_BROKERS",
    "LOCAL_AWS_URL",
    "AUTHENTICATION_SERVICE_SECRET_KEY",
    "INTERNAL_API_KEY",
    "AUDIENCE",
    "ISSUER",
    "JWT_SECRET_KEY",
    "MACRO_API_TOKEN_ISSUER",
    "MACRO_API_TOKEN_PUBLIC_KEY",
    "QUEUE_WAIT_TIME_SECONDS",
    "OUTLOOK_SYNC_ENABLED",
    "OUTLOOK_WRITES_ENABLED",
    "OVERRIDE_GOOGLE_CALENDAR_API_URL",
    "OVERRIDE_MICROSOFT_GRAPH_URL",
    "OVERRIDE_AUTH_SERVICE_URL",
    "OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL",
    "OVERRIDE_CONNECTION_GATEWAY_URL",
    "OVERRIDE_LINK_MANAGER_QUEUE",
    "OVERRIDE_CALENDAR_SERVICE_BACKFILL_QUEUE",
];

/// The environment of `calendar_service`, listening on `port`.
///
/// `email_env` is the email services' environment, `app_url` the stand-in
/// for the app service, and `overrides` the scenario's own variables, which
/// replace anything set here.
pub(crate) fn calendar_env(
    email_env: &BTreeMap<String, String>,
    port: u16,
    app_url: &str,
    overrides: &[(String, String)],
) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = SHARED
        .iter()
        .filter_map(|name| {
            email_env
                .get(*name)
                .map(|value| ((*name).to_owned(), value.clone()))
        })
        .collect();

    let own = [
        ("PORT", port.to_string()),
        ("CALENDAR_SYNC_ENABLED", "true".to_owned()),
        (TEAM_SHARING, "true".to_owned()),
        ("BACKFILL_QUEUE_WORKERS", "4".to_owned()),
        // Google pushes calendar changes to the address production registers:
        // the service behind the gateway's `/calendar` prefix.
        (
            "CALENDAR_WATCH_WEBHOOK_URL",
            format!("{}/notifications", gateway_url(port)),
        ),
        ("CALENDAR_WATCH_TOKEN", WATCH_TOKEN.to_owned()),
        ("OVERRIDE_APP_SERVICE_URL", app_url.to_owned()),
    ];
    env.extend(own.map(|(name, value)| (name.to_owned(), value)));
    env.extend(overrides.iter().cloned());
    env
}

/// Where the gateway forwards calendar requests: it keeps the `/calendar`
/// prefix, so this is the address clients and Google's pushes reach.
pub(crate) fn gateway_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/calendar")
}
