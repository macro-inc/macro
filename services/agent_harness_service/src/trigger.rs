//! Committed-post consumer that emits agent-session trigger events.

use agent_session::outbound::postgres::PgAgentSessionRepo;
use agent_trigger::domain::processing::process_message_event;
use agent_trigger::domain::service::AgentTriggerService;
use agent_trigger::domain::sources::{MessageTriggerEvents, TriggerEvents};
use agent_trigger::domain::task_assignment::process_task_assignment;
use agent_trigger::outbound::{
    BotRepoAgentLookup, ChannelRepoTypeLookup, DssTaskAssignmentContext, FastModelTriggerJudge,
    LexicalExplicitReplyExtractor, MessageThreadHistory, VisionImageCaptioner,
};
use bots::outbound::pg_bots_repo::PgBotsRepo;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use document_storage_service_client::DocumentStorageServiceClient;
use entity_registry::OwnerGrantPolicy;
use entity_registry_db_utils::OwnedEntityRegistrar;
use kafka_util::{GroupName, KafkaEventConsumer, consumer_span, record_span_error};
use lexical_client::LexicalClient;
use macro_event_broker::{
    KafkaConsumerAdapter, KafkaEventPublisher, MacroEventBrokerService, MacroEventCollection,
    MacroEventConsumerService,
};
use macro_service_urls::{DocumentStorageServiceUrl, LexicalServiceUrl, StaticFileServiceUrl};
use messages::domain::api::MessageServiceApi;
use messages::outbound::pg_message_repo::PgMessageRepository;
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::time::{Duration, sleep};
use tracing::Instrument as _;

struct AgentTriggerConsumerGroup;

impl GroupName for AgentTriggerConsumerGroup {
    const GROUP_NAME: &'static str = "agent-trigger-service";
}

/// The concrete trigger service this binary composes.
type Trigger = AgentTriggerService<
    PgAgentSessionRepo<PgBotsRepo>,
    BotRepoAgentLookup<PgBotsRepo>,
    BotRepoAgentLookup<PgBotsRepo>,
    BotRepoAgentLookup<PgBotsRepo>,
    LexicalExplicitReplyExtractor,
    FastModelTriggerJudge,
    MessageThreadHistory<
        entity_access::domain::service::EntityAccessServiceImpl<
            entity_access::outbound::PgAccessRepository,
        >,
    >,
>;
type Publisher = MacroEventBrokerService<KafkaEventPublisher, macro_event_broker::GlobalSpawner>;
type ChannelTypes = ChannelRepoTypeLookup<PgChannelsRepo>;

type TriggerKafkaAdapter<M> = KafkaConsumerAdapter<AgentTriggerConsumerGroup, M>;
type TriggerConsumer<M> = MacroEventConsumerService<M, TriggerKafkaAdapter<M>>;

fn commit_message<M: MacroEventCollection + 'static>(
    consumer: &TriggerConsumer<M>,
    message: &BorrowedMessage<'_>,
) -> anyhow::Result<()> {
    consumer
        .inner()
        .commit_message(message, CommitMode::Sync)
        .map_err(|error| anyhow::anyhow!("failed to commit trigger event offset: {error:?}"))
}

/// Shared domain services retained across trigger-consumer restarts.
#[derive(Clone)]
pub struct TriggerServices {
    /// Recorder configured with the host's quota policy.
    pub recorder: Arc<dyn ai_usage::UsageRecorder>,
    /// Admission gate for Macro-funded inference.
    pub admission: Arc<dyn ai_billing::AiAdmissionService>,
    /// Message service used to announce task assignments.
    pub messages: Arc<dyn MessageServiceApi>,
}

/// Keeps the trigger consumer running across transient failures.
pub async fn supervise(
    pool: PgPool,
    kafka_brokers: String,
    internal_api_key: String,
    document_storage_service_auth_key: String,
    services: TriggerServices,
) {
    loop {
        if let Err(error) = run(
            pool.clone(),
            kafka_brokers.clone(),
            internal_api_key.clone(),
            document_storage_service_auth_key.clone(),
            services.clone(),
        )
        .await
        {
            tracing::error!(error = ?error, "agent trigger stopped; restarting");
            sleep(Duration::from_secs(1)).await;
        }
    }
}

async fn run(
    pool: PgPool,
    kafka_brokers: String,
    internal_api_key: String,
    document_storage_service_auth_key: String,
    services: TriggerServices,
) -> anyhow::Result<()> {
    let TriggerServices {
        recorder,
        admission,
        messages,
    } = services;
    let lexical = LexicalClient::new(internal_api_key, LexicalServiceUrl::new()?.to_string());
    let task_context = DssTaskAssignmentContext::new(
        DocumentStorageServiceClient::new(
            document_storage_service_auth_key,
            DocumentStorageServiceUrl::new()?.to_string(),
        ),
        lexical.clone(),
    );
    let images = VisionImageCaptioner::new(
        static_file::outbound::CdnStaticFileRepo::new(StaticFileServiceUrl::new()?.to_string()),
        recorder.clone(),
    );
    let trigger = AgentTriggerService::new(
        PgAgentSessionRepo::new(
            pool.clone(),
            OwnedEntityRegistrar::new(OwnerGrantPolicy::new(PgBotsRepo::new(pool.clone()))),
        ),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        BotRepoAgentLookup::new(PgBotsRepo::new(pool.clone())),
        LexicalExplicitReplyExtractor::new(lexical),
        FastModelTriggerJudge::new(recorder, images),
        MessageThreadHistory::new(
            std::sync::Arc::new(messages::domain::service::MessageService::new(
                PgMessageRepository::new(pool.clone())
                    .with_initiatives(initiative::domain::lookup::InitiativeLookup::new(
                        initiative::outbound::PgInitiativeRepo::new(pool.clone()),
                    ))
                    .with_crm(crm::outbound::lookup::PgCrmParentReader::new(pool.clone())),
                messages::domain::ports::NoMessageEventPublisher,
            )),
            entity_access::domain::service::EntityAccessServiceImpl::new(
                entity_access::outbound::PgAccessRepository::new(pool.clone()),
            ),
        ),
    )
    .with_admission(admission);
    let channel_types = ChannelRepoTypeLookup::new(PgChannelsRepo::new(pool));
    let publisher = MacroEventBrokerService::new(
        KafkaEventPublisher::new(&kafka_brokers)?,
        macro_event_broker::GlobalSpawner,
    );
    let consumer = KafkaEventConsumer::<AgentTriggerConsumerGroup>::from_env(&kafka_brokers)?;
    let consumer = KafkaConsumerAdapter::<AgentTriggerConsumerGroup, ()>::new(consumer);
    consume::<MessageTriggerEvents>(
        consumer,
        &trigger,
        &publisher,
        &channel_types,
        messages.as_ref(),
        &task_context,
    )
    .await
}

/// Read the trigger topic until it fails, evaluating every committed post.
async fn consume<Events: TriggerEvents>(
    consumer: KafkaConsumerAdapter<AgentTriggerConsumerGroup, ()>,
    trigger: &Trigger,
    publisher: &Publisher,
    channel_types: &ChannelTypes,
    messages: &dyn MessageServiceApi,
    task_context: &DssTaskAssignmentContext,
) -> anyhow::Result<()> {
    let consumer = consumer
        .subscribe::<Events>()
        .map_err(|error| anyhow::anyhow!("failed to subscribe to trigger events: {error:?}"))?;
    let consumer = TriggerConsumer::<Events>::new(consumer);

    tracing::info!(
        topics = ?Events::topics(),
        group = AgentTriggerConsumerGroup::GROUP_NAME,
        "agent trigger listening"
    );

    loop {
        let message = match consumer.recv().await {
            Ok(message) => message,
            Err(error) => {
                tracing::error!(error = ?error, "failed to receive trigger event");
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        let span = consumer_span(message.inner(), AgentTriggerConsumerGroup::GROUP_NAME);
        let result = async {
            let kafka_message = message.inner();
            let decoded = match message.decode_payload() {
                Ok(decoded) => decoded.into_trigger(),
                Err(error) => {
                    record_span_error(&tracing::Span::current(), &error);
                    tracing::error!(
                        error = ?error,
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                        "dropping undecodable trigger event"
                    );
                    commit_message(&consumer, kafka_message)?;
                    return Ok::<(), anyhow::Error>(());
                }
            };
            tracing::Span::current()
                .record("macro.event.id", tracing::field::display(decoded.event_id));
            tracing::Span::current().record("macro.event.type", decoded.event_type);

            if let Some(posted) = &decoded.posted {
                process_message_event(trigger, publisher, channel_types, posted).await?;
            }
            if let Some(assignment) = &decoded.assignment {
                process_task_assignment(trigger, publisher, messages, task_context, assignment)
                    .await?;
            }
            commit_message(&consumer, kafka_message)?;
            Ok(())
        }
        .instrument(span.clone())
        .await;
        if let Err(error) = &result {
            record_span_error(&span, error);
        }
        result?;
    }
}
