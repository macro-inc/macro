use std::convert::Infallible;

use axum::{
    extract::FromRequestParts,
    http::{Request, request::Parts},
};

#[cfg(test)]
mod test;

/// Request-scoped HTTP request parts for a Soup GraphQL operation.
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
    /// Mutable HTTP request parts shared by lazy resolver extractors.
    parts: tokio::sync::Mutex<Parts>,
}

impl<S> FromRequestParts<S> for GraphqlSoupRequestParts
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let mut request = Request::new(());
        *request.method_mut() = parts.method.clone();
        *request.uri_mut() = parts.uri.clone();
        *request.version_mut() = parts.version;
        *request.headers_mut() = parts.headers.clone();
        *request.extensions_mut() = parts.extensions.clone();
        Ok(Self::new(request.into_parts().0))
    }
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
