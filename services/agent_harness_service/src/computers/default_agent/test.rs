use super::*;
use crate::computers::HostedHarnesses;
use bots::domain::models::BotOwner;
use bots::domain::ports::{BotRepo, HarnessRemoved};
use bots::domain::service::BotServiceImpl;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use harnesses::domain::models::CreateHostedPairing;
use harnesses::domain::ports::HarnessService;
use hosted_runtimes::domain::ids::{ComputerId, HostId};
use hosted_runtimes::domain::lifecycle::ComputerState;
use hosted_runtimes::domain::models::{Computer, ComputerName};
use hosted_runtimes::domain::ports::ComputerRepo;
use hosted_runtimes::domain::ports::Harnesses;
use hosted_runtimes::domain::size::{
    CatalogEntryId, ComputerResources, ComputerSize, DiskGib, MemoryGib, Vcpus,
};
use hosted_runtimes::outbound::pg::PgComputerRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;

const BUYER: &str = "macro|buyer@example.com";
const TEAMMATE: &str = "macro|teammate@example.com";

/// A team of two whose admin, Grace, bought a computer: the hosted harness
/// the operator pairs, owned by the buyer and granted to the team.
async fn team_computer(pool: &PgPool, team_id: Uuid) -> (ComputerId, HarnessId) {
    sqlx::query!(
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
    sqlx::query!(
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
    sqlx::query!(
        "INSERT INTO macro_user_info (macro_user_id, first_name, last_name) VALUES ('00000000-0000-4000-8000-000000000001', 'Grace', 'Hopper')",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Platform', $2)",
        team_id,
        BUYER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $3, 'owner'), ($2, $3, 'member')
        "#,
        BUYER,
        TEAMMATE,
        team_id,
    )
    .execute(pool)
    .await
    .unwrap();

    let computer_id = ComputerId::new_from_uuid(Uuid::new_v4());
    crate::computers::harness_service(&pool)
        .create_hosted_pairing(CreateHostedPairing {
            team_id,
            name: "Ada".to_owned(),
            created_by: MacroUserIdStr::try_from(BUYER.to_owned()).unwrap(),
            computer_id,
        })
        .await
        .unwrap();
    let harness: Uuid = sqlx::query_scalar!(
        "SELECT id FROM harnesses WHERE computer_id = $1",
        computer_id.as_uuid()
    )
    .fetch_one(pool)
    .await
    .unwrap();
    // The computer row: its team, not its buyer, decides who may use and
    // manage the harness (harness_access_level).
    let host_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO hosted_runtime_host (id, name, awake_capacity_units, sold_capacity_units)
        VALUES ($1, 'host-1', 8, 8)
        "#,
        host_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO hosted_runtime (
            id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry,
            purchase_key, host_id, state, harness_id, created_by
        )
        VALUES ($1, $2, 'Ada', 'standard', 4, 8, 100, 'standard@2026-11', 'buy-ada', $3, '{}', $4, $5)
        "#,
        computer_id.as_uuid(),
        team_id,
        host_id,
        harness,
        BUYER,
    )
    .execute(pool)
    .await
    .unwrap();
    (computer_id, HarnessId::new_from_uuid(harness))
}

fn bots(
    pool: &PgPool,
) -> BotServiceImpl<PgBotsRepo, NoopMacroEventBroker, crate::computers::PgHarnessService> {
    BotServiceImpl::new(
        PgBotsRepo::new(pool.clone()),
        NoopMacroEventBroker,
        crate::computers::harness_service(pool),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_ready_computer_gets_one_team_coding_agent(pool: PgPool) {
    let team_id = Uuid::new_v4();
    let (_, harness_id) = team_computer(&pool, team_id).await;
    // A teammate already took the natural handle on another runtime.
    bots(&pool)
        .create_agent(
            MacroUserIdStr::try_from(TEAMMATE.to_owned()).unwrap(),
            CreateAgentRequest {
                team_id: Some(team_id),
                harness_id: None,
                name: "Grace's Agent".to_owned(),
                handle: "grace-s-agent".to_owned(),
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
    let agents = BotDefaultAgents::new(bots(&pool), PgBotsRepo::new(pool.clone()), pool.clone());
    let request = DefaultAgentRequest {
        team_id,
        buyer: MacroUserIdStr::try_from(BUYER.to_owned()).unwrap(),
        harness_id,
    };

    let DefaultAgent::Created { agent_id } = agents.create(request.clone()).await.unwrap() else {
        panic!("the computer had no agent yet");
    };
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
    assert_eq!(agent.bot.id, agent_id);
    assert_eq!(agent.bot.name, "Grace's Agent");
    assert_eq!(agent.bot.handle, "grace-s-agent-2");
    assert_eq!(agent.bot.owner, Some(BotOwner::Team { team_id }));
    assert_eq!(agent.bot.created_by.as_deref(), Some(BUYER));
    assert_eq!(agent.harness, "macrod");
    assert_eq!(agent.default_model, "default");
    assert_eq!(agent.channel_scope, AgentChannelScope::All);
    assert_eq!(agent.mcp, AgentMcpServers::OwnerConnections);
    // A Macro computer is the team's sandbox: its agent runs without asking.
    assert_eq!(agent.auto_accept_permissions, Some(true));
    assert!(agent.is_coding);
}

/// Releasing a computer revokes its harness; every agent on it goes too, so
/// none is left offline in the composer pointing at a machine that is gone.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revoking_a_computer_deletes_its_agents(pool: PgPool) {
    let team_id = Uuid::new_v4();
    let (computer_id, harness_id) = team_computer(&pool, team_id).await;
    let buyer = MacroUserIdStr::try_from(BUYER.to_owned()).unwrap();
    let teammate = MacroUserIdStr::try_from(TEAMMATE.to_owned()).unwrap();
    let agents = BotDefaultAgents::new(bots(&pool), PgBotsRepo::new(pool.clone()), pool.clone());
    agents
        .create(DefaultAgentRequest {
            team_id,
            buyer: buyer.clone(),
            harness_id,
        })
        .await
        .unwrap();
    // A teammate's private agent on the same computer, which the buyer
    // could not delete through the API.
    bots(&pool)
        .create_agent(
            teammate.clone(),
            CreateAgentRequest {
                team_id: None,
                harness_id: Some(harness_id),
                name: "Mine".to_owned(),
                handle: "mine-on-ada".to_owned(),
                description: None,
                avatar_url: None,
                instructions: String::new(),
                harness: "macrod".to_owned(),
                default_model: "default".to_owned(),
                channel_scope: AgentChannelScope::All,
                channel_ids: Vec::new(),
                mcp: AgentMcpServers::OwnerConnections,
                auto_accept_permissions: None,
                is_coding: true,
            },
        )
        .await
        .unwrap();
    // Another runtime's agent stays.
    bots(&pool)
        .create_agent(
            teammate.clone(),
            CreateAgentRequest {
                team_id: None,
                harness_id: None,
                name: "Elsewhere".to_owned(),
                handle: "elsewhere".to_owned(),
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
    let computer = Computer {
        id: computer_id,
        team_id,
        name: ComputerName::try_new("Ada").unwrap(),
        size: ComputerSize::Standard,
        resources: ComputerResources {
            vcpus: Vcpus::new(4),
            memory_gib: MemoryGib::new(8),
            disk_gib: DiskGib::new(100),
        },
        catalog_entry: CatalogEntryId::try_new("standard@2026-11".to_owned()).unwrap(),
        funding: hosted_runtimes::domain::models::Funding::Comped {
            reason: "default agent test".to_owned(),
        },
        host: HostId::new(Uuid::new_v4()),
        state: ComputerState {
            provision_traceparent: None,
            setup: None,
            phase: hosted_runtimes::domain::lifecycle::Phase::Running,
            billing: hosted_runtimes::domain::lifecycle::Billing::Comped {
                reason: "default agent test".to_owned(),
            },
            billing_changed_at: chrono::Utc::now(),
            power: hosted_runtimes::domain::lifecycle::Power::On,
            macrod_connected: true,
            macrod_misses: 0,
            recent_crashes: vec![],
            power_on_requested: false,
            capacity_wait: None,
            retried_by_team: false,
            failure: None,
        },
        harness_id: Some(harness_id),
        enrollment_generation: Default::default(),
        created_by: buyer.clone(),
        created_at: chrono::Utc::now(),
        enrolled_at: None,
        setup_completed_at: None,
        default_agent_id: None,
        image: None,
    };
    let harnesses = HostedHarnesses {
        service: Arc::new(crate::computers::harness_service(&pool)),
        default_agents: Arc::new(agents),
    };
    let computers = PgComputerRepo::new(
        pool.clone(),
        hosted_runtimes::domain::lifecycle::BillingPolicy::from_days(14, 7).unwrap(),
    );
    // What the release dialog warns about: the default agent and the private one.
    assert_eq!(
        computers.agent_counts(&[computer_id]).await.unwrap(),
        HashMap::from([(computer_id, 2)])
    );

    harnesses.revoke(&computer).await.unwrap();
    // A redelivered effect finds nothing left to do.
    harnesses.revoke(&computer).await.unwrap();

    let handles: Vec<String> = bots(&pool)
        .list_agents(teammate.clone())
        .await
        .unwrap()
        .into_iter()
        .map(|agent| agent.bot.handle)
        .collect();
    assert_eq!(handles, vec!["elsewhere".to_owned()]);
    assert!(
        bots(&pool)
            .list_agents(buyer)
            .await
            .unwrap()
            .iter()
            .all(|agent| agent.harness_id != Some(harness_id))
    );
    let live: i64 = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM harnesses WHERE id = $1 AND deleted_at IS NULL"#,
        harness_id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(live, 0);
    assert!(
        computers
            .agent_counts(&[computer_id])
            .await
            .unwrap()
            .is_empty()
    );

    // A bind that lost the race to the release finds the harness gone.
    let late = CreateAgentRequest {
        team_id: None,
        harness_id: Some(harness_id),
        name: "Late".to_owned(),
        handle: "late".to_owned(),
        description: None,
        avatar_url: None,
        instructions: String::new(),
        harness: "macrod".to_owned(),
        default_model: "default".to_owned(),
        channel_scope: AgentChannelScope::All,
        channel_ids: Vec::new(),
        mcp: AgentMcpServers::OwnerConnections,
        auto_accept_permissions: None,
        is_coding: true,
    };
    let refused = PgBotsRepo::new(pool.clone())
        .create_agent(
            BotOwner::User {
                user_id: TEAMMATE.to_owned(),
            },
            teammate,
            late,
        )
        .await
        .unwrap_err();
    assert!(refused.is::<HarnessRemoved>());
}

/// The computer shows up in every teammate's "Where it runs", and any of
/// them can put an agent of their own, or the team's, on it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn any_teammate_can_run_agents_on_a_team_computer(pool: PgPool) {
    let team_id = Uuid::new_v4();
    let (_, harness_id) = team_computer(&pool, team_id).await;
    let teammate = MacroUserIdStr::try_from(TEAMMATE.to_owned()).unwrap();

    let usable = crate::computers::harness_service(&pool)
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

/// An agent put on a Macro computer later runs without asking unless the
/// request picks prompting, which stays a choice.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agents_on_a_computer_default_to_bypassing_permissions(pool: PgPool) {
    let team_id = Uuid::new_v4();
    let (_, harness_id) = team_computer(&pool, team_id).await;
    let teammate = MacroUserIdStr::try_from(TEAMMATE.to_owned()).unwrap();

    let mut permissions = Vec::new();
    for (handle, requested) in [("unsaid", None), ("prompts", Some(false))] {
        let agent = bots(&pool)
            .create_agent(
                teammate.clone(),
                CreateAgentRequest {
                    team_id: Some(team_id),
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
                    auto_accept_permissions: requested,
                    is_coding: true,
                },
            )
            .await
            .unwrap();
        permissions.push(agent.auto_accept_permissions);
    }

    assert_eq!(permissions, vec![Some(true), Some(false)]);
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
