use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::models::{AgentName, CreatedAccount, NewAgentAccount, PersonaSeed, PurchaseKey};
use crate::domain::ports::TeamAgentRepository;
use crate::outbound::pg_team_agents_repo::PgTeamAgentsRepo;

const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);
const AGENT: &str = "macro|sam-rivera-abc123@agents.macro.invalid";
const ADMIN: &str = "macro|admin@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

/// A team with its admin and one invited agent.
async fn team_with_agent(pool: &PgPool) {
    let macro_user_id = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_0011);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'admin@example.com', 'admin@example.com', 'cus_admin')
        "#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|admin@example.com', 'admin@example.com', $1)"#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Agents', 'macro|admin@example.com')",
        TEAM,
    )
    .execute(pool)
    .await
    .unwrap();
    let created = PgTeamAgentsRepo::new(pool.clone())
        .create_account(&NewAgentAccount {
            user_id: user(AGENT),
            email: "sam-rivera-abc123@agents.macro.invalid".to_owned(),
            team_id: TEAM,
            created_by: user(ADMIN),
            name: AgentName::try_new("Sam Rivera").unwrap(),
            avatar_url: None,
            persona_seed: PersonaSeed {
                creator_id: Some(user(ADMIN)),
                name: "Sam Rivera".to_owned(),
                job_description: String::new(),
                personality: String::new(),
                voice: None,
            },
            purchase_key: PurchaseKey::try_new("invite-1".to_owned()).unwrap(),
        })
        .await
        .unwrap();
    assert_eq!(created, CreatedAccount::Created);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_first_reserve_wins_and_a_later_one_gets_its_request_id(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);

    let reserved = inboxes
        .reserve(&user(AGENT), TEAM, first, AgentInboxState::Provisioning)
        .await
        .unwrap();
    let again = inboxes
        .reserve(&user(AGENT), TEAM, second, AgentInboxState::Paused)
        .await
        .unwrap();

    assert_eq!(reserved.request_id, first);
    assert_eq!(reserved.state, AgentInboxState::Provisioning);
    assert_eq!(again.request_id, first);
    assert_eq!(again, reserved);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_update_keeps_a_known_mailbox_and_address_and_lists_by_team(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    let mailbox = Uuid::from_u128(9);
    inboxes
        .reserve(
            &user(AGENT),
            TEAM,
            Uuid::from_u128(1),
            AgentInboxState::Provisioning,
        )
        .await
        .unwrap();

    inboxes
        .update(
            &user(AGENT),
            &InboxUpdate {
                mailbox_id: Some(mailbox),
                address: Some("sam-rivera@agents.example.com".to_owned()),
                state: AgentInboxState::Active,
                last_error: None,
                fake_provider: true,
            },
        )
        .await
        .unwrap();
    let paused = inboxes
        .update(
            &user(AGENT),
            &InboxUpdate {
                mailbox_id: None,
                address: None,
                state: AgentInboxState::Failed,
                last_error: Some(AgentInboxFailure::Unavailable),
                fake_provider: true,
            },
        )
        .await
        .unwrap();

    assert_eq!(paused.mailbox_id, Some(mailbox));
    assert_eq!(
        paused.address.as_deref(),
        Some("sam-rivera@agents.example.com")
    );
    assert_eq!(paused.state, AgentInboxState::Failed);
    assert_eq!(paused.last_error, Some(AgentInboxFailure::Unavailable));
    let listed = inboxes.list_for_team(TEAM).await.unwrap();
    assert_eq!(listed, vec![paused]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_the_agents_seat_drops_its_inbox_record(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    inboxes
        .reserve(
            &user(AGENT),
            TEAM,
            Uuid::from_u128(1),
            AgentInboxState::Provisioning,
        )
        .await
        .unwrap();

    PgTeamAgentsRepo::new(pool.clone())
        .remove_seat(&user(AGENT))
        .await
        .unwrap();

    assert_eq!(inboxes.get(&user(AGENT)).await.unwrap(), None);
    assert!(matches!(
        inboxes
            .update(
                &user(AGENT),
                &InboxUpdate {
                    mailbox_id: None,
                    address: None,
                    state: AgentInboxState::Released,
                    last_error: None,
                    fake_provider: false,
                },
            )
            .await,
        Err(PgAgentInboxesError::Missing)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_update_never_overwrites_an_inbox_being_wound_down(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    inboxes
        .reserve(
            &user(AGENT),
            TEAM,
            Uuid::from_u128(1),
            AgentInboxState::Paused,
        )
        .await
        .unwrap();
    let active = InboxUpdate {
        mailbox_id: Some(Uuid::from_u128(9)),
        address: Some("sam-rivera@agents.example.com".to_owned()),
        state: AgentInboxState::Active,
        last_error: None,
        fake_provider: false,
    };

    let refused = inboxes.update_live(&user(AGENT), &active).await.unwrap();

    assert_eq!(refused, None);
    assert_eq!(
        inboxes.get(&user(AGENT)).await.unwrap().unwrap().state,
        AgentInboxState::Paused
    );
}
