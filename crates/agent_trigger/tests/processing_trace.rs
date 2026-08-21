use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use agent_session::domain::error::Result as AgentSessionResult;
use agent_session::testing::InMemoryAgentSessionRepo;
use agent_trigger::domain::processing::process_channel_event;
use agent_trigger::domain::service::{AgentBotLookup, AgentTriggerService};
use bot_id::BotId;
use channel_sender::ChannelSender;
use channels::domain::broker_events::{ChannelMacroEvent, ChannelMessagePostedMetadata};
use channels::domain::models::{ChannelType, SimpleMention};
use chrono::Utc;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
use tracing::Instrument as _;
use tracing::instrument::WithSubscriber as _;
use tracing_subscriber::layer::SubscriberExt as _;

struct AgentBots;

impl AgentBotLookup for AgentBots {
    async fn has_agent(&self, _bot_id: BotId) -> AgentSessionResult<bool> {
        Ok(true)
    }
}

struct RecordingPublisher(Arc<AtomicUsize>);

impl MacroEventBroker for RecordingPublisher {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(tokio::spawn(
            async { Ok(()) }.instrument(tracing::info_span!("test.publish")),
        ))
    }
}

fn channel_event() -> ChannelMacroEvent {
    ChannelMacroEvent::message_posted(ChannelMessagePostedMetadata {
        channel_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
        thread_id: None,
        sender: ChannelSender::new_from_user(
            MacroUserIdStr::try_from_email("trigger@macro.com").expect("valid user id"),
        ),
        triggered_by: None,
        channel_type: ChannelType::Public,
        content: "hello".to_owned(),
        mentions: vec![SimpleMention {
            entity_type: "bot".to_owned(),
            entity_id: BotId::TEST_A.into_storage_id().as_ref().to_owned(),
        }],
        attachments: vec![],
        created_at: Utc::now(),
    })
}

#[tokio::test]
async fn processing_stays_under_the_consumer_span() {
    let trigger = AgentTriggerService::new(InMemoryAgentSessionRepo::new(), AgentBots);
    let event = channel_event();
    let published = Arc::new(AtomicUsize::new(0));
    let publisher = RecordingPublisher(Arc::clone(&published));

    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    async {
        process_channel_event(&trigger, &publisher, &event)
            .instrument(tracing::info_span!("kafka.process"))
            .await
            .expect("process event");
    }
    .with_subscriber(subscriber)
    .await;

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let consumer = spans
        .iter()
        .find(|span| span.name == "kafka.process")
        .expect("consumer span");
    let evaluate = spans
        .iter()
        .find(|span| span.name == "evaluate")
        .expect("trigger evaluation span");
    let publish = spans
        .iter()
        .find(|span| span.name == "test.publish")
        .expect("publication span");

    assert_eq!(published.load(Ordering::SeqCst), 1);
    assert_eq!(evaluate.parent_span_id, consumer.span_context.span_id());
    assert_eq!(publish.parent_span_id, consumer.span_context.span_id());
}
