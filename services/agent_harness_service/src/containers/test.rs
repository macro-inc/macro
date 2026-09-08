use super::*;
use agent_fold::domain::service::FoldedMessageService;
use agent_harness::outbound::daytona::AnthropicApiKey;
use agent_harness::outbound::local::{LocalContainerManager, LocalSettings};
use agent_session::domain::ports::NoOpRealtime;
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};
use bot_id::BotId;

/// A sandbox provider the tests never reach: every case here is decided by
/// `route` before the provider is asked for anything.
fn unreachable_sandbox() -> HarnessContainers {
    HarnessContainers::Local(LocalContainerManager::new(LocalSettings {
        docker_binary: "false".to_owned(),
        image: "unused".to_owned(),
        network: "unused".to_owned(),
        anthropic_api_key: AnthropicApiKey::new(String::new()),
    }))
}

fn sessions_with(bot: BotId) -> (AgentSessionId, impl AgentSessionService + use<>) {
    sessions_with_harness(bot, "opencode")
}

fn sessions_with_harness(
    bot: BotId,
    harness: &str,
) -> (AgentSessionId, impl AgentSessionService + use<>) {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    let mut session = test_agent_session(id);
    session.bot_id = bot;
    session.harness = harness.to_owned();
    repo.insert_session(session);
    let service =
        AgentSessionServiceImpl::new(repo.clone(), FoldedMessageService::new(repo), NoOpRealtime);
    (id, service)
}

#[tokio::test]
async fn recognizes_a_database_backed_in_memory_agent() {
    let agent = BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0x0000_5678));
    let (id, sessions) = sessions_with_harness(agent, "in-memory");
    let containers = RoutedContainers::new(unreachable_sandbox(), None, sessions);

    let error = containers
        .route(id)
        .await
        .expect_err("an in-memory agent requires the shared in-process runtime");

    assert!(
        matches!(error, HarnessError::Container(message) if message.contains("in-process bot"))
    );
}

/// The whole point of the refusal: `@macro-new`'s sessions have no repository to
/// clone, so a deployment that cannot run them in-process must not quietly
/// bill a sandbox for one.
#[tokio::test]
async fn refuses_the_in_process_bot_when_no_in_memory_runtime_is_configured() {
    let (id, sessions) = sessions_with(bot_id::MACRO_NEW_BOT_ID);
    let containers = RoutedContainers::new(unreachable_sandbox(), None, sessions);

    let error = containers
        .route(id)
        .await
        .expect_err("a deployment without the in-process runtime must refuse its bot");

    assert!(
        matches!(error, HarnessError::Container(message) if message.contains("in-process bot")),
        "expected a refusal naming the in-process bot"
    );
}

/// The sandboxed bot is unaffected by the refusal above.
#[tokio::test]
async fn routes_the_sandboxed_bot_to_the_sandbox() {
    let (id, sessions) = sessions_with(bot_id::MACRO_CODER_BOT_ID);
    let containers = RoutedContainers::new(unreachable_sandbox(), None, sessions);

    assert!(matches!(
        containers.route(id).await.expect("coder routes"),
        Route::Sandbox
    ));
}

/// So is a user-owned bot, which is what an `@claude` deployment serves.
#[tokio::test]
async fn routes_an_owned_bot_to_the_sandbox() {
    let owned = BotId::new_from_uuid(macro_uuid::Uuid::from_u128(0x0000_1234));
    let (id, sessions) = sessions_with(owned);
    let containers = RoutedContainers::new(unreachable_sandbox(), None, sessions);

    assert!(matches!(
        containers.route(id).await.expect("owned bot routes"),
        Route::Sandbox
    ));
}

/// The in-process runtime skips Macro's own server by the name the harness
/// gives it, and restates that name rather than importing it. This is the one
/// crate that sees both, so it is where they are held equal.
#[test]
fn the_in_process_runtime_and_the_harness_agree_on_macros_server_name() {
    assert_eq!(
        agent_inmem::domain::mcp::MACRO_MCP_NAME,
        agent_harness::domain::model::MACRO_MCP_NAME
    );
}
