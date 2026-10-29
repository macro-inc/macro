use http::{HeaderMap, Method, StatusCode};
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::PipedreamConnection;
use pipedream_mcp::domain::ports::{ConnectedAppProxy, ConnectionStore, ProxyResponse};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::Mutex;

pub struct Store;
impl ConnectionStore for Store {
    type Err = std::convert::Infallible;
    async fn load(
        &self,
        user: &MacroUserIdStr<'static>,
        slug: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        Ok(Some(PipedreamConnection {
            user_id: user.clone(),
            app_slug: slug.into(),
            server_name: slug.into(),
            account_id: "apn_test".into(),
            enabled: true,
        }))
    }
    async fn save(&self, _: &PipedreamConnection) -> Result<(), Self::Err> {
        unreachable!()
    }
    async fn delete(&self, _: &MacroUserIdStr<'static>, _: &str) -> Result<(), Self::Err> {
        unreachable!()
    }
    async fn list(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        unreachable!()
    }
}

pub struct Proxy {
    pub responses: Mutex<VecDeque<ProxyResponse>>,
    pub requests: Mutex<Vec<(Method, String, Option<Value>)>>,
}
impl Proxy {
    pub fn new(bodies: Vec<Value>) -> Self {
        Self {
            responses: Mutex::new(
                bodies
                    .into_iter()
                    .map(|body| ProxyResponse {
                        status: StatusCode::OK,
                        headers: HeaderMap::new(),
                        body: body.to_string(),
                    })
                    .collect(),
            ),
            requests: Mutex::new(Vec::new()),
        }
    }
}
impl ConnectedAppProxy for Proxy {
    async fn proxy(
        &self,
        _: &PipedreamConnection,
        method: Method,
        url: &str,
        _: &HeaderMap,
        body: Option<&Value>,
    ) -> anyhow::Result<ProxyResponse> {
        self.requests
            .lock()
            .unwrap()
            .push((method, url.to_string(), body.cloned()));
        Ok(self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected provider request"))
    }
}
