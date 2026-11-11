//! Properties shared by server-side product events.

#[cfg(test)]
mod test;

use macro_env::Environment;
use serde::Serialize;

/// An event's own properties plus the context the web app's events carry, so
/// server-side and browser events filter and group the same way in PostHog.
#[derive(Debug, Serialize)]
pub struct ProductEventProperties<P> {
    #[serde(flatten)]
    properties: P,
    /// Same values as the web app's `env` super property, so the usual
    /// `env != 'DEV'` filter also excludes the develop deployment here.
    env: &'static str,
    /// Same values as the web app's `macro_environment` super property.
    macro_environment: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_id: Option<uuid::Uuid>,
    /// PostHog group analytics, keyed like the web app's
    /// `posthog.group('team', ...)`.
    #[serde(rename = "$groups", skip_serializing_if = "Option::is_none")]
    groups: Option<TeamGroup>,
}

#[derive(Debug, Serialize)]
struct TeamGroup {
    team: uuid::Uuid,
}

impl<P> ProductEventProperties<P> {
    /// Wraps `properties` for an event from `environment`, attributed to
    /// `team_id` when the user belongs to a team.
    pub fn new(properties: P, environment: Environment, team_id: Option<uuid::Uuid>) -> Self {
        let (env, macro_environment) = match environment {
            Environment::Production => ("PROD", "prod"),
            Environment::Develop => ("DEV", "dev"),
            Environment::Local => ("LOCAL", "local"),
        };
        Self {
            properties,
            env,
            macro_environment,
            team_id,
            groups: team_id.map(|team| TeamGroup { team }),
        }
    }
}
