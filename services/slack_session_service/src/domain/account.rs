//! One leased Slack account: open its sealed session, boot it, keep the
//! catalogue current, catch up and follow the websocket for added chats,
//! import history, dispatch sends and read marks. Every write is fenced by
//! the lease epoch; `Fenced` stops the account.

use std::sync::Arc;
use std::time::Duration;

use external_chat::domain::models::MEDIA_LIMIT_BYTES;
use external_chat::domain::models::{ExternalChatError, Mutation, ReplyContent, SendReply};
use external_chat::domain::ports::ExternalChatResult;
use slack_client::api::FileUpload;
use slack_client::models::Message;
use slack_client::realtime::{Event, RealtimeEvent};
use slack_client::{ChannelId, InvalidId, MessageTs, SlackError};
use slack_linked::domain::events::{
    ClaimedSend, HistoryWork, InboundChange, IngestOrigin, Lease, MediaFailure, SendOutcome,
    SessionScope,
};
use slack_linked::domain::models::{BACKFILL_MESSAGE_LIMIT, EndedReason};
use slack_linked::domain::session::{
    SessionService, changes_catalogue, ended_reason, inbound_changes, inbound_message,
    reaction_name, ts_time,
};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use uuid::Uuid;

use super::ports::{
    AccountControl, AccountExit, AccountRunner, AccountSignal, Connected, OpenFailure, Secrets,
    SlackConnector, SlackSession,
};

/// Timings of an account.
#[derive(Debug, Clone, Copy)]
pub struct AccountConfig {
    /// How often to retry deferred changes and look for missed work.
    pub tick_every: Duration,
    /// Sends claimed per batch.
    pub send_batch: i64,
}

/// Messages asked for per history or catch-up page.
const PAGE_SIZE: u16 = 200;

/// Runs the Slack accounts this replica leases.
pub struct SlackAccounts<Connector, Keys> {
    sessions: SessionService,
    connector: Arc<Connector>,
    secrets: Arc<Keys>,
    config: AccountConfig,
}

impl<Connector, Keys> SlackAccounts<Connector, Keys> {
    /// Wire the runner.
    pub fn new(
        sessions: SessionService,
        connector: Arc<Connector>,
        secrets: Arc<Keys>,
        config: AccountConfig,
    ) -> Self {
        Self {
            sessions,
            connector,
            secrets,
            config,
        }
    }
}

/// Why a step stopped the account.
enum Stop {
    Exit(AccountExit),
    Ended(EndedReason),
}

fn from_domain(report: rootcause::Report<ExternalChatError>) -> Stop {
    match report.current_context() {
        ExternalChatError::Fenced => Stop::Exit(AccountExit::Fenced),
        _ => {
            tracing::warn!(error = %report, "Slack account step failed");
            Stop::Exit(AccountExit::Failed)
        }
    }
}

/// A stored Slack id that doesn't parse: the row is corrupt.
fn stored<Id>(parsed: Result<Id, InvalidId>) -> Result<Id, Stop> {
    parsed.map_err(|error| {
        tracing::error!(error = %error, "A stored Slack id is invalid");
        Stop::Exit(AccountExit::Failed)
    })
}

fn from_slack(error: SlackError) -> Stop {
    match error.code().and_then(ended_reason) {
        Some(reason) => Stop::Ended(reason),
        None => {
            tracing::warn!(error = %error, "Slack call failed");
            Stop::Exit(AccountExit::Failed)
        }
    }
}

impl<Connector: SlackConnector, Keys: Secrets> AccountRunner for SlackAccounts<Connector, Keys> {
    type Signal = AccountSignal;

    async fn run(&self, account: Uuid, control: AccountControl<AccountSignal>) -> AccountExit {
        let span = tracing::info_span!(
            "slack.account.connect",
            account_id = %account,
            outcome = tracing::field::Empty,
        );
        span.follows_from(control.cause.id());
        let lease = match self
            .sessions
            .begin_lease(account)
            .instrument(span.clone())
            .await
        {
            Ok(lease) => lease,
            Err(report) => {
                return match from_domain(report) {
                    Stop::Exit(exit) => exit,
                    Stop::Ended(_) => AccountExit::Failed,
                };
            }
        };
        let scope = lease.scope;
        let outcome = self
            .open(&lease, control.stop.clone())
            .instrument(span.clone())
            .await;
        let connected = match outcome {
            Ok(Some(connected)) => connected,
            Ok(None) => {
                span.record("outcome", "idle");
                return AccountExit::Idle;
            }
            Err(stop) => {
                span.record("outcome", "stopped");
                return self.finish(scope, stop).await;
            }
        };
        span.record("outcome", "connected");
        let mut running = Running {
            accounts: self,
            scope,
            session: connected.session,
        };
        let result = running.serve(connected.events, control).await;
        match result {
            Ok(exit) => exit,
            Err(stop) => self.finish(scope, stop).await,
        }
    }
}

impl<Connector: SlackConnector, Keys: Secrets> SlackAccounts<Connector, Keys> {
    /// Open the sealed session and boot it; `None` when there is nothing to
    /// run (consent ended; a requested sign-out ran).
    async fn open(
        &self,
        lease: &Lease,
        stop: CancellationToken,
    ) -> Result<Option<Connected<Connector::Session>>, Stop> {
        let Some(secret) = &lease.credentials else {
            return Ok(None);
        };
        let credentials = match self
            .secrets
            .open_credentials(&lease.user_id, lease.scope.account_id, secret)
            .await
        {
            Ok(credentials) => credentials,
            Err(OpenFailure::Unavailable) => return Err(Stop::Exit(AccountExit::Failed)),
            Err(OpenFailure::Unreadable) => return Err(Stop::Ended(EndedReason::Unreadable)),
        };
        if !lease.state.is_active() {
            // Disconnected with "sign out of Slack": sign out, then forget.
            let session_stop = CancellationToken::new();
            let connected = self
                .connector
                .connect(credentials, session_stop.clone())
                .await;
            session_stop.cancel();
            if let Ok(connected) = connected
                && let Err(error) = connected.session.sign_out().await
            {
                tracing::warn!(error = %error, "Signing the Slack session out failed");
            }
            self.sessions
                .signed_out(lease.scope)
                .await
                .map_err(from_domain)?;
            return Ok(None);
        }
        let connected = self
            .connector
            .connect(credentials, stop.child_token())
            .await
            .map_err(from_slack)?;
        self.sessions
            .connected(lease.scope, &connected.boot)
            .await
            .map_err(from_domain)?;
        Ok(Some(connected))
    }

    async fn finish(&self, scope: SessionScope, stop: Stop) -> AccountExit {
        match stop {
            Stop::Exit(exit) => exit,
            Stop::Ended(reason) => match self.sessions.session_ended(scope, reason).await {
                Ok(()) => AccountExit::Idle,
                Err(report) => match from_domain(report) {
                    Stop::Exit(exit) => exit,
                    Stop::Ended(_) => AccountExit::Failed,
                },
            },
        }
    }
}

struct Running<'a, Connector: SlackConnector, Keys> {
    accounts: &'a SlackAccounts<Connector, Keys>,
    scope: SessionScope,
    session: Connector::Session,
}

impl<Connector: SlackConnector, Keys: Secrets> Running<'_, Connector, Keys> {
    async fn serve(
        &mut self,
        mut events: tokio::sync::mpsc::Receiver<RealtimeEvent>,
        mut control: AccountControl<AccountSignal>,
    ) -> Result<AccountExit, Stop> {
        self.refresh_catalogue().await?;
        self.catch_up().await?;
        self.work().await?;
        let mut tick = tokio::time::interval(self.accounts.config.tick_every);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                biased;
                () = control.stop.cancelled() => return Ok(AccountExit::Stopped),
                () = control.release.cancelled() => return Ok(AccountExit::Released),
                signal = control.signals.recv() => {
                    let Some(signal) = signal else { return Ok(AccountExit::Stopped) };
                    let span = tracing::info_span!(
                        parent: &signal.span,
                        "slack.account.signal",
                        account_id = %self.scope.account_id,
                        signal = ?signal.signal,
                    );
                    self.signal(signal.signal).instrument(span).await?;
                }
                event = events.recv() => match event {
                    Some(event) => self.event(event).await?,
                    None => return Ok(AccountExit::Failed),
                },
                _ = tick.tick() => self.work().await?,
            }
        }
    }

    async fn signal(&mut self, signal: AccountSignal) -> Result<(), Stop> {
        match signal {
            AccountSignal::Catalogue => self.refresh_catalogue().await,
            AccountSignal::Send => self.sends().await,
            AccountSignal::Read => self.read_marks().await,
            AccountSignal::History => self.history().await,
            AccountSignal::Changed | AccountSignal::Resync => {
                let lease_state = self
                    .accounts
                    .sessions
                    .observed_chats(self.scope)
                    .await
                    .map_err(from_domain)?;
                drop(lease_state);
                self.refresh_catalogue().await?;
                self.work().await
            }
        }
    }

    async fn event(&mut self, event: RealtimeEvent) -> Result<(), Stop> {
        match event {
            RealtimeEvent::Event(Event::Known(event)) => {
                let span = tracing::info_span!(
                    "slack.inbound.event",
                    account_id = %self.scope.account_id,
                    changes = tracing::field::Empty,
                );
                async {
                    let changes = inbound_changes(&event);
                    tracing::Span::current().record("changes", changes.len());
                    self.store(changes).await?;
                    if changes_catalogue(&event) {
                        self.refresh_catalogue().await?;
                    }
                    Ok(())
                }
                .instrument(span)
                .await
            }
            RealtimeEvent::Connected { .. } => self.catch_up().await,
            RealtimeEvent::SessionEnded { code } => {
                Err(ended_reason(&code).map_or(Stop::Exit(AccountExit::Failed), Stop::Ended))
            }
            RealtimeEvent::Event(_)
            | RealtimeEvent::Connecting { .. }
            | RealtimeEvent::Disconnected { .. } => Ok(()),
        }
    }

    /// Persist changes, then ingest everything queued.
    async fn store(&self, changes: Vec<InboundChange>) -> Result<(), Stop> {
        let sessions = &self.accounts.sessions;
        for change in &changes {
            sessions
                .enqueue_inbound(self.scope, change)
                .await
                .map_err(from_domain)?;
        }
        sessions
            .ingest_queued(self.scope)
            .await
            .map_err(from_domain)?;
        Ok(())
    }

    async fn work(&mut self) -> Result<(), Stop> {
        self.accounts
            .sessions
            .ingest_queued(self.scope)
            .await
            .map_err(from_domain)?;
        self.sends().await?;
        self.read_marks().await?;
        self.history().await?;
        self.media().await
    }

    /// Download the files of added chats this account observed.
    async fn media(&self) -> Result<(), Stop> {
        let sessions = &self.accounts.sessions;
        let claimed = sessions
            .claim_media(self.scope, 4)
            .await
            .map_err(from_domain)?;
        for import in claimed {
            let span = tracing::info_span!(
                "slack.media.import",
                account_id = %self.scope.account_id,
                chat_id = %import.attachment.chat_id,
                outcome = tracing::field::Empty,
            );
            async {
                let downloaded = match slack_client::FileId::new(import.file_id.clone()) {
                    Ok(file) => self.session.download(&file).await,
                    Err(_) => {
                        tracing::Span::current().record("outcome", "invalid_file");
                        return sessions
                            .fail_media(self.scope, &import.attachment, MediaFailure::Permanent)
                            .await
                            .map_err(from_domain);
                    }
                };
                match downloaded {
                    Ok(bytes) if bytes.len() <= MEDIA_LIMIT_BYTES => {
                        tracing::Span::current().record("outcome", "downloaded");
                        sessions
                            .complete_media(self.scope, &import.attachment, &bytes)
                            .await
                            .map_err(from_domain)
                    }
                    Ok(_) => {
                        tracing::Span::current().record("outcome", "too_large");
                        sessions
                            .fail_media(self.scope, &import.attachment, MediaFailure::Permanent)
                            .await
                            .map_err(from_domain)
                    }
                    Err(error) => {
                        if let Some(reason) = error.code().and_then(ended_reason) {
                            return Err(Stop::Ended(reason));
                        }
                        let permanent = error.code().is_some();
                        tracing::Span::current()
                            .record("outcome", if permanent { "failed" } else { "retry" });
                        sessions
                            .fail_media(
                                self.scope,
                                &import.attachment,
                                if permanent {
                                    MediaFailure::Permanent
                                } else {
                                    MediaFailure::Retry
                                },
                            )
                            .await
                            .map_err(from_domain)
                    }
                }
            }
            .instrument(span)
            .await?;
        }
        Ok(())
    }

    #[tracing::instrument(name = "slack.catalogue.refresh", skip_all, fields(account_id = %self.scope.account_id, conversations))]
    async fn refresh_catalogue(&self) -> Result<(), Stop> {
        let catalogue = self.session.catalogue().await.map_err(from_slack)?;
        tracing::Span::current().record("conversations", catalogue.conversations.len());
        self.accounts
            .sessions
            .replace_catalogue(self.scope, &catalogue)
            .await
            .map_err(from_domain)
    }

    /// What arrived while the websocket was down, in added chats.
    #[tracing::instrument(name = "slack.catch_up", skip_all, fields(account_id = %self.scope.account_id, chats, messages))]
    async fn catch_up(&self) -> Result<(), Stop> {
        let chats = self
            .accounts
            .sessions
            .observed_chats(self.scope)
            .await
            .map_err(from_domain)?;
        tracing::Span::current().record("chats", chats.len());
        let mut count = 0;
        for chat in chats {
            // A chat added moments ago has no position yet: its history import
            // brings it up to date.
            let Some(latest) = chat.latest_ts.as_deref() else {
                continue;
            };
            let conversation = stored(ChannelId::new(chat.conversation_id.clone()))?;
            let latest = stored(MessageTs::new(latest))?;
            let page = self
                .session
                .history(&conversation, Some(&latest), None, PAGE_SIZE)
                .await
                .map_err(from_slack)?;
            count += page.messages.len();
            let changes = self
                .with_threads(&chat.conversation_id, page.messages, IngestOrigin::Live)
                .await?;
            self.store(changes).await?;
        }
        tracing::Span::current().record("messages", count);
        Ok(())
    }

    /// Messages oldest first, each followed by its thread's replies.
    async fn with_threads(
        &self,
        conversation: &str,
        mut messages: Vec<Message>,
        origin: IngestOrigin,
    ) -> Result<Vec<InboundChange>, Stop> {
        messages.sort_by(|a, b| a.ts.cmp(&b.ts));
        let channel = stored(ChannelId::new(conversation))?;
        let mut changes = Vec::with_capacity(messages.len());
        for message in messages {
            let thread = message.reply_count.unwrap_or(0) > 0 && !message.is_thread_reply();
            let ts = message.ts.clone();
            changes.push(InboundChange::Message {
                conversation_id: conversation.to_owned(),
                message: inbound_message(&message),
                origin,
            });
            if thread {
                for reply in self
                    .session
                    .replies(&channel, &ts)
                    .await
                    .map_err(from_slack)?
                {
                    changes.push(InboundChange::Message {
                        conversation_id: conversation.to_owned(),
                        message: inbound_message(&reply),
                        origin,
                    });
                }
            }
        }
        Ok(changes)
    }

    async fn history(&self) -> Result<(), Stop> {
        let work = self
            .accounts
            .sessions
            .history_work(self.scope)
            .await
            .map_err(from_domain)?;
        for chat in work {
            self.history_page(chat).await?;
        }
        Ok(())
    }

    #[tracing::instrument(name = "slack.history.page", skip_all, fields(account_id = %self.scope.account_id, chat_id = %work.chat_id, messages, exhausted))]
    async fn history_page(&self, work: HistoryWork) -> Result<(), Stop> {
        let conversation = stored(ChannelId::new(work.conversation_id.clone()))?;
        let before = match work.before_ts.clone() {
            Some(before) => Some(stored(MessageTs::new(before))?),
            None => None,
        };
        let page = self
            .session
            .history(&conversation, None, before.as_ref(), PAGE_SIZE)
            .await
            .map_err(from_slack)?;
        let messages: Vec<Message> = page
            .messages
            .into_iter()
            .filter(|message| ts_time(message.ts.as_str()) >= work.not_before)
            .collect();
        let oldest = messages.iter().map(|message| message.ts.to_string()).min();
        let count = i32::try_from(messages.len()).unwrap_or(i32::MAX);
        let reached_limit = !page.has_more
            || messages.is_empty()
            || work.imported + count >= BACKFILL_MESSAGE_LIMIT;
        let span = tracing::Span::current();
        span.record("messages", count);
        span.record("exhausted", !page.has_more || messages.is_empty());
        let changes = self
            .with_threads(&work.conversation_id, messages, IngestOrigin::History)
            .await?;
        self.store(changes).await?;
        self.accounts
            .sessions
            .history_page(
                self.scope,
                work.chat_id,
                oldest.as_deref(),
                count,
                reached_limit && (!page.has_more || count == 0),
            )
            .await
            .map_err(from_domain)
    }

    async fn sends(&self) -> Result<(), Stop> {
        loop {
            let claimed = self
                .accounts
                .sessions
                .claim_sends(self.scope, self.accounts.config.send_batch)
                .await
                .map_err(from_domain)?;
            if claimed.is_empty() {
                return Ok(());
            }
            for send in claimed {
                let span = tracing::info_span!(
                    "slack.send.dispatch",
                    account_id = %self.scope.account_id,
                    send_id = %send.id,
                    chat_id = %send.chat_id,
                    outcome = tracing::field::Empty,
                );
                external_chat::signals::trace_context::adopt(&span, send.traceparent.as_deref());
                self.dispatch(send).instrument(span).await?;
            }
        }
    }

    async fn dispatch(&self, send: ClaimedSend) -> Result<(), Stop> {
        let sessions = &self.accounts.sessions;
        let client_msg_id = Uuid::now_v7();
        if !sessions
            .begin_dispatch(self.scope, send.id, &client_msg_id.to_string())
            .await
            .map_err(from_domain)?
        {
            tracing::Span::current().record("outcome", "not_allowed");
            return Ok(());
        }
        let request: SendReply = match serde_json::from_value(send.payload) {
            Ok(request) => request,
            Err(_) => {
                return self
                    .record(
                        send.id,
                        SendOutcome::Failed {
                            code: "invalid_payload".to_owned(),
                        },
                    )
                    .await;
            }
        };
        let (Ok(conversation), Ok(thread_ts), Ok(target_ts)) = (
            ChannelId::new(send.conversation_id.clone()),
            send.thread_ts.clone().map(MessageTs::new).transpose(),
            send.target_ts.clone().map(MessageTs::new).transpose(),
        ) else {
            return self
                .record(
                    send.id,
                    SendOutcome::Failed {
                        code: "invalid_target".to_owned(),
                    },
                )
                .await;
        };
        let conversation = &conversation;
        let result: Result<String, SlackError> = match (&request.message, target_ts.as_ref()) {
            (ReplyContent::Text { text, .. }, _) => {
                self.session
                    .post(conversation, text, thread_ts.as_ref(), client_msg_id)
                    .await
            }
            (
                ReplyContent::Mutation {
                    operation: Mutation::Edit,
                    text,
                    ..
                },
                Some(target),
            ) => {
                self.session
                    .update(conversation, target, text.as_deref().unwrap_or_default())
                    .await
            }
            (
                ReplyContent::Mutation {
                    operation: Mutation::Delete,
                    ..
                },
                Some(target),
            ) => self
                .session
                .delete(conversation, target)
                .await
                .map(|()| target.to_string()),
            (
                ReplyContent::Mutation {
                    operation: operation @ (Mutation::Reaction | Mutation::RemoveReaction),
                    text,
                    ..
                },
                Some(target),
            ) => {
                let Some(name) = text.as_deref().and_then(reaction_name) else {
                    return self
                        .record(
                            send.id,
                            SendOutcome::Failed {
                                code: "unsupported_emoji".to_owned(),
                            },
                        )
                        .await;
                };
                let add = *operation == Mutation::Reaction;
                self.session
                    .react(conversation, target, &name, add)
                    .await
                    .map(|()| now_ts())
            }
            (ReplyContent::Media { .. }, _) => {
                let file = sessions
                    .outbound_file(self.scope, send.id)
                    .await
                    .map_err(from_domain)?;
                self.session
                    .upload(&FileUpload {
                        channel: conversation.clone(),
                        thread_ts: thread_ts.clone(),
                        filename: file.filename,
                        title: None,
                        initial_comment: file.caption,
                        client_msg_id,
                        body: file.bytes.into(),
                    })
                    .await
            }
            (ReplyContent::Mutation { .. }, None) => {
                return self
                    .record(
                        send.id,
                        SendOutcome::Failed {
                            code: "target_unavailable".to_owned(),
                        },
                    )
                    .await;
            }
        };
        let outcome = match result {
            Ok(ts) => SendOutcome::Accepted { ts },
            Err(error) => {
                if let Some(reason) = error.code().and_then(ended_reason) {
                    self.record(send.id, SendOutcome::Unknown).await?;
                    return Err(Stop::Ended(reason));
                }
                match error.code() {
                    Some(code) => SendOutcome::Failed {
                        code: code.as_str().to_owned(),
                    },
                    // Cut off without an answer: never resent.
                    None => SendOutcome::Unknown,
                }
            }
        };
        self.record(send.id, outcome).await
    }

    async fn record(&self, send: Uuid, outcome: SendOutcome) -> Result<(), Stop> {
        let label = match &outcome {
            SendOutcome::Accepted { .. } => "accepted",
            SendOutcome::Failed { .. } => "failed",
            SendOutcome::Unknown => "unknown",
        };
        tracing::Span::current().record("outcome", label);
        tracing::info!(
            telemetry_event = "slack_send_outcome",
            outcome = label,
            "Slack send finished"
        );
        self.accounts
            .sessions
            .record_send_outcome(self.scope, send, &outcome)
            .await
            .map_err(from_domain)
    }

    async fn read_marks(&self) -> Result<(), Stop> {
        let marks = self
            .accounts
            .sessions
            .pending_read_marks(self.scope)
            .await
            .map_err(from_domain)?;
        for mark in marks {
            let conversation = stored(ChannelId::new(mark.conversation_id.clone()))?;
            let thread = match mark.thread_ts.clone() {
                Some(thread) => Some(stored(MessageTs::new(thread))?),
                None => None,
            };
            let read = stored(MessageTs::new(mark.ts.clone()))?;
            if let Err(error) = self
                .session
                .mark(&conversation, thread.as_ref(), &read)
                .await
            {
                if let Some(reason) = error.code().and_then(ended_reason) {
                    return Err(Stop::Ended(reason));
                }
                tracing::warn!(error = %error, "Marking a Slack conversation read failed");
            }
            self.accounts
                .sessions
                .read_mark_done(self.scope, &mark)
                .await
                .map_err(from_domain)?;
        }
        Ok(())
    }
}

/// A Slack-shaped timestamp for now, ordering a reaction made from Macro.
fn now_ts() -> String {
    let now = chrono::Utc::now();
    format!("{}.{:06}", now.timestamp(), now.timestamp_subsec_micros())
}

/// Whether a domain failure only means "try later".
pub fn is_fenced(result: &ExternalChatResult<()>) -> bool {
    matches!(result, Err(report) if matches!(report.current_context(), ExternalChatError::Fenced))
}
