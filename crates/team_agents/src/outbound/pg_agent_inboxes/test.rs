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
async fn the_inbox_record_outlives_the_agents_seat_and_its_team(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    inboxes
        .reserve(
            &user(AGENT),
            TEAM,
            Uuid::from_u128(1),
            AgentInboxState::Pausing,
        )
        .await
        .unwrap();

    PgTeamAgentsRepo::new(pool.clone())
        .remove_seat(&user(AGENT))
        .await
        .unwrap();
    sqlx::query!("DELETE FROM team WHERE id = $1", TEAM)
        .execute(&pool)
        .await
        .unwrap();

    // Still there for the sweep, which claims it once its first attempt
    // is due, and not again until its backoff has passed.
    let record = inboxes.get(&user(AGENT)).await.unwrap().unwrap();
    assert_eq!(record.state, AgentInboxState::Pausing);
    let due = record.updated_at + chrono::Duration::minutes(2);
    assert_eq!(
        inboxes
            .claim_unsettled(record.updated_at, 10)
            .await
            .unwrap(),
        vec![]
    );
    assert_eq!(
        inboxes.claim_unsettled(due, 10).await.unwrap(),
        vec![record]
    );
    assert_eq!(inboxes.claim_unsettled(due, 10).await.unwrap(), vec![]);
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
            AgentInboxState::Provisioning,
        )
        .await
        .unwrap();
    let update = |state| InboxUpdate {
        mailbox_id: None,
        address: None,
        state,
        last_error: None,
        fake_provider: false,
    };
    for wound_down in [
        AgentInboxState::Releasing,
        AgentInboxState::Released,
        AgentInboxState::Paused,
    ] {
        inboxes
            .update(&user(AGENT), &update(wound_down))
            .await
            .unwrap();

        let refused = inboxes
            .update_live(&user(AGENT), &update(AgentInboxState::Active))
            .await
            .unwrap();

        assert_eq!(refused, None, "{wound_down:?}");
        assert_eq!(
            inboxes.get(&user(AGENT)).await.unwrap().unwrap().state,
            wound_down
        );
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_seated_reserve_needs_the_agent_on_the_team(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    let other_team = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00bb);

    assert_eq!(
        inboxes
            .reserve_seated(&user(AGENT), other_team, Uuid::from_u128(1))
            .await
            .unwrap(),
        None
    );
    let reserved = inboxes
        .reserve_seated(&user(AGENT), TEAM, Uuid::from_u128(1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reserved.state, AgentInboxState::Provisioning);
    assert_eq!(
        inboxes.seated_agents(TEAM).await.unwrap(),
        vec![user(AGENT)]
    );

    PgTeamAgentsRepo::new(pool.clone())
        .remove_seat(&user(AGENT))
        .await
        .unwrap();

    assert_eq!(
        inboxes
            .reserve_seated(&user(AGENT), TEAM, Uuid::from_u128(2))
            .await
            .unwrap(),
        None
    );
    assert_eq!(inboxes.seated_agents(TEAM).await.unwrap(), vec![]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_settle_only_moves_the_mark_it_was_started_from(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    inboxes
        .reserve(
            &user(AGENT),
            TEAM,
            Uuid::from_u128(1),
            AgentInboxState::Releasing,
        )
        .await
        .unwrap();
    let paused = InboxUpdate {
        mailbox_id: None,
        address: None,
        state: AgentInboxState::Paused,
        last_error: None,
        fake_provider: false,
    };

    // A pause finishing late never overwrites a release in progress.
    assert_eq!(
        inboxes
            .settle(&user(AGENT), AgentInboxState::Pausing, &paused)
            .await
            .unwrap(),
        None
    );
    let released = InboxUpdate {
        state: AgentInboxState::Released,
        ..paused
    };
    let settled = inboxes
        .settle(&user(AGENT), AgentInboxState::Releasing, &released)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(settled.state, AgentInboxState::Released);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_sweep_finds_a_live_inbox_whose_agent_lost_its_seat(pool: PgPool) {
    team_with_agent(&pool).await;
    let inboxes = PgAgentInboxes::new(pool.clone());
    let record = inboxes
        .reserve_seated(&user(AGENT), TEAM, Uuid::from_u128(1))
        .await
        .unwrap()
        .unwrap();
    let window = |record: &InboxRecord| {
        (
            record.updated_at - chrono::Duration::minutes(1),
            record.updated_at + chrono::Duration::minutes(1),
        )
    };
    let (after, before) = window(&record);
    assert_eq!(
        inboxes.seatless_live(after, before, 10).await.unwrap(),
        vec![]
    );

    PgTeamAgentsRepo::new(pool.clone())
        .remove_seat(&user(AGENT))
        .await
        .unwrap();

    assert_eq!(
        inboxes.seatless_live(after, before, 10).await.unwrap(),
        vec![record]
    );
}
