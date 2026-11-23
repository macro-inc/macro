use std::sync::Arc;

use crate::{
    domain::{ports::SuppressionService, service::NotificationSuppression},
    outbound::postgres::PostgresSuppressionStore,
};

pub(crate) fn service(db: sqlx::PgPool) -> Arc<impl SuppressionService> {
    Arc::new(NotificationSuppression::new(PostgresSuppressionStore::new(
        db,
    )))
}
