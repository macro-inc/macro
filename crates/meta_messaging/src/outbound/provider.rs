//! Direct official Meta Graph API adapter. Redirects are disabled, URLs have
//! fixed provider origins, and errors never retain token-bearing request URLs.

use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::{Client, Method, Response};
use serde_json::{Value, json};
use url::Url;

use crate::domain::{connection::*, events::*, models::*, ports::*};

mod history;
mod media;
mod sending;
#[cfg(all(test, feature = "axum"))]
mod test;

/// WhatsApp app credentials; deliberately not Debug/Serialize.
pub struct WhatsappCredentials {
    /// Parent Meta app ID.
    pub app_id: String,
    /// Parent Meta app secret.
    pub app_secret: AccessToken,
}
/// Instagram Login credentials inside the Meta business app.
pub struct InstagramCredentials {
    /// Instagram app ID, distinct from the parent app ID.
    pub app_id: String,
    /// Instagram App Secret from Instagram API setup.
    pub app_secret: AccessToken,
    /// Exact approved HTTPS callback URI.
    pub redirect_uri: String,
}
/// Explicit local test-number configuration with a recipient allowlist.
pub struct WhatsappDeveloperAccount {
    /// Graph messaging-account identity from Meta API Setup.
    pub business_account_id: ProviderId,
    /// Meta API Setup test phone-number identity.
    pub phone_number_id: ProviderId,
    /// Server-side test token; never returned to the browser.
    pub token: AccessToken,
    /// Explicitly authorized test recipients, as WhatsApp IDs with country code.
    pub recipients: Vec<ProviderId>,
}
/// Official API client; absent credentials disable only the corresponding connection flow.
pub struct HttpMetaProvider {
    client: Client,
    version: String,
    whatsapp: Option<WhatsappCredentials>,
    instagram: Option<InstagramCredentials>,
    developer: Option<WhatsappDeveloperAccount>,
    #[cfg(all(test, feature = "axum"))]
    test_origin: Option<Url>,
}
impl HttpMetaProvider {
    /// Pin a supported version and validate all supplied configuration at startup.
    pub fn new(
        version: String,
        whatsapp: Option<WhatsappCredentials>,
        instagram: Option<InstagramCredentials>,
    ) -> Result<Self, MessagingError> {
        if version != "v26.0" {
            return Err(MessagingError::Invalid(
                "this integration supports Meta Graph API v26.0",
            ));
        }
        for id in whatsapp
            .as_ref()
            .map(|c| &c.app_id)
            .into_iter()
            .chain(instagram.as_ref().map(|c| &c.app_id))
        {
            if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
                return Err(MessagingError::Invalid("invalid Meta application ID"));
            }
        }
        if let Some(config) = &instagram {
            let uri = Url::parse(&config.redirect_uri)
                .map_err(|_| MessagingError::Invalid("invalid Instagram redirect URI"))?;
            if uri.scheme() != "https"
                || uri.host_str().is_none()
                || !uri.username().is_empty()
                || uri.password().is_some()
                || uri.fragment().is_some()
            {
                return Err(MessagingError::Invalid(
                    "Instagram requires an exact HTTPS redirect URI",
                ));
            }
        }
        let client = Client::builder()
            .user_agent("MacroMessaging/1.0")
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| MessagingError::Unavailable)?;
        Ok(Self {
            client,
            version,
            whatsapp,
            instagram,
            developer: None,
            #[cfg(all(test, feature = "axum"))]
            test_origin: None,
        })
    }
    /// Enable a test account only when the host has independently enforced local mode.
    pub fn with_developer_account(
        mut self,
        config: WhatsappDeveloperAccount,
    ) -> Result<Self, MessagingError> {
        if config.recipients.is_empty() || config.recipients.len() > 5 {
            return Err(MessagingError::Invalid(
                "configure one to five verified test recipients",
            ));
        }
        self.developer = Some(config);
        Ok(self)
    }
    fn endpoint(&self, provider: Provider, path: &[&str]) -> Url {
        let host = match provider {
            Provider::Whatsapp => "https://graph.facebook.com",
            Provider::Instagram => "https://graph.instagram.com",
        };
        let mut url = Url::parse(host).expect("constant provider URL");
        #[cfg(all(test, feature = "axum"))]
        if let Some(origin) = &self.test_origin {
            url = origin.clone();
        }
        {
            let mut segments = url.path_segments_mut().expect("constant provider URL");
            segments.push(&self.version);
            for segment in path {
                segments.push(segment);
            }
        }
        url
    }
    fn instagram_token_endpoint(&self, exchange_code: bool) -> Url {
        let url = Url::parse(if exchange_code {
            "https://api.instagram.com/oauth/access_token"
        } else {
            "https://graph.instagram.com/access_token"
        })
        .expect("constant Instagram token URL");
        #[cfg(all(test, feature = "axum"))]
        if let Some(origin) = &self.test_origin {
            return origin.join(url.path()).expect("constant token path");
        }
        url
    }
    async fn graph(
        &self,
        provider: Provider,
        token: &AccessToken,
        method: Method,
        path: &[&str],
        params: &[(&str, &str)],
        body: Option<&Value>,
    ) -> PortResult<Value> {
        let mut request = self
            .client
            .request(method, self.endpoint(provider, path))
            .bearer_auth(token.expose())
            .query(params);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        checked_json(response).await
    }
    async fn whatsapp_authorize(
        &self,
        input: &CompleteAuthorization,
    ) -> PortResult<AuthorizedAccount> {
        let config = self
            .whatsapp
            .as_ref()
            .ok_or(MessagingError::Invalid("WhatsApp is not configured"))?;
        let account = input
            .business_account_id
            .as_ref()
            .ok_or(MessagingError::Invalid(
                "Embedded Signup did not return a messaging account",
            ))?;
        let response = self
            .client
            .get(self.endpoint(Provider::Whatsapp, &["oauth", "access_token"]))
            .query(&[
                ("client_id", config.app_id.as_str()),
                ("client_secret", config.app_secret.expose()),
                ("code", input.code.as_str()),
            ])
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        let response = checked_json(response).await?;
        let token = AccessToken::new(required(&response, "access_token")?.to_owned())?;
        let app_token =
            AccessToken::new(format!("{}|{}", config.app_id, config.app_secret.expose()))?;
        let debug = self
            .graph(
                Provider::Whatsapp,
                &app_token,
                Method::GET,
                &["debug_token"],
                &[("input_token", token.expose())],
                None,
            )
            .await?;
        let data = &debug["data"];
        if data["is_valid"] != true || data["app_id"].as_str() != Some(&config.app_id) {
            return Err(MessagingError::Forbidden.into());
        }
        for scope in [
            "whatsapp_business_management",
            "whatsapp_business_messaging",
        ] {
            if !data["scopes"]
                .as_array()
                .is_some_and(|a| a.iter().any(|s| s.as_str() == Some(scope)))
            {
                return Err(MessagingError::Invalid(
                    "required WhatsApp permissions were not granted",
                )
                .into());
            }
        }
        let phones = self
            .graph(
                Provider::Whatsapp,
                &token,
                Method::GET,
                &[account.as_str(), "phone_numbers"],
                &[
                    (
                        "fields",
                        "id,verified_name,display_phone_number,is_on_biz_app,platform_type",
                    ),
                    ("limit", "100"),
                ],
                None,
            )
            .await?;
        let choices = phones["data"]
            .as_array()
            .ok_or(MessagingError::ProviderRejected)?;
        let phone = match &input.phone_number_id {
            Some(id) => choices
                .iter()
                .find(|p| p["id"].as_str() == Some(id.as_str()))
                .ok_or(MessagingError::Forbidden)?,
            None if choices.len() == 1 => &choices[0],
            None => {
                return Err(MessagingError::Invalid(
                    "choose one phone number in Embedded Signup and try connecting again",
                )
                .into());
            }
        };
        if phone["is_on_biz_app"] != true || phone["platform_type"] != "CLOUD_API" {
            return Err(MessagingError::Invalid(
                "this number is not registered for WhatsApp Business app coexistence",
            )
            .into());
        }
        let expires_at = data["expires_at"]
            .as_i64()
            .filter(|n| *n > 0)
            .and_then(|n| DateTime::from_timestamp(n, 0));
        Ok(AuthorizedAccount {
            developer_account: false,
            account_id: required(phone, "id")?.to_owned().try_into()?,
            business_account_id: Some(account.clone()),
            display_name: phone["display_phone_number"]
                .as_str()
                .or_else(|| phone["verified_name"].as_str())
                .unwrap_or(account.as_str())
                .to_owned(),
            token,
            expires_at,
        })
    }
    async fn instagram_authorize(
        &self,
        input: &CompleteAuthorization,
    ) -> PortResult<AuthorizedAccount> {
        let config = self
            .instagram
            .as_ref()
            .ok_or(MessagingError::Invalid("Instagram is not configured"))?;
        let response = self
            .client
            .post(self.instagram_token_endpoint(true))
            .form(&[
                ("client_id", config.app_id.as_str()),
                ("client_secret", config.app_secret.expose()),
                ("grant_type", "authorization_code"),
                ("redirect_uri", config.redirect_uri.as_str()),
                ("code", input.code.as_str()),
            ])
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        let short = checked_json(response).await?;
        let short = single_account_response(&short)?;
        let granted = &short["permissions"];
        for scope in [
            "instagram_business_basic",
            "instagram_business_manage_messages",
        ] {
            let has_scope = match granted {
                Value::String(scopes) => scopes.split(',').any(|s| s.trim() == scope),
                Value::Array(scopes) => scopes.iter().any(|s| s.as_str() == Some(scope)),
                _ => false,
            };
            if !has_scope {
                return Err(MessagingError::Invalid(
                    "required Instagram permissions were not granted",
                )
                .into());
            }
        }
        let response = self
            .client
            .get(self.instagram_token_endpoint(false))
            .query(&[
                ("grant_type", "ig_exchange_token"),
                ("client_secret", config.app_secret.expose()),
                ("access_token", required(short, "access_token")?),
            ])
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        let long = checked_json(response).await?;
        let token = AccessToken::new(required(&long, "access_token")?.to_owned())?;
        let profile = self
            .graph(
                Provider::Instagram,
                &token,
                Method::GET,
                &["me"],
                &[("fields", "user_id,username")],
                None,
            )
            .await?;
        let profile = single_account_response(&profile)?;
        let account = required(profile, "user_id")?.to_owned().try_into()?;
        let expires = long["expires_in"]
            .as_i64()
            .filter(|s| *s > 0)
            .ok_or(MessagingError::ProviderRejected)?;
        Ok(AuthorizedAccount {
            developer_account: false,
            account_id: account,
            business_account_id: None,
            display_name: required(profile, "username")?.to_owned(),
            token,
            expires_at: Some(Utc::now() + chrono::Duration::seconds(expires)),
        })
    }
}

fn single_account_response(value: &Value) -> Result<&Value, MessagingError> {
    match value.get("data") {
        None if value.is_object() => Ok(value),
        Some(Value::Array(accounts)) if accounts.len() == 1 => Ok(&accounts[0]),
        _ => Err(MessagingError::ProviderRejected),
    }
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, MessagingError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            tracing::warn!(field = key, "Meta response omitted a required string field");
            MessagingError::ProviderRejected
        })
}
async fn bounded_bytes(mut response: Response, limit: usize) -> PortResult<Vec<u8>> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(MessagingError::ProviderRejected.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| MessagingError::Unavailable)?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(MessagingError::ProviderRejected.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn checked_json(response: Response) -> PortResult<Value> {
    let status = response.status();
    let endpoint = response.url().path().to_owned();
    let json: Option<Value> =
        serde_json::from_slice(&bounded_bytes(response, 4 * 1024 * 1024).await?).ok();
    match json {
        Some(json) if status.is_success() && json.get("error").is_none() => Ok(json),
        json => {
            let code = json
                .as_ref()
                .and_then(|json| json["error"]["code"].as_i64());
            tracing::warn!(%status, %endpoint, provider_code = code, "Meta API rejected request");
            Err(rejection(status, json.as_ref()).into())
        }
    }
}

/// Meta's documented throttling codes, which often arrive with a 4xx status.
pub(super) fn is_rate_limit(code: Option<i64>) -> bool {
    matches!(
        code,
        Some(4 | 17 | 32 | 613 | 80007 | 130429 | 131048 | 131056)
    )
}

/// Gateway pages without a JSON body and throttling stay retryable.
fn rejection(status: reqwest::StatusCode, json: Option<&Value>) -> MessagingError {
    let code = json.and_then(|json| json["error"]["code"].as_i64());
    if code == Some(190) {
        MessagingError::Disconnected
    } else if matches!(code, Some(10 | 200)) {
        MessagingError::ProviderAccessRequired
    } else if status.as_u16() == 429
        || status.is_server_error()
        || is_rate_limit(code)
        || json.is_some_and(|json| json["error"]["is_transient"] == true)
    {
        MessagingError::Unavailable
    } else {
        MessagingError::ProviderRejected
    }
}

#[async_trait]
impl MetaProvider for HttpMetaProvider {
    async fn request_whatsapp_history(
        &self,
        c: &Connection,
        token: &AccessToken,
        contacts: bool,
    ) -> PortResult<String> {
        self.request_whatsapp_history_impl(c, token, contacts).await
    }
    async fn instagram_history(
        &self,
        c: &Connection,
        token: &AccessToken,
        after: Option<&str>,
    ) -> PortResult<crate::domain::history::HistoryPage> {
        self.instagram_history_impl(c, token, after).await
    }

    async fn customer_profile(
        &self,
        c: &Connection,
        token: &AccessToken,
        customer: &ProviderId,
    ) -> PortResult<CustomerProfile> {
        if c.provider != Provider::Instagram {
            return Ok(CustomerProfile::default());
        }
        let profile = self
            .graph(
                c.provider,
                token,
                Method::GET,
                &[customer.as_str()],
                &[("fields", "name,username")],
                None,
            )
            .await?;
        let bounded = |key: &str| {
            profile[key]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(|s| {
                    s.chars()
                        .filter(|c| !c.is_control())
                        .take(128)
                        .collect::<String>()
                })
        };
        Ok(CustomerProfile {
            name: bounded("name"),
            handle: bounded("username"),
        })
    }

    async fn developer_account(&self) -> PortResult<AuthorizedAccount> {
        let c = self.developer.as_ref().ok_or(MessagingError::Forbidden)?;
        let data = self
            .graph(
                Provider::Whatsapp,
                &c.token,
                Method::GET,
                &[c.business_account_id.as_str(), "phone_numbers"],
                &[("fields", "id,display_phone_number"), ("limit", "100")],
                None,
            )
            .await?;
        let phone = data["data"]
            .as_array()
            .and_then(|a| {
                a.iter()
                    .find(|p| p["id"].as_str() == Some(c.phone_number_id.as_str()))
            })
            .ok_or(MessagingError::Forbidden)?;
        Ok(AuthorizedAccount {
            developer_account: true,
            account_id: c.phone_number_id.clone(),
            business_account_id: Some(c.business_account_id.clone()),
            display_name: format!("{} (test number)", required(phone, "display_phone_number")?),
            token: AccessToken::new(c.token.expose().to_owned())?,
            expires_at: None,
        })
    }
    async fn authorize(
        &self,
        provider: Provider,
        input: &CompleteAuthorization,
    ) -> PortResult<AuthorizedAccount> {
        match provider {
            Provider::Whatsapp => self.whatsapp_authorize(input).await,
            Provider::Instagram => self.instagram_authorize(input).await,
        }
    }
    async fn subscribe(&self, c: &Connection, token: &AccessToken) -> PortResult<()> {
        let account = c.business_account_id.as_ref().unwrap_or(&c.account_id);
        let body = if c.provider == Provider::Instagram {
            json!({"subscribed_fields":"messages,messaging_seen,messaging_postbacks,message_reactions,messaging_referral"})
        } else {
            json!({})
        };
        let result = self
            .graph(
                c.provider,
                token,
                Method::POST,
                &[account.as_str(), "subscribed_apps"],
                &[],
                Some(&body),
            )
            .await?;
        if result["success"] != true {
            return Err(MessagingError::ProviderRejected.into());
        }
        Ok(())
    }
    async fn unsubscribe(&self, c: &Connection, token: &AccessToken) -> PortResult<()> {
        let account = c.business_account_id.as_ref().unwrap_or(&c.account_id);
        let result = self
            .graph(
                c.provider,
                token,
                Method::DELETE,
                &[account.as_str(), "subscribed_apps"],
                &[],
                None,
            )
            .await?;
        if result["success"] != true {
            return Err(MessagingError::ProviderRejected.into());
        }
        Ok(())
    }
    async fn refresh(&self, token: &AccessToken) -> PortResult<(AccessToken, DateTime<Utc>)> {
        let response = self
            .client
            .get("https://graph.instagram.com/refresh_access_token")
            .query(&[
                ("grant_type", "ig_refresh_token"),
                ("access_token", token.expose()),
            ])
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        let data = checked_json(response).await?;
        let expires = data["expires_in"]
            .as_i64()
            .filter(|n| *n > 0)
            .ok_or(MessagingError::ProviderRejected)?;
        Ok((
            AccessToken::new(required(&data, "access_token")?.to_owned())?,
            Utc::now() + chrono::Duration::seconds(expires),
        ))
    }
    async fn templates(&self, c: &Connection, token: &AccessToken) -> PortResult<Vec<Template>> {
        if c.provider != Provider::Whatsapp {
            return Ok(vec![]);
        }
        let account = c
            .business_account_id
            .as_ref()
            .ok_or(MessagingError::ProviderRejected)?;
        let mut templates = Vec::new();
        let mut after = String::new();
        for _ in 0..10 {
            let mut params = vec![
                ("fields", "id,name,language,status,components"),
                ("limit", "100"),
            ];
            if !after.is_empty() {
                params.push(("after", &after));
            }
            let page = self
                .graph(
                    c.provider,
                    token,
                    Method::GET,
                    &[account.as_str(), "message_templates"],
                    &params,
                    None,
                )
                .await?;
            for item in page["data"]
                .as_array()
                .ok_or(MessagingError::ProviderRejected)?
            {
                if item["status"] == "APPROVED" {
                    let layout = crate::domain::templates::text_parameters(&item["components"]);
                    let parameter_labels = layout
                        .as_ref()
                        .map(|params| params.iter().map(|p| p.label()).collect())
                        .unwrap_or_default();
                    let unsupported_reason = layout.err().map(|e| e.to_string());
                    templates.push(Template {
                        parameter_labels,
                        unsupported_reason,
                        id: required(item, "id")?.to_owned().try_into()?,
                        name: required(item, "name")?.to_owned(),
                        language: required(item, "language")?.to_owned(),
                        components: item["components"].clone(),
                    });
                }
            }
            let next = page["paging"]["cursors"]["after"].as_str();
            if page["paging"]["next"].is_null() || next.is_none() {
                return Ok(templates);
            }
            after = next.unwrap_or_default().to_owned();
        }
        Err(MessagingError::Invalid("this account exceeds the 1000-template browsing limit").into())
    }
    async fn prepare_reply(
        &self,
        c: &Connection,
        token: &AccessToken,
        conversation: &Conversation,
        request: &SendReply,
        media: Option<&OutboundMedia>,
    ) -> PortResult<PreparedReply> {
        self.prepare_reply_impl(c, token, conversation, request, media)
            .await
    }
    async fn send(
        &self,
        c: &Connection,
        token: &AccessToken,
        prepared: &PreparedReply,
    ) -> ProviderSendResult {
        self.send_impl(c, token, prepared).await
    }
    async fn download(
        &self,
        c: &Connection,
        token: &AccessToken,
        media: &IncomingMedia,
    ) -> PortResult<MediaBytes> {
        self.download_impl(c, token, media).await
    }
}
