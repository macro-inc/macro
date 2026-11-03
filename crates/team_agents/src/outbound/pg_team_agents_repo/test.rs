use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgTeamAgentsRepo;
use crate::domain::models::NewAgentAccount;
use crate::domain::ports::TeamAgentRepository;

const ADMIN: &str = "macro|admin@example.com";
const AGENT: &str = "macro|sam-1a2b3c@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id)
        .map(MacroUserIdStr::into_owned)
        .expect("valid user id")
}

/// Seeds an admin, their team, and a team runtime; returns (team, harness).
async fn seed(pool: &PgPool) -> (Uuid, Uuid) {
    let macro_user_id = Uuid::now_v7();
    let team_id = Uuid::now_v7();
    let harness_id = Uuid::now_v7();

    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(ADMIN)
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(ADMIN)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .expect("user should insert");
    sqlx::query(r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Acme', $2)"#)
        .bind(team_id)
        .bind(ADMIN)
        .execute(pool)
        .await
        .expect("team should insert");
    sqlx::query(
        r#"INSERT INTO harnesses (id, name, team_id, created_by) VALUES ($1, 'Office Mac', $2, $3)"#,
    )
    .bind(harness_id)
    .bind(team_id)
    .bind(ADMIN)
    .execute(pool)
    .await
    .expect("harness should insert");

    (team_id, harness_id)
}

fn account(team_id: Uuid, harness_id: Uuid) -> NewAgentAccount {
    NewAgentAccount {
        user_id: user(AGENT),
        email: "sam-1a2b3c@example.com".to_string(),
        team_id,
        created_by: user(ADMIN),
        name: "Sam".to_string(),
        job_description: "Books venues.".to_string(),
        personality: "Warm and direct.".to_string(),
        avatar_url: None,
        harness_id,
        mailbox_id: Some("inbox-1".to_string()),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn created_agent_reads_back_with_its_brain(pool: PgPool) {
    let (team_id, harness_id) = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    let bot_id = Uuid::now_v7();
    let session_id = Uuid::now_v7();

    repo.create_account(&account(team_id, harness_id))
        .await
        .expect("account should be created");
    repo.set_brain(&user(AGENT), bot_id, session_id)
        .await
        .expect("brain should be recorded");

    let agent = repo
        .get(&user(AGENT))
        .await
        .expect("get should succeed")
        .expect("agent should exist");
    assert_eq!(agent.name, "Sam");
    assert_eq!(agent.team_id, team_id);
    assert_eq!(agent.created_by, Some(user(ADMIN)));
    assert_eq!(agent.brain_bot_id, Some(bot_id));
    assert_eq!(agent.brain_session_id, Some(session_id));
    assert_eq!(
        repo.mailbox_id(&user(AGENT)).await.expect("mailbox read"),
        Some("inbox-1".to_string())
    );
    assert_eq!(repo.get(&user(ADMIN)).await.expect("get admin"), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_account_removes_every_row(pool: PgPool) {
    let (team_id, harness_id) = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());

    repo.create_account(&account(team_id, harness_id))
        .await
        .expect("account should be created");
    repo.delete_account(&user(AGENT))
        .await
        .expect("account should be deleted");

    let users: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "User" WHERE id = $1"#)
        .bind(AGENT)
        .fetch_one(&pool)
        .await
        .expect("count users");
    let macro_users: i64 =
        sqlx::query_scalar(r#"SELECT COUNT(*) FROM macro_user WHERE username = $1"#)
            .bind(AGENT)
            .fetch_one(&pool)
            .await
            .expect("count macro users");
    assert_eq!((users, macro_users), (0, 0));
    assert_eq!(repo.get(&user(AGENT)).await.expect("get"), None);
}
