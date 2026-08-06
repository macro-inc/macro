//! Composition root: builds the dispatch service from environment config.

use macro_env_var::env_vars;
use notification::domain::service::SqsNotificationIngress;
use notification::outbound::queue::SqsQueue;
use reminders::domain::models::DispatchSummary;
use reminders::domain::ports::ReminderDispatch;
use reminders::domain::service::dispatch::ReminderDispatchService;
use reminders::outbound::notification_notifier::NotificationReminderNotifier;
use reminders::outbound::pg_reminders_repo::PgRemindersRepo;
use rootcause::{Report, prelude::*};
use sqlx::postgres::PgPoolOptions;

env_vars! {
    struct DatabaseUrl;
}

/// How many due reminders one invocation will handle.
///
/// The schedule fires every minute, so a backlog drains rather than being
/// dropped. Bounded so a large backlog cannot stretch one invocation past its
/// Lambda timeout.
const BATCH_SIZE: i64 = 100;

type DispatchService = ReminderDispatchService<
    PgRemindersRepo,
    NotificationReminderNotifier<SqsNotificationIngress<SqsQueue>>,
>;

/// Everything one invocation needs, built once per cold start.
pub struct AppContext {
    dispatch: DispatchService,
}

impl AppContext {
    /// Build the dispatch context from environment variables.
    pub async fn from_env() -> Result<Self, Report> {
        let database_url = DatabaseUrl::new().context("DATABASE_URL must be provided")?;
        // The var only has to be present to deserialize, so a blank value would
        // otherwise reach `connect` and fail as an opaque parse error.
        let database_url = database_url.as_ref().trim();
        if database_url.is_empty() {
            bail!("DATABASE_URL must not be blank");
        }

        // One connection is enough: the sweep is sequential, and a Lambda that
        // holds a wide pool open across cold starts starves the shared database.
        let pool = PgPoolOptions::new()
            .min_connections(1)
            .max_connections(1)
            .connect(database_url)
            .await
            .context("failed to connect to postgres")?;

        let aws_config = macro_aws_config::get_macro_aws_config().await;
        let ingress = SqsNotificationIngress {
            queue: SqsQueue::new(
                aws_sdk_sqs::Client::new(&aws_config),
                macro_queues::NotificationIngressQueue::new().to_string(),
            ),
        };

        let dispatch = ReminderDispatchService::new(
            PgRemindersRepo::new(pool),
            NotificationReminderNotifier::new(ingress),
        );

        Ok(Self { dispatch })
    }

    /// Sweep the reminders that are currently due.
    pub async fn dispatch_due(&self) -> Result<DispatchSummary, Report> {
        Ok(self
            .dispatch
            .dispatch_due(BATCH_SIZE)
            .await
            .context("reminder dispatch sweep failed")?)
    }
}
