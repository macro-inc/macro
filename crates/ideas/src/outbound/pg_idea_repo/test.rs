use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::model::{ChangeAction, RunMode};

/// A person who can own ideas.
pub(crate) async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

const OWNER: &str = "macro|ideas-repo@macro.com";

async fn generation(pool: &PgPool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion_generation (id, user_id, trigger, status, started_at)
           VALUES ($1, $2, 'onboarding', 'generating', now())"#,
        id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

fn content(key: &str) -> IdeaContent {
    IdeaContent {
        dedup_key: key.to_owned(),
        title: "Compare quotes".to_owned(),
        summary: "Three arrived.".to_owned(),
        importance: 50,
        categories: Vec::new(),
        about: Vec::new(),
        prompt: Some("Compare them.".to_owned()),
    }
}

/// Concurrent writes can't pass the limits together: the person's writes
/// queue on one lock.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_creates_stay_within_the_limits(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let generation = generation(&pool).await;
    let repo = std::sync::Arc::new(PgIdeaRepo::new(pool));
    let user = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let limits = Limits {
        open: 30,
        new_per_generation: 3,
    };
    let writes = (0..8).map(|n| {
        let repo = std::sync::Arc::clone(&repo);
        let user = user.clone();
        async move {
            let change = Change {
                session: Uuid::now_v7(),
                generation,
                action: ChangeAction::Created,
                old: None,
                new: None,
                reason: None,
                at: Utc::now(),
            };
            repo.create(
                &user,
                Uuid::now_v7(),
                &NewKind::Prompt {
                    run_mode: RunMode::Composer,
                },
                &content(&format!("idea:{n}")),
                limits,
                &change,
            )
            .await
            .unwrap()
        }
    });
    let written = futures::future::join_all(writes).await;
    assert_eq!(
        written.iter().filter(|w| **w == Written::Applied).count(),
        3
    );
    assert_eq!(repo.added_in(generation).await.unwrap(), 3);
    assert_eq!(repo.ideas(&user).await.unwrap().len(), 3);
}
