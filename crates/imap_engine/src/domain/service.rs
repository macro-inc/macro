//! Link ownership, credential promotion, journal sync and exactly-once send admission.
use super::{models::*, ports::*};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{Duration, Utc};
use email_api_client::domain::models::{MessageAction, SendRequest};
use macro_user_id::{cowlike::ArcCowStr, email::Email};
use mailparse::MailHeaderMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
mod recent;
use uuid::Uuid;

const PAGE_SIZE: usize = 500;
const MAX_ATTACHMENT: usize = 25 * 1024 * 1024;

#[derive(Clone, Copy, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum AdmissionOutcome {
    Admitted,
    #[strum(serialize = "admission_unavailable")]
    Unavailable,
    #[strum(serialize = "admission_timeout")]
    Timeout,
    #[strum(serialize = "admission_cancelled")]
    Cancelled,
}

/// Engine orchestrator. Authorization and state transitions live here, not in HTTP handlers.
pub struct Engine {
    repository: Arc<dyn Repository>,
    cipher: Arc<dyn CredentialCipher>,
    transport: Arc<dyn MailTransport>,
    settings: Option<Arc<dyn super::account_settings::SettingsRepository>>,
    notifier: Option<Arc<dyn Notifier>>,
    discovery: Option<Arc<dyn super::discovery::DiscoveryProvider>>,
    idle_policy: std::sync::Mutex<super::adaptive_idle::IdlePolicy>,
    operation_capacity: tokio::sync::Semaphore,
    operation_waiting: std::sync::atomic::AtomicUsize,
    ingestion_capacity: tokio::sync::Semaphore,
    ingestion_waiting: std::sync::atomic::AtomicUsize,
    import_capacity: tokio::sync::Semaphore,
    import_waiting: std::sync::atomic::AtomicUsize,
    wakeups: std::sync::Mutex<BTreeMap<Uuid, (Uuid, Arc<tokio::sync::Notify>)>>,
    synchronization_capacity: tokio::sync::Semaphore,
    synchronization_waiting: std::sync::atomic::AtomicUsize,
}
impl Engine {
    /// Construct with replaceable infrastructure ports.
    pub fn new(
        repository: Arc<dyn Repository>,
        cipher: Arc<dyn CredentialCipher>,
        transport: Arc<dyn MailTransport>,
    ) -> Self {
        Self {
            repository,
            notifier: None,
            settings: None,
            discovery: None,
            operation_capacity: tokio::sync::Semaphore::new(16),
            operation_waiting: Default::default(),
            ingestion_capacity: tokio::sync::Semaphore::new(4),
            ingestion_waiting: Default::default(),
            import_capacity: tokio::sync::Semaphore::new(2),
            import_waiting: Default::default(),
            wakeups: Default::default(),
            synchronization_capacity: tokio::sync::Semaphore::new(usize::from(
                SyncConcurrency::DEFAULT.get(),
            )),
            synchronization_waiting: Default::default(),
            idle_policy: std::sync::Mutex::new(super::adaptive_idle::IdlePolicy::new()),
            cipher,
            transport,
        }
    }

    /// Set the bounded sync concurrency at composition, without reducing account coverage.
    pub fn with_sync_concurrency(mut self, concurrency: SyncConcurrency) -> Self {
        self.synchronization_capacity = tokio::sync::Semaphore::new(usize::from(concurrency.get()));
        self
    }

    /// Attach owner-scoped folder/server settings at the composition boundary.
    pub fn with_settings(
        mut self,
        settings: Arc<dyn super::account_settings::SettingsRepository>,
    ) -> Self {
        self.settings = Some(settings);
        self
    }
    /// Read sanitized setup and routing preferences for this exact live binding.
    pub async fn account_mail_settings(
        &self,
        binding: Binding,
    ) -> Result<super::account_settings::AccountMailSettings, Error> {
        let settings = self.settings.as_ref().ok_or(Error::ConnectionUnavailable)?;
        let (owner, ciphertext) = settings.credentials_for_settings(binding).await?;
        let credentials = self
            .cipher
            .decrypt(binding.link_id, &owner, &ciphertext)
            .await?;
        let preferences = settings.preferences(binding).await?;
        let folders = settings.folders(binding).await?;
        super::account_settings::AccountMailSettings::new(&credentials, folders, &preferences)
    }
    /// Conditionally change only roles/watches belonging to this mailbox catalog.
    pub async fn update_mail_settings(
        &self,
        binding: Binding,
        input: super::account_settings::UpdateFolderSettings,
    ) -> Result<super::account_settings::AccountMailSettings, Error> {
        let settings = self.settings.as_ref().ok_or(Error::ConnectionUnavailable)?;
        let _ = settings.credentials_for_settings(binding).await?;
        let folders = settings.folders(binding).await?;
        input.validate(folders.iter().map(|entry| &entry.folder))?;
        settings.update(binding, &input).await?;
        self.wake_account(binding.link_id);
        self.account_mail_settings(binding).await
    }

    /// Attach the durable-journal wakeup delivery port at the composition boundary.
    pub fn with_notifier(mut self, notifier: Arc<dyn Notifier>) -> Self {
        self.notifier = Some(notifier);
        self
    }

    /// Attach password-free live discovery at the composition root.
    pub fn with_discovery(
        mut self,
        discovery: Arc<dyn super::discovery::DiscoveryProvider>,
    ) -> Self {
        self.discovery = Some(discovery);
        self
    }
    /// Pure embedded-catalog discovery, also used when no network adapter is configured.
    pub fn discover(email: &Email<ArcCowStr<'_>>) -> Result<Discovery, Error> {
        super::discovery::discover(email)
    }
    /// Password-free discovery through catalog, MX, ISPDB and guarded advertisements.
    pub async fn discover_remote(&self, email: &Email<ArcCowStr<'_>>) -> Result<Discovery, Error> {
        match &self.discovery {
            Some(discovery) => discovery.discover(email).await,
            None => Self::discover(email),
        }
    }
    /// Probe and encrypt credentials, bound to an authenticated owner and expiry.
    #[tracing::instrument(skip_all, err)]
    pub async fn verify(&self, input: VerifyRequest) -> Result<Verification, Error> {
        if input.user_id.is_empty()
            || input.imap.password.0.len() > 1024
            || input.smtp.password.0.len() > 1024
        {
            return Err(Error::Invalid);
        }
        if !input.confirmed_hosts.contains(&input.imap.endpoint.host)
            || !input.confirmed_hosts.contains(&input.smtp.endpoint.host)
        {
            return Err(Error::Forbidden);
        }
        let mut scopes = vec![(
            format!("{:x}", Sha256::digest(format!("owner:{}", input.user_id))),
            10,
        )];
        for endpoint in [&input.imap.endpoint, &input.smtp.endpoint] {
            scopes.push((
                format!(
                    "{:x}",
                    Sha256::digest(format!("host:{}", endpoint.host.to_ascii_lowercase()))
                ),
                1000,
            ));
            scopes.push((
                format!(
                    "{:x}",
                    Sha256::digest(format!(
                        "login:{}:{}",
                        endpoint.host.to_ascii_lowercase(),
                        endpoint.username
                    ))
                ),
                10,
            ));
        }
        scopes.sort_by(|a, b| a.0.cmp(&b.0));
        scopes.dedup_by(|a, b| a.0 == b.0);
        self.repository.admit_verification(&scopes).await?;
        let mut credentials = Credentials {
            features: None,
            binding: None,
            user_id: input.user_id.clone(),
            email: input.email.0.as_ref().to_owned(),
            imap: input.imap,
            smtp: input.smtp,
        };
        credentials.features = self.transport.verify_features(&credentials).await?;
        let verification = Verification {
            id: Uuid::now_v7(),
            expires_at: Utc::now() + Duration::minutes(15),
        };
        let ciphertext = self
            .cipher
            .encrypt(verification.id, &input.user_id, &credentials)
            .await?;
        self.repository
            .put_verification(VerifiedAccount {
                verification: verification.clone(),
                user_id: input.user_id,
                ciphertext,
                consumed_by: None,
            })
            .await?;
        Ok(verification)
    }
    /// Promote only the original owner's verification and re-encrypt under the permanent link context.
    #[tracing::instrument(skip_all, fields(link_id = %link), err)]
    pub async fn connect(&self, link: Uuid, input: ConnectRequest) -> Result<Binding, Error> {
        let v = self.repository.verification(input.verification_id).await?;
        if v.user_id != input.owner_user_id
            || (v.verification.expires_at <= Utc::now() && v.consumed_by != Some(link))
            || v.consumed_by.is_some_and(|other| other != link)
        {
            return Err(Error::Forbidden);
        }
        let binding = Binding {
            link_id: link,
            sync_generation: input.sync_generation,
            grant_generation: input.grant_generation,
        };
        if v.consumed_by == Some(link) {
            self.repository
                .connect(binding, &v.user_id, Vec::new(), input.verification_id)
                .await?;
            return Ok(binding);
        }
        let mut credentials = self
            .cipher
            .decrypt(v.verification.id, &v.user_id, &v.ciphertext)
            .await?;
        credentials.binding = Some(binding);
        let ciphertext = self.cipher.encrypt(link, &v.user_id, &credentials).await?;
        let binding = Binding {
            link_id: link,
            sync_generation: input.sync_generation,
            grant_generation: input.grant_generation,
        };
        self.repository
            .connect(binding, &v.user_id, ciphertext, input.verification_id)
            .await?;
        Ok(binding)
    }
    /// Disconnect only this exact credential generation. Stored secrets are deleted, not revoked upstream.
    pub async fn delete(&self, binding: Binding) -> Result<(), Error> {
        self.transport.disconnect(binding).await?;
        self.repository.delete(binding).await
    }
    /// Current scheduler work, already filtered to active links.
    pub async fn bindings(&self, retained_links: &[Uuid]) -> Result<Vec<Binding>, Error> {
        self.report_admission_saturation();
        self.transport.maintenance().await;
        self.repository.bindings(2000, retained_links).await
    }

    /// Execute an operation using the trusted caller's workload class.
    #[tracing::instrument(skip_all, fields(operation.busy_retry_count = tracing::field::Empty), err)]
    pub async fn execute_in_class(
        &self,
        binding: Binding,
        operation: Operation,
        class: OperationClass,
    ) -> Result<Value, Error> {
        if let Operation::RecentInbox { limit } = operation {
            return self.recent_inbox(binding, limit, class).await;
        }
        let retryable = (operation.access() == OperationAccess::Read
            && !matches!(&operation, Operation::RecentInbox { .. }))
            || matches!(&operation, Operation::Apply { .. });
        if !retryable {
            return self
                .execute_with_owner(binding, operation, class, None)
                .await;
        }
        let result = self
            .execute_with_owner(binding, operation.clone(), class, None)
            .await;
        if matches!(&result, Err(Error::AccountBusy)) {
            // The first attempt has dropped its global slot and DB snapshot.
            // Give a short burst one retry without holding either resource.
            // Apply only propagates AccountBusy before its first provider write;
            // Submit and all other command operations are excluded.
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let result = self
                .execute_with_owner(binding, operation, class, None)
                .await;
            tracing::Span::current().record("operation.busy_retry_count", 1i64);
            result
        } else {
            tracing::Span::current().record("operation.busy_retry_count", 0i64);
            result
        }
    }

    async fn execute_owned_sync(
        &self,
        binding: Binding,
        owner: Uuid,
        stopped: &tokio_util::sync::CancellationToken,
    ) -> Result<(), Error> {
        self.execute_with_owner(
            binding,
            Operation::Sync,
            OperationClass::Interactive,
            Some((owner, stopped.clone())),
        )
        .await
        .map(|_| ())
    }

    #[tracing::instrument(skip_all, name = "execute", fields(link_id = %binding.link_id), err)]
    async fn execute_with_owner(
        &self,
        binding: Binding,
        operation: Operation,
        class: OperationClass,
        owner: Option<(Uuid, tokio_util::sync::CancellationToken)>,
    ) -> Result<Value, Error> {
        let synchronizing = matches!(operation, Operation::Sync);
        let reading = operation.access() == OperationAccess::Read;
        let submission_deadline = tokio::time::Instant::now() + SUBMISSION_PRE_BODY_BUDGET;
        let stopped = owner
            .as_ref()
            .map(|(_, stopped)| stopped.clone())
            .unwrap_or_default();
        let capacity = tokio::select! {
            biased;
            _ = stopped.cancelled() => return Err(Error::Conflict),
            capacity = self.admit_capacity(&operation, class, submission_deadline) => capacity?,
        };
        let mut account = None;
        let work = async {
            // A queued actor must still own the connection immediately before
            // loading state and opening a provider session.
            if let Some((owner, _)) = owner
                && !self.repository.claim_owner(binding, owner).await?
            {
                return Err(Error::Conflict);
            }
            let selection = sync::selection(&operation)?;
            // Drain acquisition before observing owner cancellation, so a command
            // lease returned by the repository always reaches fenced cleanup.
            account = Some(if reading {
                self.repository.read_scoped(binding, selection).await?
            } else {
                self.repository.acquire_scoped(binding, selection).await?
            });
            let account = account.as_mut().ok_or(Error::ConnectionUnavailable)?;
            if account.state.needs_reauth {
                return Err(Error::CredentialsRejected);
            }
            tokio::select! {
                biased;
                _ = stopped.cancelled() => Err(Error::Conflict),
                result = self.execute_leased(account, operation, submission_deadline) => result,
            }
        };
        let result = if synchronizing {
            match tokio::time::timeout(SYNC_ROUND_BUDGET, work).await {
                Ok(result) => result,
                Err(_) => {
                    tracing::warn!(
                        sync.deadline_exceeded = true,
                        "IMAP synchronization work exceeded its budget"
                    );
                    Err(Error::ConnectionUnavailable)
                }
            }
        } else {
            work.await
        };
        // Release the expensive sync slot before bounded lease cleanup; queued
        // accounts must not wait for another account's cleanup query.
        if synchronizing {
            drop(capacity);
        }
        let Some(account) = account else {
            return result;
        };
        if reading {
            // The snapshot/connection is already released before MIME IO. Check
            // authorization again before exposing the settled result.
            self.repository.validate_read(&account).await?;
            return result;
        }
        let release = self.repository.release(&account).await;
        match result {
            Ok(value) => {
                release?;
                Ok(value)
            }
            Err(error) => Err(error),
        }
    }

    /// Execute user work, or the actor's separately admitted synchronization.
    pub async fn execute(&self, binding: Binding, operation: Operation) -> Result<Value, Error> {
        self.execute_in_class(binding, operation, OperationClass::Interactive)
            .await
    }
    async fn refresh(&self, a: &mut Account) -> Result<(), Error> {
        let c = self
            .cipher
            .decrypt(a.binding.link_id, &a.user_id, &a.ciphertext)
            .await?;
        let remote = self.transport.snapshot(&c, &a.state).await?;
        merge_snapshot(&mut a.state, remote)?;
        a.state.notification_pending = true;
        self.repository.save(a).await?;
        self.reconcile_sent(a, &c).await?;
        self.notify(a).await
    }

    async fn read_message(&self, a: &Account, id: &str) -> Result<Option<Message>, Error> {
        let Some(mut message) = a.state.messages.get(id).cloned() else {
            return Ok(None);
        };
        if !message.source_complete {
            if message.size > MAX_MESSAGE_SOURCE_BYTES {
                return Err(Error::MessageTooLarge);
            }
            let location = a
                .state
                .locations
                .iter()
                .find(|l| l.message_id == id && l.folder_id == message.folder_id)
                .filter(|l| l.uid > 0)
                .ok_or(Error::ConnectionUnavailable)?;
            let folder = a
                .state
                .folders
                .get(&location.folder_id)
                .ok_or(Error::NotFound)?;
            let credentials = self
                .cipher
                .decrypt(a.binding.link_id, &a.user_id, &a.ciphertext)
                .await?;
            let source = self
                .transport
                .source(
                    &credentials,
                    &folder.path,
                    location.uid_validity,
                    location.uid,
                )
                .await?;
            if source.len()
                > usize::try_from(MAX_MESSAGE_SOURCE_BYTES).map_err(|_| Error::Invalid)?
            {
                return Err(Error::MessageTooLarge);
            }
            message.classification = Some(super::bounce::classify(&source));
            message.mime_base64 = STANDARD.encode(source);
            message.source_complete = true;
        }
        Ok(Some(message))
    }
    async fn notify(&self, a: &mut Account) -> Result<(), Error> {
        if !a.state.notification_pending {
            return Ok(());
        }
        if let Some(notifier) = &self.notifier {
            match notifier
                .notify(Notification {
                    binding: a.binding,
                    credentials_rejected: a.state.needs_reauth,
                })
                .await
            {
                Ok(()) => {
                    a.state.notification_pending = false;
                    self.repository.save_health(a).await?;
                }
                Err(error) => tracing::warn!(?error, "IMAP wakeup remains pending"),
            }
        }
        Ok(())
    }
    async fn execute_leased(
        &self,
        a: &mut Account,
        op: Operation,
        submission_deadline: tokio::time::Instant,
    ) -> Result<Value, Error> {
        match op {
            Operation::Folders => {
                if a.state.folders.is_empty() {
                    return Err(Error::ConnectionUnavailable);
                }
                value(
                    a.state
                        .folders
                        .values()
                        .map(|f| f.folder.clone())
                        .collect::<Vec<_>>(),
                )
            }
            Operation::Sync => {
                self.refresh(a).await?;
                Ok(Value::Null)
            }
            Operation::Changes { folder, position } => {
                value(changes(&a.state, &folder, position.as_deref())?)
            }
            Operation::Message { id } => value(self.read_message(a, &id).await?),
            Operation::Organization { id } => value(a.state.messages.get(&id)),
            // Batch contention retries retain completed bodies outside the
            // global slot; execute_in_class dispatches this separate use case.
            Operation::RecentInbox { .. } => Err(Error::Invalid),
            Operation::Attachment { id, part } => {
                let m = self.read_message(a, &id).await?.ok_or(Error::NotFound)?;
                let raw = STANDARD
                    .decode(&m.mime_base64)
                    .map_err(|_| Error::ConnectionUnavailable)?;
                let parsed = mailparse::parse_mail(&raw).map_err(|_| Error::Invalid)?;
                let indexes = part
                    .split('.')
                    .map(|s| s.parse::<usize>().map_err(|_| Error::Invalid))
                    .collect::<Result<Vec<_>, _>>()?;
                if indexes.len() > 32 {
                    return Err(Error::Invalid);
                }
                let mut p = &parsed;
                for index in indexes {
                    if index == 0 && part == "0" {
                        continue;
                    }
                    p = p
                        .subparts
                        .get(index.checked_sub(1).ok_or(Error::Invalid)?)
                        .ok_or(Error::NotFound)?;
                }
                value(p.get_body_raw().map_err(|_| Error::Invalid)?)
            }
            Operation::Apply { id, request } => self.apply_organization(a, id, request).await,
            Operation::GetDraft { id } => {
                if a.state
                    .drafts
                    .get(&id)
                    .is_some_and(|d| d.submission == Some(SubmissionOutcome::Unknown))
                {
                    let credentials = self
                        .cipher
                        .decrypt(a.binding.link_id, &a.user_id, &a.ciphertext)
                        .await?;
                    self.reconcile_submission(a, &credentials, &id).await?;
                }
                value(a.state.drafts.get(&id).map(|d| &d.draft))
            }
            Operation::FindDrafts { correlation } => value(
                a.state
                    .drafts
                    .values()
                    .filter(|d| d.input.correlation == correlation)
                    .map(|d| &d.draft)
                    .collect::<Vec<_>>(),
            ),
            Operation::CreateDraft { input } => {
                let id = format!("m:{}", input.correlation);
                if let Some(existing) = a.state.drafts.get(&id) {
                    return value(&existing.draft);
                }
                let draft = new_draft(&a.state, id.clone(), input)?;
                let output = value(&draft.draft)?;
                a.state.drafts.insert(id, draft);
                self.repository.save(a).await?;
                Ok(output)
            }
            Operation::UpdateDraft { id, version, input } => {
                let existing = a.state.drafts.get(&id).ok_or(Error::NotFound)?;
                if existing.draft.version != version
                    || !existing.draft.is_draft
                    || existing.submission.is_some()
                    || existing.input.correlation != input.correlation
                    || existing.input.revision > input.revision
                {
                    return Err(Error::Conflict);
                }
                let attachments = existing.attachments.clone();
                let mut draft = new_draft(&a.state, id.clone(), input)?;
                draft.attachments = attachments;
                let output = value(&draft.draft)?;
                a.state.drafts.insert(id, draft);
                self.repository.save(a).await?;
                Ok(output)
            }
            Operation::DeleteDraft { id, version } => {
                if let Some(draft) = a.state.drafts.get(&id)
                    && (draft.draft.version != version || draft.submission.is_some())
                {
                    return Err(Error::Conflict);
                }
                a.state.drafts.remove(&id);
                a.state.uploads.retain(|_, u| u.draft_id != id);
                self.repository.save(a).await?;
                Ok(Value::Null)
            }
            Operation::Attachments { id } => {
                let draft = a.state.drafts.get(&id).ok_or(Error::NotFound)?;
                value(
                    draft
                        .attachments
                        .values()
                        .map(attachment_metadata)
                        .collect::<Result<Vec<_>, _>>()?,
                )
            }
            Operation::AddAttachment { id, input } => {
                let metadata = attachment_metadata(&input)?;
                let draft = editable(&mut a.state, &id)?;
                if let Some(existing) = draft.attachments.get(&input.content_id)
                    && existing.data_base64 != input.data_base64
                {
                    return Err(Error::Conflict);
                }
                draft.attachments.insert(input.content_id.clone(), input);
                self.repository.save(a).await?;
                value(metadata)
            }
            Operation::DeleteAttachment { id, attachment } => {
                editable(&mut a.state, &id)?.attachments.remove(&attachment);
                self.repository.save(a).await?;
                Ok(Value::Null)
            }
            Operation::CreateUpload { id, input } => {
                editable(&mut a.state, &id)?;
                let _ = attachment_metadata(&input)?;
                let session = UploadSession {
                    id: Uuid::now_v7(),
                    expires_at: Utc::now() + Duration::hours(1),
                    next_offset: 0,
                    attachment: None,
                };
                a.state.uploads.insert(
                    session.id,
                    Upload {
                        session: session.clone(),
                        draft_id: id,
                        input,
                        bytes: Vec::new(),
                    },
                );
                self.repository.save(a).await?;
                value(session)
            }
            Operation::InspectUpload { id } => {
                let upload = a.state.uploads.get(&id).ok_or(Error::NotFound)?;
                if upload.session.expires_at <= Utc::now() {
                    return Err(Error::NotFound);
                }
                value(&upload.session)
            }
            Operation::UploadRange {
                id,
                offset,
                total,
                bytes,
            } => {
                let data = STANDARD.decode(bytes).map_err(|_| Error::Invalid)?;
                if total > u64::try_from(MAX_ATTACHMENT).map_err(|_| Error::Invalid)? {
                    return Err(Error::Invalid);
                }
                let upload = a.state.uploads.get_mut(&id).ok_or(Error::NotFound)?;
                if upload.session.expires_at <= Utc::now()
                    || offset > upload.session.next_offset
                    || offset.saturating_add(u64::try_from(data.len()).map_err(|_| Error::Invalid)?)
                        > total
                {
                    return Err(Error::Conflict);
                }
                let start = usize::try_from(offset).map_err(|_| Error::Invalid)?;
                if offset < upload.session.next_offset {
                    if upload.bytes.get(start..start + data.len()) != Some(data.as_slice()) {
                        return Err(Error::Conflict);
                    }
                } else {
                    upload.bytes.extend_from_slice(&data);
                    upload.session.next_offset =
                        u64::try_from(upload.bytes.len()).map_err(|_| Error::Invalid)?;
                }
                let complete = upload.session.next_offset == total;
                let draft_id = upload.draft_id.clone();
                let mut input = upload.input.clone();
                if complete {
                    input.data_base64 = STANDARD.encode(&upload.bytes);
                    upload.session.attachment = Some(attachment_metadata(&input)?);
                }
                let result = upload.session.clone();
                if complete {
                    editable(&mut a.state, &draft_id)?
                        .attachments
                        .insert(input.content_id.clone(), input);
                }
                self.repository.save(a).await?;
                value(result)
            }
            Operation::Submit { id } => self.submit(a, &id, submission_deadline).await,
        }
    }
}

fn value(v: impl Serialize) -> Result<Value, Error> {
    serde_json::to_value(v).map_err(|_| Error::Invalid)
}
fn editable<'a>(state: &'a mut AccountState, id: &str) -> Result<&'a mut DraftState, Error> {
    let d = state.drafts.get_mut(id).ok_or(Error::NotFound)?;
    if !d.draft.is_draft || d.submission.is_some() {
        return Err(Error::Conflict);
    }
    Ok(d)
}
fn attachment_metadata(a: &AttachmentInput) -> Result<DraftAttachment, Error> {
    if a.name.len() > 1024
        || a.content_id.is_empty()
        || a.content_id.len() > 998
        || a.content_id.chars().any(char::is_control)
        || a.content_type.len() > 255
    {
        return Err(Error::Invalid);
    }
    let bytes = STANDARD
        .decode(&a.data_base64)
        .map_err(|_| Error::Invalid)?;
    if bytes.len() > MAX_ATTACHMENT {
        return Err(Error::Invalid);
    }
    Ok(DraftAttachment {
        id: a.content_id.clone(),
        name: a.name.clone(),
        size: u64::try_from(bytes.len()).map_err(|_| Error::Invalid)?,
        content_id: Some(a.content_id.clone()),
        inline: a.inline,
    })
}
fn models_attachment(
    a: &AttachmentInput,
    data: Vec<u8>,
) -> models_email::service::attachment::AttachmentToSend {
    models_email::service::attachment::AttachmentToSend {
        file_name: a.name.clone(),
        content_type: a.content_type.clone(),
        content_id: Some(a.content_id.clone()),
        is_inline: a.inline,
        data,
    }
}
fn new_draft(state: &AccountState, id: String, input: DraftInput) -> Result<DraftState, Error> {
    let _: SendRequest =
        serde_json::from_value(input.content.clone()).map_err(|_| Error::Invalid)?;
    let conversation = input
        .reply_to
        .as_ref()
        .and_then(|p| state.messages.get(p))
        .map(|m| m.thread_id.clone())
        .unwrap_or_else(|| format!("t:{}", input.correlation));
    let mut content = input.content.clone();
    if let Some(message) = content.get_mut("message").and_then(Value::as_object_mut) {
        message.remove("attachments");
    }
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&content).map_err(|_| Error::Invalid)?)
    );
    Ok(DraftState {
        draft: Draft {
            id,
            conversation_id: conversation,
            version: Uuid::now_v7().to_string(),
            is_draft: true,
            app_revision: input.revision,
            content_fingerprint: fingerprint,
        },
        input,
        attachments: BTreeMap::new(),
        submission: None,
        sent_copy_pending: false,
        sent_copy_attempted: false,
        frozen_content: None,
        answered_pending: false,
    })
}

mod actor;
mod admission;
mod organization;
mod send;
mod sync;
mod watchers;
use sync::{changes, merge_snapshot};

#[cfg(test)]
pub(crate) mod test;
