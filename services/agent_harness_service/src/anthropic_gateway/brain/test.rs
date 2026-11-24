use std::time::Duration;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::*;

const AGENT: &str = "macro|scout@example.com";

/// Always the agent, without looking anything up.
struct TheAgent;

impl BrainAuthenticator for TheAgent {
    fn authenticate<'a>(&'a self, _key: &'a str) -> BrainLookup<'a> {
        Box::pin(async {
            Ok(Some(BrainCaller {
                user_id: MacroUserIdStr::try_from(AGENT.to_owned()).unwrap(),
                team_id: Uuid::nil(),
            }))
        })
    }
}

/// A person drives the agent's computer for the next hour.
async fn driven(pool: &PgPool) {
    let session = Uuid::now_v7();
    let (harness, computer) = (Uuid::now_v7(), Uuid::now_v7());
    sqlx::query!(
        "INSERT INTO computer_screen_sessions (id, harness_id, computer_id, user_id, transport, surface, mode)
         VALUES ($1, $2, $3, 'macro|alice@example.com', 'vnc', 'desktop', 'drive')",
        session,
        harness,
        computer,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO computer_screen_driver_leases
             (computer_id, harness_id, session_id, user_id, agent_user_id, expires_at)
         VALUES ($1, $2, $3, 'macro|alice@example.com', $4, now() + interval '1 hour')",
        computer,
        harness,
        session,
        AGENT,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_shutdown_answers_a_held_brain_at_once(pool: PgPool) {
    driven(&pool).await;
    let shutdown = CancellationToken::new();
    let brains = HeldBrains::new(
        Arc::new(TheAgent),
        crate::computers::screen::test_screens(pool).await,
        shutdown.clone(),
    );

    let held = tokio::spawn(async move { brains.authenticate("mak_key").await.map(|_| ()) });
    shutdown.cancel();
    let answered = tokio::time::timeout(Duration::from_secs(10), held)
        .await
        .expect("the held request outlived the shutdown")
        .unwrap();

    assert!(
        matches!(answered, Err(BrainLookupError::Held { retry_after }) if retry_after == HELD_RETRY_AFTER),
        "{answered:?}"
    );
}
