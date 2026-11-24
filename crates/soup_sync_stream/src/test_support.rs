//! What tests plan lanes with: the web app's lane documents, as it sends them.

use serde_json::Value;

/// The web app's lane documents by operation, written by its
/// `src/lib/queries/soup/sync/lane-queries.test.ts`.
const CLIENT_QUERIES: &str = include_str!("catalog/test/client_queries.json");

/// The web app's lane documents.
pub(crate) fn client_queries() -> Value {
    serde_json::from_str(CLIENT_QUERIES).expect("client_queries.json is JSON")
}

/// `body` with the web app's lane documents, unless it names its own.
pub(crate) fn with_client_queries(mut body: Value) -> Value {
    if let Some(object) = body.as_object_mut() {
        object.entry("queries").or_insert_with(client_queries);
    }
    body
}
