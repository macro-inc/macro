//! MCP Events (`io.modelcontextprotocol/events`) on the public MCP server.
//!
//! A connected agent subscribes to the same Macro events webhooks deliver,
//! with the same access rules, in two modes: `events/stream` holds the request
//! open and pushes each event as a notification, and `events/subscribe`
//! registers a callback URL that the document storage service verifies and
//! delivers to (`crates/webhook`, README's "MCP Events subscriptions").
//!
//! The `macro.events` type takes a request in plain words. It is compiled once,
//! when the subscription is made, into the exact filter language of
//! `webhook::domain::mcp::filter`; the result names the filter and a
//! deterministic reading of it, and delivery evaluates only the filter. Each
//! webhook event name is also a type of its own, taking optional parent ids.

mod catalog;
mod compiler;
mod describe;
mod dss;
mod protocol;
mod stream;
#[cfg(test)]
pub(crate) mod test;

pub(crate) use compiler::ModelFilterCompiler;
pub(crate) use dss::DssEvents;
pub(crate) use protocol::{EXTENSION_ID, METHOD_PREFIX, RequestScope, handle};

use catalog::Selection;
use compiler::{CompileError, FilterCompiler};
use dss::{EventSource, StoreError, SubscriptionStore};
use lru::LruCache;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use webhook::domain::mcp::filter::McpEventFilter;
use webhook::domain::mcp::models::{
    McpEndpointFailure, McpSecretCiphertext, McpSubscribeRequest, McpSubscribeResult,
    McpSubscriptionErrorBody, McpTtlRequest, McpUnsubscribeRequest,
};
use webhook_signature::standard::SigningSecret;

/// Compiled requests kept per process, so reopening a stream with the same
/// words costs no model call.
const COMPILED_CACHE_ENTRIES: NonZeroUsize = match NonZeroUsize::new(1024) {
    Some(entries) => entries,
    None => NonZeroUsize::MIN,
};
/// Streams one user may hold open on one process. Each holds one event
/// stream from the document storage service per distinct `ids` in its filter.
pub(crate) const MAX_STREAMS_PER_USER: u8 = 5;

/// Encrypts a subscriber's signing secret for storage.
// Object-safe (`async_trait`): `McpEvents` holds it as `Arc<dyn SecretSealer>`
// so tests can stand in for KMS.
#[async_trait::async_trait]
pub(crate) trait SecretSealer: Send + Sync {
    async fn seal(
        &self,
        user: &MacroUserIdStr<'static>,
        secret: &SigningSecret,
    ) -> Result<McpSecretCiphertext, rootcause::Report>;
}

#[async_trait::async_trait]
impl<Kms> SecretSealer for webhook::outbound::KmsMcpSecretCipher<Kms>
where
    Kms: cursor_api_key::cipher::KmsCiphertexts + Send + Sync + 'static,
{
    async fn seal(
        &self,
        user: &MacroUserIdStr<'static>,
        secret: &SigningSecret,
    ) -> Result<McpSecretCiphertext, rootcause::Report> {
        webhook::domain::mcp::ports::McpSecretCipher::encrypt(self, user, secret)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}

/// Why an `events/*` request failed, as the extension's error codes.
#[derive(Debug, thiserror::Error)]
pub(crate) enum EventsError {
    #[error("{0}")]
    InvalidParams(String),
    #[error("unknown event type")]
    UnknownEvent,
    #[error("no subscription has this name, arguments and URL")]
    UnknownSubscription,
    #[error("too many {limit}")]
    ResourceExhausted {
        limit: &'static str,
        max: Option<u32>,
    },
    #[error("{feature} `{value}` is not supported")]
    Unsupported {
        feature: &'static str,
        value: String,
    },
    #[error("the callback endpoint failed verification")]
    CallbackEndpoint(McpEndpointFailure),
    #[error("AI usage is not available: {0}")]
    NotAdmitted(String),
    #[error("internal error")]
    Internal(rootcause::Report),
}

impl From<StoreError> for EventsError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Refused(body) => match body {
                McpSubscriptionErrorBody::InvalidParams { message } => Self::InvalidParams(message),
                McpSubscriptionErrorBody::NotFound => Self::UnknownSubscription,
                McpSubscriptionErrorBody::ResourceExhausted { max } => Self::ResourceExhausted {
                    limit: "subscriptions",
                    max: Some(max),
                },
                McpSubscriptionErrorBody::CallbackEndpointError { reason } => {
                    Self::CallbackEndpoint(reason)
                }
                McpSubscriptionErrorBody::FilterRequired | McpSubscriptionErrorBody::Internal => {
                    Self::Internal(rootcause::Report::new(StoreError::Refused(body)).into_dynamic())
                }
            },
            StoreError::Internal(report) => Self::Internal(report),
        }
    }
}

impl From<CompileError> for EventsError {
    fn from(error: CompileError) -> Self {
        match error {
            CompileError::Refused(reason) => Self::InvalidParams(format!(
                "this request cannot be expressed as a Macro event filter: {reason}"
            )),
            CompileError::NotAdmitted(error) => Self::NotAdmitted(error.to_string()),
            CompileError::Internal(report) => Self::Internal(report),
        }
    }
}

/// A selection compiled into the filter delivery evaluates.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Compiled {
    pub(crate) filter: McpEventFilter,
    /// A reading of the filter in words, derived from the filter alone.
    pub(crate) interpretation: String,
}

impl Compiled {
    fn new(filter: McpEventFilter) -> Self {
        let interpretation = describe::describe(&filter);
        Self {
            filter,
            interpretation,
        }
    }
}

/// An `events/subscribe` request, parsed.
pub(crate) struct Subscribe {
    pub(crate) name: String,
    pub(crate) arguments: serde_json::Value,
    pub(crate) url: String,
    pub(crate) secret: SigningSecret,
    pub(crate) ttl: McpTtlRequest,
}

/// An `events/unsubscribe` request, parsed.
pub(crate) struct Unsubscribe {
    pub(crate) name: String,
    pub(crate) arguments: serde_json::Value,
    pub(crate) url: String,
}

/// A subscription made or refreshed, with the filter it delivers by.
pub(crate) struct Subscribed {
    pub(crate) result: McpSubscribeResult,
    pub(crate) compiled: Compiled,
}

/// Events for the public MCP server: compiling selections, webhook
/// subscriptions through the document storage service, and the source
/// streams read.
pub(crate) struct McpEvents {
    compiler: Arc<dyn FilterCompiler>,
    store: Arc<dyn SubscriptionStore>,
    source: Arc<dyn EventSource>,
    sealer: Arc<dyn SecretSealer>,
    compiled: Mutex<LruCache<(String, String), McpEventFilter>>,
    open_streams: Arc<Mutex<HashMap<String, u8>>>,
}

impl McpEvents {
    pub(crate) fn new(
        compiler: Arc<dyn FilterCompiler>,
        store: Arc<dyn SubscriptionStore>,
        source: Arc<dyn EventSource>,
        sealer: Arc<dyn SecretSealer>,
    ) -> Self {
        Self {
            compiler,
            store,
            source,
            sealer,
            compiled: Mutex::new(LruCache::new(COMPILED_CACHE_ENTRIES)),
            open_streams: Arc::default(),
        }
    }

    /// Compile a selection: a named type into its event and ids, a request in
    /// words through the model, once per user and wording on this process.
    async fn compile(
        &self,
        user: &MacroUserIdStr<'static>,
        selection: &Selection,
    ) -> Result<Compiled, EventsError> {
        let filter = match selection {
            Selection::Event { name, ids } => {
                McpEventFilter::for_events(vec![(*name).to_owned()], ids.clone())
            }
            Selection::Query(query) => {
                let key = (user.as_ref().to_owned(), query.clone());
                let cached = self
                    .compiled
                    .lock()
                    .ok()
                    .and_then(|mut cache| cache.get(&key).cloned());
                match cached {
                    Some(filter) => filter,
                    None => {
                        let filter = self.compiler.compile(user, query).await?;
                        if let Ok(mut cache) = self.compiled.lock() {
                            cache.put(key, filter.clone());
                        }
                        filter
                    }
                }
            }
        };
        filter
            .validate()
            .map_err(|error| EventsError::InvalidParams(error.to_string()))?;
        Ok(Compiled::new(filter))
    }

    /// Create or refresh a webhook subscription. A refresh keeps the filter
    /// stored when it was made, so only a new subscription to `macro.events`
    /// costs a model call.
    pub(crate) async fn subscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: Subscribe,
    ) -> Result<Subscribed, EventsError> {
        let selection = catalog::selection(&request.name, &request.arguments)?;
        let secret_ciphertext = self
            .sealer
            .seal(user, &request.secret)
            .await
            .map_err(EventsError::Internal)?;
        let mut body = McpSubscribeRequest {
            event_type: request.name,
            arguments: request.arguments,
            endpoint_url: request.url,
            filter: None,
            secret: request.secret,
            secret_ciphertext,
            ttl: request.ttl,
        };
        if let Selection::Event { .. } = selection {
            body.filter = Some(self.compile(user, &selection).await?.filter);
        }
        let result = match self.store.subscribe(user, &body).await {
            Err(StoreError::Refused(McpSubscriptionErrorBody::FilterRequired)) => {
                body.filter = Some(self.compile(user, &selection).await?.filter);
                self.store.subscribe(user, &body).await?
            }
            other => other?,
        };
        let compiled = Compiled::new(result.filter.clone());
        Ok(Subscribed { result, compiled })
    }

    /// Remove a webhook subscription.
    pub(crate) async fn unsubscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: Unsubscribe,
    ) -> Result<(), EventsError> {
        catalog::selection(&request.name, &request.arguments)?;
        let body = McpUnsubscribeRequest {
            event_type: request.name,
            arguments: request.arguments,
            endpoint_url: request.url,
        };
        Ok(self.store.unsubscribe(user, &body).await?)
    }

    /// Hold one of the user's stream slots for as long as the guard lives.
    fn claim_stream(&self, user: &MacroUserIdStr<'static>) -> Result<StreamSlot, EventsError> {
        let mut open = self
            .open_streams
            .lock()
            .map_err(|_| EventsError::Internal(rootcause::report!("stream slots poisoned")))?;
        let count = open.entry(user.as_ref().to_owned()).or_default();
        if *count >= MAX_STREAMS_PER_USER {
            return Err(EventsError::ResourceExhausted {
                limit: "streams",
                max: Some(u32::from(MAX_STREAMS_PER_USER)),
            });
        }
        *count += 1;
        Ok(StreamSlot {
            user: user.as_ref().to_owned(),
            open: Arc::clone(&self.open_streams),
        })
    }
}

/// One open stream counted against its user; released on drop.
pub(crate) struct StreamSlot {
    user: String,
    open: Arc<Mutex<HashMap<String, u8>>>,
}

impl Drop for StreamSlot {
    fn drop(&mut self) {
        if let Ok(mut open) = self.open.lock()
            && let Some(count) = open.get_mut(&self.user)
        {
            *count = count.saturating_sub(1);
            if *count == 0 {
                open.remove(&self.user);
            }
        }
    }
}
