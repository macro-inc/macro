use std::sync::Arc;

use crate::{
    config::{Config, Environment},
    context::Context,
    domain::{models::MaintenanceConfig, ports::RefreshService, service::LinkMaintenance},
    outbound::{postgres::PostgresLinkRepository, sqs::SqsLinkManagerQueue},
};

pub(crate) fn context(
    db: sqlx::PgPool,
    sqs_client: Arc<sqs_client::SQS>,
    config: Config,
) -> Context<impl RefreshService> {
    Context {
        service: Arc::new(LinkMaintenance::new(
            PostgresLinkRepository::new(db),
            SqsLinkManagerQueue::new(sqs_client),
            MaintenanceConfig {
                is_production: matches!(config.environment, Environment::Production),
                delete_unused_after_days: config.delete_unused_after_days,
                delete_inactive_after_days: config.delete_inactive_after_days,
                health_poll_interval_hours: config.health_poll_interval_hours,
            },
        )),
    }
}
