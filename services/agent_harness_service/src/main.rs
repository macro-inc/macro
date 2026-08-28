#![recursion_limit = "256"]
//! Composition root for the agent harness service.
//!
//! The hexagon lives in `crates/agent_harness`; this binary is the shell
//! around it: it builds the Postgres repositories, the container
//! manager (Daytona, or local Docker when opted in), and a channel service with the full side-effect stack for
//! announcements, derives agent triggers from `macro.channels`, then drives
//! the orchestrator from the resulting `macro.agent_sessions` events.

mod api;
mod bots_directory;
mod config;
mod containers;
mod trigger;

use std::{future::Future, pin::Pin, sync::Arc};

use agent_egress::domain::service::EgressServiceImpl;
use agent_egress::outbound::forwarder::ReqwestForwarder;
use agent_egress::outbound::github_tokens::GithubAppTokens;
use agent_egress::outbound::macro_mcp::{MacroApiTokenSigner, WithMacroMcp};
use agent_egress::outbound::mcp_credentials::PipedreamMcpCredentials;
use agent_egress::outbound::session_authority::StoredTokenSessionAuthority;
use agent_fold::domain::service::FoldedMessageService;
use agent_harness::domain::model::{HarnessCommand, HarnessDefaults, SessionDefaults};
use agent_harness::domain::service::AgentHarnessService;
use agent_harness::inbound::kafka::{RoutedTrigger, route_agent_trigger};
use agent_harness::inbound::runtime_gateway::RuntimeGatewayState;
use agent_harness::outbound::agent_prompt_composer::LexicalAgentPromptComposer;
use agent_harness::outbound::channel_announcer::ChannelAnnouncer;
use agent_harness::outbound::channel_prompt_context::ChannelPromptContextAdapter;
use agent_harness::outbound::containers::HarnessContainers;
use agent_harness::outbound::cursor::{CursorContainerManager, PgCursorApiKeys};
use agent_harness::outbound::daytona::{
    AnthropicApiKey as AnthropicApiKeySecret, DaytonaApiKey as DaytonaApiKeySecret,
    DaytonaContainerManager, DaytonaSettings, Snapshot,
};
use agent_harness::outbound::egress::EgressProvisioner;
use agent_harness::outbound::local::{LocalContainerManager, LocalSettings};
use agent_harness::outbound::routing::RoutedContainerManager;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_inmem::outbound::log_frames::LogFrameSource;
use agent_inmem::outbound::manager::InMemAgentManager;
use agent_inmem::outbound::rig_engine::RigTurnEngine;
use agent_session::domain::ports::NoOpRealtime;
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::inbound::axum_router::{
    AgentSessionControlState, AgentSessionRouterState, CreateSessionState,
};
use agent_session::outbound::connection_gateway_realtime::ConnectionGatewayAgentSessionRealtime;
use agent_session::outbound::name_generator::HaikuAgentSessionNameGenerator;
use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::broker_events::AgentSessionMacroEvent;
use anyhow::Context as _;
use bot_id::BotId;
use bots::outbound::pg_bots_repo::PgBotsRepo;
use bots_directory::PgBotDirectory;
use channels::domain::service::ChannelServiceImpl;
use channels::domain::side_effects::{ChannelSideEffectService, SpawnedChannelEventDispatcher};
use channels::outbound::connection_gateway_realtime::ConnectionGatewayChannelRealtimePublisher;
use channels::outbound::contacts_dispatcher::ContactsChannelDispatcher;
use channels::outbound::notification_sender::NotificationChannelSender;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use channels::outbound::pg_side_effect_context::PgChannelSideEffectContext;
use config::{Config, Environment};
use connection_gateway_client::ConnectionGatewayClient;
use containers::{InMemRuntime, RoutedContainers};
use cursor_api_key::cipher::{AwsKmsCiphertexts, KmsCursorApiKeyCipher};
use cursor_cloud_agents::api::CURSOR_API_BASE_URL;
use cursor_cloud_agents::domain::model::RepoUrl as CursorRepoUrl;
use github::domain::service::{InstallationTokenConfig, InstallationTokenService};
use github::outbound::github_sync_client::GithubSyncClientImpl;
use github::outbound::pg_github_sync_repo::PgGithubSyncRepo;
use kafka_util::{GroupName, KafkaEventConsumer, consumer_span, record_span_error};
use lexical_client::LexicalClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, PgBotAuthorizationRepo, PgBotAuthorizer,
};
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEvent as _, MacroEventBrokerService,
    MacroEventCollection as _, MacroEventConsumerService,
};
use macro_service_urls::{ConnectionGatewayUrl, LexicalServiceUrl};
use pipedream_mcp::outbound::api::{PipedreamClient, PipedreamConfig};
use pipedream_mcp::outbound::pg_connection_repo::PgConnectionRepo;
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::postgres::PgPoolOptions;
use tracing::Instrument as _;

/// Consumer group owning this harness's agent-session offsets.
///
/// TODO: one group per bot deployment. Two bots sharing this name would
/// split partitions between them and each miss half its events; fine while
/// exactly one harness deployment exists.
struct AgentHarnessConsumerGroup;

impl GroupName for AgentHarnessConsumerGroup {
    const GROUP_NAME: &'static str = "agent-harness-service";
}

macro_event_broker::declare_topics!(DeclaredMacroEvent: AgentSessionMacroEvent);

type HarnessKafkaAdapter = KafkaConsumerAdapter<AgentHarnessConsumerGroup, DeclaredMacroEvent>;
type HarnessConsumer = MacroEventConsumerService<DeclaredMacroEvent, HarnessKafkaAdapter>;

fn commit_message(consumer: &HarnessConsumer, message: &BorrowedMessage<'_>) -> anyhow::Result<()> {
    consumer
        .inner()
        .commit_message(message, CommitMode::Sync)
        .map_err(|error| anyhow::anyhow!("failed to commit agent session offset: {error:?}"))
}

type HarnessWork =
    Pin<Box<dyn Future<Output = agent_harness::domain::error::Result<()>> + Send + 'static>>;

struct PendingHarnessWork {
    session_id: agent_session::domain::model::AgentSessionId,
    span: tracing::Span,
    work: HarnessWork,
    description: &'static str,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> anyhow::Result<()> {
    agent_harness::install_tls_provider();
    // AWS first, because the config's secrets resolve through Secrets Manager.
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let secrets = secretsmanager_client::SecretsManager::new(aws_sdk_secretsmanager::Client::new(
        &aws_config,
    ));
    let config = Config::from_env()?
        .resolve_remote_secrets(Environment::new_or_prod(), &secrets)
        .await
        .context("failed to resolve agent harness service secrets")?;
    let bot_id = BotId::new_from_uuid(config.harness_bot_id);
    // The in-process Macro bot is a compile-time identity, not configuration:
    // it is always `bot_id::MACRO_AI_BOT_ID`, so the only real question is
    // whether this environment serves it. Production stays off until its AI
    // tool config lands - `build_tool_service_context_from_env` below is
    // fatal, so turning it on without that config would refuse to boot.
    let inmem_bot = match config.environment {
        Environment::Local | Environment::Develop => Some(bot_id::MACRO_AI_BOT_ID),
        Environment::Production => None,
    };

    let pool = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(config.database_url.as_ref())
        .await
        .context("failed to connect to macrodb")?;

    // Built before the sessions rather than beside the other channel plumbing
    // below: this service owns the live actors, so it is where a session's
    // frames are streamed from.
    let connection_gateway = Arc::new(ConnectionGatewayClient::new(
        config.internal_api_key.clone(),
        ConnectionGatewayUrl::new()?.to_string(),
    ));

    // Sessions: persistence and live actors. The same repo answers every port,
    // as in the `document_storage_service` root - a session's actor writes its
    // log and pushes each frame at the channel's participants so a viewer sees
    // it happen.
    let session_repo = PgAgentSessionRepo::new(pool.clone());
    let sessions = AgentSessionServiceImpl::new(
        session_repo.clone(),
        FoldedMessageService::new(session_repo.clone()),
        ConnectionGatewayAgentSessionRealtime::new(
            connection_gateway.clone(),
            session_repo.clone(),
        ),
    )
    .with_name_generator(HaikuAgentSessionNameGenerator::new(ai_usage::pg_recorder(
        pool.clone(),
    )));

    // Containers: the sandbox provider (local Docker when a developer has
    // opted in, Daytona otherwise) plus Cursor cloud agents for the `@cursor`
    // bot, routed per session.
    // The Anthropic key rides into every sandbox's environment; without it the
    // runtime has no model provider at all (`container/opencode.json` enables
    // only `anthropic`), so managed sessions would advertise no models and
    // fail every prompt.
    if config.anthropic_api_key.trim().is_empty() {
        tracing::warn!(
            "ANTHROPIC_API_KEY is unset: managed sandboxes have no model provider; external agent sessions are unaffected"
        );
    }
    let anthropic_api_key = AnthropicApiKeySecret::new(config.anthropic_api_key.clone());
    let sandbox = if config.dev_dangerous_local_containers {
        if !matches!(config.environment, Environment::Local) {
            anyhow::bail!("DEV_DANGEROUS_LOCAL_CONTAINERS is only allowed when ENVIRONMENT=local");
        }
        let network = config.local_container_network.trim();
        if network.is_empty() {
            anyhow::bail!(
                "LOCAL_CONTAINER_NETWORK is required when DEV_DANGEROUS_LOCAL_CONTAINERS is set"
            );
        }
        HarnessContainers::Local(LocalContainerManager::new(LocalSettings {
            docker_binary: config.local_container_docker_binary.clone(),
            image: config.local_container_image.clone(),
            network: network.to_owned(),
            anthropic_api_key: anthropic_api_key.clone(),
        }))
    } else {
        // Credential-less boot is deliberate: external sessions need no
        // sandbox at all. A Daytona spawn without a key fails at spawn time
        // instead, loudly.
        if config.daytona_api_key.trim().is_empty() {
            tracing::warn!(
                "DAYTONA_API_KEY is unset: Daytona-backed sandboxes are unarmed; external agent sessions are unaffected"
            );
        }
        HarnessContainers::Daytona(DaytonaContainerManager::new(DaytonaSettings {
            api_url: config.daytona_api_url.clone(),
            api_key: DaytonaApiKeySecret::new(config.daytona_api_key.clone()),
            snapshot: Snapshot::new(config.daytona_snapshot.clone()),
            anthropic_api_key,
        }))
    };
    let container_shutdown = sandbox.clone();

    // Tracks event publishes the in-memory agent's tool context starts;
    // closed and drained on shutdown so nothing is dropped mid-publish.
    let event_broker_tracker = tokio_util::task::TaskTracker::new();
    let inmem = match inmem_bot {
        Some(bot) => {
            let tool_context = ai_tools::build_tool_service_context_from_env(
                pool.clone(),
                event_broker_tracker.clone(),
            )
            .await
            .context("failed to build the in-memory agent tool context")?;
            let engine = Arc::new(RigTurnEngine::new(pool.clone(), tool_context));
            // Cold attaches (fresh spawns and post-restart resumes) rebuild
            // their model context from the same log every frame lands in.
            let frames = Arc::new(LogFrameSource::new(session_repo.clone()));
            Some(InMemRuntime {
                bot,
                manager: InMemAgentManager::new(engine, frames),
            })
        }
        None => None,
    };
    // The sandbox provider serves every bot but the in-memory one, which the
    // router pulls out by bot id before the provider ever sees it.
    let sandbox_and_inmem = RoutedContainers::new(
        sandbox,
        inmem,
        AgentSessionServiceImpl::new(
            session_repo.clone(),
            FoldedMessageService::new(session_repo.clone()),
            NoOpRealtime,
        ),
    );

    // Cursor sessions run on their owner's own Cursor account, so there is no
    // deployment-wide key to arm this with: the manager reads each session
    // owner's key at spawn. Decrypt-only — registering keys belongs to the
    // authentication service, and a harness that could encrypt would be a
    // harness whose IAM role grants more than it uses.
    let cursor_manager = CursorContainerManager::new(
        PgCursorApiKeys::new(
            pool.clone(),
            KmsCursorApiKeyCipher::new(AwsKmsCiphertexts::decrypting(aws_sdk_kms::Client::new(
                &aws_config,
            ))),
        ),
        CURSOR_API_BASE_URL.to_owned(),
        CursorRepoUrl::parse(&config.cursor_repo_url)
            .context("CURSOR_REPO_URL is not a valid repository url")?,
        session_repo.clone(),
    );
    // Every deployment serves its sandbox bot, the configured in-memory bot,
    // and Cursor. Whether a given user can open a Cursor session depends on
    // the key they registered and is answered at spawn.
    let our_bots: Vec<BotId> = std::iter::once(bot_id)
        .chain(inmem_bot)
        .chain(std::iter::once(bot_id::CURSOR_BOT_ID))
        .collect();
    // Logged because the failure mode this replaced was silent: a harness that
    // resolved no in-process bot booted healthy, passed its health check, and
    // dropped every `@macro` mention as ForeignBot with nothing to show for it.
    tracing::info!(
        bots = ?our_bots.iter().map(|bot| bot.as_uuid()).collect::<Vec<_>>(),
        in_process_bot = ?inmem_bot.map(BotId::as_uuid),
        environment = %config.environment,
        "agent harness serving bots"
    );
    let containers =
        RoutedContainerManager::new(sandbox_and_inmem, cursor_manager, session_repo.clone());

    let notifications = Arc::new(notification::domain::service::SqsNotificationIngress {
        queue: notification::outbound::queue::SqsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            macro_queues::NotificationIngressQueue::new().to_string(),
        ),
    });
    let contacts_ingress = Arc::new(contacts::domain::service::SqsContactsIngress {
        queue: contacts::outbound::ingress::SqsContactsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            macro_queues::ContactsQueue::new().to_string(),
        ),
    });
    let broker = MacroEventBrokerService::new(
        KafkaEventPublisher::new(config.kafka_brokers.as_ref())
            .context("failed to create kafka event publisher")?,
        macro_event_broker::GlobalSpawner,
    );
    let side_effects = ChannelSideEffectService::new(
        PgChannelSideEffectContext::new(pool.clone()),
        ConnectionGatewayChannelRealtimePublisher::new(connection_gateway.clone()),
        NotificationChannelSender::new(notifications),
        ContactsChannelDispatcher::new(contacts_ingress),
    )
    .with_macro_event_broker(broker);
    let channel_service = Arc::new(ChannelServiceImpl::with_dependencies(
        PgChannelsRepo::new(pool.clone()),
        SpawnedChannelEventDispatcher::new(side_effects),
        channels::domain::service::NoopChannelReferenceSharePermissions,
    ));
    let entity_access = Arc::new(
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
    );
    let lexical = LexicalClient::new(
        config.internal_api_key.clone(),
        LexicalServiceUrl::new()?.to_string(),
    );
    let announcer = ChannelAnnouncer::new(Arc::clone(&channel_service), lexical.clone());
    let prompt_composer = LexicalAgentPromptComposer::new(lexical);
    let prompt_context =
        ChannelPromptContextAdapter::new(channel_service, Arc::clone(&entity_access));

    // One connection per bot, shared by every session that bot runs. Held
    // here because the gateway puts dialed-in sockets into it and the harness
    // takes sessions out of it.
    let runtimes = RuntimeRegistry::new();
    let mut defaults = HarnessDefaults::new(SessionDefaults {
        bot_id,
        model: config.harness_model.clone(),
        harness: config.harness_slug.clone(),
        repo_url: config.harness_repo_url.clone(),
    });
    if let Some(bot) = inmem_bot {
        defaults = defaults
            .with_bot(
                bot,
                SessionDefaults {
                    bot_id: bot,
                    model: config.inmem_model.clone(),
                    harness: config.inmem_harness_slug.clone(),
                    // Stamped but unused: the in-process agent has no
                    // workspace to clone anything into.
                    repo_url: config.harness_repo_url.clone(),
                },
            )
            // Sessions nothing names a bot for (the create menu's) run
            // in-process too; only mentioning the coder bot gets a sandbox.
            .with_managed_bot(bot);
    }

    // MCP connections: the same rows the chat tool path reads, so an app
    // connected in Macro is an app the sandbox can reach, with nothing to
    // keep in sync. The rows hold no secrets - Pipedream owns the grants.
    let mcp_connections = Arc::new(PgConnectionRepo::new(pool.clone()));

    // The client that addresses Pipedream's remote MCP server, built from the
    // same credentials `document_cognition_service` uses.
    let pipedream = PipedreamClient::new(PipedreamConfig {
        client_id: config.pipedream_client_id.to_string(),
        client_secret: config.pipedream_client_secret.to_string(),
        project_id: config.pipedream_project_id.to_string(),
        environment: config.pipedream_environment.clone(),
        api_url: config.pipedream_api_url.clone(),
        mcp_url: config.pipedream_mcp_url.clone(),
        // Only Connect tokens carry allowed origins, and this service never
        // mints one: connecting apps stays in the app.
        allowed_origins: Vec::new(),
    })
    .context("failed to build Pipedream client")?;

    let harness = Arc::new(AgentHarnessService::new(
        sessions,
        containers,
        announcer,
        Arc::clone(&runtimes),
        prompt_context,
        prompt_composer,
        EgressProvisioner::new(Arc::clone(&mcp_connections), config.egress_base_url.clone()),
        defaults,
    ));

    // The complete session API is served from this process because it owns the
    // live sessions. Spawned rather than awaited: the Kafka loop below owns the
    // main task, and both run until shutdown.
    let authorization_service = MacroAuthorizationServiceImpl::new(
        MacroAuthJwtValidator::new(
            JwtValidationArgs::new_with_secret_manager(config.environment, &secrets).await?,
        ),
        InternalAuthConfig {
            api_key: config.internal_api_key.clone(),
            default_user_id: None,
        },
        PgBotAuthorizer::new(PgBotAuthorizationRepo::new(pool.clone())),
    );
    let read_state = AgentSessionRouterState::new(
        AgentSessionServiceImpl::new(
            session_repo.clone(),
            FoldedMessageService::new(session_repo.clone()),
            ConnectionGatewayAgentSessionRealtime::new(connection_gateway, session_repo.clone()),
        ),
        entity_access.clone(),
        MacroAuthorizationState::new(Arc::new(authorization_service.clone())),
    );
    let control_state = AgentSessionControlState::new(
        harness.clone(),
        entity_access,
        MacroAuthorizationState::new(Arc::new(authorization_service.clone())),
    );
    let bots_directory = Arc::new(PgBotDirectory::new(PgBotsRepo::new(pool.clone())));
    let create_state = CreateSessionState::new(
        harness.clone(),
        bots_directory.clone(),
        MacroAuthorizationState::new(Arc::new(authorization_service.clone())),
    );
    let gateway_state = RuntimeGatewayState::new(
        runtimes,
        bots_directory,
        MacroAuthorizationState::new(Arc::new(authorization_service)),
    );
    let http_port = config.port;
    let http = tokio::spawn(async move {
        if let Err(error) = api::setup_and_serve(
            read_state,
            control_state,
            create_state,
            gateway_state,
            http_port,
            shutdown_signal(),
        )
        .await
        {
            tracing::error!(error = ?error, "agent harness service http stopped");
        }
    });

    // Keep trigger generation in this deployment while retaining Kafka as the
    // boundary between channel events and harness commands.
    let mut trigger = tokio::spawn(trigger::supervise(
        pool.clone(),
        config.kafka_brokers.as_ref().to_owned(),
        config.internal_api_key.clone(),
    ));

    // Every session's MCP servers: Macro's own under the reserved `macro`
    // slug, then the owner's Pipedream connections. The `macro` credential is
    // signed inline with the same key authentication_service holds; what this
    // process hands out is always single-user and minutes from expiry.
    let mcp_credentials = WithMacroMcp::new(
        PipedreamMcpCredentials::new(mcp_connections, pipedream),
        MacroApiTokenSigner::new(
            pool.clone(),
            config.macro_api_token_issuer.as_ref(),
            config.macro_api_token_private_secret_key.as_ref(),
        ),
        url::Url::parse(&config.macro_mcp_url).context("MACRO_MCP_URL is not a url")?,
        // The one gate on cleartext: a local stack's mcp-service is dialed
        // across the compose bridge, where TLS would be theater. Everywhere
        // else, an http URL refuses to boot.
        matches!(config.environment, Environment::Local),
    )
    .context("the macro MCP upstream is misconfigured")?;

    // The egress proxy: one binary today, its own listener from the start.
    let egress = EgressServiceImpl::new(
        StoredTokenSessionAuthority::new(PgAgentSessionRepo::new(pool.clone())),
        mcp_credentials,
        GithubAppTokens::new(InstallationTokenService::new(
            InstallationTokenConfig {
                client_id: config.github_sync_app_client_id.clone(),
                private_key_pem: config.github_sync_app_pem_secret_key.as_ref().to_owned(),
            },
            PgGithubSyncRepo::new(pool.clone()),
            GithubSyncClientImpl::default(),
        )),
        ReqwestForwarder::new()?,
    );
    let egress_port = config.egress_port;
    let egress_http = tokio::spawn(async move {
        if let Err(error) = api::serve_egress(egress, egress_port, shutdown_signal()).await {
            tracing::error!(error = ?error, "agent harness service egress stopped");
        }
    });

    // The consumer: every agent-session event, filtered to our bot.
    let consumer =
        KafkaEventConsumer::<AgentHarnessConsumerGroup>::from_env(config.kafka_brokers.as_ref())?;
    let consumer = KafkaConsumerAdapter::<AgentHarnessConsumerGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()
        .map_err(|error| {
            anyhow::anyhow!("failed to subscribe to agent session events: {error:?}")
        })?;
    let consumer = HarnessConsumer::new(consumer);

    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = AgentHarnessConsumerGroup::GROUP_NAME,
        %bot_id,
        environment = %config.environment,
        "agent harness service listening"
    );

    let mut shutdown = std::pin::pin!(shutdown_signal());
    let mut tasks = tokio::task::JoinSet::new();
    let mut run_error = None;
    loop {
        tokio::select! {
            () = &mut shutdown => {
                tracing::info!("agent harness service shutting down");
                break;
            }
            result = &mut trigger => {
                run_error = Some(match result {
                    Ok(()) => anyhow::anyhow!("agent trigger stopped unexpectedly"),
                    Err(error) => anyhow::anyhow!("agent trigger task failed: {error}"),
                });
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(error) => {
                        tracing::error!(error = ?error, "failed to receive agent session event");
                        continue;
                    }
                };
                let span = consumer_span(message.inner(), AgentHarnessConsumerGroup::GROUP_NAME);
                let processing = async {
                    let kafka_message = message.inner();
                    let event = match message.decode_payload() {
                        Ok(DeclaredMacroEvent::AgentSessionMacroEvent(event)) => event,
                        Err(error) => {
                            record_span_error(&tracing::Span::current(), &error);
                            tracing::error!(
                                error = ?error,
                                partition = kafka_message.partition(),
                                offset = kafka_message.offset(),
                                "dropping undecodable agent session event"
                            );
                            commit_message(&consumer, kafka_message)?;
                            return Ok::<_, anyhow::Error>(None);
                        }
                    };
                    tracing::Span::current()
                        .record("macro.event.id", tracing::field::display(event.event().event_id));

                    let routed = match route_agent_trigger(event.event().event.clone(), &our_bots) {
                        Ok(routed) => routed,
                        Err(skipped) => {
                            // Info, not debug: a skip is the last visible trace
                            // of a mention this deployment chose not to serve,
                            // and debugging "the bot did not answer" starts here.
                            tracing::info!(?skipped, "skipped an agent session event");
                            commit_message(&consumer, kafka_message)?;
                            return Ok(None);
                        }
                    };

                    let pending = match routed {
                        RoutedTrigger::Command(session_id, command) => {
                            tracing::Span::current()
                                .record("agent.session.id", tracing::field::display(session_id));
                            let event_type = match &command {
                                HarnessCommand::Open(_) => "agent_trigger.new",
                                HarnessCommand::Deliver(_) => "agent_trigger.existing",
                                HarnessCommand::Delete => "agent_trigger.delete",
                                HarnessCommand::SetSandboxSize(_) => {
                                    "agent_trigger.set_sandbox_size"
                                }
                            };
                            tracing::Span::current().record("macro.event.type", event_type);
                            let execution_span = tracing::info_span!(
                                "harness.execute",
                                agent.session.id = %session_id,
                                agent.command.type = event_type,
                                otel.status_code = tracing::field::Empty,
                                otel.status_description = tracing::field::Empty,
                            );
                            // `execute` admits synchronously, so entering here is
                            // what carries this child context through the queue.
                            let execution = execution_span
                                .in_scope(|| harness.execute(session_id, command));
                            PendingHarnessWork {
                                session_id,
                                span: execution_span,
                                work: Box::pin(execution),
                                description: "executed an agent harness command",
                            }
                        }
                        RoutedTrigger::Announce(session_id, prompt) => {
                            tracing::Span::current()
                                .record("agent.session.id", tracing::field::display(session_id));
                            tracing::Span::current()
                                .record("macro.event.type", "agent_trigger.announce");
                            let execution_span = tracing::info_span!(
                                "harness.announce",
                                agent.session.id = %session_id,
                                otel.status_code = tracing::field::Empty,
                                otel.status_description = tracing::field::Empty,
                            );
                            let harness = harness.clone();
                            PendingHarnessWork {
                                session_id,
                                span: execution_span,
                                work: Box::pin(async move {
                                    harness.announce_external_prompt(session_id, prompt).await
                                }),
                                description: "announced an external prompt",
                            }
                        }
                    };

                    // Intentionally at-most-once: admission precedes commit, but
                    // long-running harness work is independent of Kafka afterward.
                    commit_message(&consumer, kafka_message)?;
                    Ok(Some(pending))
                }
                .instrument(span.clone())
                .await;

                let pending = match processing {
                    Ok(pending) => pending,
                    Err(error) => {
                        record_span_error(&span, &error);
                        run_error = Some(error);
                        break;
                    }
                };
                if let Some(PendingHarnessWork { session_id, span, work, description }) = pending {
                    tasks.spawn(async move {
                        match work.instrument(span.clone()).await {
                            Ok(()) => tracing::info!(%session_id, description, "agent harness work completed"),
                            Err(error) => {
                                record_span_error(&span, &error);
                                tracing::error!(error = ?error, %session_id, "agent harness work failed");
                            }
                        }
                    });
                }
            }
            Some(result) = tasks.join_next(), if !tasks.is_empty() => {
                if let Err(error) = result {
                    tracing::error!(error = ?error, "agent harness task failed");
                }
            }
        }
    }

    http.abort();
    trigger.abort();
    egress_http.abort();
    let stop_failures = container_shutdown.shutdown_all().await;
    if stop_failures > 0 {
        tracing::error!(stop_failures, "some sandboxes failed to stop");
    }

    while let Some(result) = tasks.join_next().await {
        if let Err(error) = result {
            tracing::error!(error = ?error, "agent harness task failed during shutdown");
        }
    }

    event_broker_tracker.close();
    if tokio::time::timeout(
        std::time::Duration::from_secs(10),
        event_broker_tracker.wait(),
    )
    .await
    .is_err()
    {
        tracing::warn!("timed out draining in-memory agent event publishes");
    }

    match run_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}
