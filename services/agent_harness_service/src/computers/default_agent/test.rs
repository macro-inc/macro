use super::*;
use bots::domain::models::BotOwner;
use bots::domain::service::BotServiceImpl;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use harnesses::domain::models::CreateHostedPairing;
use harnesses::domain::ports::HarnessService;
use harnesses::domain::service::HarnessServiceImpl;
use harnesses::outbound::pg_harness_repo::PgHarnessRepo;
use hosted_runtimes::domain::ids::ComputerId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use sqlx::PgPool;

const BUYER: &str = "macro|buyer@example.com";
const TEAMMATE: &str = "macro|teammate@example.com";

/// A team of two whose admin bought a computer: the hosted harness the
/// operator pairs, owned by the buyer and granted to the team.
async fn team_computer(pool: &PgPool, team_id: Uuid) -> HarnessId {
    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES
            ('00000000-0000-4000-8000-000000000001', 'buyer@example.com', 'buyer@example.com', 'stripe_buyer'),
            ('00000000-0000-4000-8000-000000000002', 'teammate@example.com', 'teammate@example.com', 'stripe_teammate')
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES
            ('macro|buyer@example.com', 'buyer@example.com', '00000000-0000-4000-8000-000000000001'),
            ('macro|teammate@example.com', 'teammate@example.com', '00000000-0000-4000-8000-000000000002')
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Platform', $2)")
        .bind(team_id)
        .bind(BUYER)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $3, 'owner'), ($2, $3, 'member')
        "#,
    )
    .bind(BUYER)
    .bind(TEAMMATE)
    .bind(team_id)
    .execute(pool)
    .await
    .unwrap();

    let computer_id = ComputerId::new_from_uuid(Uuid::new_v4());
    HarnessServiceImpl::new(PgHarnessRepo::new(pool.clone()))
        .create_hosted_pairing(CreateHostedPairing {
            team_id,
            name: "Ada".to_owned(),
            created_by: MacroUserIdStr::try_from(BUYER.to_owned()).unwrap(),
            allow_permission_bypass: true,
            computer_id,
        })
        .await
        .unwrap();
    let harness: Uuid = sqlx::query_scalar("SELECT id FROM harnesses WHERE computer_id = $1")
        .bind(computer_id.as_uuid())
        .fetch_one(pool)
        .await
        .unwrap();
    HarnessId::new_from_uuid(harness)
}

fn bots(pool: &PgPool) -> BotServiceImpl<PgBotsRepo, NoopMacroEventBroker> {
    BotServiceImpl::new(PgBotsRepo::new(pool.clone()), NoopMacroEventBroker)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_ready_computer_gets_one_team_coding_agent(pool: PgPool) {
    let team_id = Uuid::new_v4();
    let harness_id = team_computer(&pool, team_id).await;
    // A teammate already took the natural handle on another runtime.
    bots(&pool)
        .create_agent(
            MacroUserIdStr::try_from(TEAMMATE.to_owned()).unwrap(),
            CreateAgentRequest {
                team_id: Some(team_id),
                harness_id: None,
                name: "Claude Code".to_owned(),
                handle: "claude-code-ada".to_owned(),
                description: None,
                avatar_url: None,
                instructions: String::new(),
                harness: "in-memory".to_owned(),
                default_model: "claude-sonnet-5".to_owned(),
                channel_scope: AgentChannelScope::All,
                channel_ids: Vec::new(),
                mcp: AgentMcpServers::OwnerConnections,
                auto_accept_permissions: None,
                is_coding: false,
            },
        )
        .await
        .unwrap();
    let agents = BotDefaultAgents::new(bots(&pool), PgBotsRepo::new(pool.clone()));
    let request = DefaultAgentRequest {
        team_id,
        buyer: MacroUserIdStr::try_from(BUYER.to_owned()).unwrap(),
        computer_name: "Ada".to_owned(),
        harness_id,
    };

    assert_eq!(
        agents.create(request.clone()).await.unwrap(),
        DefaultAgent::Created
    );
    assert_eq!(
        agents.create(request).await.unwrap(),
        DefaultAgent::AlreadyBound
    );

    // Every teammate sees it: a team agent on the computer, made by the buyer.
    let on_computer: Vec<_> = bots(&pool)
        .list_agents(MacroUserIdStr::try_from(TEAMMATE.to_owned()).unwrap())
        .await
        .unwrap()
        .into_iter()
        .filter(|agent| agent.harness_id == Some(harness_id))
        .collect();
    assert_eq!(on_computer.len(), 1);
    let agent = &on_computer[0];
    assert_eq!(agent.bot.name, "Claude Code · Ada");
    assert_eq!(agent.bot.handle, "claude-code-ada-2");
    assert_eq!(agent.bot.owner, Some(BotOwner::Team { team_id }));
    assert_eq!(agent.bot.created_by.as_deref(), Some(BUYER));
    assert_eq!(agent.harness, "macrod");
    assert_eq!(agent.default_model, "default");
    assert_eq!(agent.channel_scope, AgentChannelScope::All);
    assert_eq!(agent.mcp, AgentMcpServers::OwnerConnections);
    assert_eq!(agent.auto_accept_permissions, Some(false));
    assert!(agent.is_coding);
}

/// The computer shows up in every teammate's "Where it runs", and any of
/// them can put an agent of their own, or the team's, on it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn any_teammate_can_run_agents_on_a_team_computer(pool: PgPool) {
    let team_id = Uuid::new_v4();
    let harness_id = team_computer(&pool, team_id).await;
    let teammate = MacroUserIdStr::try_from(TEAMMATE.to_owned()).unwrap();

    let usable = HarnessServiceImpl::new(PgHarnessRepo::new(pool.clone()))
        .list_harnesses(teammate.clone())
        .await
        .unwrap();
    assert_eq!(
        usable.iter().map(|harness| harness.id).collect::<Vec<_>>(),
        vec![harness_id]
    );
    assert_eq!(usable[0].shared_team_ids, vec![team_id]);

    for (team, handle) in [(None, "mine-on-ada"), (Some(team_id), "ours-on-ada")] {
        let agent = bots(&pool)
            .create_agent(
                teammate.clone(),
                CreateAgentRequest {
                    team_id: team,
                    harness_id: Some(harness_id),
                    name: handle.to_owned(),
                    handle: handle.to_owned(),
                    description: None,
                    avatar_url: None,
                    instructions: String::new(),
                    harness: "macrod".to_owned(),
                    default_model: "default".to_owned(),
                    channel_scope: AgentChannelScope::All,
                    channel_ids: Vec::new(),
                    mcp: AgentMcpServers::OwnerConnections,
                    auto_accept_permissions: Some(true),
                    is_coding: true,
                },
            )
            .await
            .unwrap();
        assert_eq!(agent.harness_id, Some(harness_id));
    }
}

#[test]
fn handles_follow_the_settings_slug_and_skip_taken_ones() {
    assert_eq!(
        unique_handle("Claude Code · Build Box", &HashSet::new()),
        "claude-code-build-box"
    );
    assert_eq!(
        unique_handle(
            "Claude Code · Ada",
            &HashSet::from(["claude-code-ada".to_owned(), "claude-code-ada-2".to_owned()])
        ),
        "claude-code-ada-3"
    );
    let long = format!("Claude Code · {}", "x".repeat(80));
    let handle = unique_handle(
        &long,
        &HashSet::from([format!("claude-code-{}", "x".repeat(52))]),
    );
    assert_eq!(handle, format!("claude-code-{}-2", "x".repeat(50)));
}
