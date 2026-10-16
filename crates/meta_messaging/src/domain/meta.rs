//! Specialized Meta account lifecycle, ingestion, and history use cases.

use std::sync::Arc;

use super::service::{MessagingService, channel_id};
use chrono::{Duration, Utc};
use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt, EntityType};
use messages::domain::service::MessageView;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{connection::*, events::*, models::*, policy::*, ports::*};

mod history;
mod replies;
mod worker;
use worker::IngestionLease;

/// Meta lifecycle and compatibility facade around the shared messaging service.
#[derive(Clone)]
pub struct MetaService {
    /// Durable state used by the inbound worker driver.
    pub repository: Arc<dyn MessagingRepository>,
    /// Shared conversation and send use cases.
    pub messaging: MessagingService,
    provider: Arc<dyn MetaProvider>,
    cipher: Arc<dyn CredentialCipher>,
    native: Arc<dyn NativeMessaging>,
    configuration: PublicConfiguration,
}

impl MetaService {
    /// Wire capabilities once; secret configuration is validated by adapters at startup.
    pub fn new(
        repository: Arc<dyn MessagingRepository>,
        provider: Arc<dyn MetaProvider>,
        cipher: Arc<dyn CredentialCipher>,
        native: Arc<dyn NativeMessaging>,
        configuration: PublicConfiguration,
    ) -> Self {
        let replies = Arc::new(replies::MetaReplies {
            repository: repository.clone(),
            provider: provider.clone(),
            cipher: cipher.clone(),
            human_agent_approved: configuration.instagram_human_agent_approved,
        });
        let messaging =
            MessagingService::new(repository.clone(), replies.clone(), replies, native.clone());
        Self {
            messaging,
            repository,
            provider,
            cipher,
            native,
            configuration,
        }
    }

    /// Return only non-secret integration configuration.
    pub fn configuration(&self) -> &PublicConfiguration {
        &self.configuration
    }

    /// Connect an explicitly enabled local test number using server-only credentials.
    pub async fn connect_developer(
        &self,
        access: &EntityAccessReceipt<AdminTeamRole>,
    ) -> PortResult<Connection> {
        let (team, user) = team_actor(access)?;
        if !self.configuration.whatsapp_developer_available {
            return Err(MessagingError::Forbidden.into());
        }
        let account = self.provider.developer_account().await?;
        let existing = self
            .repository
            .account(Provider::Whatsapp, &account.account_id)
            .await?;
        if existing
            .as_ref()
            .is_some_and(|c| c.team_id != team || !c.developer_account)
        {
            return Err(MessagingError::Conflict.into());
        }
        let reconnect = existing.as_ref().map(|c| c.id);
        let id = reconnect.unwrap_or_else(Uuid::now_v7);
        let sealed = self.cipher.encrypt(team, id, &account.token).await?;
        let connection = Connection {
            id,
            team_id: team,
            user_id: user.into(),
            provider: Provider::Whatsapp,
            account_id: account.account_id,
            business_account_id: account.business_account_id,
            display_name: account.display_name,
            status: ConnectionStatus::Connecting,
            connected_at: Some(Utc::now()),
            credential_expires_at: account.expires_at,
            human_agent_approved: false,
            developer_account: true,
            history_status: HistoryStatus::NotRequested,
            history_progress: None,
            health_error: None,
        };
        self.repository
            .connect(&connection, &sealed, reconnect)
            .await
    }

    /// Accept a signature-verified envelope durably before HTTP acknowledgement.
    pub async fn receive(
        &self,
        provider: Provider,
        body_sha256: &[u8],
        payload: &serde_json::Value,
    ) -> PortResult<()> {
        self.repository
            .accept_receipt(provider, body_sha256, payload)
            .await
    }

    /// Retain the existing Meta response fields around the shared conversation contract.
    pub async fn conversation_view(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        authority: SendAuthority,
    ) -> PortResult<Option<ConversationView>> {
        let Some(state) = self.messaging.conversation_view(access, authority).await? else {
            return Ok(None);
        };
        let account = self
            .repository
            .connection(state.account.id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        if account.team_id != state.account.team_id
            || account.connected_at != state.account.generation
        {
            return Err(MessagingError::Conflict.into());
        }
        Ok(Some(ConversationView {
            can_reply: state.can_reply,
            text_limit: state.capabilities.text_limit,
            text_limit_in_bytes: state.capabilities.text_limit_in_bytes,
            media: state.capabilities.media.clone(),
            capabilities: state.capabilities,
            eligibility: state.eligibility,
            conversation: state.conversation,
            provider: account.provider,
            account_name: account.display_name,
            status: account.status,
            health_error: account.health_error,
            developer_account: account.developer_account,
            human_agent_approved: account.human_agent_approved
                && self.configuration.instagram_human_agent_approved,
            sends: state.sends,
        }))
    }

    /// List team account health using a verified administrator receipt.
    pub async fn connections(
        &self,
        access: &EntityAccessReceipt<AdminTeamRole>,
    ) -> PortResult<Vec<Connection>> {
        let (team, _) = team_actor(access)?;
        self.repository.connections(team).await
    }

    /// Start one caller-bound authorization attempt, including reconnect identity.
    #[tracing::instrument(skip_all, err)]
    pub async fn begin_authorization(
        &self,
        access: &EntityAccessReceipt<AdminTeamRole>,
        provider: Provider,
        reconnect: Option<Uuid>,
    ) -> PortResult<BeginAuthorization> {
        let (team, user) = team_actor(access)?;
        let configured = match provider {
            Provider::Whatsapp => {
                self.configuration.whatsapp_app_id.is_some()
                    && self.configuration.whatsapp_configuration_id.is_some()
            }
            Provider::Instagram => {
                self.configuration.instagram_app_id.is_some()
                    && self.configuration.instagram_redirect_uri.is_some()
            }
        };
        if !configured {
            return Err(MessagingError::Invalid("this provider is not configured; ask the server administrator to complete Meta setup").into());
        }
        if let Some(id) = reconnect {
            self.team_connection(team, id).await?;
        }
        // These are random CSRF tokens, not database identifiers.
        let state = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let browser_transaction = (provider == Provider::Instagram)
            .then(|| format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()));
        self.repository
            .begin_authorization(&OAuthAttempt {
                state_sha256: authorization_digest(&state, browser_transaction.as_deref()),
                team_id: team,
                user_id: user.to_owned(),
                provider,
                reconnect_id: reconnect,
                expires_at: Utc::now() + Duration::minutes(10),
            })
            .await?;
        Ok(BeginAuthorization {
            state,
            browser_transaction,
            configuration: self.configuration.clone(),
        })
    }

    /// Complete authorization under the same authenticated team/user. Account
    /// facts are independently resolved through Meta before storing credentials.
    #[tracing::instrument(skip_all, err)]
    pub async fn complete_authorization(
        &self,
        access: &EntityAccessReceipt<AdminTeamRole>,
        input: CompleteAuthorization,
    ) -> PortResult<Connection> {
        let (team, user) = team_actor(access)?;
        if input.state.len() != 64 || input.code.is_empty() || input.code.len() > 8192 {
            return Err(MessagingError::Invalid("invalid authorization callback").into());
        }
        if input
            .browser_transaction
            .as_ref()
            .is_some_and(|proof| proof.len() != 64 || !proof.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(MessagingError::Forbidden.into());
        }
        self.native.require_admin(team, user).await?;
        let attempt = self
            .repository
            .consume_authorization(
                &authorization_digest(&input.state, input.browser_transaction.as_deref()),
                team,
                user,
            )
            .await?;
        // Reject pre-upgrade Instagram attempts too; no public/state-only fallback.
        if attempt.provider == Provider::Instagram && input.browser_transaction.is_none() {
            return Err(MessagingError::Forbidden.into());
        }
        self.finish_authorization(attempt, input).await
    }

    async fn finish_authorization(
        &self,
        attempt: OAuthAttempt,
        input: CompleteAuthorization,
    ) -> PortResult<Connection> {
        let team = attempt.team_id;
        let user = attempt.user_id.as_str();
        let account = self.provider.authorize(attempt.provider, &input).await?;
        let id = attempt.reconnect_id.unwrap_or_else(Uuid::now_v7);
        if let Some(existing) = attempt.reconnect_id {
            let original = self.team_connection(team, existing).await?;
            if original.provider != attempt.provider
                || original.account_id != account.account_id
                || original.business_account_id != account.business_account_id
            {
                return Err(MessagingError::Conflict.into());
            }
        }
        let sealed = self.cipher.encrypt(team, id, &account.token).await?;
        let connection = Connection {
            id,
            team_id: team,
            user_id: user.to_owned(),
            provider: attempt.provider,
            account_id: account.account_id,
            business_account_id: account.business_account_id,
            display_name: account.display_name,
            status: ConnectionStatus::Connecting,
            connected_at: Some(Utc::now()),
            credential_expires_at: account.expires_at,
            human_agent_approved: attempt.provider == Provider::Instagram
                && self.configuration.instagram_human_agent_approved,
            developer_account: false,
            history_status: HistoryStatus::NotRequested,
            history_progress: None,
            health_error: None,
        };
        // Subscription is retryable maintenance, so a provider outage cannot lose
        // an exchanged single-use code before its credential has been sealed.
        self.repository
            .connect(&connection, &sealed, attempt.reconnect_id)
            .await
    }

    /// Stop local receiving/sending immediately. Return whether Meta confirmed
    /// removal of its subscription so the UI can explain any remaining app action.
    pub async fn disconnect(
        &self,
        access: &EntityAccessReceipt<AdminTeamRole>,
        id: Uuid,
    ) -> PortResult<DisconnectResult> {
        let (team, user) = team_actor(access)?;
        let connection = self.team_connection(team, id).await?;
        let _guard = self
            .repository
            .lock_subscription(&connection)
            .await?
            .ok_or(MessagingError::Unavailable)?;
        self.native.require_admin(team, user).await?;
        // Authorization can have changed while waiting for another lifecycle operation.
        let connection = self.team_connection(team, id).await?;
        let token = self.token(&connection).await.ok();
        self.repository.disconnect(team, id).await?;
        self.remove_unused_subscription(&connection, token.as_ref())
            .await
    }

    // Caller holds the subscription guard through the remote operation. A separate
    // connection (even on another Macro team) is not ours to disconnect.
    async fn remove_unused_subscription(
        &self,
        c: &Connection,
        token: Option<&AccessToken>,
    ) -> PortResult<DisconnectResult> {
        if self.repository.subscription_in_use(c).await? {
            return Ok(DisconnectResult {
                remote_unsubscribed: false,
                shared_subscription_kept: true,
            });
        }
        let remote_unsubscribed = match token {
            Some(token) => self.provider.unsubscribe(c, token).await.is_ok(),
            None => false,
        };
        Ok(DisconnectResult {
            remote_unsubscribed,
            shared_subscription_kept: false,
        })
    }

    /// Approved templates are read only through a channel the caller can view.
    pub async fn templates(
        &self,
        access: &EntityAccessReceipt<MessageView>,
    ) -> PortResult<Vec<Template>> {
        let conversation = self
            .repository
            .conversation(channel_id(access)?)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let connection = self
            .repository
            .connection(conversation.connection_id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let user = access
            .get_authenticated_user()
            .map_err(|_| MessagingError::Forbidden)?;
        self.native
            .require_send(connection.team_id, conversation.channel_id, user.as_ref())
            .await?;
        let token = self.token(&connection).await?;
        self.provider.templates(&connection, &token).await
    }

    async fn team_connection(&self, team: Uuid, id: Uuid) -> PortResult<Connection> {
        self.repository
            .connection(id)
            .await?
            .filter(|c| c.team_id == team)
            .ok_or_else(|| MessagingError::NotFound.into())
    }
    async fn token(&self, connection: &Connection) -> PortResult<AccessToken> {
        if matches!(
            connection.status,
            ConnectionStatus::Disconnected | ConnectionStatus::Revoked
        ) {
            return Err(MessagingError::Disconnected.into());
        }
        let bytes = self.repository.credential(connection.id).await?;
        self.cipher
            .decrypt(connection.team_id, connection.id, &bytes)
            .await
    }
}

fn team_actor(access: &EntityAccessReceipt<AdminTeamRole>) -> Result<(Uuid, &str), MessagingError> {
    if access.entity().entity_type != EntityType::Team {
        return Err(MessagingError::Forbidden);
    }
    Ok((
        access
            .entity()
            .entity_id
            .parse()
            .map_err(|_| MessagingError::Forbidden)?,
        access
            .get_authenticated_user()
            .map_err(|_| MessagingError::Forbidden)?
            .as_ref(),
    ))
}

// Fixed-length random values make this unambiguous. Domain separation prevents
// a browser proof from being confused with a legacy/WhatsApp state digest.
fn authorization_digest(state: &str, browser_transaction: Option<&str>) -> Vec<u8> {
    let mut digest = Sha256::new();
    if let Some(proof) = browser_transaction {
        digest.update(b"instagram-browser-transaction:");
        digest.update(proof.as_bytes());
    }
    digest.update(state.as_bytes());
    digest.finalize().to_vec()
}
