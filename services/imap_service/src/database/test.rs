use super::*;
use sqlx::ConnectOptions;

#[sqlx::test(migrations = false)]
async fn an_unused_engine_opens_no_connections_and_has_no_idle_minimum(db: PgPool) {
    let pool = pool(db.connect_options().to_url_lossy().as_str()).unwrap();
    assert_eq!(pool.size(), 0);
    assert_eq!(pool.options().get_min_connections(), 0);
    assert_eq!(pool.options().get_max_connections(), 10);
    assert_eq!(
        pool.options().get_idle_timeout(),
        Some(crate::scheduler::POLL_INTERVAL / 3)
    );
    let mut connection = pool.acquire().await.unwrap();
    assert_eq!(pool.size(), 1);
    connection.return_to_pool().await;
    pool.close().await;
    assert_eq!(pool.size(), 0);
}
