//! The user's Dialpad grant, held by Macro Connect and read over its customer
//! API (`macro-inc/macro-connect`).
use crate::domain::{
    models::{AccessToken, DIALPAD_APP, Grant},
    ports::{Grants, Result},
};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Method, StatusCode, Url};
use serde::Deserialize;
use serde_json::{Value, json};
use zeroize::Zeroizing;

/// [`Grants`] over Macro Connect, as the customer its key names.
pub struct ConnectGrants {
    http: reqwest::Client,
    base_url: Url,
    customer_key: Zeroizing<String>,
}

/// Connect's answer. Never log the body: a token export carries the token.
struct Reply {
    status: StatusCode,
    body: Vec<u8>,
}

impl Reply {
    /// Connect's error code, e.g. `needs_reauth`.
    fn error(&self) -> Option<String> {
        #[derive(Deserialize)]
        struct Error {
            error: String,
        }
        serde_json::from_slice::<Error>(&self.body)
            .ok()
            .map(|error| error.error)
    }
}

impl ConnectGrants {
    /// Grants from the Connect API at `base_url`.
    pub fn new(base_url: &str, customer_key: impl Into<String>) -> Result<Self> {
        let base_url = Url::parse(base_url)?;
        if base_url.cannot_be_a_base() {
            return Err(rootcause::report!(
                "Macro Connect URL is not an HTTP origin"
            ));
        }
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            base_url,
            customer_key: Zeroizing::new(customer_key.into()),
        })
    }

    async fn send(&self, method: Method, path: &[&str], body: Option<Value>) -> Result<Reply> {
        let mut url = self.base_url.clone();
        url.path_segments_mut()
            .map_err(|()| rootcause::report!("Macro Connect URL is not an HTTP origin"))?
            .pop_if_empty()
            .extend(path);
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let mut request = self
            .http
            .request(method, url)
            .headers(headers)
            .bearer_auth(self.customer_key.as_str());
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        Ok(Reply {
            status: response.status(),
            body: response.bytes().await?.to_vec(),
        })
    }
}

#[async_trait]
impl Grants for ConnectGrants {
    #[tracing::instrument(name = "connect.access_token", skip_all, err(Display))]
    async fn grant(&self, user: &MacroUserIdStr<'static>) -> Result<Grant> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Token {
            access_token: String,
        }
        let path = [
            "v1",
            "users",
            user.as_ref(),
            "connections",
            DIALPAD_APP,
            "token",
        ];
        let reply = self.send(Method::GET, &path, None).await?;
        match reply.status {
            status if status.is_success() => {
                let token: Token = serde_json::from_slice(&reply.body)?;
                Ok(Grant::Active(AccessToken(Zeroizing::new(
                    token.access_token,
                ))))
            }
            StatusCode::NOT_FOUND => Ok(Grant::NotConnected),
            StatusCode::CONFLICT if reply.error().as_deref() == Some("needs_reauth") => {
                Ok(Grant::NeedsReauth)
            }
            status => Err(rootcause::report!(
                "Macro Connect token export returned HTTP {status}"
            )),
        }
    }

    #[tracing::instrument(name = "connect.create_connect_session", skip_all, err(Display))]
    async fn connect_url(
        &self,
        user: &MacroUserIdStr<'static>,
        redirect_url: &str,
    ) -> Result<String> {
        #[derive(Deserialize)]
        struct Session {
            connect_url: String,
        }
        let body = json!({
            "external_user_id": user.as_ref(),
            "app_id": DIALPAD_APP,
            "redirect_url": redirect_url,
        });
        let reply = self
            .send(Method::POST, &["v1", "connect-sessions"], Some(body))
            .await?;
        if !reply.status.is_success() {
            return Err(rootcause::report!(
                "Macro Connect session returned HTTP {}",
                reply.status
            ));
        }
        Ok(serde_json::from_slice::<Session>(&reply.body)?.connect_url)
    }

    #[tracing::instrument(name = "connect.delete_connection", skip_all, err(Display))]
    async fn disconnect(&self, user: &MacroUserIdStr<'static>) -> Result<()> {
        let path = ["v1", "users", user.as_ref(), "connections", DIALPAD_APP];
        let reply = self.send(Method::DELETE, &path, None).await?;
        match reply.status {
            status if status.is_success() || status == StatusCode::NOT_FOUND => Ok(()),
            status => Err(rootcause::report!(
                "Macro Connect disconnect returned HTTP {status}"
            )),
        }
    }
}

#[cfg(test)]
mod test;
