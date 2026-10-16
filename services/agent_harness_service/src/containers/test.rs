use super::*;
use agent_fold::domain::service::FoldedMessageService;
use agent_harness::domain::model::SandboxEgress;
use agent_harness::outbound::daytona::AnthropicApiKey;
use agent_harness::outbound::local::{LocalContainerManager, LocalSettings};
use agent_harness::testing::helpers::egress::test_egress;
use agent_inmem::domain::engine::{TurnEngine, TurnRequest};
use agent_inmem::domain::mcp::NoMcpServers;
use agent_inmem::domain::model_access::{InMemModelAccess, ModelAccess, ModelAccessError};
use agent_inmem::outbound::log_frames::LogFrameSource;
use agent_session::domain::model::{ClaimOutcome, ReplicaId};
use agent_session::domain::ports::{AgentSessionRepo, NoOpRealtime, SessionOwnership};
use agent_session::domain::ports::{
    NoOpAgentSessionNameGenerator, NoOpTurnObserver, NoopLifecyclePublisher,
};
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::testing::{InMemoryAgentSessionRepo, test_agent_session};
use bot_id::BotId;
use std::sync::Arc;

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
    let (id, repo) = repo_with_session(bot, harness);
    (id, service_over(repo))
}

fn repo_with_session(bot: BotId, harness: &str) -> (AgentSessionId, InMemoryAgentSessionRepo) {
    let repo = InMemoryAgentSessionRepo::new();
    let id = AgentSessionId::new();
    let mut session = test_agent_session(id);
    session.bot_id = bot;
    session.harness = harness.to_owned();
    repo.insert_session(session);
    (id, repo)
}

fn service_over(repo: InMemoryAgentSessionRepo) -> impl AgentSessionService + use<> {
    AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo),
        NoOpRealtime,
        NoOpAgentSessionNameGenerator,
        Arc::new(NoOpTurnObserver),
        Arc::new(NoopLifecyclePublisher),
        ReplicaId::mint(),
    )
}

/// Never asked to run a turn: these tests only attach sessions.
struct IdleEngine;

impl TurnEngine for IdleEngine {
    fn supported_models(&self) -> &[&str] {
        &[]
    }

    fn run_turn(
        &self,
        _request: TurnRequest,
    ) -> tokio::sync::mpsc::Receiver<Result<agent::StreamPart, agent::AgentError>> {
        tokio::sync::mpsc::channel(1).1
    }
}

struct FreeModels;

#[async_trait::async_trait]
impl InMemModelAccess for FreeModels {
    async fn access(&self, _owner: &model_owner::Owner) -> Result<ModelAccess, ModelAccessError> {
        Ok(ModelAccess::Free)
    }
}

fn in_process_runtime(repo: InMemoryAgentSessionRepo) -> InMemRuntime {
    InMemRuntime {
        manager: InMemAgentManager::new(
            Arc::new(IdleEngine),
            Arc::new(LogFrameSource::new(repo)),
            Arc::new(NoMcpServers),
            Arc::new(FreeModels),
        ),
    }
}

fn in_process_containers(
    repo: &InMemoryAgentSessionRepo,
) -> RoutedContainers<impl AgentSessionService + use<>> {
    RoutedContainers::new(
        unreachable_sandbox(),
        Some(in_process_runtime(repo.clone())),
        service_over(repo.clone()),
    )
}

async fn session_for_token(
    repo: &InMemoryAgentSessionRepo,
    token: &SessionToken,
) -> Option<AgentSessionId> {
    repo.find_by_egress_token_hash(&token.hash())
        .await
        .expect("token lookup")
        .map(|session| session.id)
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

/// A replica that replaced the one which spawned an in-process session has
/// no way to read its token back, so resuming there rotates the credential:
/// the session's MCP servers are advertised under a token the proxy accepts,
/// and the token that died with the old process no longer is.
#[tokio::test]
async fn resuming_an_in_process_session_held_elsewhere_rotates_its_credential() {
    let (id, repo) = repo_with_session(bot_id::MACRO_NEW_BOT_ID, "opencode");
    let lost = SessionToken::new("held by the replaced replica");
    repo.set_egress_token_hash(id, &lost.hash())
        .await
        .expect("spawn's hash");
    let containers = in_process_containers(&repo);

    let _attachment = containers.resume(id).await.expect("resumes");

    let token = containers
        .session_token(id)
        .await
        .expect("token lookup")
        .expect("a resumed in-process session holds a credential");
    assert_eq!(
        session_for_token(&repo, &SessionToken::new(token)).await,
        Some(id)
    );
    assert_eq!(session_for_token(&repo, &lost).await, None);
}

/// A session can move to another replica and back while the first stays up.
/// The token the first still holds was revoked when the second rotated, so
/// resuming on the first again must not reuse it.
#[tokio::test]
async fn resuming_where_a_revoked_token_is_still_held_does_not_reuse_it() {
    let (id, repo) = repo_with_session(bot_id::MACRO_NEW_BOT_ID, "opencode");
    let spawned = SessionToken::new("held by the first replica");
    repo.set_egress_token_hash(id, &spawned.hash())
        .await
        .expect("spawn's hash");
    let first = in_process_containers(&repo);
    let second = in_process_containers(&repo);
    let _spawned = first
        .spawn(SpawnContainer {
            session_id: id,
            kind: AgentKind::InMemory,
            size: SandboxSize::Default,
            egress: SandboxEgress {
                session_token: spawned.as_str().to_owned(),
                ..test_egress()
            },
        })
        .await
        .expect("spawns");
    let _moved = second.resume(id).await.expect("resumes on the second");

    let _returned = first.resume(id).await.expect("resumes on the first again");

    let token = first
        .session_token(id)
        .await
        .expect("token lookup")
        .expect("a resumed in-process session holds a credential");
    assert_ne!(token, spawned.as_str());
    assert_eq!(
        session_for_token(&repo, &SessionToken::new(token)).await,
        Some(id)
    );
}

/// Another live replica's claim would refuse this attach, and rotating first
/// would revoke the credential that replica's agent is using.
#[tokio::test]
async fn resuming_a_session_a_live_peer_manages_is_refused_without_rotating() {
    let (id, repo) = repo_with_session(bot_id::MACRO_NEW_BOT_ID, "opencode");
    let current = SessionToken::new("held by the managing replica");
    repo.set_egress_token_hash(id, &current.hash())
        .await
        .expect("spawn's hash");
    let claimed = repo
        .claim(id, ReplicaId::mint())
        .await
        .expect("peer claims");
    assert!(matches!(claimed, ClaimOutcome::Claimed(_)));
    let containers = in_process_containers(&repo);

    let Err(error) = containers.resume(id).await else {
        panic!("a session a live peer manages must not resume here");
    };

    assert!(matches!(
        error,
        HarnessError::Session(AgentSessionError::ManagedElsewhere(session)) if session == id
    ));
    assert_eq!(session_for_token(&repo, &current).await, Some(id));
    assert_eq!(
        containers.session_token(id).await.expect("token lookup"),
        None
    );
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
