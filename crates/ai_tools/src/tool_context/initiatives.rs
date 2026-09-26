//! Composition of project workflows from owning domain ports and adapters.

use super::*;
use documents::domain::{ports::mentions::NoOpDocumentMentionTracker, purge::DocumentPurger};
use documents::outbound::{
    document_bytes_upload::ReqwestDocumentBytesUploader,
    document_purge::{LegacyDocumentPurgeRepository, SqsDocumentPurgeQueue},
    markdown_init::LexicalSyncMarkdownInitializer,
};
use initiative::{
    domain::{
        history::InitiativeHistory, resources::InitiativeResources, service::InitiativeServiceImpl,
    },
    inbound::toolset::InitiativeToolContext,
    outbound::{PgInitiativeRepo, resources::ProjectResources},
};
use messages::inbound::toolset::InitiativeDiscussionToolContext;

type ToolDescriptionDocuments = initiative_documents::InitiativeDescriptionDocumentsAdapter<
    Arc<ToolDocumentService>,
    LexicalSyncMarkdownInitializer,
    ReqwestDocumentBytesUploader,
    NoOpDocumentMentionTracker,
    DocumentPurger<LegacyDocumentPurgeRepository, SqsDocumentPurgeQueue, ToolEventBroker>,
>;

/// Production initiative service with the same document lifecycle as DSS.
pub type ToolInitiativeService = InitiativeServiceImpl<PgInitiativeRepo, ToolDescriptionDocuments>;

/// Native project workflow context for every AI/MCP host.
pub type ToolInitiativeToolContext = InitiativeToolContext<
    ToolInitiativeService,
    ToolEntityAccessService,
    activity::outbound::pg_activity_repo::PgActivityRepo,
>;

/// Shared discussion workflow context for every AI/MCP host.
pub type ToolInitiativeDiscussionToolContext =
    InitiativeDiscussionToolContext<ToolEntityAccessService>;

/// Compose project lifecycle and discussion tools with all production side effects.
pub fn build_initiative_tool_contexts(
    pool: sqlx::PgPool,
    documents: &ToolDocumentToolContext,
    properties: Arc<ToolPropertiesService>,
    access: Arc<ToolEntityAccessService>,
    clients: ChannelSideEffectClients,
) -> (
    ToolInitiativeToolContext,
    ToolInitiativeDiscussionToolContext,
) {
    let document_queue = Arc::new(
        sqs_client::SQS::new(clients.sqs.clone())
            .document_delete_queue(macro_queues::DocumentDeleteQueue::new().as_ref()),
    );
    let purger = DocumentPurger::new(
        LegacyDocumentPurgeRepository::new(pool.clone()),
        SqsDocumentPurgeQueue::new(document_queue),
        clients.macro_event_broker.clone(),
    );
    let description = initiative_documents::InitiativeDescriptionDocumentsAdapter::new(
        documents.creator.clone(),
        purger,
    );
    let resources: Arc<dyn InitiativeResources> = Arc::new(ProjectResources::new(
        properties.clone(),
        Arc::new(SystemPropertiesServiceImpl::new(
            PgSystemPropertiesRepository::new(pool.clone()),
        )),
        access.clone(),
    ));
    let service = InitiativeServiceImpl::new(
        PgInitiativeRepo::new(pool.clone()),
        description,
        resources.clone(),
    )
    .with_event_publisher(Arc::new(
        initiative::outbound::event_publisher::BrokerInitiativeEventPublisher::new(
            clients.macro_event_broker.clone(),
        ),
    ));
    let project_context = InitiativeToolContext {
        service: Arc::new(service),
        access: access.clone(),
        history: Arc::new(InitiativeHistory::new(
            activity::outbound::pg_activity_repo::PgActivityRepo::new(pool.clone()),
            access.clone(),
        )),
        resources,
        actor: bot_id::MACRO_AI_BOT_ID,
    };
    let notification_ingress = Arc::new(SqsNotificationIngress {
        queue: notification::outbound::queue::SqsQueue::new(
            clients.sqs,
            macro_queues::NotificationIngressQueue::new().to_string(),
        ),
    });
    let delivery = messages::domain::delivery::DiscussionDelivery::new(
        messages::outbound::pg_discussion_context::PgDiscussionContext(pool.clone())
            .with_initiatives(
                initiative::domain::lookup::InitiativeLookup::new(PgInitiativeRepo::new(
                    pool.clone(),
                )),
                properties,
            ),
        messages::outbound::entity_access_audience::EntityAccessMessageAudience((*access).clone()),
        messages::outbound::connection_gateway::ConnectionGatewayMessages(
            clients.connection_gateway,
        ),
        messages::outbound::notification_sender::MessageNotificationSender(notification_ingress),
    )
    .with_sharing(messages::outbound::pg_discussion_context::PgDiscussionContext(pool.clone()));
    let effects = messages::domain::effects::MessageEffects::new(
        messages::outbound::broker::BrokerMessagePublisher::new(clients.macro_event_broker),
        messages::domain::ports::NoMessageEventPublisher,
        delivery,
    );
    let discussion_context = InitiativeDiscussionToolContext {
        service: Arc::new(shared_message_service(
            pool,
            effects,
            documents.lexical_client.clone(),
        )),
        access,
        actor: bot_id::MACRO_AI_BOT_ID,
    };
    (project_context, discussion_context)
}
