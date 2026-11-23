//! Optional, bounded CRM authority signal for retiring client caches.

use std::{num::NonZeroUsize, sync::Arc, time::Duration};

use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    RequestPartsExt,
    extract::{Request, State},
    http::HeaderValue,
    middleware::Next,
    response::Response,
};
use axum_extra::extract::Cached;
use crm::domain::{model::CrmError, service::CrmService};
use lru::LruCache;
use macro_authorization::{AnyPrincipal, MacroAuthorization, OptionalMacroAuthorizationExtractor};
use tokio::{sync::Mutex, time::Instant};

pub(crate) const HEADER: &str = "x-macro-crm-access";
pub(crate) const REQUEST_HEADER: &str = "x-macro-crm-access-signal";
const TTL: Duration = Duration::from_secs(3);
const QUERY_TIMEOUT: Duration = Duration::from_millis(200);
const LOOKUP_TIMEOUT: Duration = Duration::from_millis(250);
const MAX_USERS: usize = 10_000;

type UserSignal = Arc<Mutex<Option<Signal>>>;

/// This cache is only a retirement hint. Never use it for authorization.
#[derive(Clone)]
pub(crate) struct SignalCache(Arc<Mutex<LruCache<String, UserSignal>>>);

impl Default for SignalCache {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(LruCache::new(
            NonZeroUsize::new(MAX_USERS).expect("signal cache capacity is nonzero"),
        ))))
    }
}

#[derive(Clone)]
struct Signal {
    expires_at: Instant,
    value: Option<HeaderValue>,
}

impl SignalCache {
    #[tracing::instrument(name = "crm.access_signal", skip_all, fields(cache_hit))]
    async fn get(
        &self,
        user_id: &str,
        lookup: impl Future<Output = Result<HeaderValue, CrmError>>,
    ) -> Signal {
        let entry = {
            let mut entries = self.0.lock().await;
            if let Some(entry) = entries.get(user_id) {
                entry.clone()
            } else {
                // Do not evict an active lookup and lose its shared lock. When
                // the oldest slot is busy, omit this optional hint instead.
                if entries.len() == entries.cap().get()
                    && entries
                        .peek_lru()
                        .is_some_and(|(_, entry)| Arc::strong_count(entry) > 1)
                {
                    tracing::Span::current().record("cache_hit", false);
                    return Signal {
                        expires_at: Instant::now() + TTL,
                        value: None,
                    };
                }
                let entry = Arc::new(Mutex::new(None));
                entries.put(user_id.to_owned(), entry.clone());
                entry
            }
        };
        // Only requests for this user share the in-flight lookup. Other users
        // never wait behind its database query.
        let mut entry = entry.lock().await;
        if let Some(signal) = entry.as_ref().filter(|s| s.expires_at > Instant::now()) {
            tracing::Span::current().record("cache_hit", true);
            return signal.clone();
        }
        tracing::Span::current().record("cache_hit", false);
        // Count freshness from before the read, not its completion. Cache misses
        // and failures too, so an outage cannot create a lookup on every request.
        let expires_at = Instant::now() + TTL;
        // If the request is cancelled mid-read, retain an unknown hint for the
        // same window instead of letting its next retry start another lookup.
        *entry = Some(Signal {
            expires_at,
            value: None,
        });
        let value = match tokio::time::timeout(QUERY_TIMEOUT, lookup).await {
            Ok(Ok(value)) => Some(value),
            Ok(Err(error)) => {
                tracing::warn!(error = ?error, "unable to publish CRM authority");
                None
            }
            Err(_) => {
                tracing::warn!("CRM authority signal lookup timed out");
                None
            }
        };
        let signal = Signal { expires_at, value };
        *entry = Some(signal.clone());
        signal
    }
}

#[tracing::instrument(skip_all)]
pub(crate) async fn handler(
    State((state, cache)): State<(ApiContext, SignalCache)>,
    request: Request,
    next: Next,
) -> Response {
    // Check before even extracting authentication: old clients and callers
    // without a CRM cache do not perform any work for this optional signal.
    if !requested(&request) {
        return next.run(request).await;
    }
    let (mut parts, body) = request.into_parts();
    let auth = parts
        .extract_with_state::<
            Cached<OptionalMacroAuthorizationExtractor<AuthorizationService, AnyPrincipal>>,
            _,
        >(&state)
        .await;
    let request = Request::from_parts(parts, body);
    let authority = async {
        let Ok(Cached(auth)) = auth else {
            return None;
        };
        let user = auth
            .authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)?;
        Some(
            cache
                .get(user.macro_user_id.as_ref(), async {
                    state
                        .crm_state
                        .service
                        .current_member_access(user.macro_user_id.as_ref())
                        .await
                        .map(|access| {
                            match access {
                                Some((team, allowed)) => {
                                    format!("{team}:{}", if allowed { "allowed" } else { "denied" })
                                }
                                None => "none".to_owned(),
                            }
                            .parse()
                            .expect("CRM authority is a valid header")
                        })
                })
                .await,
        )
    };
    respond(request, next, authority).await
}

fn requested(request: &Request) -> bool {
    request
        .headers()
        .get(REQUEST_HEADER)
        .is_some_and(|value| value == "1")
}

async fn respond(
    request: Request,
    next: Next,
    authority: impl Future<Output = Option<Signal>>,
) -> Response {
    if !requested(&request) {
        return next.run(request).await;
    }
    // Run the handler immediately, alongside the hint. Bound the entire hint,
    // including waiting for an in-flight lookup, independently of handler time.
    let (authority, mut response) = tokio::join!(
        tokio::time::timeout(LOOKUP_TIMEOUT, authority),
        next.run(request)
    );
    if let Ok(Some(Signal {
        expires_at,
        value: Some(value),
    })) = authority
        && expires_at > Instant::now()
    {
        response.headers_mut().insert(HEADER, value);
    }
    response
}

#[cfg(test)]
mod test;
