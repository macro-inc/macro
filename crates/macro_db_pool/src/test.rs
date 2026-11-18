use super::*;
use sqlx::postgres::PgPoolOptions;

#[sqlx::test(migrations = false)]
async fn request_sessions_start_with_the_request_timeouts(
    pool_options: PgPoolOptions,
    connect_options: PgConnectOptions,
) {
    let pool = pool_options
        .connect_with(with_request_timeouts(connect_options))
        .await
        .unwrap();

    let settings = sqlx::query!(
        "SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(settings.statement_timeout.as_deref(), Some("30s"));
    assert_eq!(
        settings.idle_in_transaction_session_timeout.as_deref(),
        Some("1min")
    );
}
