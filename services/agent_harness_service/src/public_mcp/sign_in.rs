//! What happens when a person signs in to Macro from their AI agent.
//!
//! The MCP sign-in is a real signup path, so it does what the web login does
//! at the same moment — provision the inbox when Google granted Gmail — plus
//! what is specific to agent-led setup: hand a new account to the agent and
//! attribute it to the client that brought it in.

#[cfg(test)]
mod test;

use std::sync::Arc;
use tracing::Instrument;

use email::domain::ports::{FirstInboxProvisionOutcome, FirstInboxProvisioner};
use macro_auth::middleware::decode_jwt::{JwtToken, JwtValidationArgs};
use macro_user_id::user_id::MacroUserIdStr;
use mcp_auth_proxy::domain::{
    models::SignIn,
    ports::{ObserveFuture, SignInObserver},
};
use onboarding::domain::service::OnboardingService;

use crate::public_mcp::{
    agent_led::{AccountDirectory, AgentHandover, Handover},
    client_attribution::{ClientAttribution, ClientStore},
    telemetry::{ClientInfo, McpTelemetry, SignInEvent},
};

/// Reads the Macro profile id out of a freshly issued access token.
pub trait TokenIdentity: Send + Sync + 'static {
    /// The profile the token was issued to, or `None` for a token that does
    /// not validate.
    fn user_of(&self, access_token: &str) -> Option<MacroUserIdStr<'static>>;
}

impl TokenIdentity for JwtValidationArgs {
    fn user_of(&self, access_token: &str) -> Option<MacroUserIdStr<'static>> {
        let token = macro_auth::middleware::decode_jwt::handler(self, access_token)
            .inspect_err(|error| tracing::warn!(error=?error, "sign-in token did not validate"))
            .ok()?;
        let user_id = match token {
            JwtToken::MacroAccessToken(token) => token.macro_user_id,
            JwtToken::MacroApiToken(token) => token.macro_user_id,
        };
        MacroUserIdStr::try_from(user_id).ok()
    }
}

/// The MCP server's [`SignInObserver`].
pub struct AgentSignIn<T, P, O, A, S> {
    identity: Arc<T>,
    inbox: Arc<P>,
    handover: AgentHandover<O, A>,
    attribution: ClientAttribution<S>,
    telemetry: McpTelemetry,
}

impl<T, P, O, A: Clone, S: Clone> Clone for AgentSignIn<T, P, O, A, S> {
    fn clone(&self) -> Self {
        Self {
            identity: Arc::clone(&self.identity),
            inbox: Arc::clone(&self.inbox),
            handover: self.handover.clone(),
            attribution: self.attribution.clone(),
            telemetry: self.telemetry.clone(),
        }
    }
}

impl<T, P, O, A, S> AgentSignIn<T, P, O, A, S>
where
    T: TokenIdentity,
    P: FirstInboxProvisioner,
    O: OnboardingService,
    A: AccountDirectory + Clone,
    S: ClientStore + Clone,
{
    /// An observer over its collaborators.
    pub fn new(
        identity: Arc<T>,
        inbox: Arc<P>,
        handover: AgentHandover<O, A>,
        attribution: ClientAttribution<S>,
        telemetry: McpTelemetry,
    ) -> Self {
        Self {
            identity,
            inbox,
            handover,
            attribution,
            telemetry,
        }
    }

    /// Everything a sign-in sets in motion, in order. Each step is
    /// best-effort and idempotent: inbox provisioning recurs on every sign-in
    /// and the setup tools redo the handover, so a lost step only delays it.
    #[tracing::instrument(name = "mcp.agent_sign_in", skip_all, fields(client = sign_in.client_name.as_deref()))]
    pub async fn after_sign_in(&self, user: MacroUserIdStr<'static>, sign_in: SignIn) {
        let token = sign_in.access_token.as_str();

        // Only an account this sign-in created is set up for its agent; people
        // who already had Macro keep it as it was until they ask.
        let agent_led = match self
            .handover
            .hand_over_new_sign_up(&user, sign_in.client_name.as_deref(), chrono::Utc::now())
            .await
        {
            Ok(outcome) => outcome == Handover::AgentLed,
            Err(error) => {
                tracing::warn!(error=?error, "failed to hand the account to the agent on sign-in");
                false
            }
        };

        let inbox = if agent_led {
            match self.inbox.provision_first_inbox(token).await {
                Ok(FirstInboxProvisionOutcome::Provisioned) => "provisioned",
                Ok(FirstInboxProvisionOutcome::Skipped) => "skipped",
                Err(error) => {
                    tracing::warn!(error=?error, "first-inbox provision on MCP sign-in failed");
                    "failed"
                }
            }
        } else {
            "skipped"
        };

        let client = ClientInfo {
            name: sign_in.client_name.clone(),
            ..ClientInfo::default()
        };
        self.attribution
            .remember_if_unknown(token, user.as_ref(), &client)
            .await;

        self.telemetry.signed_in(
            user.as_ref(),
            &SignInEvent {
                client_name: sign_in.client_name,
                agent_led,
                inbox,
            },
        );
    }
}

impl<T, P, O, A, S> SignInObserver for AgentSignIn<T, P, O, A, S>
where
    T: TokenIdentity,
    P: FirstInboxProvisioner,
    O: OnboardingService,
    A: AccountDirectory + Clone,
    S: ClientStore + Clone,
{
    fn signed_in(&self, sign_in: SignIn) -> ObserveFuture<'_> {
        // The person is waiting on the redirect back to their agent, so all of
        // this happens after it.
        if let Some(user) = self.identity.user_of(sign_in.access_token.as_str()) {
            let this = self.clone();
            // Stays on the sign-in's trace.
            tokio::spawn(async move { this.after_sign_in(user, sign_in).await }.in_current_span());
        }
        Box::pin(async {})
    }
}
