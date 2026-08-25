use anyhow::Result;
use opentelemetry::trace::TraceContextExt as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use stream::domain::StreamEvent;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Message {
    #[serde(rename = "type")]
    pub message_type: String,
    pub data: String,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub(crate) trace: HashMap<String, String>,
}

impl Message {
    pub fn new(message_type: String, data: String) -> Self {
        Self {
            message_type,
            data,
            trace: HashMap::new(),
        }
        .with_current_trace_context()
    }

    pub fn with_current_trace_context(mut self) -> Self {
        self.trace.clear();
        let context = tracing::Span::current().context();
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(&context, &mut self.trace);
        });
        self
    }

    pub fn remote_trace_context(&self) -> Option<opentelemetry::Context> {
        let context = opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.extract(&self.trace)
        });
        context.span().span_context().is_valid().then_some(context)
    }
}

pub(crate) fn record_span_error(span: &tracing::Span, error: &(impl std::fmt::Display + ?Sized)) {
    span.record("otel.status_code", "ERROR");
    span.record("otel.status_description", tracing::field::display(error));
}

static STREAM_EVENT_TYPE: &str = "stream_event";
impl TryFrom<StreamEvent> for Message {
    type Error = anyhow::Error;
    fn try_from(value: StreamEvent) -> Result<Self, Self::Error> {
        serde_json::to_string(&value)
            .map(|data| Self::new(STREAM_EVENT_TYPE.into(), data))
            .map_err(anyhow::Error::from)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum OutgoingMessage {
    Pong,
    Message(Message),
}

impl TryFrom<Message> for axum::extract::ws::Message {
    type Error = anyhow::Error;

    fn try_from(msg: Message) -> Result<Self> {
        let string: String = serde_json::to_string(&msg)?;
        Ok(axum::extract::ws::Message::Text(string.into()))
    }
}

impl TryFrom<OutgoingMessage> for axum::extract::ws::Message {
    type Error = anyhow::Error;

    fn try_from(msg: OutgoingMessage) -> Result<Self> {
        match msg {
            OutgoingMessage::Pong => Ok(axum::extract::ws::Message::Text("pong".into())),
            OutgoingMessage::Message(message) => message.try_into(),
        }
    }
}
