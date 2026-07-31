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

use std::panic::AssertUnwindSafe;

use anyhow::Context;
use futures::FutureExt;

use bot_id::BotId;
use channels::domain::side_effects::ChannelBotTrigger;

use crate::domain::models::{AgentSession, ThreadSession, reply_thread_id};
use crate::domain::ports::{
    AgentSandbox, AgentSessionStore, ChannelReplier, RuntimeAttachments, SandboxProvider,
};
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
    Sessions: AgentSessionStore,
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
            .find_for_thread(self.bot, trigger.message.thread_id)
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
    ///
    /// The acknowledgement goes out *before* the container so a spawn failure is
    /// still visible to whoever asked - booting takes minutes on a cold image,
    /// and silence for that long reads as nothing having happened.
    async fn start(&self, trigger: ChannelBotTrigger) -> anyhow::Result<()> {
        let reply_id = self.replier.reply(&trigger, "booting".to_owned()).await?;

        // The reply anchors the session's thread, which is why it has to exist
        // before the row: `agent_sessions.thread_id` references
        // `comms_messages`.
        //
        // NOT YET: `sessions.create(..)` with that anchor. It needs a `bots` row
        // for the bot-id foreign key, which does not exist yet - so a run
        // currently happens without being recorded, and is therefore not
        // resumable.
        tracing::debug!(%reply_id, "reply anchors the session thread");

        self.run(&trigger).await
    }

    /// A later mention in the thread the session was created from: continue
    /// that session and post a fresh link to it.
    ///
    /// A new link rather than an edited one - the spec calls for a new message
    /// each time.
    ///
    /// See [`Self::resume`] for what continuing actually requires.
    async fn resume_from_origin_thread(
        &self,
        _trigger: ChannelBotTrigger,
        _session: AgentSession,
    ) -> anyhow::Result<()> {
        todo!("reply_with_session_link, then resume(session, prompt)")
    }

    /// A message inside the agent's own thread. No link to post - the reader is
    /// already looking at the session - so this only delivers the prompt.
    ///
    /// See [`Self::resume`] for what that requires.
    async fn resume_in_agent_thread(
        &self,
        _trigger: ChannelBotTrigger,
        _session: AgentSession,
    ) -> anyhow::Result<()> {
        todo!("resume(session, prompt)")
    }

    /// Get a prompt to an existing session, rebooting its container first if
    /// nothing is live.
    ///
    /// Liveness is **not** `session.last_status`. That column records the last
    /// state anyone observed, so a harness that was killed mid-run leaves rows
    /// reading `Ready` with no container behind them. The authority is whether
    /// this process is holding the session's channel halves; after a restart it
    /// is holding none, which is exactly when resumption matters.
    ///
    /// So:
    ///
    /// - live container for this session -> inject the prompt, done
    /// - otherwise -> spawn a fresh sandbox, re-establish ACP, then inject
    ///
    /// Re-establishing is the open part. `session.acp_session_id` is persisted
    /// for it, but a new container has none of the agent's own state - no
    /// conversation, no edited files, no tool history. Options, roughly in order
    /// of how much they need from elsewhere: an ACP `session/load` if the
    /// harness supports one (nothing in this repo speaks it yet); replaying the
    /// stored ACP message log into a fresh `session/new`, which is the reason to
    /// persist every frame rather than only render from it; or accepting that a
    /// rebooted session starts cold and saying so in the thread.
    async fn resume(&self, _session: &AgentSession, _prompt: String) -> anyhow::Result<()> {
        todo!("live container -> inject; otherwise reboot, re-establish ACP, then inject")
    }

    /// Drive one agent run: boot a container and hand its connection to the
    /// session manager.
    ///
    /// Short by design. Everything that used to be here - the ACP bootstrap,
    /// the prompt, persisting frames - belongs to whoever implements
    /// [`RuntimeAttachments`]. What is left is the part nobody else can do.
    #[tracing::instrument(err, skip(self, trigger), fields(message_id = %trigger.message.id))]
    async fn run(&self, trigger: &ChannelBotTrigger) -> anyhow::Result<()> {
        let session_id = reply_thread_id(trigger);

        tracing::info!(%session_id, "spawning a sandbox");
        let sandbox = self
            .provider
            .spawn()
            .await
            .context("spawning the sandbox")?;
        tracing::info!(%session_id, sandbox_id = %sandbox.id(), "sandbox ready");

        // Past this point the sandbox costs money, so it is released on every
        // path - including a panic. `catch_unwind` rather than a `Drop` guard
        // because releasing is async and `Drop` cannot await; without it an
        // unwind skips the release and the sandbox holds the provider's quota
        // until it is reclaimed.
        let result = AssertUnwindSafe(async {
            let frames = sandbox
                .connect()
                .await
                .context("connecting to the sidecar")?;
            runtime::bridge(session_id, frames, self.attachments.as_ref()).await
        })
        .catch_unwind()
        .await;

        sandbox.release().await;

        match result {
            Ok(result) => result,
            Err(panic) => std::panic::resume_unwind(panic),
        }
    }
}
