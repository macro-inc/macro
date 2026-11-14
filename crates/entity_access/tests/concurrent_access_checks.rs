//! Concurrent access checks through the repository production uses. A check
//! matches grants against the viewer's memberships inside its own statement,
//! so no caller looks up the viewer's teams and channels first, and there is no
//! such lookup for concurrent callers to share.

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use entity_access::domain::{models::AccessLevel, ports::AccessRepository};
use entity_access::outbound::PgAccessRepository;
use futures::future::join_all;
use macro_user_id::user_id::MacroUserId;
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};

const TEAM_INITIATIVE: &str = "7e000000-0000-0000-0000-0000000000a1";
const CHANNEL_INITIATIVE: &str = "7e000000-0000-0000-0000-0000000000a2";
const CHECKS: usize = 20;

/// A pool that counts connection checkouts. Each statement checks out one
/// connection, so the count is the number of statements that reached the
/// database.
async fn counting_pool(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> sqlx::Result<(PgPool, Arc<AtomicUsize>)> {
    let checkouts = Arc::new(AtomicUsize::new(0));
    let new_connections = Arc::clone(&checkouts);
    let reused_connections = Arc::clone(&checkouts);

    let pool = options
        .after_connect(move |_, _| {
            let checkouts = Arc::clone(&new_connections);
            Box::pin(async move {
                checkouts.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
        })
        .before_acquire(move |_, _| {
            let checkouts = Arc::clone(&reused_connections);
            Box::pin(async move {
                checkouts.fetch_add(1, Ordering::SeqCst);
                Ok(true)
            })
        })
        .connect_with(connect)
        .await?;

    Ok((pool, checkouts))
}

/// A member of one team and 200 channels, with an initiative shared with the
/// team and another shared with the last channel.
async fn seed(pool: &PgPool) -> sqlx::Result<()> {
    sqlx::raw_sql(
        r#"
        BEGIN;
        SET LOCAL session_replication_role = 'replica';
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ('macro|checks-once@example.test', '7e000000-0000-0000-0000-000000000001', 'member');
        INSERT INTO comms_channel_participants (channel_id, user_id, role)
        SELECT ('7e000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid,
               'macro|checks-once@example.test', 'member'
        FROM generate_series(1, 200) n;
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ('7e000000-0000-0000-0000-0000000000a1', 'initiative',
                '7e000000-0000-0000-0000-000000000001', 'team', 'edit'),
               ('7e000000-0000-0000-0000-0000000000a2', 'initiative',
                '7e000000-0000-0000-0001-000000000200', 'channel', 'view');
        COMMIT;
        "#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn concurrent_checks_for_one_user_run_one_statement_each(
    options: PgPoolOptions,
    connect: PgConnectOptions,
) -> anyhow::Result<()> {
    let (pool, checkouts) = counting_pool(options, connect).await?;
    seed(&pool).await?;
    let repo = PgAccessRepository::new(pool.clone());
    let user = MacroUserId::parse_from_str("macro|checks-once@example.test")?.lowercase();

    for (initiative, level) in [
        (TEAM_INITIATIVE, AccessLevel::Edit),
        (CHANNEL_INITIATIVE, AccessLevel::View),
    ] {
        let before = checkouts.load(Ordering::SeqCst);
        let checks = (0..CHECKS).map(|_| repo.get_initiative_access(initiative, Some(&user)));
        for access in join_all(checks).await {
            assert_eq!(access?, Some(level));
        }
        assert_eq!(checkouts.load(Ordering::SeqCst) - before, CHECKS);
    }

    Ok(())
}
