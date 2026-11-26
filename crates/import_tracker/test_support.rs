//! Tests drive the real connectors services over `FakeConnectors`: a user
//! holds an app the way the rules count it, and its API answers in turn.

use connectors::fake::{FakeConnection, FakeConnectors};
use connectors::{ApiResponse, Connectors};
use http::{HeaderMap, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use std::sync::Arc;

pub fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

/// A `200` answer with a JSON body.
pub fn ok(body: Value) -> ApiResponse {
    answer(StatusCode::OK, body)
}

/// An answer with a JSON body.
pub fn answer(status: StatusCode, body: Value) -> ApiResponse {
    ApiResponse {
        status,
        headers: HeaderMap::new(),
        body: body.to_string(),
    }
}

/// [`user`] connected to `app` with API access, its API answering
/// `responses` in turn.
pub fn connected(app: &str, responses: Vec<ApiResponse>) -> (FakeConnectors, Arc<Connectors>) {
    let fake = FakeConnectors::new().with_catalog_app(app).with_connection(
        &user(),
        FakeConnection::app(app).answering_in_turn(responses),
    );
    let connectors = Arc::new(fake.build());
    (fake, connectors)
}

/// The JSON bodies of every API call made so far, in order.
pub fn bodies(fake: &FakeConnectors) -> Vec<Option<Value>> {
    fake.api_calls().into_iter().map(|call| call.body).collect()
}
