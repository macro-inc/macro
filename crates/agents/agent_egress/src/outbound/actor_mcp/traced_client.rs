//! Carry per-request trace context through rmcp's background transport tasks.

use futures::stream::BoxStream;
use http::{HeaderName, HeaderValue};
use rmcp::model::ClientJsonRpcMessage;
use rmcp::transport::streamable_http_client::{
    SseError, StreamableHttpClient, StreamableHttpError, StreamableHttpPostResponse,
};
use sse_stream::Sse;
use std::{collections::HashMap, sync::Arc};

#[derive(Clone)]
pub(super) struct TracedClient(pub reqwest::Client);

impl StreamableHttpClient for TracedClient {
    type Error = reqwest::Error;

    async fn post_message(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_header: Option<String>,
        mut headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<StreamableHttpPostResponse, StreamableHttpError<Self::Error>> {
        let value = serde_json::to_value(&message)?;
        for name in ["traceparent", "tracestate", "baggage"] {
            if let Some(value) = value["params"]["_meta"][name].as_str()
                && let Ok(value) = HeaderValue::from_str(value)
            {
                headers.insert(HeaderName::from_static(name), value);
            }
        }
        let mut trace = http::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut trace);
        for (name, value) in &trace {
            headers.entry(name.clone()).or_insert_with(|| value.clone());
        }
        self.0
            .post_message(uri, message, session_id, auth_header, headers)
            .await
    }

    async fn delete_session(
        &self,
        uri: Arc<str>,
        session_id: Arc<str>,
        auth_header: Option<String>,
        headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<(), StreamableHttpError<Self::Error>> {
        self.0
            .delete_session(uri, session_id, auth_header, headers)
            .await
    }

    async fn get_stream(
        &self,
        uri: Arc<str>,
        session_id: Arc<str>,
        last_event_id: Option<String>,
        auth_header: Option<String>,
        headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<BoxStream<'static, Result<Sse, SseError>>, StreamableHttpError<Self::Error>> {
        self.0
            .get_stream(uri, session_id, last_event_id, auth_header, headers)
            .await
    }
}
