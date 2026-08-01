//! The use case: a mention arrives, and either starts an agent session or
//! continues the one that already owns this thread.
//!
//! A session is scoped to **one bot in one thread**. `@claude` and `@codex` in
//! the same thread get one session each, in parallel, because each harness
//! deployment answers for exactly one [`crate::domain::mentions::HARNESS_BOT_ID`].
//!
//! The harness never speaks ACP itself. It boots a container, hands the
//! connection to whatever manages sessions (see
//! [`crate::domain::ports::RuntimeAttachments`]), and relays frames verbatim -
//! see [`crate::domain::runtime`].

use std::sync::Arc;

use anyhow::Context;

use bot_id::BotId;
use channels::domain::side_effects::ChannelBotTrigger;

use agent_session::domain::model::{AgentSession, ThreadSession};
use agent_session::domain::ports::AgentSessionRepo;

use crate::domain::ports::{AgentSandbox, ChannelReplier, RuntimeAttachments, SandboxProvider};
use crate::domain::runtime;

/// Runs agents for mentions of this deployment's bot.
pub struct MentionHandler<Provider, Attach, Sessions, Replier> {
    /// The one bot this deployment answers for. `@claude` and `@codex` are
    /// separate deployments, each with its own id, which is what lets their
    /// sessions run in parallel in the same thread.
    bot: BotId,
    provider: Arc<Provider>,
    attachments: Arc<Attach>,
    sessions: Arc<Sessions>,
    replier: Arc<Replier>,
}

impl<Provider, Attach, Sessions, Replier> MentionHandler<Provider, Attach, Sessions, Replier>
where
    Provider: SandboxProvider,
    Attach: RuntimeAttachments,
    Sessions: AgentSessionRepo,
    Replier: ChannelReplier,
{
    /// Wire the handler to its adapters.
    pub fn new(
        bot: BotId,
        provider: Arc<Provider>,
        attachments: Arc<Attach>,
        sessions: Arc<Sessions>,
        replier: Arc<Replier>,
    ) -> Self {
        Self {
            bot,
            provider,
            attachments,
            sessions,
            replier,
        }
    }

    /// Handle one mention. Returns as soon as the work is under way; progress
    /// reaches the reader through the session, not back through this call.
    ///
    /// Fire-and-forget on purpose: the Kafka consumer must keep polling, and a
    /// run outlives the poll loop iteration that started it.
    pub fn handle(self: &Arc<Self>, trigger: ChannelBotTrigger) {
        let handler = Arc::clone(self);
        tokio::spawn(async move {
            let message_id = trigger.message.id;
            let _ = handler.dispatch(trigger).await.inspect_err(|error| {
                tracing::error!(error = ?error, %message_id, "handling a mention failed");
            });
        });
    }

    /// Decide what this mention means for the thread it arrived in.
    ///
    /// One lookup answers all three cases, so the branch here *is* the policy.
    ///
    /// Note the asymmetry in whether a message has to address us. Starting a
    /// session and continuing one from its originating thread both require it -
    /// otherwise every message in a busy channel would be a prompt. A message
    /// *inside* the agent's own thread does not: that thread exists only to hold
    /// this run, so everything said there is for the agent.
    #[tracing::instrument(err, skip(self, trigger), fields(
        channel_id = %trigger.channel_id,
        message_id = %trigger.message.id,
    ))]
    async fn dispatch(&self, trigger: ChannelBotTrigger) -> anyhow::Result<()> {
        // Ignore ourself and other bots, we just care about humans dispatching
        // us. Without this the agent answers itself forever: our reply lands in
        // the thread we watch, and a message in an agent thread needs no mention
        // to count.
        if trigger.message.sender_id.as_bot().is_some() {
            return Ok(());
        }

        // `channels` already matched the mentions, so the `bot|<uuid>` form and
        // the user-tagged-bot quirk stay owned there.
        let addressed = trigger.bot_ids.contains(&self.bot);

        // A message that neither addresses us nor sits in any thread cannot
        // concern us, and skipping it here keeps the channel firehose off the
        // database.
        if !addressed && trigger.message.thread_id.is_none() {
            return Ok(());
        }

        match self
            .sessions
            // A channel thread is its parent message, so a top-level mention's
            // thread is the mention itself.
            .find_for_thread(
                self.bot,
                trigger.message.thread_id.unwrap_or(trigger.message.id),
            )
            .await?
        {
            ThreadSession::None if addressed => self.start(trigger).await,
            ThreadSession::CreatedFromThisThread(session) if addressed => {
                self.resume_from_origin_thread(trigger, session).await
            }
            ThreadSession::InSessionThread(session) => {
                self.resume_in_agent_thread(trigger, session).await
            }
            // Someone talking in a channel that happens to have a session of
            // ours, without addressing us.
            ThreadSession::None | ThreadSession::CreatedFromThisThread(_) => Ok(()),
        }
    }

    /// First mention in this thread: acknowledge, then boot a container.
    async fn start(&self, trigger: ChannelBotTrigger) -> anyhow::Result<()> {
        // A channel thread is its parent message, so a top-level mention's
        // thread is the mention itself.
        let origin_thread = trigger.message.thread_id.unwrap_or(trigger.message.id);
        let anchor = self
            .replier
            .post(&trigger, origin_thread, "booting".to_owned())
            .await?;

        // That message anchors the session's own thread: everything the run
        // says goes there, and `agent_session.thread_id` will reference it.
        //
        // NOT YET: `sessions.create(..)` with that anchor. It needs a `bots` row
        // for the bot-id foreign key, which does not exist yet - so a run
        // currently happens without being recorded, and is therefore not
        // resumable.
        tracing::debug!(%anchor, "message anchoring the session thread");

        self.run(&trigger).await
    }

    /// A later mention in the thread the session was created from: continue
    /// that session and post a fresh link to it.
    async fn resume_from_origin_thread(
        &self,
        _trigger: ChannelBotTrigger,
        _session: AgentSession,
    ) -> anyhow::Result<()> {
        todo!("post a fresh link into the origin thread, then resume(session, prompt)")
    }

    /// A message inside the agent's own thread. No link to post - the reader is
    /// already looking at the session - so this only delivers the prompt.
    async fn resume_in_agent_thread(
        &self,
        _trigger: ChannelBotTrigger,
        _session: AgentSession,
    ) -> anyhow::Result<()> {
        todo!("resume(session, prompt)")
    }

    async fn resume(&self, _session: &AgentSession, _prompt: String) -> anyhow::Result<()> {
        todo!("live container -> inject; otherwise reboot, re-establish ACP, then inject")
    }

    /// Boot a container and hand its connection to the session manager.
    #[tracing::instrument(err, skip(self, trigger), fields(message_id = %trigger.message.id))]
    async fn run(&self, trigger: &ChannelBotTrigger) -> anyhow::Result<()> {
        let session_id = trigger.message.thread_id.unwrap_or(trigger.message.id);

        tracing::info!(%session_id, "spawning a sandbox");
        let sandbox = self
            .provider
            .spawn()
            .await
            .context("spawning the sandbox")?;
        tracing::info!(%session_id, sandbox_id = %sandbox.id(), "sandbox ready");

        // Past this point the sandbox costs money, so the result is held and the
        // release happens either way. Only for an `Err` - a panic or a kill
        // signal still skips it and leaks the container.
        let result = async {
            let frames = sandbox
                .connect()
                .await
                .context("connecting to the sidecar")?;
            runtime::bridge(session_id, frames, self.attachments.as_ref()).await
        }
        .await;

        sandbox.release().await;
        result
    }
}
