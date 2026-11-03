use serde::Deserialize;
use worker::{Env, Fetch, Method, Request, RequestInit};

use crate::{
    constants::header_names::MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
    error::ResultExt,
    state::RootChange,
    timeout::{DEFAULT_TIMEOUT_MS, timeout},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentOnlyChangeResponse {
    comment_only: bool,
}

/// Client for lexical-service, which owns what Lexical node types mean.
pub struct LexicalServiceClient<'a> {
    env: &'a Env,
}

impl<'a> LexicalServiceClient<'a> {
    pub fn new(env: &'a Env) -> Self {
        Self { env }
    }

    fn url(&self) -> worker::Result<String> {
        Ok(self.env.var("LEXICAL_SERVICE_URL")?.to_string())
    }

    fn internal_auth_key(&self) -> worker::Result<String> {
        self.env
            .secret("LEXICAL_SERVICE_AUTH_KEY")
            .map(|value| value.to_string())
            .or_else(|_| {
                self.env
                    .var("LEXICAL_SERVICE_AUTH_KEY")
                    .map(|value| value.to_string())
            })
    }

    /// Whether `change` adds, removes or alters only comment marks.
    pub async fn is_comment_only_change(&self, change: &RootChange) -> worker::Result<bool> {
        let body = serde_json::json!({
            "before": { "root": change.before },
            "after": { "root": change.after },
        });
        let mut request = Request::new_with_init(
            &format!("{}/comment-only-change", self.url()?),
            RequestInit::new()
                .with_method(Method::Post)
                .with_body(Some(body.to_string().into())),
        )?;
        request.headers_mut()?.set(
            MACRO_INTERNAL_AUTH_KEY_HEADER_KEY,
            &self.internal_auth_key()?,
        )?;
        request
            .headers_mut()?
            .set("Content-Type", "application/json")?;
        let mut response = timeout(Fetch::Request(request).send(), DEFAULT_TIMEOUT_MS)
            .await
            .into_result()??;
        let status = response.status_code();
        if status != 200 {
            return Err(worker::Error::from(format!(
                "lexical-service comment-only-change returned {status}"
            )));
        }
        let parsed: CommentOnlyChangeResponse = response
            .json()
            .await
            .context("failed to parse comment-only-change response")?;
        Ok(parsed.comment_only)
    }
}
