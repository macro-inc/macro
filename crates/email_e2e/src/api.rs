//! Calls to the email API, as a signed-in user's client makes them.

use reqwest::Method;
use rootcause::prelude::*;
use serde_json::Value;
use uuid::Uuid;

/// The header that picks the inbox a request acts on.
const LINK_HEADER: &str = "x-email-link-id";

/// An answer of the email API.
#[derive(Clone, Debug)]
pub struct ApiResponse {
    /// The HTTP status.
    pub status: u16,
    /// The body as JSON. Null when the body is empty or not JSON.
    pub json: Value,
    /// The body as text.
    pub text: String,
}

impl ApiResponse {
    /// The JSON body of a 2xx answer; an error naming the status and body
    /// otherwise.
    pub fn ok(self) -> Result<Value, Report> {
        if (200..300).contains(&self.status) {
            Ok(self.json)
        } else {
            bail!("the API answered {}: {}", self.status, self.text)
        }
    }
}

/// Who a request is made as, and where.
#[derive(Clone)]
pub(crate) struct ApiClient {
    pub(crate) http: reqwest::Client,
    pub(crate) api_url: String,
    /// Where the GraphQL API answers, in a stack that serves it.
    pub(crate) graphql_url: Option<String>,
    pub(crate) internal_api_key: String,
    pub(crate) macro_user_id: String,
    pub(crate) fusion_user_id: Uuid,
}

impl ApiClient {
    /// Runs one GraphQL operation as the user and answers its `data`. A
    /// GraphQL error fails the call, with what the server said.
    pub(crate) async fn graphql(&self, query: &str, variables: &Value) -> Result<Value, Report> {
        let Some(url) = &self.graphql_url else {
            bail!(
                "this stack does not serve GraphQL: start it with \
                 `StackOptions {{ document_storage: true, ..Default::default() }}`"
            );
        };
        let response = self
            .http
            .post(url)
            .header("x-internal-auth-key", &self.internal_api_key)
            .header("x-internal-macro-user-id", &self.macro_user_id)
            .header(
                "x-internal-fusionauth-user-id",
                self.fusion_user_id.to_string(),
            )
            .json(&serde_json::json!({ "query": query, "variables": variables }))
            .send()
            .await
            .context("the GraphQL API did not answer")?;
        let status = response.status();
        let text = response
            .text()
            .await
            .context("the GraphQL API answered an unreadable body")?;
        if !status.is_success() {
            bail!("the GraphQL API answered {status}: {text}");
        }
        let mut answer: Value = serde_json::from_str(&text)
            .context(format!("the GraphQL API answered {status}: {text}"))?;
        if let Some(errors) = answer.get("errors").filter(|errors| !errors.is_null()) {
            bail!("the GraphQL API answered errors: {errors}");
        }
        Ok(answer["data"].take())
    }

    /// Makes one request as the user, on the inbox `link` when given.
    ///
    /// The services accept a user through the internal headers the Macro
    /// gateway services use among themselves; the request is authorized as
    /// that user exactly as a session token's would be.
    pub(crate) async fn request(
        &self,
        method: Method,
        path: &str,
        link: Option<Uuid>,
        body: Option<&Value>,
    ) -> Result<ApiResponse, Report> {
        let mut request = self
            .http
            .request(method.clone(), format!("{}{path}", self.api_url))
            .header("x-internal-auth-key", &self.internal_api_key)
            .header("x-internal-macro-user-id", &self.macro_user_id)
            .header(
                "x-internal-fusionauth-user-id",
                self.fusion_user_id.to_string(),
            );
        if let Some(link) = link {
            request = request.header(LINK_HEADER, link.to_string());
        }
        if let Some(body) = body {
            request = request.json(body);
        }

        let response = request
            .send()
            .await
            .context(format!("{method} {path} did not answer"))?;
        let status = response.status().as_u16();
        let text = response
            .text()
            .await
            .context(format!("{method} {path} answered an unreadable body"))?;
        let json = serde_json::from_str(&text).unwrap_or(Value::Null);
        Ok(ApiResponse { status, json, text })
    }
}
