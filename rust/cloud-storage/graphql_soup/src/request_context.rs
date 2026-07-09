use axum::{extract::FromRequestParts, http::request::Parts};

/// Request-scoped HTTP request parts for a Soup GraphQL query.
///
/// Resolvers run axum `FromRequestParts` extractors against these parts on
/// demand instead of the embedding service loading everything upfront. This
/// keeps per-request work lazy: a query that never touches email links or
/// CRM scope never pays for resolving them.
///
/// Extraction results that should be computed once per request should be
/// wrapped in `axum_extra::extract::Cached`, which memoizes inside the parts'
/// extensions exactly like the REST routes do.
pub struct GraphqlSoupRequestParts {
    parts: tokio::sync::Mutex<Parts>,
}

impl GraphqlSoupRequestParts {
    /// Wrap the parts of the incoming HTTP request.
    pub fn new(parts: Parts) -> Self {
        Self {
            parts: tokio::sync::Mutex::new(parts),
        }
    }

    /// Run an axum extractor against the stored request parts.
    pub async fn extract_with_state<T, St>(&self, state: &St) -> Result<T, T::Rejection>
    where
        T: FromRequestParts<St>,
        St: Send + Sync,
    {
        let mut parts = self.parts.lock().await;
        T::from_request_parts(&mut parts, state).await
    }
}
