use std::sync::Arc;

use crate::{
    context::Context,
    domain::{ports::SfsDeleteService, service::OrphanCleanup},
    outbound::{postgres::PostgresOrphanRepository, sqs::SqsDeleteQueue},
};

pub(crate) fn context(
    db: sqlx::PgPool,
    sqs_client: Arc<sqs_client::SQS>,
) -> Context<impl SfsDeleteService> {
    Context {
        service: Arc::new(OrphanCleanup::new(
            PostgresOrphanRepository::new(db),
            SqsDeleteQueue::new(sqs_client),
        )),
    }
}
