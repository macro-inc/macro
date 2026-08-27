use super::*;
use agent_fold::domain::service::FoldedMessageService;
use agent_harness::outbound::daytona::AnthropicApiKey;
use agent_harness::outbound::local::{LocalContainerManager, LocalSettings};
use agent_session::domain::ports::NoOpRealtime;
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};

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
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    let mut session = test_agent_session(id);
    session.bot_id = bot;
    repo.insert_session(session);
    let service =
        AgentSessionServiceImpl::new(repo.clone(), FoldedMessageService::new(repo), NoOpRealtime);
    (id, service)
}

/// The whole point of the refusal: `@macro`'s sessions have no repository to
/// clone, so a deployment that cannot run them in-process must not quietly
/// bill a sandbox for one.
#[tokio::test]
async fn refuses_the_in_process_bot_when_no_in_memory_runtime_is_configured() {
    let (id, sessions) = sessions_with(bot_id::MACRO_AI_BOT_ID);
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
