//! Quota admission at harness ingress, after access validation and retry detection.
//! Session owners fund managed inference; the actor can be a collaborator.

use super::*;
use ai_usage::AiFeature;

impl<
    Sessions,
    Containers,
    Announcer,
    Runtimes,
    PromptContext,
    PromptComposer,
    Egress,
    Lifecycle,
    Mentions,
    Notifier,
>
    AgentHarnessInner<
        Sessions,
        Containers,
        Announcer,
        Runtimes,
        PromptContext,
        PromptComposer,
        Egress,
        Lifecycle,
        Mentions,
        Notifier,
    >
where
    Sessions: AgentSessionService,
    PromptContext: MessagePromptContext,
{
    /// Origin-bearing commands must be authorized even when they will only
    /// queue (or arrived over the internal forwarding bus). Direct controls
    /// carry the access check performed when constructing `ControlEvent`.
    pub(super) async fn authorize_action(&self, command: &DeliverAction) -> Result<()> {
        if let Some(origin) = &command.announce {
            let actor = command.actor.as_ref().ok_or(AgentSessionError::Forbidden)?;
            self.prompt_context.authorize_origin(actor, origin).await?;
        }
        Ok(())
    }

    pub(super) async fn admit_session(&self, session: &AgentSession) -> Result<()> {
        let kind = AgentKind::for_session(session.bot_id, &session.harness);
        if macro_funded(kind) {
            // Never use the actor or a system fallback for a missing user owner.
            self.admission
                .admit(session.owner_user()?, AiFeature::AgentSession)
                .await?;
        }
        Ok(())
    }

    pub(super) async fn admit_open(
        &self,
        bot: BotId,
        harness: &str,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<()> {
        if macro_funded(AgentKind::for_session(bot, harness)) {
            self.admission.admit(owner, AiFeature::AgentSession).await?;
        }
        Ok(())
    }
}

fn macro_funded(kind: AgentKind) -> bool {
    match kind {
        AgentKind::InMemory | AgentKind::SandboxedCoder => true,
        // Independently billed tools/helpers have their own admission; runtime
        // execution itself uses the owner's subscription or external provider.
        AgentKind::Cursor
        | AgentKind::CodexCloud
        | AgentKind::ClaudeCloud
        | AgentKind::External => false,
    }
}
