//! The environment `email_focus_worker` runs with: the email services'
//! database, broker and gateway stand-in, plus its own settings.

use std::collections::BTreeMap;

/// What the worker shares with the email services, by name.
const SHARED: &[&str] = &[
    "ENVIRONMENT",
    "RUST_MIN_STACK",
    "RUST_LOG",
    "NO_COLOR",
    "MACRO_DB_URL",
    "KAFKA_BROKERS",
    "INTERNAL_API_KEY",
    "OVERRIDE_CONNECTION_GATEWAY_URL",
];

/// The domain of the addresses [`Stack::user`](crate::Stack::user) and
/// [`Stack::unique_user`](crate::Stack::unique_user) give: the worker
/// classifies the inboxes at it and no others.
const INBOX_DOMAIN: &str = "example.com";

/// The environment of `email_focus_worker`.
///
/// `email_env` is the email services' environment, `model_url` and
/// `harness_url` the stand-ins the worker asks, and `overrides` the
/// scenario's own variables, which replace anything set here.
pub(crate) fn focus_env(
    email_env: &BTreeMap<String, String>,
    model_url: &str,
    harness_url: &str,
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
        // The key the stand-in asks for; the worker stays off without one.
        ("TYPESAFE_API_KEY", crate::focus::MODEL_API_KEY.to_owned()),
        ("FOCUS_ENABLED_EMAIL_DOMAINS", INBOX_DOMAIN.to_owned()),
        // Production's hour: the sweep at startup is the only one a
        // scenario sees, so mail is classified from its events.
        ("FOCUS_SWEEP_INTERVAL_SECS", "3600".to_owned()),
        ("OVERRIDE_TYPESAFE_API_URL", model_url.to_owned()),
        ("OVERRIDE_AGENT_HARNESS_SERVICE_URL", harness_url.to_owned()),
    ];
    env.extend(own.map(|(name, value)| (name.to_owned(), value)));
    env.extend(overrides.iter().cloned());
    env
}
