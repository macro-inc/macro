use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgTeamAgentsRepo;
use crate::domain::models::{NewAgentAccount, PersonaSeed, TeamAgentStatus};
use crate::domain::ports::TeamAgentRepository;

const ADMIN: &str = "macro|admin@example.com";
const AGENT: &str = "macro|sam-1a2b3c@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id)
        .map(MacroUserIdStr::into_owned)
        .expect("valid user id")
}

/// Seeds an admin and their team; returns the team.
async fn seed(pool: &PgPool) -> Uuid {
    let macro_user_id = Uuid::now_v7();
    let team_id = Uuid::now_v7();

    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        ADMIN
    )
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        ADMIN,
        macro_user_id
    )
    .execute(pool)
    .await
    .expect("user should insert");
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Acme', $2)"#,
        team_id,
        ADMIN
    )
    .execute(pool)
    .await
    .expect("team should insert");

    team_id
}

fn account(team_id: Uuid) -> NewAgentAccount {
    NewAgentAccount {
        persona_seed: PersonaSeed {
            creator_id: Some(user(ADMIN)),
            name: "Sam".to_string(),
            job_description: "Help the team".to_string(),
            personality: "Direct".to_string(),
        },
        user_id: user(AGENT),
        email: "sam-1a2b3c@example.com".to_string(),
        team_id,
        created_by: user(ADMIN),
        name: "Sam".to_string(),
        avatar_url: None,
        mailbox_id: Some(
            crate::domain::mail::MailboxId::parse("inbox-1".to_string()).expect("mailbox id"),
        ),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_created_agent_reads_back_and_tracks_its_computer(pool: PgPool) {
    let team_id = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    let computer_id = Uuid::now_v7();

    repo.create_account(&account(team_id))
        .await
        .expect("account should be created");

    assert_eq!(
        repo.persona_seed(&user(AGENT)).await.unwrap(),
        Some(account(team_id).persona_seed)
    );
    let agent = repo
        .get(&user(AGENT))
        .await
        .expect("get should succeed")
        .expect("agent should exist");
    assert_eq!(agent.name, "Sam");
    assert_eq!(agent.email, "sam-1a2b3c@example.com");
    assert_eq!(agent.team_id, team_id);
    assert_eq!(agent.created_by, Some(user(ADMIN)));
    assert_eq!(agent.computer_id, None);
    assert_eq!(agent.status, TeamAgentStatus::Provisioning);

    let is_agent: bool =
        sqlx::query_scalar!(r#"SELECT "isAgent" FROM "User" WHERE id = $1"#, AGENT)
            .fetch_one(&pool)
            .await
            .expect("user row");
    assert!(is_agent, "the account is marked as an agent");

    repo.set_computer(&user(AGENT), computer_id)
        .await
        .expect("computer recorded");
    repo.set_status(&user(AGENT), TeamAgentStatus::Failed, Some("no capacity"))
        .await
        .expect("status recorded");

    let listed = repo.list_for_team(team_id).await.expect("listed");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].computer_id, Some(computer_id));
    assert_eq!(listed[0].status, TeamAgentStatus::Failed);
    assert_eq!(listed[0].status_reason.as_deref(), Some("no capacity"));
    assert_eq!(
        repo.mailbox_id(&user(AGENT)).await.expect("mailbox read"),
        Some(crate::domain::mail::MailboxId::parse("inbox-1".to_string()).expect("mailbox id"))
    );
    assert_eq!(repo.get(&user(ADMIN)).await.expect("get admin"), None);
    assert_eq!(
        repo.list_for_team(Uuid::now_v7()).await.expect("listed"),
        vec![]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn older_saved_persona_seeds_default_to_no_creator(pool: PgPool) {
    let team_id = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    repo.create_account(&account(team_id)).await.unwrap();
    sqlx::query!(
        "UPDATE team_agents SET persona_seed = persona_seed - 'creator_id' WHERE user_id = $1",
        AGENT
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.persona_seed(&user(AGENT))
            .await
            .unwrap()
            .unwrap()
            .creator_id,
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_account_removes_every_row(pool: PgPool) {
    let team_id = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());

    repo.create_account(&account(team_id))
        .await
        .expect("account should be created");
    repo.delete_account(&user(AGENT))
        .await
        .expect("account should be deleted");

    let users: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "User" WHERE id = $1"#,
        AGENT
    )
    .fetch_one(&pool)
    .await
    .expect("count users");
    let macro_users: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM macro_user WHERE username = $1"#,
        AGENT
    )
    .fetch_one(&pool)
    .await
    .expect("count macro users");
    assert_eq!((users, macro_users), (0, 0));
    assert_eq!(repo.get(&user(AGENT)).await.expect("get"), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_agents_have_no_recovery_seed(pool: PgPool) {
    let team_id = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    repo.create_account(&account(team_id)).await.unwrap();
    sqlx::query!(
        "UPDATE team_agents SET persona_seed = NULL WHERE user_id = $1",
        AGENT
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(repo.persona_seed(&user(AGENT)).await.unwrap(), None);
    assert!(repo.get(&user(AGENT)).await.unwrap().is_some());
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn included_policy_reads_only_the_current_owners_verified_primary_email(pool: PgPool) {
    let _team_id = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool.clone());
    assert_eq!(repo.verified_email(&user(ADMIN)).await.unwrap(), None);
    sqlx::query!(
        r#"UPDATE "User" SET email = 'owner@staff.example.com' WHERE id = $1"#,
        ADMIN
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO macro_user_email_verification (macro_user_id, email, is_verified)
        SELECT macro_user_id, email, false FROM "User" WHERE id = $1"#,
        ADMIN
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(repo.verified_email(&user(ADMIN)).await.unwrap(), None);
    sqlx::query!(r#"UPDATE macro_user_email_verification SET is_verified = true WHERE email = 'owner@staff.example.com'"#).execute(&pool).await.unwrap();
    assert_eq!(
        repo.verified_email(&user(ADMIN)).await.unwrap().as_deref(),
        Some("owner@staff.example.com")
    );
    sqlx::query!(
        r#"UPDATE "User" SET email = 'new@example.com' WHERE id = $1"#,
        ADMIN
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(repo.verified_email(&user(ADMIN)).await.unwrap(), None);
    assert_eq!(
        repo.verified_email(&user("macro|missing@example.com"))
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn transient_health_cannot_be_stored_as_failure(pool: PgPool) {
    let team_id = seed(&pool).await;
    let repo = PgTeamAgentsRepo::new(pool);
    repo.create_account(&account(team_id)).await.unwrap();
    repo.set_status(
        &user(AGENT),
        TeamAgentStatus::Unhealthy,
        Some("unhealthy: disconnected"),
    )
    .await
    .unwrap();
    let agent = repo.get(&user(AGENT)).await.unwrap().unwrap();
    assert_eq!(agent.status, TeamAgentStatus::Running);
    assert_eq!(agent.status_reason, None);
}
