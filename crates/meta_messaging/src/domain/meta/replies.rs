//! Meta policy and prepared transport behind the shared reply interfaces.

use crate::domain::meta_policy::{
    HUMAN_SUPPORT_WINDOW, ReplyWindow, STANDARD_REPLY_WINDOW, authorize_send,
};
use crate::domain::{connection::*, models::*, policy::*, ports::*, replies::*};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::sync::Arc;

pub(super) struct MetaReplies {
    pub repository: Arc<dyn MessagingRepository>,
    pub provider: Arc<dyn MetaProvider>,
    pub cipher: Arc<dyn CredentialCipher>,
    pub human_agent_approved: bool,
    pub native: Arc<dyn NativeMessaging>,
}

impl From<&Connection> for AccountScope {
    fn from(connection: &Connection) -> Self {
        Self {
            id: connection.id,
            team_id: connection.team_id,
            generation: connection.connected_at,
            personal: None,
            status: connection.status,
        }
    }
}

impl MetaReplies {
    async fn connection(&self, scope: &AccountScope) -> PortResult<Connection> {
        self.repository
            .connection(scope.id)
            .await?
            .filter(|connection| {
                connection.team_id == scope.team_id && connection.connected_at == scope.generation
            })
            .ok_or_else(|| MessagingError::Conflict.into())
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

#[async_trait]
impl ReplyPolicy for MetaReplies {
    async fn evaluate(
        &self,
        scope: &AccountScope,
        conversation: &Conversation,
        now: DateTime<Utc>,
    ) -> PortResult<ReplyOptions> {
        let mut connection = self.connection(scope).await?;
        super::visible_health(self.native.as_ref(), &mut connection).await?;
        Ok(reply_options(
            &connection,
            conversation,
            self.human_agent_approved,
            now,
        ))
    }

    async fn validate_content(&self, scope: &AccountScope, request: &SendReply) -> PortResult<()> {
        if matches!(request.message, ReplyContent::Mutation { .. }) {
            return Err(
                MessagingError::Invalid("this operation requires a personal linked group").into(),
            );
        }
        if request.human_support && !self.human_agent_approved {
            return Err(MessagingError::HumanSupportRequired.into());
        }
        if let ReplyContent::Template {
            template_id,
            language,
            parameters,
        } = &request.message
        {
            if parameters.len() > 50
                || parameters.iter().any(|value| value.len() > 1024)
                || language.len() > 32
                || language.is_empty()
            {
                return Err(
                    MessagingError::Invalid("invalid template parameters or language").into(),
                );
            }
            let connection = self.connection(scope).await?;
            let token = self.token(&connection).await?;
            let templates = self.provider.templates(&connection, &token).await?;
            let template = templates
                .iter()
                .find(|template| template.id == *template_id && template.language == *language)
                .ok_or(MessagingError::Invalid(
                    "template is not approved for this account and language",
                ))?;
            let layout = crate::domain::templates::text_parameters(&template.components)?;
            if layout.len() != parameters.len()
                || parameters.iter().any(|value| value.trim().is_empty())
            {
                return Err(
                    MessagingError::Invalid("fill every approved template parameter").into(),
                );
            }
        }
        Ok(())
    }
}

/// Both supported products use this evaluator for composer eligibility and dispatch.
pub(super) fn reply_options(
    connection: &Connection,
    conversation: &Conversation,
    app_human_agent_approved: bool,
    now: DateTime<Utc>,
) -> ReplyOptions {
    let (modes, text_limit, text_limit_in_bytes) = match connection.provider {
        Provider::Whatsapp => (
            vec![ReplyMode::FreeForm, ReplyMode::ApprovedTemplate],
            4096,
            false,
        ),
        Provider::Instagram => (
            vec![ReplyMode::FreeForm, ReplyMode::HumanSupport],
            1000,
            true,
        ),
    };
    let window = ReplyWindow {
        provider: connection.provider,
        connected: connection.is_ready(),
        last_customer_message_at: conversation.last_customer_message_at,
        human_agent_approved: connection.human_agent_approved && app_human_agent_approved,
    };
    let group_blocked = conversation.kind == crate::domain::groups::ConversationKind::Group
        && conversation.group_status != Some(crate::domain::groups::GroupStatus::Active);
    let eligibility = modes
        .iter()
        .map(|&mode| {
            let reason = if group_blocked {
                Some(ReplyBlockReason::GroupReadOnly)
            } else {
                authorize_send(&window, SendAuthority::Human, mode, now)
                    .err()
                    .map(|error| match error {
                        MessagingError::Forbidden => ReplyBlockReason::Forbidden,
                        MessagingError::Disconnected => ReplyBlockReason::Disconnected,
                        MessagingError::TemplateRequired => ReplyBlockReason::TemplateRequired,
                        MessagingError::ReplyWindowClosed => ReplyBlockReason::WindowClosed,
                        MessagingError::HumanSupportRequired => {
                            ReplyBlockReason::HumanSupportRequired
                        }
                        _ => ReplyBlockReason::Unsupported,
                    })
            };
            let expires_at = if reason.is_some() {
                None
            } else {
                match mode {
                    ReplyMode::FreeForm => conversation
                        .last_customer_message_at
                        .map(|at| at + STANDARD_REPLY_WINDOW),
                    ReplyMode::HumanSupport => conversation
                        .last_customer_message_at
                        .map(|at| at + HUMAN_SUPPORT_WINDOW),
                    ReplyMode::ApprovedTemplate => None,
                }
            };
            ModeEligibility {
                mode,
                allowed: reason.is_none(),
                reason,
                expires_at,
            }
        })
        .collect();
    ReplyOptions {
        capabilities: ReplyCapabilities {
            modes,
            text_limit,
            text_limit_in_bytes,
            media: crate::domain::meta_policy::media::capabilities(connection.provider),
            max_attachments: 1,
        },
        eligibility: ReplyEligibility {
            evaluated_at: now,
            modes: eligibility,
        },
    }
}

#[async_trait]
impl ReplyTransport for MetaReplies {
    async fn prepare(
        &self,
        scope: &AccountScope,
        conversation: &Conversation,
        request: &SendReply,
        media: Option<&OutboundMedia>,
    ) -> PortResult<Box<dyn PreparedSend>> {
        let connection = self.connection(scope).await?;
        let token = self.token(&connection).await?;
        let prepared = self
            .provider
            .prepare_reply(&connection, &token, conversation, request, media)
            .await?;
        Ok(Box::new(MetaPreparedSend {
            provider: self.provider.clone(),
            repository: self.repository.clone(),
            connection,
            token,
            prepared,
        }))
    }
}

struct MetaPreparedSend {
    provider: Arc<dyn MetaProvider>,
    repository: Arc<dyn MessagingRepository>,
    connection: Connection,
    token: AccessToken,
    prepared: PreparedReply,
}

#[async_trait]
impl PreparedSend for MetaPreparedSend {
    fn rendered_text(&self) -> &str {
        &self.prepared.rendered_text
    }

    async fn dispatch(self: Box<Self>) -> PortResult<ProviderSendResult> {
        let result = self
            .provider
            .send(&self.connection, &self.token, &self.prepared)
            .await;
        if matches!(&result, ProviderSendResult::Rejected(code) if code == "provider_error_190")
            && let Err(error) = self
                .repository
                .health(
                    &self.connection,
                    ConnectionStatus::Revoked,
                    Some("access_revoked_reconnect"),
                )
                .await
        {
            // Account maintenance rechecks health; the provider result stays definitive.
            tracing::warn!(error=?error.current_context(),"revoked Meta authorization could not be recorded");
        }
        Ok(result)
    }
}
