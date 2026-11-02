//! One leased account: take the lease epoch, open the device, pair or
//! connect, ingest adopted-group traffic, dispatch sends, and hand the account
//! back cleanly.

use std::sync::Arc;
use std::time::Duration;

use external_chat::domain::models::ExternalChatError;
use external_chat::domain::ports::ExternalChatResult;
use tokio::sync::{Notify, Semaphore, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    ClaimedSend, Lease, OutgoingContent, PairingUpdate, PairingWork, SendOutcome, SessionScope,
};
use whatsapp_linked::domain::models::{AccountState, GroupInfo, PairingState};
use whatsapp_linked::domain::session::SessionService;

use super::inbound::InboundGate;
use super::media::{MEDIA_LIMIT_BYTES, MediaImports, TRANSFERS_PER_ACCOUNT};
use super::ports::{
    AccountControl, AccountExit, AccountRunner, AccountSignal, SendFailure, SessionConnector,
    SessionError, SessionEvent, Traced, UploadedMedia, WhatsAppSession,
};

mod backfill;
mod lookups;
#[cfg(test)]
mod test;

/// Most `replay_deferred` rounds per wake-up, so a large backlog cannot
/// starve signals and sends.
const REPLAY_ROUNDS: usize = 8;

/// Requested group refreshes (opening the WhatsApp page or a group) run at
/// most this often per account in production. Connecting always refreshes;
/// live group events update single groups in between.
pub const GROUPS_REFRESH_INTERVAL: Duration = Duration::from_secs(30);

/// Messages asked from the phone per page of a chat's earlier messages.
pub const BACKFILL_PAGE: u32 = 50;

/// A page request the phone has not answered after this is unanswered: the
/// import waits until the owner starts it again.
pub const BACKFILL_TIMEOUT: Duration = Duration::from_secs(60);

/// Timings and batch sizes for one account.
#[derive(Debug, Clone, Copy)]
pub struct AccountConfig {
    /// How long a submitted send may wait for the server's acknowledgement
    /// before its outcome is recorded as unknown.
    pub send_timeout: Duration,
    /// Sends claimed per round trip.
    pub send_batch: i64,
    /// How often to look for sends, deferred events and pairing expiry
    /// without a signal.
    pub tick_every: Duration,
    /// Least time between requested group refreshes
    /// ([`GROUPS_REFRESH_INTERVAL`] in production).
    pub groups_refresh_interval: Duration,
    /// [`BACKFILL_TIMEOUT`] in production.
    pub backfill_timeout: Duration,
}

/// Runs leased accounts against the linked-devices domain.
pub struct AccountSessions<Connector> {
    sessions: SessionService,
    connector: Connector,
    config: AccountConfig,
}

impl<Connector: SessionConnector> AccountSessions<Connector> {
    /// Wires the domain service and the WhatsApp connector.
    pub fn new(sessions: SessionService, connector: Connector, config: AccountConfig) -> Self {
        AccountSessions {
            sessions,
            connector,
            config,
        }
    }
}

/// How the event loop should continue.
enum Next {
    Continue,
    Exit(AccountExit),
}

fn is_fenced(report: &rootcause::Report<ExternalChatError>) -> bool {
    matches!(report.current_context(), ExternalChatError::Fenced)
}

/// Fenced ends the account; any other domain error is logged and survived.
fn survive<Value>(
    result: ExternalChatResult<Value>,
    step: &'static str,
) -> Result<Option<Value>, AccountExit> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(report) if is_fenced(&report) => Err(AccountExit::Fenced),
        Err(report) => {
            tracing::warn!(
                step,
                code = report.current_context().code(),
                error = %report,
                "WhatsApp account step failed"
            );
            Ok(None)
        }
    }
}

impl<Connector: SessionConnector> AccountRunner for AccountSessions<Connector> {
    async fn run(&self, account: Uuid, control: AccountControl) -> AccountExit {
        let lease = match self.sessions.begin_lease(account).await {
            Ok(lease) => lease,
            Err(report) if matches!(report.current_context(), ExternalChatError::NotFound) => {
                return AccountExit::Idle;
            }
            Err(report) => {
                tracing::warn!(
                    account_id = %account,
                    code = report.current_context().code(),
                    error = %report,
                    "Taking the WhatsApp account lease failed"
                );
                return AccountExit::Failed;
            }
        };
        let pairing = match survive(
            self.sessions.live_pairing(lease.scope).await,
            "live_pairing",
        ) {
            Ok(Some(pairing)) => pairing,
            Ok(None) => return AccountExit::Failed,
            Err(exit) => return exit,
        };
        // A `pairing` account without a live transaction has nothing to show.
        if lease.state != AccountState::Connected && pairing.is_none() {
            return AccountExit::Idle;
        }
        let connect_span = tracing::info_span!(
            "whatsapp.account.connect",
            account_id = %account,
            lease_epoch = lease.scope.lease_epoch,
            paired = tracing::field::Empty,
            fresh_device = tracing::field::Empty,
            pairing = pairing.is_some(),
            outcome = tracing::field::Empty,
        );
        // Linked, not parented: the session outlives the signal that started it.
        connect_span.follows_from(&control.cause);
        let gate = Arc::new(InboundGate::new(self.sessions.clone(), lease.scope));
        let opened = self
            .open(&lease, pairing.as_ref(), Arc::clone(&gate))
            .instrument(connect_span.clone())
            .await;
        connect_span.record(
            "outcome",
            match &opened {
                Ok(Some(_)) => "connecting",
                Ok(None) => "idle",
                Err(AccountExit::Fenced) => "fenced",
                Err(AccountExit::Idle) => "device_unreadable",
                Err(_) => "failed",
            },
        );
        let (session, events) = match opened {
            Ok(Some(opened)) => opened,
            Ok(None) => return AccountExit::Idle,
            Err(exit) => return exit,
        };
        let session = Arc::new(session);
        let transfers = Arc::new(Semaphore::new(TRANSFERS_PER_ACCOUNT));
        let media_wake = Arc::new(Notify::new());
        let (connected, connected_receiver) = watch::channel(false);
        let media_stop = CancellationToken::new();
        // Aborted if this runner is: the import loop never outlives it.
        let imports = tokio_util::task::AbortOnDropHandle::new(tokio::spawn(
            MediaImports {
                sessions: self.sessions.clone(),
                scope: lease.scope,
                session: Arc::clone(&session),
                transfers: Arc::clone(&transfers),
                wake: Arc::clone(&media_wake),
                connected: connected_receiver,
                every: self.config.tick_every,
                fenced: gate.fenced.clone(),
            }
            .run(media_stop.clone()),
        ));
        let mut running = Running {
            sessions: &self.sessions,
            config: self.config,
            scope: lease.scope,
            session,
            gate,
            transfers,
            media_wake,
            connected,
            pairing,
            reconnecting: false,
            groups_refreshed_at: None,
            release: control.release.clone(),
            stop: control.stop.clone(),
        };
        let exit = running.serve(events, control).await;
        media_stop.cancel();
        if exit == AccountExit::Stopped {
            imports.abort();
        }
        match imports.await {
            Err(error) if error.is_panic() => {
                tracing::error!(error = %error, "The WhatsApp attachment import loop panicked");
            }
            Ok(()) | Err(_) => {}
        }
        exit
    }
}

impl<Connector: SessionConnector> AccountSessions<Connector> {
    /// Opens the device and starts connecting, or `None` when an unpaired
    /// device has no pairing transaction to serve. Pairing an account that
    /// is not connected starts from a fresh device: the old one was logged
    /// out or disconnected and its keys are useless.
    ///
    /// A stored device that can never be read again (KMS lost its data key)
    /// is replaced when pairing, once. Without a pairing, a connected account
    /// with such a device is recorded as logged out, so its owner is asked to
    /// reconnect. A KMS outage replaces nothing: the account fails, and the
    /// next rescan tries again.
    async fn open(
        &self,
        lease: &Lease,
        pairing: Option<&PairingWork>,
        gate: Arc<InboundGate>,
    ) -> Result<Option<(Connector::Session, mpsc::UnboundedReceiver<SessionEvent>)>, AccountExit>
    {
        let mut fresh_device = pairing.is_some() && lease.state != AccountState::Connected;
        let mut replaced = false;
        let (session, events) = loop {
            match self
                .connector
                .open(lease.scope, fresh_device, gate.clone())
                .await
            {
                Ok(opened) => break opened,
                Err(SessionError::Fenced) => return Err(AccountExit::Fenced),
                Err(SessionError::DeviceUnreadable) if pairing.is_some() && !replaced => {
                    tracing::warn!(
                        fresh_device,
                        "The stored WhatsApp device cannot be read; pairing a fresh one"
                    );
                    fresh_device = true;
                    replaced = true;
                }
                Err(SessionError::DeviceUnreadable) if pairing.is_none() => {
                    tracing::error!(
                        "The stored WhatsApp device cannot be read; the owner must reconnect"
                    );
                    survive(self.sessions.logged_out(lease.scope).await, "logged_out")?;
                    return Err(AccountExit::Idle);
                }
                Err(error) => {
                    tracing::error!(error = %error, "Opening the WhatsApp device failed");
                    return Err(AccountExit::Failed);
                }
            }
        };
        tracing::Span::current().record("fresh_device", fresh_device);
        let paired = session.identity_jid().await.is_some();
        tracing::Span::current().record("paired", paired);
        if !paired {
            if pairing.is_none() {
                return Ok(None);
            }
            if let Err(error) = session.start_pairing().await {
                tracing::error!(error = %error, "Starting WhatsApp pairing failed");
                return Err(AccountExit::Failed);
            }
        }
        if let Err(error) = session.connect().await {
            tracing::error!(error = %error, "Connecting to WhatsApp failed");
            session.disconnect().await;
            return Err(AccountExit::Failed);
        }
        Ok(Some((session, events)))
    }
}

struct Running<'service, Session> {
    sessions: &'service SessionService,
    config: AccountConfig,
    scope: SessionScope,
    session: Arc<Session>,
    /// Stores adopted-group events from the client and filters the rest.
    gate: Arc<InboundGate>,
    /// Upload and download slots shared with the import loop.
    transfers: Arc<Semaphore>,
    /// Wakes the import loop after ingestion.
    media_wake: Arc<Notify>,
    connected: watch::Sender<bool>,
    pairing: Option<PairingWork>,
    reconnecting: bool,
    /// When the group list was last read, for rate limiting requested refreshes.
    groups_refreshed_at: Option<tokio::time::Instant>,
    /// The runner's release and stop requests, checked between sends.
    release: CancellationToken,
    stop: CancellationToken,
}

impl<Session: WhatsAppSession> Running<'_, Session> {
    fn is_connected(&self) -> bool {
        *self.connected.borrow()
    }

    async fn serve(
        &mut self,
        mut events: mpsc::UnboundedReceiver<SessionEvent>,
        mut control: AccountControl,
    ) -> AccountExit {
        let gate = Arc::clone(&self.gate);
        let mut tick = tokio::time::interval(self.config.tick_every);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let exit = loop {
            let next = tokio::select! {
                biased;
                () = control.stop.cancelled() => Next::Exit(AccountExit::Stopped),
                () = control.release.cancelled() => Next::Exit(self.release().await),
                () = gate.fenced.cancelled() => Next::Exit(AccountExit::Fenced),
                () = gate.queued.notified() => {
                    let result = self.replay().await;
                    self.exit_on(result)
                }
                event = events.recv() => match event {
                    Some(event) => self.on_event(event).await,
                    None => Next::Exit(AccountExit::Failed),
                },
                Some(signal) = control.signals.recv() => self.on_signal(signal).await,
                _ = tick.tick() => self.on_tick().await,
            };
            if let Next::Exit(exit) = next {
                break exit;
            }
        };
        if exit != AccountExit::Released {
            self.session.disconnect().await;
        }
        exit
    }

    /// Drain: no new sends, disconnect, and hand undispatched claims back.
    async fn release(&mut self) -> AccountExit {
        self.session.disconnect().await;
        match survive(
            self.sessions.release_lease(self.scope).await,
            "release_lease",
        ) {
            Ok(_) => AccountExit::Released,
            Err(exit) => exit,
        }
    }

    fn exit_on(&self, result: Result<(), AccountExit>) -> Next {
        match result {
            Ok(()) => Next::Continue,
            Err(exit) => Next::Exit(exit),
        }
    }

    async fn on_event(&mut self, event: SessionEvent) -> Next {
        match event {
            SessionEvent::Qr(code) => {
                let result = self.update_pairing(PairingUpdate::Qr(code)).await;
                self.exit_on(result)
            }
            SessionEvent::PairSuccess { identity_jid } => {
                let result = self
                    .update_pairing(PairingUpdate::Success { identity_jid })
                    .await;
                self.exit_on(result)
            }
            SessionEvent::PasskeyRequested { challenge } => {
                let result = self
                    .update_pairing(PairingUpdate::Passkey { challenge })
                    .await;
                self.exit_on(result)
            }
            SessionEvent::PasskeyConfirmation { code } => {
                let result = self.confirm_passkey(code).await;
                self.exit_on(result)
            }
            SessionEvent::PairExpired => self.end_pairing(PairingUpdate::Expired).await,
            SessionEvent::PairFailed => self.end_pairing(PairingUpdate::Failed).await,
            SessionEvent::Connected => {
                if self.reconnecting {
                    tracing::info!(
                        telemetry_event = "whatsapp_session_reconnect",
                        account_id = %self.scope.account_id,
                        "WhatsApp session reconnected"
                    );
                }
                self.connected.send_replace(true);
                self.reconnecting = false;
                let result = self.on_connected().await;
                self.exit_on(result)
            }
            SessionEvent::Disconnected => {
                self.connected.send_replace(false);
                self.reconnecting = true;
                Next::Continue
            }
            SessionEvent::LoggedOut => {
                match survive(self.sessions.logged_out(self.scope).await, "logged_out") {
                    Ok(_) => Next::Exit(AccountExit::Idle),
                    Err(exit) => Next::Exit(exit),
                }
            }
            SessionEvent::Replaced => {
                tracing::error!(
                    account_id = %self.scope.account_id,
                    "Another WhatsApp connection replaced this account's session"
                );
                Next::Exit(AccountExit::Failed)
            }
            SessionEvent::Chats(chats) => {
                let result = survive(
                    self.sessions.update_chats(self.scope, &chats).await,
                    "update_chats",
                )
                .map(drop);
                self.exit_on(result)
            }
            SessionEvent::HistoryPage(page) => {
                let result = Box::pin(self.history_page(&page)).await;
                self.exit_on(result)
            }
            SessionEvent::GroupChanged { group_jid, info } => {
                let result = self.group_changed(&group_jid, info.map(|info| *info)).await;
                self.exit_on(result)
            }
        }
    }

    /// A live group event: store that group's current metadata, or that the
    /// account is no longer in it.
    async fn group_changed(
        &mut self,
        group_jid: &str,
        info: Option<GroupInfo>,
    ) -> Result<(), AccountExit> {
        let span = tracing::info_span!(
            "whatsapp.groups.event",
            account_id = %self.scope.account_id,
            outcome = tracing::field::Empty,
        );
        async {
            let info = match info {
                Some(info) => Some(info),
                None => match self.session.group(group_jid).await {
                    Ok(info) => info,
                    Err(SessionError::Fenced) => return Err(AccountExit::Fenced),
                    Err(error) => {
                        tracing::Span::current().record("outcome", "read_failed");
                        tracing::warn!(error = %error, "Reading a changed WhatsApp group failed");
                        return Ok(());
                    }
                },
            };
            match info {
                Some(info) => {
                    tracing::Span::current().record("outcome", "updated");
                    survive(
                        self.sessions.update_group(self.scope, &info).await,
                        "update_group",
                    )?;
                }
                None => {
                    tracing::Span::current().record("outcome", "left");
                    survive(
                        self.sessions
                            .group_left(self.scope, group_jid, chrono::Utc::now())
                            .await,
                        "group_left",
                    )?;
                    self.gate.reload().await;
                }
            }
            Ok(())
        }
        .instrument(span)
        .await
    }

    /// Handles a signal inside a child of the notification's span, so the
    /// sender's trace continues into what it caused here.
    async fn on_signal(&mut self, Traced { signal, span }: Traced<AccountSignal>) -> Next {
        let handling = tracing::info_span!(
            parent: &span,
            "whatsapp.account.signal",
            account_id = %self.scope.account_id,
            signal = ?signal,
        );
        let result = async {
            match signal {
                AccountSignal::Pairing(pairing) => self.check_pairing(pairing).await,
                AccountSignal::Send => self.dispatch_sends().await,
                AccountSignal::Groups => self.requested_refresh().await,
                AccountSignal::Lookup => self.answer_lookups().await,
                AccountSignal::History => Box::pin(self.backfill()).await,
                AccountSignal::Changed => self.account_changed().await,
                AccountSignal::Resync => self.resync().await,
            }
        }
        .instrument(handling)
        .await;
        self.exit_on(result)
    }

    async fn on_tick(&mut self) -> Next {
        let result = async {
            if let Some(pairing) = self.pairing.as_ref().map(|pairing| pairing.id) {
                self.check_pairing(pairing).await?;
            }
            self.replay().await?;
            if self.is_connected() {
                self.dispatch_sends().await?;
                self.answer_lookups().await?;
                Box::pin(self.backfill()).await?;
            }
            Ok(())
        }
        .await;
        self.exit_on(result)
    }

    async fn resync(&mut self) -> Result<(), AccountExit> {
        if let Some(pairing) = self.pairing.as_ref().map(|pairing| pairing.id) {
            self.check_pairing(pairing).await?;
        }
        self.replay().await?;
        if self.is_connected() {
            self.gate.reload().await;
            self.refresh_groups().await?;
            self.dispatch_sends().await?;
        }
        Ok(())
    }

    /// Ingests what the gate queued (and deferred events now due), then lets
    /// the import loop look for new attachments.
    async fn replay(&mut self) -> Result<(), AccountExit> {
        for _ in 0..REPLAY_ROUNDS {
            match survive(
                self.sessions.replay_deferred(self.scope).await,
                "replay_deferred",
            )? {
                Some(applied) if applied > 0 => {}
                _ => break,
            }
        }
        self.media_wake.notify_one();
        Ok(())
    }

    async fn on_connected(&mut self) -> Result<(), AccountExit> {
        if let Some(pairing) = self.pairing.clone()
            && let Some(identity_jid) = self.session.identity_jid().await
        {
            // A reconnect of an already paired device completes its pairing.
            if pairing.state != PairingState::Success {
                self.update_pairing(PairingUpdate::Success { identity_jid })
                    .await?;
            }
        }
        self.gate.reload().await;
        self.refresh_groups().await?;
        self.replay().await?;
        self.dispatch_sends().await?;
        self.answer_lookups().await?;
        // An import the owner started while the connection was down.
        Box::pin(self.backfill()).await
    }

    /// The phone shows a code: surface it on the pairing row, then confirm.
    async fn confirm_passkey(&mut self, code: String) -> Result<(), AccountExit> {
        self.update_pairing(PairingUpdate::PairCode(code)).await?;
        if let Err(error) = self.session.confirm_passkey().await {
            tracing::warn!(error = %error, "Confirming the WhatsApp passkey pairing failed");
            self.update_pairing(PairingUpdate::Failed).await?;
        }
        Ok(())
    }

    /// Reports pairing progress; a terminal transaction ends the account.
    async fn update_pairing(&mut self, update: PairingUpdate) -> Result<(), AccountExit> {
        let Some(pairing) = self.pairing.as_ref().map(|pairing| pairing.id) else {
            return Ok(());
        };
        let success = matches!(update, PairingUpdate::Success { .. });
        match self
            .sessions
            .update_pairing(self.scope, pairing, update)
            .await
        {
            Ok(work) => self.after_pairing(work).await,
            Err(report) if is_fenced(&report) => Err(AccountExit::Fenced),
            Err(report) if success => {
                // The phone paired as someone it must not be: unlink the device.
                tracing::warn!(
                    code = report.current_context().code(),
                    "WhatsApp pairing rejected; logging the device out"
                );
                self.session.logout().await;
                Err(AccountExit::Idle)
            }
            Err(report) => {
                tracing::warn!(
                    code = report.current_context().code(),
                    error = %report,
                    "Recording WhatsApp pairing progress failed"
                );
                Ok(())
            }
        }
    }

    async fn check_pairing(&mut self, pairing: Uuid) -> Result<(), AccountExit> {
        match survive(self.sessions.pairing_work(pairing).await, "pairing_work")? {
            Some(Some(work)) if work.account_id == self.scope.account_id => {
                let pending_response = work.passkey_response.is_some();
                self.after_pairing(work).await?;
                if pending_response {
                    self.forward_passkey(pairing).await?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// WhatsApp ended the pairing; the session goes idle until the next one.
    async fn end_pairing(&mut self, update: PairingUpdate) -> Next {
        match self.update_pairing(update).await {
            Ok(()) => Next::Exit(AccountExit::Idle),
            Err(exit) => Next::Exit(exit),
        }
    }

    /// Hands the owner's passkey assertion to WhatsApp, once.
    async fn forward_passkey(&mut self, pairing: Uuid) -> Result<(), AccountExit> {
        let Some(Some(response)) = survive(
            self.sessions
                .take_passkey_response(self.scope, pairing)
                .await,
            "take_passkey_response",
        )?
        else {
            return Ok(());
        };
        if let Err(error) = self.session.send_passkey_response(response).await {
            tracing::warn!(error = %error, "Forwarding the WhatsApp passkey assertion failed");
            self.update_pairing(PairingUpdate::Failed).await?;
        }
        Ok(())
    }

    async fn after_pairing(&mut self, work: PairingWork) -> Result<(), AccountExit> {
        match work.state {
            PairingState::Waiting | PairingState::Qr | PairingState::Passkey => {
                self.pairing = Some(work);
                Ok(())
            }
            PairingState::Success => {
                self.pairing = None;
                Ok(())
            }
            PairingState::Cancelled => {
                self.pairing = None;
                if self.session.identity_jid().await.is_some() && !self.is_connected() {
                    self.session.logout().await;
                }
                if self.is_connected() {
                    Ok(())
                } else {
                    Err(AccountExit::Idle)
                }
            }
            PairingState::Expired | PairingState::Failed => {
                self.pairing = None;
                if self.is_connected() {
                    Ok(())
                } else {
                    Err(AccountExit::Idle)
                }
            }
        }
    }

    /// Consent or adopted groups changed. An owner who disconnected asked for
    /// the device to be unlinked at WhatsApp.
    async fn account_changed(&mut self) -> Result<(), AccountExit> {
        match self.sessions.account_state(self.scope.account_id).await {
            Ok(Some(AccountState::Disconnected)) => {
                self.session.logout().await;
                Err(AccountExit::Idle)
            }
            Ok(Some(AccountState::LoggedOut) | None) => Err(AccountExit::Idle),
            Ok(Some(AccountState::Pairing | AccountState::Connected)) => {
                self.gate.reload().await;
                Ok(())
            }
            Err(report) => {
                tracing::warn!(error = %report, "Reading the WhatsApp account state failed");
                self.gate.reload().await;
                Ok(())
            }
        }
    }

    /// A page asked for fresh groups: refresh unless that happened recently.
    async fn requested_refresh(&mut self) -> Result<(), AccountExit> {
        if self
            .groups_refreshed_at
            .is_some_and(|at| at.elapsed() < self.config.groups_refresh_interval)
        {
            tracing::debug!(
                account_id = %self.scope.account_id,
                "WhatsApp group refresh skipped: refreshed recently"
            );
            return Ok(());
        }
        self.refresh_groups().await
    }

    async fn refresh_groups(&mut self) -> Result<(), AccountExit> {
        if !self.is_connected() {
            return Ok(());
        }
        self.groups_refreshed_at = Some(tokio::time::Instant::now());
        let span = tracing::info_span!(
            "whatsapp.groups.refresh",
            account_id = %self.scope.account_id,
            count = tracing::field::Empty,
        );
        async {
            match self.session.joined_groups().await {
                Ok(groups) => {
                    tracing::Span::current().record("count", groups.len());
                    survive(
                        self.sessions.update_groups(self.scope, &groups, true).await,
                        "update_groups",
                    )?;
                    Ok(())
                }
                Err(SessionError::Fenced) => Err(AccountExit::Fenced),
                Err(error) => {
                    tracing::warn!(error = %error, "Listing WhatsApp groups failed");
                    Ok(())
                }
            }
        }
        .instrument(span)
        .await
    }

    /// Claims pending sends and dispatches them one at a time, in group order.
    async fn dispatch_sends(&mut self) -> Result<(), AccountExit> {
        if !self.is_connected() {
            return Ok(());
        }
        loop {
            let Some(claimed) = survive(
                self.sessions
                    .claim_sends(self.scope, self.config.send_batch)
                    .await,
                "claim_sends",
            )?
            else {
                return Ok(());
            };
            if claimed.is_empty() {
                return Ok(());
            }
            for send in &claimed {
                // Claims not dispatched yet go back on release or takeover.
                if self.release.is_cancelled() || self.stop.is_cancelled() {
                    return Ok(());
                }
                self.dispatch(send).await?;
            }
        }
    }

    /// Uploads a media send's attachment, before the point of no return. A
    /// failed upload reached nobody, so the send is recorded rejected.
    async fn upload(
        &mut self,
        send: &ClaimedSend,
    ) -> Result<Result<Option<UploadedMedia>, &'static str>, AccountExit> {
        if !matches!(send.content, OutgoingContent::Media { .. }) {
            return Ok(Ok(None));
        }
        let Some(media) = survive(
            self.sessions.outbound_media(self.scope, send.id).await,
            "outbound_media",
        )?
        else {
            return Ok(Err("media_unavailable"));
        };
        if media.bytes.len() as u64 > MEDIA_LIMIT_BYTES {
            return Ok(Err("media_too_large"));
        }
        let Ok(_permit) = self.transfers.acquire().await else {
            return Ok(Err("media_upload_failed"));
        };
        Ok(match self.session.upload_media(&media).await {
            Ok(uploaded) => Ok(Some(uploaded)),
            Err(SendFailure::Rejected(code)) => Err(code),
            Err(SendFailure::Unknown) => Err("media_upload_failed"),
        })
    }

    async fn dispatch(&mut self, send: &ClaimedSend) -> Result<(), AccountExit> {
        let span = tracing::info_span!(
            "whatsapp.send.dispatch",
            account_id = %self.scope.account_id,
            send_id = %send.id,
            chat_sequence = send.chat_sequence,
            outcome = tracing::field::Empty,
        );
        // The dispatch joins the trace of the request that recorded the send.
        external_chat::signals::trace_context::adopt(&span, send.traceparent.as_deref());
        async {
            let uploaded = self.upload(send).await?;
            let message_id = self.session.new_message_id().await;
            // Recorded before submission: from here on the send is never retried.
            if survive(
                self.sessions
                    .begin_dispatch(self.scope, send.id, &message_id)
                    .await,
                "begin_dispatch",
            )?
            .is_none()
            {
                return Ok(());
            }
            let submitted = match &uploaded {
                Ok(media) => {
                    tokio::time::timeout(
                        self.config.send_timeout,
                        self.session.send(send, &message_id, media.as_ref()),
                    )
                    .await
                }
                Err(code) => Ok(Err(SendFailure::Rejected(code))),
            };
            let (outcome, name) = match submitted {
                Ok(Ok(server_at)) => (SendOutcome::Accepted { server_at }, "sent"),
                Ok(Err(SendFailure::Rejected(code))) => (
                    SendOutcome::Rejected {
                        code: code.to_owned(),
                    },
                    "failed",
                ),
                Ok(Err(SendFailure::Unknown)) | Err(_) => (SendOutcome::Unknown, "unknown"),
            };
            tracing::Span::current().record("outcome", name);
            tracing::info!(
                telemetry_event = "whatsapp_send_outcome",
                account_id = %self.scope.account_id,
                send_id = %send.id,
                outcome = name,
                "WhatsApp send finished"
            );
            survive(
                self.sessions
                    .record_send_outcome(self.scope, send.id, outcome)
                    .await,
                "record_send_outcome",
            )?;
            Ok(())
        }
        .instrument(span)
        .await
    }
}
