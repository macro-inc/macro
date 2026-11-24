//! The native API source: [`Source`] over `api_app_connections`, an
//! [`ApiConnection`] per row, and the [`AppAuthorization`] the OAuth
//! callback route finishes sign-ins through.

use crate::domain::discovery::CatalogApp;
use crate::domain::models::{
    ApiRequest, ApiResponse, ConnectStep, ConnectorId, ConnectorKey, Surfaces,
};
use crate::domain::ports::{
    ApiConnection, GrantState, Source, SourceConnection, SourceKind, SourceRefusal,
};
use crate::domain::sign_in::AppAuthorization;
use crate::outbound::native_api::cipher::{Grant, GrantCipher};
use crate::outbound::native_api::oauth::{OAuthClient, TokenError, Tokens};
use crate::outbound::native_api::pending::{PendingSignIn, PendingSignIns};
use crate::outbound::native_api::repo::{ApiAppRepo, ApiAppRow, NewGrant};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::sync::Arc;
use std::time::Duration;
use zeroize::Zeroizing;

#[cfg(test)]
mod test;

/// An access token this close to expiry is refreshed before a call.
const REFRESH_MARGIN: chrono::Duration = chrono::Duration::minutes(5);
/// How many refreshes one process runs at once. Each holds a pooled
/// connection in a row-locked transaction for as long as the vendor's token
/// endpoint takes (up to 15 s), so a burst must not take the pool.
const CONCURRENT_REFRESHES: usize = 4;
/// How long one API call may take. Downloads of large designs go through
/// the vendor's signed storage URLs, not through here.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Everything the source and its connections share.
struct Inner {
    apps: Vec<OAuthClient>,
    repo: ApiAppRepo,
    cipher: GrantCipher,
    pending: Arc<dyn PendingSignIns>,
    http: reqwest::Client,
    refreshes: tokio::sync::Semaphore,
}

/// REST apps Macro signs in to with its own OAuth client.
#[derive(Clone)]
pub(crate) struct NativeApiSource {
    inner: Arc<Inner>,
}

impl NativeApiSource {
    /// The source over the apps `apps` signs in to, their rows in `repo`,
    /// sealed by `cipher`, with started sign-ins waiting in `pending`.
    pub(crate) fn new(
        apps: Vec<OAuthClient>,
        repo: ApiAppRepo,
        cipher: GrantCipher,
        pending: Arc<dyn PendingSignIns>,
    ) -> Result<Self, Report> {
        let http = reqwest::Client::builder()
            .timeout(CALL_TIMEOUT)
            // A redirect would carry the bearer to wherever it points.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(Report::new)?;

        Ok(Self {
            inner: Arc::new(Inner {
                apps,
                repo,
                cipher,
                pending,
                http,
                refreshes: tokio::sync::Semaphore::new(CONCURRENT_REFRESHES),
            }),
        })
    }
}

impl NativeApiSource {
    /// The configured apps, as the catalog lists them.
    pub(crate) fn catalog_entries(&self) -> Vec<CatalogApp> {
        self.inner
            .apps
            .iter()
            .map(|client| client.app().catalog_entry())
            .collect()
    }
}

impl Inner {
    fn client(&self, app: &ConnectorId) -> Option<&OAuthClient> {
        self.apps.iter().find(|client| client.app().id == *app)
    }

    /// The configured app a key names, or the refusal.
    fn client_for_key(&self, key: &ConnectorKey) -> Result<&OAuthClient, Report> {
        match key {
            ConnectorKey::App(app) => self.client(app),
            ConnectorKey::Server(_) => None,
        }
        .ok_or_else(|| Report::new(SourceRefusal::Unsupported(key.clone())).into_dynamic())
    }

    fn connection(self: &Arc<Self>, row: ApiAppRow) -> Option<SourceConnection> {
        let app = ConnectorId::parse(&row.app).ok()?;
        self.client(&app)?;
        let key = ConnectorKey::App(app.clone());

        Some(SourceConnection {
            source: SourceKind::NativeApi,
            key,
            source_id: row.app,
            name: row.name,
            enabled: row.enabled,
            grant: if row.needs_reauth {
                GrantState::Dead
            } else {
                GrantState::Working
            },
            mcp: None,
            api: Some(Arc::new(NativeApiConnection {
                inner: self.clone(),
                user: row.user,
                app,
            })),
        })
    }

    /// A working access token for the user's connection to `app`,
    /// refreshed first when it is about to expire.
    async fn access_token(
        &self,
        user: &MacroUserIdStr<'static>,
        client: &OAuthClient,
    ) -> Result<Zeroizing<String>, Report> {
        let app = &client.app().id;
        let row = self
            .repo
            .get(user, app.as_str())
            .await?
            .ok_or_else(|| not_found(app))?;
        if row.needs_reauth {
            return Err(needs_reauth(app));
        }
        if is_fresh(row.access_expires_at) {
            let grant = self.cipher.decrypt(user, app, &row.grant).await?;
            return Ok(grant.access_token);
        }

        tracing::Span::current().record("refreshed", true);
        self.refresh(user, client).await
    }

    /// Spend the refresh token under the row's lock. Another replica may
    /// have refreshed while this one waited; then its token is used.
    async fn refresh(
        &self,
        user: &MacroUserIdStr<'static>,
        client: &OAuthClient,
    ) -> Result<Zeroizing<String>, Report> {
        let app = &client.app().id;
        let _permit = self
            .refreshes
            .acquire()
            .await
            .map_err(|_| rootcause::report!("the refresh limiter is closed"))?;
        let locked = self
            .repo
            .lock(user, app.as_str())
            .await?
            .ok_or_else(|| not_found(app))?;
        if locked.row.needs_reauth {
            return Err(needs_reauth(app));
        }
        let grant = self.cipher.decrypt(user, app, &locked.row.grant).await?;
        if is_fresh(locked.row.access_expires_at) {
            return Ok(grant.access_token);
        }

        match client.refresh(&grant.refresh_token).await {
            Ok(tokens) => {
                let expires_at = expiry(&tokens);
                // The vendor rotates the refresh token; one it did not
                // rotate stays the one to spend next.
                let refreshed = Grant {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token.unwrap_or(grant.refresh_token),
                };
                let sealed = self.cipher.encrypt(user, app, &refreshed).await?;
                locked.store(&sealed, expires_at).await?;
                Ok(refreshed.access_token)
            }
            Err(TokenError::InvalidGrant) => {
                tracing::warn!(app = %app, "an API app refused its refresh token; the user must sign in again");
                locked.mark_needs_reauth().await?;
                Err(needs_reauth(app))
            }
            Err(error) => Err(Report::new(error).into_dynamic()),
        }
    }
}

fn not_found(app: &ConnectorId) -> Report {
    Report::new(SourceRefusal::NotFound(ConnectorKey::App(app.clone()))).into_dynamic()
}

fn needs_reauth(app: &ConnectorId) -> Report {
    Report::new(SourceRefusal::NeedsReauth(ConnectorKey::App(app.clone()))).into_dynamic()
}

/// Whether an access token expiring at `expires_at` is good for a call.
fn is_fresh(expires_at: DateTime<Utc>) -> bool {
    expires_at > Utc::now() + REFRESH_MARGIN
}

/// When the tokens' access token expires.
fn expiry(tokens: &Tokens) -> DateTime<Utc> {
    let seconds = i64::try_from(tokens.expires_in).unwrap_or(i64::MAX);
    Utc::now() + chrono::Duration::try_seconds(seconds).unwrap_or(chrono::Duration::zero())
}

#[async_trait::async_trait]
impl Source for NativeApiSource {
    fn kind(&self) -> SourceKind {
        SourceKind::NativeApi
    }

    #[tracing::instrument(name = "connectors.api_app_connections", skip_all, err)]
    async fn connections(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<SourceConnection>, Report> {
        let rows = self.inner.repo.list(user).await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| self.inner.connection(row))
            .collect())
    }

    /// The configured apps, API only.
    async fn supports(&self, app: &ConnectorId) -> Result<Option<Surfaces>, Report> {
        Ok(self.inner.client(app).map(|_| Surfaces::new(false, true)))
    }

    #[tracing::instrument(skip(self), fields(app = %app), err)]
    async fn holders(&self, app: &ConnectorId) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        if self.inner.client(app).is_none() {
            return Ok(Vec::new());
        }
        self.inner.repo.holders(app.as_str()).await
    }

    /// The app's consent page, carrying a one-time state and a PKCE
    /// challenge whose verifier waits with the user's id until the callback.
    #[tracing::instrument(name = "connectors.api_app_start_connect", skip(self, user), fields(key = %key), err)]
    async fn start_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<ConnectStep, Report> {
        let client = self.inner.client_for_key(key)?;
        let (challenge, verifier) = oauth2::PkceCodeChallenge::new_random_sha256();
        let state = oauth2::CsrfToken::new_random();
        self.inner
            .pending
            .save(
                state.secret(),
                &PendingSignIn {
                    user: user.as_ref().to_owned(),
                    app: client.app().id.as_str().to_owned(),
                    verifier: verifier.secret().to_owned(),
                },
            )
            .await?;

        Ok(ConnectStep::OpenUrl(
            client.authorize_url(state.secret(), challenge.as_str()),
        ))
    }

    /// The connection the callback stored. Until it is there, or while the
    /// stored one still needs signing in again, there is nothing to record
    /// and the web keeps waiting.
    #[tracing::instrument(name = "connectors.api_app_complete_connect", skip(self, user), fields(app = %app), err)]
    async fn complete_connect(
        &self,
        user: &MacroUserIdStr<'static>,
        app: &ConnectorId,
    ) -> Result<SourceConnection, Report> {
        self.inner.client_for_key(&ConnectorKey::App(app.clone()))?;
        self.inner
            .repo
            .get(user, app.as_str())
            .await?
            .filter(|row| !row.needs_reauth)
            .and_then(|row| self.inner.connection(row))
            .ok_or_else(|| not_found(app))
    }

    #[tracing::instrument(skip(self, user), fields(key = %key), err)]
    async fn set_enabled(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        enabled: bool,
    ) -> Result<(), Report> {
        let client = self.inner.client_for_key(key)?;
        if !self
            .inner
            .repo
            .set_enabled(user, client.app().id.as_str(), enabled)
            .await?
        {
            return Err(Report::new(SourceRefusal::NotFound(key.clone())).into_dynamic());
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, user, name), fields(key = %key), err)]
    async fn rename(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
        name: &str,
    ) -> Result<(), Report> {
        let client = self.inner.client_for_key(key)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(Report::new(SourceRefusal::EmptyName).into_dynamic());
        }
        if !self
            .inner
            .repo
            .rename(user, client.app().id.as_str(), name)
            .await?
        {
            return Err(Report::new(SourceRefusal::NotFound(key.clone())).into_dynamic());
        }
        Ok(())
    }

    /// Delete the row, then revoke its refresh token at the vendor. Revoking
    /// is best effort: a failure there never keeps the row.
    #[tracing::instrument(name = "connectors.api_app_remove", skip(self, user), fields(key = %key), err)]
    async fn remove(
        &self,
        user: &MacroUserIdStr<'static>,
        key: &ConnectorKey,
    ) -> Result<(), Report> {
        let client = self.inner.client_for_key(key)?;
        let app = &client.app().id;
        let Some(removed) = self.inner.repo.delete(user, app.as_str()).await? else {
            return Err(Report::new(SourceRefusal::NotFound(key.clone())).into_dynamic());
        };

        match self.inner.cipher.decrypt(user, app, &removed.grant).await {
            Ok(grant) => {
                let _ = client
                    .revoke(&grant.refresh_token)
                    .await
                    .inspect_err(|error| tracing::warn!(error = ?error, "could not revoke a removed API app grant"));
            }
            Err(error) => {
                tracing::warn!(error = ?error, "could not open a removed API app grant to revoke it");
            }
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl AppAuthorization for NativeApiSource {
    /// Exchange the code for the user who started the sign-in, and store the
    /// grant. A grant it replaces is revoked, best effort.
    #[tracing::instrument(name = "connectors.api_app_complete_sign_in", skip_all, fields(app = tracing::field::Empty), err)]
    async fn complete(
        &self,
        code: &str,
        state: &str,
    ) -> Result<(MacroUserIdStr<'static>, ConnectorId), Report> {
        let pending = self
            .inner
            .pending
            .take(state)
            .await?
            .ok_or_else(|| rootcause::report!("no API app sign-in is waiting on this state"))?;
        let user = pending.user()?;
        let app = ConnectorId::parse(&pending.app).map_err(Report::new)?;
        tracing::Span::current().record("app", app.as_str());
        let client = self.inner.client(&app).ok_or_else(|| {
            Report::new(SourceRefusal::Unsupported(ConnectorKey::App(app.clone())))
        })?;

        let tokens = client
            .exchange(code, &pending.verifier)
            .await
            .map_err(Report::new)?;
        let expires_at = expiry(&tokens);
        let refresh_token = tokens
            .refresh_token
            .ok_or_else(|| rootcause::report!("{app} answered the code with no refresh token"))?;
        let grant = Grant {
            access_token: tokens.access_token,
            refresh_token,
        };
        let sealed = self.inner.cipher.encrypt(&user, &app, &grant).await?;

        let replaced = self.inner.repo.get(&user, app.as_str()).await?;
        self.inner
            .repo
            .store(&NewGrant {
                user: &user,
                app: app.as_str(),
                name: &client.app().name,
                access_expires_at: expires_at,
                grant: &sealed,
            })
            .await?;
        if let Some(replaced) = replaced {
            revoke_replaced(&self.inner.cipher, client, &user, &replaced, &grant).await;
        }

        Ok((user, app))
    }
}

/// Revoke the refresh token a new sign-in replaced, unless the vendor gave
/// the same one back.
async fn revoke_replaced(
    cipher: &GrantCipher,
    client: &OAuthClient,
    user: &MacroUserIdStr<'static>,
    replaced: &ApiAppRow,
    kept: &Grant,
) {
    let app = &client.app().id;
    let Ok(old) = cipher
        .decrypt(user, app, &replaced.grant)
        .await
        .inspect_err(|error| tracing::warn!(error = ?error, "could not open a replaced API app grant to revoke it"))
    else {
        return;
    };
    if *old.refresh_token != *kept.refresh_token {
        let _ = client.revoke(&old.refresh_token).await.inspect_err(
            |error| tracing::warn!(error = ?error, "could not revoke a replaced API app grant"),
        );
    }
}

/// One user's connection to one app, as an API.
struct NativeApiConnection {
    inner: Arc<Inner>,
    user: MacroUserIdStr<'static>,
    app: ConnectorId,
}

#[async_trait::async_trait]
impl ApiConnection for NativeApiConnection {
    /// Send `request` to the app's API origin with the connection's bearer,
    /// refreshing it first if it is about to expire. Any other host is
    /// refused before a token is read.
    #[tracing::instrument(
        name = "connectors.api_app_call",
        skip_all,
        fields(
            app = %self.app,
            http.method = %request.method,
            http.status_code = tracing::field::Empty,
            refreshed = tracing::field::Empty,
        ),
        err
    )]
    async fn call(&self, request: ApiRequest) -> Result<ApiResponse, Report> {
        let client = self.inner.client(&self.app).ok_or_else(|| {
            Report::new(SourceRefusal::Unsupported(ConnectorKey::App(
                self.app.clone(),
            )))
        })?;
        let url = client.app().api_url(&request.url)?;
        let token = self.inner.access_token(&self.user, client).await?;

        let mut headers = request.headers;
        headers.remove(http::header::AUTHORIZATION);
        headers.remove(http::header::PROXY_AUTHORIZATION);
        headers.remove(http::header::COOKIE);
        let mut builder = self
            .inner
            .http
            .request(request.method, url)
            .headers(headers)
            .bearer_auth(token.as_str());
        if let Some(body) = &request.body {
            builder = builder.json(body);
        }
        drop(token);

        let response = builder.send().await.map_err(|error| {
            rootcause::report!("{} could not be reached: {}", self.app, error.without_url())
        })?;
        let status = response.status();
        tracing::Span::current().record("http.status_code", status.as_u16());
        let headers = response.headers().clone();
        let body = response.text().await.map_err(|error| {
            rootcause::report!(
                "{}'s answer could not be read: {}",
                self.app,
                error.without_url()
            )
        })?;

        Ok(ApiResponse {
            status,
            headers,
            body,
        })
    }
}
