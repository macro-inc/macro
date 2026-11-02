//! What the supervisor and the account runner need from the outside: account
//! locks, the account directory, a runner per leased account, and the
//! account's WhatsApp connection.

use std::future::Future;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use whatsapp_linked::domain::events::{
    ChatUpdate, ClaimedSend, HistoryPage, InboundEvent, LookupAnswer, MediaImport, MessageAnchor,
    OutboundMedia, SessionScope,
};
use whatsapp_linked::domain::jid::PhoneNumber;
use whatsapp_linked::domain::models::GroupInfo;

/// Errors from taking, holding or announcing account locks.
#[derive(Debug, thiserror::Error)]
pub enum LeaseError {
    /// The lock connection is gone, so every lock it held may already be free.
    #[error("the account lock connection was lost")]
    Lost,
    /// Any other storage failure.
    #[error("account lease storage failed: {0}")]
    Internal(rootcause::Report),
}

/// Session-level advisory locks, one per account, held by this replica.
pub trait AccountLocks: Send + Sync + 'static {
    /// Takes the account's lock without waiting. `false` when another replica
    /// holds it.
    fn try_lock(&self, account: Uuid) -> impl Future<Output = Result<bool, LeaseError>> + Send;

    /// Releases a lock this replica holds.
    fn unlock(&self, account: Uuid) -> impl Future<Output = Result<(), LeaseError>> + Send;

    /// Cancelled as soon as the locks may be gone. Accounts must stop at once.
    fn lost(&self) -> CancellationToken;
}

/// Finds accounts that need a replica and tells other replicas about releases.
pub trait AccountDirectory: Send + Sync + 'static {
    /// Accounts that need a session (connected, or with a live pairing
    /// transaction) and that no replica holds, oldest first.
    fn candidates(&self, limit: u32) -> impl Future<Output = Result<Vec<Uuid>, LeaseError>> + Send;

    /// The account a pairing transaction belongs to.
    fn pairing_account(
        &self,
        pairing: Uuid,
    ) -> impl Future<Output = Result<Option<Uuid>, LeaseError>> + Send;

    /// `NOTIFY whatsapp_account_released`: the account still needs a session
    /// and is free to take.
    fn announce_released(
        &self,
        account: Uuid,
    ) -> impl Future<Output = Result<(), LeaseError>> + Send;

    /// Fleet-wide facts for the periodic health report.
    fn health(&self) -> impl Future<Output = Result<FleetHealth, LeaseError>> + Send;
}

/// Fleet-wide facts every replica reports once a minute.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FleetHealth {
    /// Accounts that need a session but whose lock no replica holds.
    pub accounts_unowned: u64,
    /// Age of the oldest inbound event still waiting to be applied.
    pub oldest_unprocessed_inbound_seconds: u64,
}

/// A signal for one account this replica runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountSignal {
    /// `whatsapp_pairing_requested`: a pairing transaction started or changed.
    Pairing(Uuid),
    /// `whatsapp_send_requested`: claim pending sends.
    Send,
    /// `whatsapp_roster_requested`: refresh the group list.
    Groups,
    /// `whatsapp_lookup_requested`: answer pending phone-number lookups.
    Lookup,
    /// `whatsapp_history_requested`: the owner started importing earlier
    /// messages.
    History,
    /// `whatsapp_account_changed`: consent or adopted groups changed.
    Changed,
    /// Notifications may have been missed; re-read everything.
    Resync,
}

/// A signal and the span of the notification it came from, so the work it
/// causes continues the sender's trace. Signals without one (rescans,
/// resyncs) carry [`tracing::Span::none`].
#[derive(Debug, Clone)]
pub struct Traced<SignalKind> {
    /// The signal.
    pub signal: SignalKind,
    /// `whatsapp.signal.receive` of the notification, or none.
    pub span: tracing::Span,
}

impl<SignalKind> From<SignalKind> for Traced<SignalKind> {
    fn from(signal: SignalKind) -> Self {
        Traced {
            signal,
            span: tracing::Span::none(),
        }
    }
}

/// What a runner receives for its account.
pub struct AccountControl {
    /// Signals for this account, coalesced when the runner is busy.
    pub signals: mpsc::Receiver<Traced<AccountSignal>>,
    /// The span that started the runner (a notification, a rescan); the
    /// account's connect span links to it.
    pub cause: tracing::Span,
    /// Graceful release (drain): stop taking sends, wait for in-flight
    /// acknowledgements, disconnect, then return [`AccountExit::Released`].
    pub release: CancellationToken,
    /// Hard stop: the lock is gone. Return without another write.
    pub stop: CancellationToken,
}

/// Why a runner returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountExit {
    /// Nothing to run: no session and no live pairing. Not announced.
    Idle,
    /// Released on request while the account still needs a session.
    Released,
    /// Another replica took the account over.
    Fenced,
    /// Stopped by `stop`.
    Stopped,
    /// Gave up after an error. Not announced, so a failing account doesn't
    /// bounce between replicas; the next rescan retries it.
    Failed,
}

/// Runs one account for as long as this replica holds its lock.
pub trait AccountRunner: Send + Sync + 'static {
    /// Runs `account` until it is idle, released, fenced or stopped.
    fn run(
        &self,
        account: Uuid,
        control: AccountControl,
    ) -> impl Future<Output = AccountExit> + Send;
}

/// What happened on an account's WhatsApp connection, already mapped onto
/// the linked-devices domain types. Group traffic does not come this way: it
/// goes straight to the [`InboundSink`] so it is stored before it is acked.
#[derive(Debug, Clone)]
pub enum SessionEvent {
    /// A new QR code to show.
    Qr(String),
    /// Pairing finished as this phone-number identity.
    PairSuccess {
        /// Verified phone-number JID of the linked account.
        identity_jid: String,
    },
    /// WhatsApp's QR codes ran out before one was scanned.
    PairExpired,
    /// Pairing failed.
    PairFailed,
    /// WhatsApp asked for a passkey assertion; `challenge` is the WebAuthn
    /// request options to show the owner.
    PasskeyRequested {
        /// WebAuthn request options.
        challenge: serde_json::Value,
    },
    /// The phone shows a code the owner must compare before the passkey
    /// pairing is confirmed.
    PasskeyConfirmation {
        /// Code to show next to the one on the phone.
        code: String,
    },
    /// Connected and authenticated.
    Connected,
    /// The websocket dropped; the client reconnects by itself.
    Disconnected,
    /// WhatsApp logged the device out or rejected its credentials.
    LoggedOut,
    /// Another connection with the same keys replaced this one.
    Replaced,
    /// What WhatsApp told the account about chats in its list (history sync,
    /// a message, a contact name, archive or pin).
    Chats(Vec<ChatUpdate>),
    /// The phone answered a request for a chat's earlier messages; the
    /// messages themselves went to the [`InboundSink`] as history.
    HistoryPage(HistoryPage),
    /// The account joined a group, or a group's name or participants changed.
    GroupChanged {
        /// The group.
        group_jid: String,
        /// Its full metadata when the event carried it (joining); otherwise
        /// the runner reads it.
        info: Option<Box<GroupInfo>>,
    },
}

/// Where the client hands group events before acknowledging them.
///
/// Object safe (`Arc<dyn InboundSink>` inside the client's event handler),
/// hence `async_trait`.
#[async_trait::async_trait]
pub trait InboundSink: Send + Sync {
    /// Stores the event (or drops it when its group is not adopted). `false`
    /// leaves the protocol node unacknowledged so WhatsApp redelivers it.
    /// Must never wait on the account's WhatsApp connection.
    async fn accept(&self, event: &InboundEvent) -> bool;
}

/// Errors opening or driving a WhatsApp session.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    /// Another replica took the account over.
    #[error("the account lease moved to another replica")]
    Fenced,
    /// KMS could not be reached right now; opening again later can succeed.
    #[error("KMS is unavailable for the account's data key")]
    KmsUnavailable,
    /// The stored device can never be read again (KMS refused its data key,
    /// or it does not decrypt). Only a fresh device, and so a new pairing,
    /// helps.
    #[error("the account's stored WhatsApp device cannot be read")]
    DeviceUnreadable,
    /// Any other failure.
    #[error("WhatsApp session failed: {0}")]
    Internal(rootcause::Report),
}

/// Why a send did not get an acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendFailure {
    /// WhatsApp refused it; nothing reached the group.
    Rejected(&'static str),
    /// It may have reached WhatsApp.
    Unknown,
}

/// Why an attachment could not be downloaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadFailure {
    /// Try again later (network, not connected, rate limited).
    Retryable,
    /// Never downloadable (expired, tampered, too large, unreadable locator).
    Permanent,
}

/// An attachment uploaded to WhatsApp's media hosts, ready to reference
/// from one message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadedMedia {
    /// Media host URL.
    pub url: String,
    /// Path on the media host.
    pub direct_path: String,
    /// Key the file was encrypted with.
    pub media_key: Vec<u8>,
    /// SHA-256 of the encrypted file.
    pub file_enc_sha256: Vec<u8>,
    /// SHA-256 of the plaintext.
    pub file_sha256: Vec<u8>,
    /// Plaintext length.
    pub file_length: u64,
}

/// One account's WhatsApp connection.
pub trait WhatsAppSession: Send + Sync + 'static {
    /// The device's phone-number JID once paired.
    fn identity_jid(&self) -> impl Future<Output = Option<String>> + Send;

    /// Starts emitting [`SessionEvent::Qr`] codes; call before `connect` on an
    /// unpaired device.
    fn start_pairing(&self) -> impl Future<Output = Result<(), SessionError>> + Send;

    /// Forwards the owner's WebAuthn assertion for a passkey pairing.
    fn send_passkey_response(
        &self,
        response: serde_json::Value,
    ) -> impl Future<Output = Result<(), SessionError>> + Send;

    /// Confirms a passkey pairing once its code was shown.
    fn confirm_passkey(&self) -> impl Future<Output = Result<(), SessionError>> + Send;

    /// Connects in the background, reconnecting by itself until `disconnect`.
    fn connect(&self) -> impl Future<Output = Result<(), SessionError>> + Send;

    /// A fresh WhatsApp message id for the next send.
    fn new_message_id(&self) -> impl Future<Output = String> + Send;

    /// Encrypts and uploads an attachment for a later send.
    fn upload_media(
        &self,
        media: &OutboundMedia,
    ) -> impl Future<Output = Result<UploadedMedia, SendFailure>> + Send;

    /// Sends one claimed intent with `message_id` and waits for the server's
    /// acknowledgement, returning its timestamp. A media send carries the
    /// attachment it uploaded first.
    fn send(
        &self,
        send: &ClaimedSend,
        message_id: &str,
        media: Option<&UploadedMedia>,
    ) -> impl Future<Output = Result<DateTime<Utc>, SendFailure>> + Send;

    /// Downloads and decrypts an observed attachment from its sealed locator.
    fn download_media(
        &self,
        import: &MediaImport,
    ) -> impl Future<Output = Result<Vec<u8>, DownloadFailure>> + Send;

    /// Full metadata for every group the account is in.
    fn joined_groups(&self) -> impl Future<Output = Result<Vec<GroupInfo>, SessionError>> + Send;

    /// Full metadata for one group, or `None` when the account is not in it
    /// (left, removed, or the group is gone).
    fn group(
        &self,
        group_jid: &str,
    ) -> impl Future<Output = Result<Option<GroupInfo>, SessionError>> + Send;

    /// Asks the account's phone for up to `count` messages of a chat older
    /// than `before`; the answer arrives later as a history page.
    fn request_history(
        &self,
        chat_jid: &str,
        before: &MessageAnchor,
        count: u32,
    ) -> impl Future<Output = Result<(), SessionError>> + Send;

    /// Asks the account's phone to send one message again (one the device
    /// saw but did not keep); it arrives as a history message.
    fn request_message(
        &self,
        chat_jid: &str,
        message: &MessageAnchor,
    ) -> impl Future<Output = Result<(), SessionError>> + Send;

    /// Asks WhatsApp whether a phone number has an account (one usync
    /// query; it records the number's LID pairing in the LID store).
    fn look_up(
        &self,
        phone: &PhoneNumber,
    ) -> impl Future<Output = Result<LookupAnswer, SessionError>> + Send;

    /// Unlinks the device at WhatsApp.
    fn logout(&self) -> impl Future<Output = ()> + Send;

    /// Closes the connection without unlinking.
    fn disconnect(&self) -> impl Future<Output = ()> + Send;
}

/// Opens an account's device store and WhatsApp client.
pub trait SessionConnector: Send + Sync + 'static {
    /// The connection type.
    type Session: WhatsAppSession;

    /// Opens the session for the holder of `scope`'s epoch. With
    /// `fresh_device`, a stored device is deleted first and new keys are
    /// generated. Group events go to `inbound`; the rest arrive on the
    /// returned receiver, which never makes the client wait.
    fn open(
        &self,
        scope: SessionScope,
        fresh_device: bool,
        inbound: Arc<dyn InboundSink>,
    ) -> impl Future<
        Output = Result<(Self::Session, mpsc::UnboundedReceiver<SessionEvent>), SessionError>,
    > + Send;
}
