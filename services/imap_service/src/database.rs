//! The engine owns no idle database connections before it is used.
use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

pub(crate) fn pool(url: &str) -> Result<PgPool, sqlx::Error> {
    let options = url
        .parse::<PgConnectOptions>()?
        .application_name("imap_service");
    Ok(PgPoolOptions::new()
        .min_connections(0)
        .max_connections(10)
        // Reaping may take twice the idle timeout; leave margin before the next poll.
        .idle_timeout(super::scheduler::POLL_INTERVAL / 3)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query!(
                    r#"
                    SET statement_timeout = '30s'
                    "#,
                )
                .execute(connection)
                .await?;
                Ok(())
            })
        })
        .connect_lazy_with(options))
}

#[cfg(test)]
mod test;
