//! Scheduled notification retention composition root. Invocation is internal;
//! the notification domain owns the policy and all deletion orchestration.

mod handler;

use std::{str::FromStr, sync::Arc, time::Duration};

use lambda_runtime::{Error, run, service_fn};
use macro_entrypoint::MacroEntrypoint;
use macro_env_var::env_vars;
use notification::{
    domain::retention::NotificationRetentionService,
    outbound::retention::PgNotificationRetentionRepository,
};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

env_vars! {
    struct DatabaseUrl;
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    let telemetry = Arc::new(MacroEntrypoint::default().init());
    let database_url = DatabaseUrl::new()?;
    // Bound preview queries as well as deletes. One maintenance connection per
    // process, and reserved Lambda concurrency of one, isolate foreground work.
    let options = PgConnectOptions::from_str(database_url.as_ref())?
        .application_name("notification_retention_handler")
        .options([
            ("statement_timeout", "5000"),
            ("lock_timeout", "1000"),
            ("idle_in_transaction_session_timeout", "10000"),
        ]);
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await?;
    let service = Arc::new(NotificationRetentionService::new(
        PgNotificationRetentionRepository::new(pool),
    ));
    run(service_fn(move |event| {
        let service = Arc::clone(&service);
        let telemetry = Arc::clone(&telemetry);
        async move {
            // `handle` must finish (closing its root span) before flushing.
            // A telemetry outage must not turn a committed cleanup into a retry.
            let result = handler::handle(&service, event).await;
            match tokio::time::timeout(Duration::from_secs(5), telemetry.force_flush()).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => tracing::error!(error = ?error, "notification retention telemetry flush failed"),
                Err(error) => tracing::error!(error = ?error, "notification retention telemetry flush timed out"),
            }
            result
        }
    }))
    .await
}
