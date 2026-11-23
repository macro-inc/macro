//! MCP Events (`io.modelcontextprotocol/events`) on the public MCP server.
//!
//! A connected agent subscribes to the same Macro events webhooks deliver,
//! with the same access rules, in two modes: `events/stream` holds the request
//! open and pushes each event as a notification, and `events/subscribe`
//! registers a callback URL that the document storage service verifies and
//! delivers to (`crates/webhook`, README's "MCP Events subscriptions").
//!
//! The `macro.events` type takes a request in plain words, in two steps. The
//! words alone are compiled into the exact filter language of
//! `webhook::domain::mcp::filter` and shown back, with a deterministic reading
//! of the filter, without subscribing; the caller confirms by sending that
//! filter with the words, and delivery evaluates only the filter it sent. So
//! nothing a model chose is delivered before the caller has read it. Each
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
pub(crate) use protocol::{
    EXTENSION_ID, METHOD_PREFIX, RequestScope, handle, is_confirm_step, names_chatgpt_profile,
};

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
    MAX_ARGUMENTS_BYTES, McpDeliveryProfile, McpEndpointFailure, McpSecretCiphertext,
    McpSubscribeRequest, McpSubscribeResult, McpSubscriptionErrorBody, McpTtlRequest,
    McpUnsubscribeRequest,
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
    /// A request in words was compiled; the caller confirms the filter, by
    /// sending `arguments`, before anything is subscribed. The display leaves
    /// out the filter and the words, which may name people.
    #[error("the compiled filter awaits the caller's confirmation")]
    ConfirmFilter {
        arguments: serde_json::Value,
        compiled: Compiled,
    },
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
                McpSubscriptionErrorBody::Internal => {
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
    /// Whose conventions its deliveries follow.
    pub(crate) profile: McpDeliveryProfile,
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

/// Compiled filters by (user, wording), each behind a cell its first caller
/// fills.
type CompiledCache = LruCache<(String, String), Arc<tokio::sync::OnceCell<McpEventFilter>>>;

/// Events for the public MCP server: compiling selections, webhook
/// subscriptions through the document storage service, and the source
/// streams read.
pub(crate) struct McpEvents {
    compiler: Arc<dyn FilterCompiler>,
    store: Arc<dyn SubscriptionStore>,
    source: Arc<dyn EventSource>,
    sealer: Arc<dyn SecretSealer>,
    /// One cell per user and wording, so concurrent first requests share one
    /// model call; a failed call leaves the cell empty for the next.
    compiled: Mutex<CompiledCache>,
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

    /// The filter a selection delivers by: a named type's event and ids, or
    /// the filter a request in words was confirmed with. Words without one
    /// are compiled through the model, once per user and wording on this
    /// process, and come back as `ConfirmFilter`.
    async fn compile(
        &self,
        user: &MacroUserIdStr<'static>,
        selection: &Selection,
    ) -> Result<Compiled, EventsError> {
        let filter = match selection {
            Selection::Event {
                name,
                ids,
                conditions,
            } => catalog::event_filter(name, ids.as_deref(), conditions),
            Selection::Query {
                filter: Some(filter),
                ..
            } => filter.clone(),
            Selection::Query {
                query,
                filter: None,
            } => {
                let key = (user.as_ref().to_owned(), query.clone());
                let cell = self
                    .compiled
                    .lock()
                    .map_err(|_| {
                        EventsError::Internal(rootcause::report!("filter cache poisoned"))
                    })?
                    .get_or_insert(key, Arc::default)
                    .clone();
                let filter = cell
                    .get_or_try_init(|| self.compiler.compile(user, query))
                    .await?
                    .clone();
                filter
                    .validate()
                    .map_err(|error| EventsError::InvalidParams(error.to_string()))?;
                // Offer only what can be confirmed: the arguments that carry
                // the filter must fit the subscription's own limit.
                let arguments = catalog::query_arguments(query, &filter);
                if arguments.to_string().len() > MAX_ARGUMENTS_BYTES {
                    return Err(EventsError::InvalidParams(format!(
                        "the filter this request compiles to is too large to confirm (the \
                         arguments carrying it must be at most {MAX_ARGUMENTS_BYTES} bytes of \
                         JSON); ask for less"
                    )));
                }
                return Err(EventsError::ConfirmFilter {
                    arguments,
                    compiled: Compiled::new(filter),
                });
            }
        };
        filter
            .validate()
            .map_err(|error| EventsError::InvalidParams(format!("arguments.filter: {error}")))?;
        Ok(Compiled::new(filter))
    }

    /// Create or refresh a webhook subscription. Its filter is part of its
    /// arguments, so subscribing costs no model call; words without a filter
    /// are compiled and shown back before anything is sealed or stored.
    pub(crate) async fn subscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: Subscribe,
    ) -> Result<Subscribed, EventsError> {
        let selection = catalog::selection(&request.name, &request.arguments)?;
        let compiled = self.compile(user, &selection).await?;
        let secret_ciphertext = self
            .sealer
            .seal(user, &request.secret)
            .await
            .map_err(EventsError::Internal)?;
        let body = McpSubscribeRequest {
            event_type: request.name,
            arguments: selection.arguments(),
            endpoint_url: request.url,
            filter: compiled.filter,
            secret: request.secret,
            secret_ciphertext,
            ttl: request.ttl,
            profile: request.profile,
        };
        let result = self.store.subscribe(user, &body).await?;
        // Document storage from before delivery profiles ignores the field
        // and stores an MCP subscription; its deliveries would then reach a
        // ChatGPT endpoint unredacted. Refuse, rather than answer as if it
        // were ChatGPT's (the row stays, and delivers what MCP's would, only
        // to an endpoint that checks the draft's ids and so drops it).
        if result.profile != request.profile {
            return Err(EventsError::Internal(rootcause::report!(
                "document storage stored delivery profile {} for a {} subscription",
                result.profile,
                request.profile
            )));
        }
        let compiled = Compiled::new(result.filter.clone());
        Ok(Subscribed { result, compiled })
    }

    /// Remove a webhook subscription.
    pub(crate) async fn unsubscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: Unsubscribe,
    ) -> Result<(), EventsError> {
        let selection = catalog::selection(&request.name, &request.arguments)?;
        let body = McpUnsubscribeRequest {
            event_type: request.name,
            arguments: selection.arguments(),
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
