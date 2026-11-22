//! Small ports for account persistence, credential encryption and mail protocols.
use super::models::*;
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Whether an organization write failed before transport admission or after it
/// could have changed provider state. Only admission refusal can be retried.
#[derive(Debug, thiserror::Error)]
pub enum ApplyError {
    /// No command session was admitted and no provider mutation was attempted.
    #[error("organization write not started: {0}")]
    NotStarted(Error),
    /// Provider I/O began; the operation must not be replayed on a busy error.
    #[error("organization write outcome: {0}")]
    Uncertain(Error),
}
impl ApplyError {
    pub(crate) fn into_error(self) -> Error {
        match self {
            Self::NotStarted(error) => error,
            Self::Uncertain(Error::AccountBusy) => Error::ConnectionUnavailable,
            Self::Uncertain(error) => error,
        }
    }
}

/// A scoped snapshot, optionally carrying a fenced command lease. The service never exposes ciphertext.
pub struct Account {
    /// Exact access binding.
    pub binding: Binding,
    /// Credential owner.
    pub user_id: String,
    /// Context-bound KMS ciphertext.
    pub ciphertext: Vec<u8>,
    /// Serialized engine state.
    pub state: AccountState,
    /// Hashes of rows loaded by this operation, for bounded differential persistence.
    pub checkpoint: std::collections::BTreeMap<(String, String), [u8; 32]>,
    /// Current compare-and-swap revision.
    pub revision: i64,
    /// Distributed write lease; None is a read-only snapshot.
    pub lease_id: Option<Uuid>,
}

/// The bounded facts needed by one use case; only synchronization loads the full index.
#[derive(Debug, Clone)]
pub enum StateSelection {
    /// Full metadata snapshot for a synchronization pass.
    Sync,
    /// Small folder catalog and health only.
    Catalog,
    /// One logical message and its remote locations.
    Message(String),
    /// Latest inbox messages, capped by the domain.
    Recent(u32),
    /// One editable draft, its uploads and optional reply parent.
    Draft {
        /// Stable draft identity.
        id: String,
        /// Optional message whose thread is inherited.
        reply_to: Option<String>,
    },
    /// One upload and its owning draft.
    Upload(Uuid),
    /// One folder page, with a stable initial key or journal sequence.
    Changes {
        /// Folder whose indexed entries are read.
        folder: String,
        /// Initial scan key; None selects incremental journal records.
        after: Option<String>,
        /// Previously committed journal sequence.
        sequence: u64,
    },
}

/// Short-lived encrypted verification row.
pub struct VerifiedAccount {
    /// Public promotion token.
    pub verification: Verification,
    /// Original owner.
    pub user_id: String,
    /// Encrypted settings, bound to the verification id.
    pub ciphertext: Vec<u8>,
    /// Link that already consumed this token, for idempotent retries.
    pub consumed_by: Option<Uuid>,
}

/// Persistence mechanics, independent from the use-case policy.
#[async_trait::async_trait]
pub trait Repository: Send + Sync {
    /// Atomically admit verification before attempting any upstream login.
    async fn admit_verification(&self, scopes: &[(String, i32)]) -> Result<(), Error>;
    /// Restore bounded per-host timing evidence, without retaining the hostname.
    async fn idle_state(
        &self,
        host_hash: &str,
    ) -> Result<Option<super::adaptive_idle::IdleState>, Error>;
    /// Store the pure learner state after an observed IDLE session.
    async fn save_idle_state(
        &self,
        host_hash: &str,
        state: &super::adaptive_idle::IdleState,
    ) -> Result<(), Error>;
    /// Claim or renew a long-lived connection owner, separately from command leases.
    async fn claim_owner(&self, binding: Binding, owner: Uuid) -> Result<bool, Error>;
    /// Relinquish this exact owner only after closing its sockets.
    async fn release_owner(&self, binding: Binding, owner: Uuid) -> Result<(), Error>;
    /// Save a new expiring verification.
    async fn put_verification(&self, value: VerifiedAccount) -> Result<(), Error>;
    /// Load a verification, including a prior consumption marker.
    async fn verification(&self, id: Uuid) -> Result<VerifiedAccount, Error>;
    /// Atomically promote the verification into its one link.
    async fn connect(
        &self,
        binding: Binding,
        user_id: &str,
        ciphertext: Vec<u8>,
        verification: Uuid,
    ) -> Result<(), Error>;
    /// Read only encrypted credentials for an already fenced connection owner.
    async fn credentials(&self, binding: Binding) -> Result<(String, Vec<u8>), Error>;
    /// Claim one account for a bounded operation, checking both generations.
    async fn acquire(&self, binding: Binding) -> Result<Account, Error>;
    /// Acquire only the facts required by one operation.
    async fn acquire_scoped(
        &self,
        binding: Binding,
        _selection: StateSelection,
    ) -> Result<Account, Error> {
        self.acquire(binding).await
    }
    /// Read one consistent snapshot without taking a command lease. Release the
    /// database transaction before returning; remote content IO happens later.
    async fn read_scoped(
        &self,
        binding: Binding,
        selection: StateSelection,
    ) -> Result<Account, Error>;
    /// Recheck the original owner, active state and generations after remote IO.
    async fn validate_read(&self, account: &Account) -> Result<(), Error>;
    /// Persist under the lease and increment the expected revision.
    async fn save(&self, account: &mut Account) -> Result<(), Error>;
    /// Persist only health and admission scalars, without revisiting the loaded index.
    async fn save_health(&self, account: &mut Account) -> Result<(), Error> {
        self.save(account).await
    }
    /// Renew a long-running remote operation without rewriting mailbox state.
    async fn renew(&self, account: &Account) -> Result<(), Error>;
    /// Release this exact lease without overwriting a successor's work.
    async fn release(&self, account: &Account) -> Result<(), Error>;
    /// Idempotently delete the account when its binding still matches.
    async fn delete(&self, binding: Binding) -> Result<(), Error>;
    /// Current bindings for the scheduler, bounded by instance capacity.
    async fn bindings(&self, limit: i64, retained_links: &[Uuid]) -> Result<Vec<Binding>, Error>;
}

/// Password encryption; associated context prevents row substitution.
#[async_trait::async_trait]
pub trait CredentialCipher: Send + Sync {
    /// Encrypt the encoded credentials, bound to this object and owner.
    async fn encrypt(&self, id: Uuid, owner: &str, value: &Credentials) -> Result<Vec<u8>, Error>;
    /// Decrypt only for its original object and owner.
    async fn decrypt(&self, id: Uuid, owner: &str, ciphertext: &[u8])
    -> Result<Credentials, Error>;
}

/// A server folder and the data needed to diff its complete UID set.
pub struct RemoteFolder {
    /// Gmail label represented by this feed, including the read-only All Mail marker.
    pub virtual_label: Option<String>,
    /// Last observed UIDNEXT in this folder epoch.
    pub uid_next: Option<u32>,
    /// Repeated tagged SELECT refusal metadata.
    pub phantom: Option<super::folder_health::PhantomFolder>,
    /// Physical server role before owner preferences.
    pub detected_role: Option<FolderRole>,
    /// Whether a body/header scan was permitted for this folder.
    pub monitored: bool,
    /// Logical folder metadata.
    pub folder: Folder,
    /// Original IMAP name.
    pub path: String,
    /// UIDVALIDITY from SELECT.
    pub uid_validity: u32,
    /// Server highest MODSEQ after this pass.
    pub highest_modseq: Option<u64>,
    /// Capability-selected tier.
    pub sync_tier: SyncTier,
    /// Current messages in UID order.
    pub messages: Vec<RemoteMessage>,
}

/// Remote message facts. All identifiers remain scoped by their owning folder.
#[derive(Clone)]
pub struct RemoteMessage {
    /// Raw Gmail labels; None selects ordinary folder semantics.
    pub gmail_labels: Option<Vec<String>>,
    /// UID.
    pub uid: u32,
    /// Flags, including keywords.
    pub flags: Vec<String>,
    /// Header source used for indexing without downloading bodies.
    pub mime: std::sync::Arc<[u8]>,
    /// Server RFC822.SIZE, used with headers/date for move identity.
    pub size: u32,
    /// Server INTERNALDATE.
    pub received_at: DateTime<Utc>,
    /// Server MODSEQ, if available.
    pub modseq: Option<u64>,
    /// Gmail's immutable message id, when available.
    pub gmail_message_id: Option<u64>,
    /// Native RFC8474 EMAILID, already wrapped in an opaque provider id.
    pub native_message_id: Option<String>,
    /// Native RFC8474 THREADID or Gmail X-GM-THRID.
    pub native_thread_id: Option<String>,
}

/// SMTP result plus an account-wide deadline penalty hint, independent of public delivery outcome.
#[derive(Debug, Clone)]
pub struct TransportSubmission {
    /// Definitive acknowledgment or uncertain acceptance.
    pub outcome: SubmissionOutcome,
    /// The configured submission deadline expired, requiring a ten-minute account penalty.
    pub deadline_exceeded: bool,
}

/// Native mapping from an acknowledged organization write.
#[derive(Debug, Clone, Default)]
pub struct RemoteWriteReceipt {
    /// Destination UIDVALIDITY and UID when UIDPLUS returned COPYUID.
    pub destination_uid: Option<(u32, u32)>,
}

/// The supported safe IMAP write vocabulary; no caller supplies a raw command.
pub enum RemoteAction {
    /// Apply only if the server supports the observed MODSEQ (never interpolate an unchecked token).
    IfUnchanged {
        /// Observed server MODSEQ.
        modseq: u64,
        /// Desired operation.
        action: Box<RemoteAction>,
    },
    /// Set or clear one validated flag.
    Flag {
        /// Validated standard flag.
        flag: String,
        /// Whether the flag should be present.
        enabled: bool,
    },
    /// Replace user keywords, retaining standard system flags.
    Keywords(Vec<String>),
    /// Change only catalog-resolved Gmail labels, retaining other system labels.
    GmailLabels {
        /// Labels to add, except the read-only All Mail marker.
        add: Vec<String>,
        /// Labels to remove.
        remove: Vec<String>,
    },
    /// Move to a catalog-resolved folder.
    Move(String),
}

/// Why a bounded folder watch ended successfully.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum WaitOutcome {
    /// The selected status or an unsolicited response differs from the committed snapshot.
    Changed,
    /// The absolute liveness interval elapsed; this is not a provider failure.
    Restarted,
}

/// Mail protocol operations. Object safety lets the service share a pooled transport.
#[async_trait::async_trait]
pub trait MailTransport: Send + Sync {
    /// Reclaim expired spare sockets during the scheduler's bounded maintenance interval.
    async fn maintenance(&self) {}
    /// Close cached authenticated sockets for a retired binding.
    async fn disconnect(&self, binding: Binding) -> Result<(), Error>;
    /// Verify both endpoints without saving credentials or sending a message.
    async fn verify(&self, credentials: &Credentials) -> Result<(), Error>;
    /// Verify both endpoints and capture safe, optionally supported capability information.
    async fn verify_features(
        &self,
        credentials: &Credentials,
    ) -> Result<Option<super::server_features::ServerFeatures>, Error> {
        self.verify(credentials).await?;
        Ok(None)
    }
    /// Read a complete, bounded set of remote folders and UID facts.
    async fn snapshot(
        &self,
        credentials: &Credentials,
        known: &AccountState,
    ) -> Result<Vec<RemoteFolder>, Error>;
    /// Read one current header/organization snapshot without downloading its body.
    async fn message(
        &self,
        credentials: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
    ) -> Result<Option<RemoteMessage>, Error>;
    /// Download one source lazily, validating the folder epoch before reading bytes.
    async fn source(
        &self,
        credentials: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
    ) -> Result<Vec<u8>, Error>;
    /// Compare the selected folder to committed catalog state before arming IDLE.
    /// A planned absolute restart is successful even while the server sends keepalives.
    async fn wait_change(
        &self,
        credentials: &Credentials,
        committed: &[FolderState],
        idle_seconds: u64,
    ) -> Result<WaitOutcome, Error>;
    /// Watch one catalog-resolved extra folder, never a caller-provided unscoped name.
    async fn wait_folder(
        &self,
        credentials: &Credentials,
        committed: &FolderState,
        idle_seconds: u64,
    ) -> Result<WaitOutcome, Error>;
    /// Apply an organization operation to one account-scoped UID.
    /// NotStarted is permitted only before command-session admission; once any
    /// mutation can have started, every failure must be Uncertain.
    async fn apply(
        &self,
        credentials: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
        action: RemoteAction,
    ) -> Result<RemoteWriteReceipt, ApplyError>;
    /// SMTP submit once. The caller persisted Unknown before invoking this.
    /// Preserve the admission deadline through every pre-body connection attempt.
    async fn submit(
        &self,
        credentials: &Credentials,
        from: &str,
        recipients: &[String],
        mime: &[u8],
        pre_body_deadline: tokio::time::Instant,
    ) -> Result<TransportSubmission, Error>;
    /// Reconcile Sent by Message-ID; only the durably admitted first attempt may APPEND.
    /// False preserves pending reconciliation and the readable fallback without another APPEND.
    /// With `allow_append = false`, true requires one exact Message-ID in an existing Sent folder.
    async fn save_sent(
        &self,
        credentials: &Credentials,
        message_id: &str,
        mime: &[u8],
        allow_append: bool,
    ) -> Result<bool, Error>;
}

/// Link-scoped wakeup publication after a committed journal or credential health change.
#[async_trait::async_trait]
pub trait Notifier: Send + Sync {
    /// Notify the email domain without including any mail or credential content.
    async fn notify(&self, notification: Notification) -> Result<(), Error>;
}
