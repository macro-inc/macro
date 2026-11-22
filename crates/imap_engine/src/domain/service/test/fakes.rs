use super::*;

pub(crate) struct MemoryRepository {
    pub(crate) owner_claims: std::sync::atomic::AtomicU32,
    pub(crate) owner_gate: std::sync::Mutex<Option<Arc<tokio::sync::Semaphore>>>,
    pub(crate) owner_errors: std::sync::atomic::AtomicU32,
    pub(crate) releases: std::sync::atomic::AtomicU32,
    pub(crate) acquire_gate: Option<Arc<tokio::sync::Semaphore>>,
    pub(crate) owner_available: std::sync::atomic::AtomicBool,
    pub(crate) state: std::sync::Mutex<AccountState>,
    pub(crate) saved_unknown: std::sync::atomic::AtomicBool,
}
#[async_trait::async_trait]
impl Repository for MemoryRepository {
    async fn idle_state(
        &self,
        _: &str,
    ) -> Result<Option<crate::domain::adaptive_idle::IdleState>, Error> {
        Ok(None)
    }
    async fn save_idle_state(
        &self,
        _: &str,
        _: &crate::domain::adaptive_idle::IdleState,
    ) -> Result<(), Error> {
        Ok(())
    }
    async fn claim_owner(&self, _: Binding, _: Uuid) -> Result<bool, Error> {
        self.owner_claims.fetch_add(1, Ordering::Relaxed);
        let gate = self.owner_gate.lock().unwrap().clone();
        if let Some(gate) = gate {
            gate.acquire()
                .await
                .map_err(|_| Error::ConnectionUnavailable)?
                .forget();
        }
        if self
            .owner_errors
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1))
            .is_ok()
        {
            return Err(Error::ConnectionUnavailable);
        }
        Ok(self.owner_available.load(Ordering::Acquire))
    }
    async fn release_owner(&self, _: Binding, _: Uuid) -> Result<(), Error> {
        Ok(())
    }
    async fn admit_verification(&self, _: &[(String, i32)]) -> Result<(), Error> {
        Ok(())
    }
    async fn put_verification(&self, _: VerifiedAccount) -> Result<(), Error> {
        Err(Error::Invalid)
    }
    async fn verification(&self, _: Uuid) -> Result<VerifiedAccount, Error> {
        Err(Error::NotFound)
    }
    async fn connect(&self, _: Binding, _: &str, _: Vec<u8>, _: Uuid) -> Result<(), Error> {
        Err(Error::Invalid)
    }
    async fn credentials(&self, _: Binding) -> Result<(String, Vec<u8>), Error> {
        Ok(("owner".into(), Vec::new()))
    }
    async fn acquire(&self, binding: Binding) -> Result<Account, Error> {
        if let Some(gate) = &self.acquire_gate {
            gate.acquire()
                .await
                .map_err(|_| Error::ConnectionUnavailable)?
                .forget();
        }
        Ok(Account {
            binding,
            user_id: "owner".into(),
            ciphertext: Vec::new(),
            state: self.state.lock().unwrap().clone(),
            checkpoint: Default::default(),
            revision: 0,
            lease_id: Some(Uuid::now_v7()),
        })
    }
    async fn read_scoped(&self, binding: Binding, _: StateSelection) -> Result<Account, Error> {
        let mut account = self.acquire(binding).await?;
        account.lease_id = None;
        Ok(account)
    }
    async fn validate_read(&self, _: &Account) -> Result<(), Error> {
        if !self.owner_available.load(Ordering::Acquire) {
            return Err(Error::Conflict);
        }
        let state = self.state.lock().unwrap();
        if let Some(error) = state.credential_issue() {
            return Err(error);
        }
        Ok(())
    }
    async fn save(&self, account: &mut Account) -> Result<(), Error> {
        account.lease_id.ok_or(Error::Conflict)?;
        if account
            .state
            .drafts
            .values()
            .any(|d| d.submission == Some(SubmissionOutcome::Unknown))
        {
            self.saved_unknown.store(true, Ordering::Release);
        }
        *self.state.lock().unwrap() = account.state.clone();
        account.revision += 1;
        Ok(())
    }
    async fn renew(&self, account: &Account) -> Result<(), Error> {
        account.lease_id.ok_or(Error::Conflict)?;
        Ok(())
    }
    async fn release(&self, account: &Account) -> Result<(), Error> {
        account.lease_id.ok_or(Error::Conflict)?;
        self.releases.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
    async fn delete(&self, _: Binding) -> Result<(), Error> {
        Ok(())
    }
    async fn bindings(&self, _: i64, _: &[Uuid]) -> Result<Vec<Binding>, Error> {
        Ok(Vec::new())
    }
}
pub(crate) struct TestCipher;
#[async_trait::async_trait]
impl CredentialCipher for TestCipher {
    async fn encrypt(&self, _: Uuid, _: &str, _: &Credentials) -> Result<Vec<u8>, Error> {
        Ok(Vec::new())
    }
    async fn decrypt(&self, _id: Uuid, _: &str, _: &[u8]) -> Result<Credentials, Error> {
        Ok(Credentials {
            features: None,
            binding: Some(Binding {
                link_id: _id,
                sync_generation: 1,
                grant_generation: 1,
            }),
            user_id: "owner".into(),
            email: "owner@example.net".into(),
            imap: Login {
                endpoint: Endpoint {
                    host: "imap.example.net".into(),
                    port: 993,
                    tls: TlsMode::Implicit,
                    username: "owner@example.net".into(),
                },
                password: Secret("sentinel-password".into()),
            },
            smtp: Login {
                endpoint: Endpoint {
                    host: "smtp.example.net".into(),
                    port: 465,
                    tls: TlsMode::Implicit,
                    username: "owner@example.net".into(),
                },
                password: Secret("sentinel-password".into()),
            },
        })
    }
}
pub(crate) struct OrganizationWorkControl {
    pub(crate) writes: std::sync::atomic::AtomicU32,
    pub(crate) seen: AtomicBool,
    pub(crate) busy_after_write: AtomicBool,
}

pub(crate) struct ProviderWorkControl {
    pub(crate) failures: BTreeMap<u32, Error>,
    pub(crate) organization: Option<Arc<OrganizationWorkControl>>,
    pub(crate) source: Option<Vec<u8>>,
    pub(crate) started: tokio::sync::mpsc::UnboundedSender<Uuid>,
    pub(crate) released: tokio::sync::Semaphore,
}
impl ProviderWorkControl {
    async fn wait(&self, credentials: &Credentials) -> Result<(), Error> {
        let binding = credentials.binding.ok_or(Error::Invalid)?;
        self.started
            .send(binding.link_id)
            .map_err(|_| Error::ConnectionUnavailable)?;
        self.released
            .acquire()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?
            .forget();
        Ok(())
    }
}

pub(crate) struct UncertainTransport {
    pub(crate) repository: Arc<MemoryRepository>,
    pub(crate) submissions: std::sync::atomic::AtomicU32,
    pub(crate) deadline: AtomicBool,
    pub(crate) submission_deadline: std::sync::Mutex<Option<tokio::time::Instant>>,
    pub(crate) refusal: Option<SubmissionRefusal>,
    pub(crate) sent_found: std::sync::Mutex<std::collections::BTreeSet<String>>,
    pub(crate) provider_work: Option<Arc<ProviderWorkControl>>,
}
#[async_trait::async_trait]
impl MailTransport for UncertainTransport {
    async fn wait_folder(&self, _: &Credentials, _: &str, _: u64) -> Result<(), Error> {
        Ok(())
    }
    async fn message(
        &self,
        _: &Credentials,
        _: &str,
        _: u32,
        uid: u32,
    ) -> Result<Option<RemoteMessage>, Error> {
        if let Some(control) = &self.provider_work
            && let Some(organization) = &control.organization
        {
            if organization.writes.load(Ordering::SeqCst) > 0
                && organization.busy_after_write.swap(false, Ordering::SeqCst)
            {
                return Err(Error::AccountBusy);
            }
            let state = self.repository.state.lock().unwrap();
            let Some(message) = state.messages.values().next() else {
                return Ok(None);
            };
            return Ok(Some(RemoteMessage {
                gmail_labels: None,
                uid,
                flags: if organization.seen.load(Ordering::SeqCst) {
                    vec!["\\Seen".into()]
                } else {
                    Vec::new()
                },
                mime: Arc::from(STANDARD.decode(&message.mime_base64).unwrap()),
                size: message.size,
                received_at: message.received_at,
                modseq: None,
                gmail_message_id: None,
                native_message_id: None,
                native_thread_id: None,
            }));
        }
        Ok(None)
    }
    async fn disconnect(&self, _: Binding) -> Result<(), Error> {
        Ok(())
    }
    async fn source(
        &self,
        credentials: &Credentials,
        _: &str,
        _: u32,
        uid: u32,
    ) -> Result<Vec<u8>, Error> {
        if let Some(control) = &self.provider_work {
            control.wait(credentials).await?;
            if let Some(error) = control.failures.get(&uid) {
                return Err(*error);
            }
            if let Some(source) = &control.source {
                return Ok(source.clone());
            }
        }
        Err(Error::NotFound)
    }
    async fn wait_change(&self, _: &Credentials, _: u64) -> Result<(), Error> {
        if self.provider_work.is_some() {
            return std::future::pending().await;
        }
        Ok(())
    }
    async fn verify(&self, _: &Credentials) -> Result<(), Error> {
        Ok(())
    }
    async fn snapshot(
        &self,
        credentials: &Credentials,
        _: &AccountState,
    ) -> Result<Vec<RemoteFolder>, Error> {
        if let Some(control) = &self.provider_work {
            control.wait(credentials).await?;
            if let Some(error) = control.failures.get(&0) {
                return Err(*error);
            }
        }
        Ok(Vec::new())
    }
    async fn apply(
        &self,
        _: &Credentials,
        _: &str,
        _: u32,
        _: u32,
        _: RemoteAction,
    ) -> Result<RemoteWriteReceipt, ApplyError> {
        if let Some(control) = &self.provider_work
            && let Some(organization) = &control.organization
        {
            organization.writes.fetch_add(1, Ordering::SeqCst);
            organization.seen.store(true, Ordering::SeqCst);
        }
        Ok(RemoteWriteReceipt::default())
    }
    async fn submit(
        &self,
        _: &Credentials,
        _: &str,
        _: &[String],
        _: &[u8],
        pre_body_deadline: tokio::time::Instant,
    ) -> Result<TransportSubmission, Error> {
        assert!(self.repository.saved_unknown.load(Ordering::Acquire));
        *self.submission_deadline.lock().unwrap() = Some(pre_body_deadline);
        self.submissions.fetch_add(1, Ordering::AcqRel);
        Ok(TransportSubmission {
            outcome: self.refusal.map_or(SubmissionOutcome::Unknown, |refusal| {
                SubmissionOutcome::Rejected { refusal }
            }),
            deadline_exceeded: self.deadline.load(Ordering::Acquire),
        })
    }
    async fn save_sent(
        &self,
        _: &Credentials,
        message_id: &str,
        _: &[u8],
        allow_append: bool,
    ) -> Result<bool, Error> {
        if allow_append {
            assert!(
                self.repository
                    .state
                    .lock()
                    .unwrap()
                    .drafts
                    .values()
                    .all(|d| d.sent_copy_attempted)
            );
            self.submissions.fetch_add(1, Ordering::AcqRel);
            Err(Error::ConnectionUnavailable)
        } else {
            Ok(self.sent_found.lock().unwrap().contains(message_id))
        }
    }
}
