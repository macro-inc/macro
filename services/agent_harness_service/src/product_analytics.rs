//! Server-side product events sent to PostHog, attributed to the user's team,
//! with the same context properties as the web app's events.

use std::sync::Arc;

use analytics_client::{
    AnalyticsClient, AnalyticsClientConfig, BackgroundSender, PostHogConfig, ProductEventProperties,
};
use entity_access::{domain::ports::AccessRepository, outbound::PgAccessRepository};
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use sqlx::PgPool;

/// Most sends in flight at once per [`ProductAnalytics`]; past it, events are
/// dropped.
const MAX_IN_FLIGHT_SENDS: usize = 16;

/// Records product events to PostHog, or nothing when PostHog is not
/// configured.
#[derive(Clone)]
pub struct ProductAnalytics {
    sink: Option<Arc<PostHogSink>>,
}

struct PostHogSink {
    sender: BackgroundSender,
    teams: PgAccessRepository,
    environment: Environment,
}

impl ProductAnalytics {
    /// PostHog analytics when `api_key` is set; otherwise analytics that
    /// record nothing. `host` falls back to the US ingestion origin.
    pub fn new(
        api_key: Option<&str>,
        host: Option<&str>,
        environment: Environment,
        db: &PgPool,
    ) -> Self {
        let Some(api_key) = api_key else {
            return Self { sink: None };
        };
        let client = AnalyticsClient::new(AnalyticsClientConfig {
            posthog: Some(PostHogConfig {
                api_key: api_key.to_owned(),
                host: host.unwrap_or("https://us.i.posthog.com").to_owned(),
            }),
            ..AnalyticsClientConfig::default()
        });
        Self {
            sink: Some(Arc::new(PostHogSink {
                sender: BackgroundSender::new(client, MAX_IN_FLIGHT_SENDS),
                teams: PgAccessRepository::new(db.clone()),
                environment,
            })),
        }
    }

    /// Whether events are sent anywhere.
    pub fn is_enabled(&self) -> bool {
        self.sink.is_some()
    }

    /// Records `event` in the background so analytics never delays or fails
    /// the work it describes.
    pub fn track<P>(&self, user_id: MacroUserIdStr<'static>, event: &'static str, properties: P)
    where
        P: Serialize + Send + Sync + 'static,
    {
        let Some(sink) = &self.sink else {
            return;
        };
        let task_sink = sink.clone();
        sink.sender.spawn(move |posthog| async move {
            task_sink
                .capture(&posthog, user_id, event, properties)
                .await;
        });
    }
}

impl PostHogSink {
    async fn capture<P: Serialize>(
        &self,
        posthog: &AnalyticsClient,
        user_id: MacroUserIdStr<'static>,
        event: &'static str,
        properties: P,
    ) {
        let team_id = self
            .teams
            .get_user_team(&user_id.0)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, event, "failed to resolve team for product analytics");
            })
            .ok()
            .flatten()
            .map(|team| team.team_id);
        let properties = ProductEventProperties::new(properties, self.environment, team_id);
        let _ = posthog
            .track_posthog(user_id.as_ref(), event, &properties)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, event, "failed to track product analytics event");
            });
    }
}
