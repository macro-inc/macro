use crate::domain::models::{MacroUserIdStr, McpServerRecord, StoredCredentials};
use crate::domain::ports::{McpServerStore, OAuthClient, OAuthStateStore, PendingAuth};
use macro_user_id::cowlike::CowLike;
use rmcp::transport::auth::{
    AuthorizationManager, CredentialStore as _, InMemoryCredentialStore, InMemoryStateStore,
    OAuthClientConfig, StateStore as _, StoredAuthorizationState,
};

/// Drives the OAuth authorization-code flow, storing ephemeral state in an
/// [`OAuthStateStore`] and persisting credentials to a [`McpServerStore`].
pub struct OAuthService<S, R> {
    server_store: S,
    state_store: R,
    redirect_uri: String,
}

impl<S, R> OAuthService<S, R> {
    /// Create a new OAuth service.
    ///
    /// `redirect_uri` is the callback URL registered with OAuth providers
    /// (e.g. `https://api.example.com/mcp/auth/callback`).
    pub fn new(server_store: S, state_store: R, redirect_uri: String) -> Self {
        Self {
            server_store,
            state_store,
            redirect_uri,
        }
    }
}

impl<S, R> OAuthClient for OAuthService<S, R>
where
    S: McpServerStore,
    R: OAuthStateStore,
    anyhow::Error: From<S::Err>,
{
    async fn start_authorization(
        &self,
        user_id: &MacroUserIdStr<'static>,
        server_url: &str,
        server_name: &str,
    ) -> anyhow::Result<String> {
        let mut auth_manager = AuthorizationManager::new(server_url).await?;
        let metadata = auth_manager.discover_metadata().await?;
        auth_manager.set_metadata(metadata);

        let in_memory_state = InMemoryStateStore::new();
        auth_manager.set_state_store(in_memory_state.clone());
        auth_manager.set_credential_store(InMemoryCredentialStore::new());

        let client_config = auth_manager
            .register_client("macro", &self.redirect_uri, &[])
            .await?;

        let auth_url = auth_manager.get_authorization_url(&[]).await?;
        let csrf_token = extract_state_param(&auth_url)?;

        let pkce_state = in_memory_state
            .load(&csrf_token)
            .await?
            .ok_or_else(|| anyhow::anyhow!("PKCE state not found after generating auth URL"))?;

        let pending = PendingAuth {
            pkce_verifier: pkce_state.pkce_verifier,
            client_id: client_config.client_id,
            client_secret: client_config.client_secret,
            user_id: user_id.as_ref().to_string(),
            server_url: server_url.to_string(),
            server_name: server_name.to_string(),
        };
        self.state_store.save(&csrf_token, pending).await?;

        tracing::info!(csrf_token, redirect_uri = %self.redirect_uri, "stored pending OAuth state");
        Ok(auth_url)
    }

    async fn exchange_authorization_code(
        &self,
        code: &str,
        state: &str,
    ) -> anyhow::Result<StoredCredentials> {
        let pending = self
            .state_store
            .take(state)
            .await?
            .ok_or_else(|| anyhow::anyhow!("no pending authorization for state"))?;

        let mut auth_manager = AuthorizationManager::new(&pending.server_url).await?;
        let metadata = auth_manager.discover_metadata().await?;
        auth_manager.set_metadata(metadata);

        let pkce_state = StoredAuthorizationState::new(
            &oauth2::PkceCodeVerifier::new(pending.pkce_verifier),
            &oauth2::CsrfToken::new(state.to_string()),
        );
        let in_memory_state = InMemoryStateStore::new();
        in_memory_state.save(state, pkce_state).await?;
        auth_manager.set_state_store(in_memory_state);

        let credential_store = InMemoryCredentialStore::new();
        auth_manager.set_credential_store(credential_store.clone());

        let mut client_config =
            OAuthClientConfig::new(pending.client_id, self.redirect_uri.clone());
        if let Some(secret) = pending.client_secret {
            client_config = client_config.with_client_secret(secret);
        }
        auth_manager.configure_client(client_config)?;

        auth_manager
            .exchange_code_for_token(code, state)
            .await
            .inspect_err(|e| tracing::error!(error = ?e, "exchange_code_for_token failed"))?;

        let credentials = credential_store
            .load()
            .await
            .inspect_err(|e| tracing::error!(error = ?e, "credential store load failed"))?
            .ok_or_else(|| anyhow::anyhow!("credentials missing after token exchange"))?;

        let user_id = MacroUserIdStr::parse_from_str(&pending.user_id)
            .map_err(|e| anyhow::anyhow!("invalid user_id in pending context: {e}"))?
            .into_owned();

        let record = McpServerRecord {
            user_id,
            url: pending.server_url,
            server_name: pending.server_name,
            credentials: Some(credentials.clone()),
            enabled: true,
        };

        self.server_store
            .save(&record)
            .await
            .inspect_err(|e| tracing::error!(error = ?e, "server store save failed"))
            .map_err(anyhow::Error::from)?;

        tracing::info!("OAuth flow completed successfully");
        Ok(credentials)
    }
}

fn extract_state_param(url: &str) -> anyhow::Result<String> {
    reqwest::Url::parse(url)?
        .query_pairs()
        .find(|(k, _)| k == "state")
        .map(|(_, v)| v.into_owned())
        .ok_or_else(|| anyhow::anyhow!("missing state parameter in authorization URL"))
}
