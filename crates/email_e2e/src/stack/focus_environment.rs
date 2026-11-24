//! The environment `email_focus_worker` runs with: the email services'
//! database, broker and gateway stand-in, plus its own settings.

use std::collections::BTreeMap;

use crate::focus::FocusStandIns;

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

/// The environment of `email_focus_worker`.
///
/// `email_env` is the email services' environment, `stand_ins` what the
/// worker asks outside the database, and `overrides` the scenario's own
/// variables, which replace anything set here.
pub(crate) fn focus_env(
    email_env: &BTreeMap<String, String>,
    stand_ins: &FocusStandIns,
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
        // Production's hour: the sweep at startup is the only one a
        // scenario sees, so mail is classified from its events.
        ("FOCUS_SWEEP_INTERVAL_SECS", "3600".to_owned()),
        // The line that says a thread was left unclassified, and why, is
        // debug: `Stack::focus_skipped_without_flag` reads it.
        (
            "RUST_LOG",
            "info,email_focus_worker::inbound::kafka_consumer=debug".to_owned(),
        ),
        ("OVERRIDE_TYPESAFE_API_URL", stand_ins.model_url()),
        (
            "OVERRIDE_AGENT_HARNESS_SERVICE_URL",
            stand_ins.harness_url(),
        ),
        // The worker classifies an inbox only while its owner, or a user it
        // is linked to, has the Focus flag, which it reads from PostHog's
        // definitions.
        ("POSTHOG_HOST", stand_ins.flags_url()),
        (
            "POSTHOG_API_KEY",
            crate::focus::POSTHOG_PROJECT_KEY.to_owned(),
        ),
        (
            "POSTHOG_FEATURE_FLAGS_SECURE_API_KEY",
            crate::focus::POSTHOG_SECRET_KEY.to_owned(),
        ),
    ];
    env.extend(own.map(|(name, value)| (name.to_owned(), value)));
    env.extend(overrides.iter().cloned());
    env
}
