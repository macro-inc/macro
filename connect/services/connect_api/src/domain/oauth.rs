use std::{collections::HashMap, sync::Arc};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use connect_registry::{App, ClientRegistration, Status};
use rand::RngCore as _;
use serde::Serialize;
use url::Url;
use uuid::Uuid;
use zeroize::Zeroizing;

use super::{Envelope, Error, Grant, GrantCipher, StoredGrant};

const SESSION_LIFETIME: Duration = Duration::minutes(10);
const REFRESH_WINDOW: Duration = Duration::seconds(60);

#[derive(Clone)]
pub struct Client {
    pub id: String,
    pub secret: Option<Zeroizing<String>>,
    pub kind: ClientRegistration,
}

pub struct Metadata {
    pub issuer: String,
    pub supports_cimd: bool,
    pub supports_dcr: bool,
}

pub struct Authorization {
    pub url: String,
    pub state: String,
    pub verifier: Zeroizing<String>,
}

pub struct Session {
    pub token: String,
    pub customer_id: Uuid,
    pub user_id: String,
    pub app_id: String,
    pub redirect_url: String,
    pub expires_at: DateTime<Utc>,
    pub traceparent: Option<String>,
}

pub struct OAuthState {
    pub state: String,
    pub customer_id: Uuid,
    pub user_id: String,
    pub app_id: String,
    pub redirect_url: String,
    pub client_id: String,
    pub issuer: String,
    pub kind: ClientRegistration,
    pub verifier: Envelope,
    pub expires_at: DateTime<Utc>,
    pub traceparent: Option<String>,
}

pub enum TakenState {
    Valid(OAuthState),
    Expired(OAuthState),
    Reused(OAuthState),
}

pub struct OAuthClientRecord {
    pub id: String,
    pub secret: Option<Envelope>,
}

pub struct LockedGrantRecord {
    pub stored: StoredGrant,
    pub needs_reauth: bool,
    pub issuer: Option<String>,
    pub client_id: Option<String>,
    pub kind: Option<ClientRegistration>,
}

#[async_trait::async_trait]
pub trait LockedClient: Send {
    async fn get(&mut self) -> Result<Option<OAuthClientRecord>, Error>;
    async fn insert(&mut self, client: OAuthClientRecord) -> Result<(), Error>;
    async fn commit(self: Box<Self>) -> Result<(), Error>;
}

#[async_trait::async_trait]
pub trait LockedGrant: Send {
    fn record(&self) -> &LockedGrantRecord;
    async fn save(&mut self, envelope: &Envelope, scopes: &[String]) -> Result<(), Error>;
    async fn needs_reauth(&mut self) -> Result<(), Error>;
    async fn commit(self: Box<Self>) -> Result<(), Error>;
}

#[async_trait::async_trait]
pub trait PendingConnection: Send {
    fn id(&self) -> Uuid;
    async fn save(
        &mut self,
        state: &OAuthState,
        grant: &Grant,
        envelope: &Envelope,
    ) -> Result<(), Error>;
    async fn commit(self: Box<Self>) -> Result<(), Error>;
}

#[async_trait::async_trait]
pub trait OAuthRepository: Send + Sync {
    async fn allowed_origins(&self, customer_id: Uuid) -> Result<Vec<String>, Error>;
    async fn create_session(&self, session: &Session) -> Result<(), Error>;
    async fn get_session(&self, token: &str) -> Result<Option<Session>, Error>;
    async fn save_state(&self, state: &OAuthState) -> Result<(), Error>;
    async fn take_state(&self, state: &str) -> Result<Option<TakenState>, Error>;
    async fn lock_client(
        &self,
        issuer: &str,
        redirect_uri: &str,
    ) -> Result<Box<dyn LockedClient>, Error>;
    async fn lock_connection(
        &self,
        state: &OAuthState,
    ) -> Result<Box<dyn PendingConnection>, Error>;
    async fn lock_grant(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
    ) -> Result<Option<Box<dyn LockedGrant>>, Error>;
    async fn set_redirect_origins(
        &self,
        customer_id: Uuid,
        origins: &[String],
    ) -> Result<bool, Error>;
}

#[async_trait::async_trait]
pub trait OAuthProvider: Send + Sync {
    async fn discover(&self, server_url: &str) -> Result<Metadata, Error>;
    async fn register(
        &self,
        server_url: &str,
        redirect_uri: &str,
        scopes: &[String],
    ) -> Result<Client, Error>;
    async fn authorize(
        &self,
        server_url: &str,
        redirect_uri: &str,
        client: &Client,
        scopes: &[String],
    ) -> Result<Authorization, Error>;
    async fn exchange(
        &self,
        server_url: &str,
        redirect_uri: &str,
        client: &Client,
        verifier: &str,
        code: &str,
        requested_scopes: &[String],
    ) -> Result<Grant, Error>;
    async fn refresh(
        &self,
        server_url: &str,
        redirect_uri: &str,
        client: &Client,
        grant: &Grant,
    ) -> Result<Grant, RefreshError>;
}

#[derive(Debug, thiserror::Error)]
pub enum RefreshError {
    #[error("refresh grant rejected")]
    InvalidGrant,
    #[error(transparent)]
    Other(Error),
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ConnectSessionResponse {
    pub connect_url: String,
    pub expires_at: DateTime<Utc>,
}

pub struct OAuthService {
    repository: Arc<dyn OAuthRepository>,
    cipher: Arc<dyn GrantCipher>,
    provider: Arc<dyn OAuthProvider>,
    apps: &'static [App],
    public_url: Url,
    own_apps: HashMap<String, Client>,
}

impl OAuthService {
    pub fn new(
        repository: Arc<dyn OAuthRepository>,
        cipher: Arc<dyn GrantCipher>,
        provider: Arc<dyn OAuthProvider>,
        apps: &'static [App],
        public_url: Url,
        own_apps: HashMap<String, Client>,
    ) -> Self {
        Self {
            repository,
            cipher,
            provider,
            apps,
            public_url,
            own_apps,
        }
    }

    fn app(&self, app_id: &str) -> Result<&App, Error> {
        self.apps
            .iter()
            .find(|app| app.id.as_str() == app_id && app.status == Status::Live)
            .ok_or(Error::InvalidRequest("app_not_live"))
    }

    fn route_url(&self, path: &str) -> String {
        let mut url = self.public_url.clone();
        url.set_path(&format!(
            "{}{path}",
            self.public_url.path().trim_end_matches('/')
        ));
        url.to_string()
    }

    fn callback_url(&self) -> String {
        self.route_url("/v1/oauth/callback")
    }

    pub fn client_metadata_url(&self) -> String {
        self.route_url("/v1/oauth/client-metadata.json")
    }

    pub fn public_path(&self) -> &str {
        self.public_url.path().trim_end_matches('/')
    }

    #[tracing::instrument(name = "connect.session.create", skip_all, fields(customer_id = %customer_id, app_id = %app_id, registration_kind, outcome), err)]
    pub async fn create_session(
        &self,
        customer_id: Uuid,
        user_id: String,
        app_id: String,
        redirect_url: String,
    ) -> Result<ConnectSessionResponse, Error> {
        tracing::Span::current().record("outcome", "error");
        let app = self.app(&app_id)?;
        tracing::Span::current().record(
            "registration_kind",
            registration_name(app.client_registration),
        );
        if user_id.is_empty() || user_id.len() > 1024 {
            return Err(Error::InvalidRequest("invalid_external_user_id"));
        }
        let redirect =
            Url::parse(&redirect_url).map_err(|_| Error::InvalidRequest("invalid_redirect_url"))?;
        if !redirect.username().is_empty()
            || redirect.password().is_some()
            || redirect
                .query_pairs()
                .any(|(name, _)| matches!(name.as_ref(), "status" | "app_id" | "reason"))
        {
            return Err(Error::InvalidRequest("invalid_redirect_url"));
        }
        let origin = redirect.origin().ascii_serialization();
        let allowed = self.repository.allowed_origins(customer_id).await?;
        if !allowed.iter().any(|entry| entry == &origin) {
            tracing::Span::current().record("outcome", "redirect_denied");
            return Err(Error::InvalidRequest("redirect_origin_not_allowed"));
        }
        let mut token_bytes = Zeroizing::new([0_u8; 32]);
        rand::rng().fill_bytes(&mut *token_bytes);
        let session = Session {
            token: URL_SAFE_NO_PAD.encode(*token_bytes),
            customer_id,
            user_id,
            app_id,
            redirect_url,
            expires_at: Utc::now() + SESSION_LIFETIME,
            traceparent: current_traceparent(),
        };
        self.repository.create_session(&session).await?;
        tracing::Span::current().record("outcome", "created");
        Ok(ConnectSessionResponse {
            connect_url: self.route_url(&format!("/v1/connect/{}", session.token)),
            expires_at: session.expires_at,
        })
    }

    #[tracing::instrument(
        name = "connect.authorize",
        skip_all,
        fields(app_id, registration_kind, outcome),
        err
    )]
    pub async fn authorize(&self, token: &str) -> Result<String, Error> {
        tracing::Span::current().record("outcome", "error");
        let traceparent = current_traceparent();
        let session = self
            .repository
            .get_session(token)
            .await?
            .ok_or(Error::InvalidState)?;
        if let Some(parent) = &session.traceparent {
            connect_parent_span(parent);
        }
        tracing::Span::current().record("app_id", session.app_id.as_str());
        let app = self.app(&session.app_id)?;
        let metadata = self.provider.discover(&app.mcp_url).await?;
        let redirect_uri = self.callback_url();
        let client = if app.client_registration == ClientRegistration::OwnApp {
            self.own_apps
                .get(app.id.as_str())
                .cloned()
                .ok_or(Error::OAuth)?
        } else if app.client_registration == ClientRegistration::Cimd && metadata.supports_cimd {
            Client {
                id: self.client_metadata_url(),
                secret: None,
                kind: ClientRegistration::Cimd,
            }
        } else if app.client_registration == ClientRegistration::Dcr && metadata.supports_dcr {
            let mut locked = self
                .repository
                .lock_client(&metadata.issuer, &redirect_uri)
                .await?;
            let client = if let Some(record) = locked.get().await? {
                Client {
                    id: record.id,
                    secret: match record.secret {
                        Some(envelope) => {
                            let mut secret = self
                                .cipher
                                .open(
                                    Uuid::nil(),
                                    client_context(&metadata.issuer, &redirect_uri),
                                    &envelope,
                                )
                                .await?;
                            Some(Zeroizing::new(std::mem::take(&mut secret.access_token)))
                        }
                        None => None,
                    },
                    kind: ClientRegistration::Dcr,
                }
            } else {
                let client = self
                    .provider
                    .register(&app.mcp_url, &redirect_uri, &app.scopes)
                    .await?;
                let secret = if let Some(value) = &client.secret {
                    let grant = Grant {
                        access_token: value.to_string(),
                        refresh_token: None,
                        token_type: "client_secret".into(),
                        expires_at: None,
                        scopes: vec![],
                    };
                    Some(
                        self.cipher
                            .seal(
                                Uuid::nil(),
                                client_context(&metadata.issuer, &redirect_uri),
                                &grant,
                            )
                            .await?,
                    )
                } else {
                    None
                };
                locked
                    .insert(OAuthClientRecord {
                        id: client.id.clone(),
                        secret,
                    })
                    .await?;
                client
            };
            locked.commit().await?;
            client
        } else {
            return Err(Error::OAuth);
        };
        tracing::Span::current().record("registration_kind", registration_name(client.kind));
        let authorization = self
            .provider
            .authorize(&app.mcp_url, &redirect_uri, &client, &app.scopes)
            .await?;
        let verifier = Grant {
            access_token: authorization.verifier.to_string(),
            refresh_token: None,
            token_type: "pkce".into(),
            expires_at: None,
            scopes: vec![],
        };
        let state = OAuthState {
            state: authorization.state.clone(),
            customer_id: session.customer_id,
            user_id: session.user_id,
            app_id: session.app_id,
            redirect_url: session.redirect_url,
            client_id: client.id,
            issuer: metadata.issuer,
            kind: client.kind,
            verifier: self
                .cipher
                .seal(
                    session.customer_id,
                    state_context(&authorization.state),
                    &verifier,
                )
                .await?,
            expires_at: Utc::now() + SESSION_LIFETIME,
            traceparent,
        };
        self.repository.save_state(&state).await?;
        tracing::Span::current().record("outcome", "redirected");
        Ok(authorization.url)
    }

    #[tracing::instrument(
        name = "connect.callback",
        skip_all,
        fields(app_id, registration_kind, outcome),
        err
    )]
    pub async fn callback(
        &self,
        state: &str,
        code: Option<&str>,
        vendor_error: Option<&str>,
    ) -> Result<(String, Option<String>), Error> {
        tracing::Span::current().record("outcome", "error");
        let taken = self
            .repository
            .take_state(state)
            .await?
            .ok_or(Error::InvalidState)?;
        let (state, failure) = match taken {
            TakenState::Valid(state) => (state, None),
            TakenState::Expired(state) => (state, Some("expired_state")),
            TakenState::Reused(state) => (state, Some("reused_state")),
        };
        if let Some(traceparent) = &state.traceparent {
            connect_parent_span(traceparent);
            link_authorize_span(traceparent);
        }
        tracing::Span::current().record("app_id", state.app_id.as_str());
        tracing::Span::current().record("registration_kind", registration_name(state.kind));
        let outcome = if let Some(reason) = failure.or(vendor_error) {
            Err(reason.to_owned())
        } else if let Some(code) = code {
            match self.finish_callback(&state, code).await {
                Ok(()) => Ok(()),
                Err(error) => {
                    tracing::warn!(error = ?error, "OAuth callback failed");
                    Err("exchange_failed".to_owned())
                }
            }
        } else {
            Err("missing_code".to_owned())
        };
        let mut redirect = Url::parse(&state.redirect_url).map_err(|_| Error::InvalidState)?;
        redirect
            .query_pairs_mut()
            .append_pair(
                "status",
                if outcome.is_ok() {
                    "connected"
                } else {
                    "error"
                },
            )
            .append_pair("app_id", &state.app_id);
        if let Err(reason) = &outcome {
            redirect.query_pairs_mut().append_pair("reason", reason);
        }
        tracing::Span::current().record(
            "outcome",
            if outcome.is_ok() {
                "connected"
            } else {
                "error"
            },
        );
        Ok((redirect.to_string(), state.traceparent))
    }

    async fn finish_callback(&self, state: &OAuthState, code: &str) -> Result<(), Error> {
        let app = self.app(&state.app_id)?;
        let client = self.client_for_state(state).await?;
        let verifier = self
            .cipher
            .open(
                state.customer_id,
                state_context(&state.state),
                &state.verifier,
            )
            .await?;
        let grant = self
            .provider
            .exchange(
                &app.mcp_url,
                &self.callback_url(),
                &client,
                &verifier.access_token,
                code,
                &app.scopes,
            )
            .await?;
        let mut pending = self.repository.lock_connection(state).await?;
        let envelope = self
            .cipher
            .seal(state.customer_id, pending.id(), &grant)
            .await?;
        pending.save(state, &grant, &envelope).await?;
        pending.commit().await
    }

    async fn client_for_state(&self, state: &OAuthState) -> Result<Client, Error> {
        self.client_for(state.kind, &state.issuer, &state.app_id, &state.client_id)
            .await
    }

    async fn client_for(
        &self,
        kind: ClientRegistration,
        issuer: &str,
        app_id: &str,
        client_id: &str,
    ) -> Result<Client, Error> {
        let secret = match kind {
            ClientRegistration::OwnApp => self
                .own_apps
                .get(app_id)
                .and_then(|client| client.secret.clone()),
            ClientRegistration::Dcr => {
                let mut locked = self
                    .repository
                    .lock_client(issuer, &self.callback_url())
                    .await?;
                let record = locked.get().await?.ok_or(Error::OAuth)?;
                locked.commit().await?;
                match record.secret {
                    Some(envelope) => {
                        let mut secret = self
                            .cipher
                            .open(
                                Uuid::nil(),
                                client_context(issuer, &self.callback_url()),
                                &envelope,
                            )
                            .await?;
                        Some(Zeroizing::new(std::mem::take(&mut secret.access_token)))
                    }
                    None => None,
                }
            }
            _ => None,
        };
        Ok(Client {
            id: client_id.to_owned(),
            secret,
            kind,
        })
    }

    #[tracing::instrument(name = "connect.connections.export", skip_all, fields(customer_id = %customer_id, app_id = %app_id, outcome), err)]
    pub async fn export(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
    ) -> Result<Grant, Error> {
        self.load_grant(customer_id, user_id, app_id, None).await
    }

    pub fn mcp_url(&self, app_id: &str) -> Result<&str, Error> {
        self.apps
            .iter()
            .find(|app| app.id.as_str() == app_id && app.status == Status::Live)
            .map(|app| app.mcp_url.as_str())
            .ok_or(Error::NotFound)
    }

    pub async fn recover_vendor_unauthorized(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
        rejected_access_token: &str,
        can_retry: bool,
        already_retried: bool,
    ) -> Result<Option<Grant>, Error> {
        if already_retried {
            self.mark_needs_reauth(customer_id, user_id, app_id).await?;
            return Err(Error::NeedsReauth);
        }
        if can_retry {
            return self
                .load_grant(customer_id, user_id, app_id, Some(rejected_access_token))
                .await
                .map(Some);
        }
        Ok(None)
    }

    async fn mark_needs_reauth(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
    ) -> Result<(), Error> {
        let mut locked = self
            .repository
            .lock_grant(customer_id, user_id, app_id)
            .await?
            .ok_or(Error::NotFound)?;
        locked.needs_reauth().await?;
        locked.commit().await
    }

    async fn load_grant(
        &self,
        customer_id: Uuid,
        user_id: &str,
        app_id: &str,
        rejected_access_token: Option<&str>,
    ) -> Result<Grant, Error> {
        let mut locked = self
            .repository
            .lock_grant(customer_id, user_id, app_id)
            .await?
            .ok_or(Error::NotFound)?;
        let record = locked.record();
        if record.needs_reauth {
            return Err(Error::NeedsReauth);
        }
        let mut grant = self
            .cipher
            .open(
                customer_id,
                record.stored.connection_id,
                &record.stored.envelope,
            )
            .await?;
        if rejected_access_token.is_some_and(|token| token == grant.access_token)
            || grant
                .expires_at
                .is_some_and(|expiry| expiry <= Utc::now() + REFRESH_WINDOW)
        {
            grant = match self
                .refresh_grant(&mut *locked, customer_id, app_id, &grant)
                .await
            {
                Ok(refreshed) => refreshed,
                Err(RefreshError::InvalidGrant) => {
                    locked.needs_reauth().await?;
                    locked.commit().await?;
                    return Err(Error::NeedsReauth);
                }
                Err(RefreshError::Other(error)) => return Err(error),
            };
            tracing::Span::current().record("outcome", "refreshed");
        } else {
            tracing::Span::current().record("outcome", "cached");
        }
        locked.commit().await?;
        Ok(grant)
    }

    #[tracing::instrument(name = "connect.token.refresh", skip_all, fields(app_id = %app_id, registration_kind, outcome), err)]
    async fn refresh_grant(
        &self,
        locked: &mut dyn LockedGrant,
        customer_id: Uuid,
        app_id: &str,
        grant: &Grant,
    ) -> Result<Grant, RefreshError> {
        tracing::Span::current().record("outcome", "error");
        let record = locked.record();
        let issuer = record.issuer.clone().ok_or(RefreshError::InvalidGrant)?;
        let client_id = record.client_id.clone().ok_or(RefreshError::InvalidGrant)?;
        let kind = record.kind.ok_or(RefreshError::InvalidGrant)?;
        tracing::Span::current().record("registration_kind", registration_name(kind));
        let app = self.app(app_id).map_err(RefreshError::Other)?;
        let client = self
            .client_for(kind, &issuer, app_id, &client_id)
            .await
            .map_err(RefreshError::Other)?;
        let refreshed = match self
            .provider
            .refresh(&app.mcp_url, &self.callback_url(), &client, grant)
            .await
        {
            Ok(refreshed) => refreshed,
            Err(RefreshError::InvalidGrant) => {
                tracing::Span::current().record("outcome", "invalid_grant");
                return Err(RefreshError::InvalidGrant);
            }
            Err(error) => return Err(error),
        };
        let envelope = self
            .cipher
            .seal(
                customer_id,
                locked.record().stored.connection_id,
                &refreshed,
            )
            .await
            .map_err(RefreshError::Other)?;
        locked
            .save(&envelope, &refreshed.scopes)
            .await
            .map_err(RefreshError::Other)?;
        tracing::Span::current().record("outcome", "refreshed");
        Ok(refreshed)
    }
}

pub async fn set_redirect_origins(
    repository: &dyn OAuthRepository,
    customer_id: Uuid,
    origins: &[String],
) -> Result<bool, Error> {
    if origins.is_empty() {
        return Err(Error::InvalidRequest("redirect_origin_required"));
    }
    for origin in origins {
        validate_origin(origin)?;
    }
    repository.set_redirect_origins(customer_id, origins).await
}

pub fn validate_origin(origin: &str) -> Result<(), Error> {
    let url = Url::parse(origin).map_err(|_| Error::InvalidRequest("invalid_redirect_origin"))?;
    let allowed_scheme = url.scheme() == "https"
        || (url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1")));
    if !allowed_scheme
        || url.origin().ascii_serialization() != origin
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::InvalidRequest("invalid_redirect_origin"));
    }
    Ok(())
}

pub fn registration_name(kind: ClientRegistration) -> &'static str {
    match kind {
        ClientRegistration::Cimd => "cimd",
        ClientRegistration::Dcr => "dcr",
        ClientRegistration::OwnApp => "own_app",
        ClientRegistration::ApiKey => "api_key",
    }
}

fn state_context(state: &str) -> Uuid {
    use sha2::Digest as _;
    let digest = sha2::Sha256::digest(state.as_bytes());
    Uuid::from_slice(&digest[..16]).expect("SHA-256 supplies 16 bytes")
}

fn client_context(issuer: &str, redirect_uri: &str) -> Uuid {
    state_context(&format!("{issuer}\0{redirect_uri}"))
}

fn parse_traceparent(value: &str) -> Option<opentelemetry::trace::SpanContext> {
    use opentelemetry::trace::{SpanContext, SpanId, TraceFlags, TraceId, TraceState};
    let mut parts = value.split('-');
    let (Some("00"), Some(trace), Some(span), Some(flags), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return None;
    };
    let (Ok(trace_id), Ok(span_id), Ok(flags)) = (
        TraceId::from_hex(trace),
        SpanId::from_hex(span),
        u8::from_str_radix(flags, 16),
    ) else {
        return None;
    };
    let context = SpanContext::new(
        trace_id,
        span_id,
        TraceFlags::new(flags),
        true,
        TraceState::default(),
    );
    context.is_valid().then_some(context)
}

fn connect_parent_span(value: &str) {
    use opentelemetry::trace::TraceContextExt as _;
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;
    if let Some(context) = parse_traceparent(value) {
        let parent = opentelemetry::Context::new().with_remote_span_context(context);
        let _ = tracing::Span::current().set_parent(parent);
    }
}

fn link_authorize_span(value: &str) {
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;
    if let Some(context) = parse_traceparent(value) {
        tracing::Span::current().add_link(context);
    }
}

fn current_traceparent() -> Option<String> {
    use opentelemetry::trace::TraceContextExt as _;
    use tracing_opentelemetry::OpenTelemetrySpanExt as _;
    let context = tracing::Span::current().context();
    let binding = context.span();
    let span = binding.span_context();
    span.is_valid().then(|| {
        format!(
            "00-{}-{}-{:02x}",
            span.trace_id(),
            span.span_id(),
            span.trace_flags().to_u8()
        )
    })
}
