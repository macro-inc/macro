use super::*;
use chrono::Utc;
use entity_access::domain::models::{
    BotIdStr, BotReceiptScope, Entity, EntityAccessAuth, EntityPermission, TeamRole,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Fake(Arc<Mutex<State>>);

#[derive(Default)]
struct State {
    owner: Option<(TeamId, MacroUserIdStr<'static>, CreateImport)>,
    progress: Option<ImportProgress>,
    uploads: HashMap<UploadId, RegisteredUpload>,
    sealed: bool,
    calls: Vec<&'static str>,
    notified: Vec<String>,
    fail_notification: bool,
    fail_disclosure: bool,
    readable_targets: HashSet<Uuid>,
    disclosure_calls: Vec<(String, Vec<Uuid>)>,
    revoked: bool,
    binding: Option<SourceId>,
}

fn team() -> TeamId {
    Uuid::from_u128(1).try_into().unwrap()
}
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|admin@example.com")
        .unwrap()
        .into_owned()
}
fn access(team: TeamId) -> EntityAccessReceipt<AdminTeamRole> {
    receipt(team, EntityAccessAuth::Authenticated(user()))
}
fn receipt(team: TeamId, auth: EntityAccessAuth) -> EntityAccessReceipt<AdminTeamRole> {
    EntityAccessReceipt::try_new(
        auth,
        Entity {
            entity_id: team.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Admin,
        },
    )
    .unwrap()
}
fn command() -> CreateImport {
    CreateImport {
        idempotency_token: Uuid::now_v7().try_into().unwrap(),
        source: SourceIdentity::Known {
            source_id: "T123".parse().unwrap(),
        },
        include_message_history: true,
        conversations: vec![ConversationMetadata {
            slack_channel_id: "C123".parse().unwrap(),
            kind: ConversationKind::PublicChannel,
            name: "general".into(),
            folder: "general".parse().unwrap(),
            member_ids: vec!["U123".parse().unwrap()],
            creator_id: None,
            created_at: None,
            archived: false,
            message_count: None,
        }],
    }
}
fn descriptor(upload: UploadId) -> UploadDescriptor {
    let record_count = match upload {
        UploadId::Users => None,
        _ => Some(1),
    };
    UploadDescriptor {
        upload,
        sha256: "a".repeat(64).parse().unwrap(),
        byte_length: 10,
        record_count,
    }
}
fn part(index: u32) -> UploadId {
    UploadId::ConversationPart {
        slack_channel_id: "C123".parse().unwrap(),
        part_index: index,
    }
}
fn setup() -> (impl ImportService, Fake, Arc<AtomicBool>) {
    setup_limits(ImportLimits::default())
}
fn setup_limits(limits: ImportLimits) -> (impl ImportService, Fake, Arc<AtomicBool>) {
    let fake = Fake::default();
    let enabled = Arc::new(AtomicBool::new(true));
    let flag = enabled.clone();
    let service = SlackImportService::new(
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        move |_| flag.load(Ordering::SeqCst),
        limits,
    )
    .unwrap();
    (service, fake, enabled)
}

impl State {
    fn owned(&self, team: TeamId, job: JobId) -> PortResult<ImportProgress> {
        if self
            .owner
            .as_ref()
            .is_some_and(|(owner, _, _)| *owner == team)
            && self.progress.as_ref().is_some_and(|p| p.job_id == job)
        {
            return Ok(self.progress.clone().unwrap());
        }
        Err(ImportError::Unavailable.into())
    }
    fn open(&self, team: TeamId, job: JobId) -> PortResult<ImportProgress> {
        let p = self.owned(team, job)?;
        if p.registration_closed_at.is_some() {
            return Err(ImportError::Conflict.into());
        }
        Ok(p)
    }
    fn settle(
        &mut self,
        team: TeamId,
        job: JobId,
        status: JobStatus,
    ) -> PortResult<ImportProgress> {
        let mut p = self.owned(team, job)?;
        p.status = status;
        p.registration_closed_at = Some(Utc::now());
        p.revision += 1;
        self.progress = Some(p.clone());
        Ok(p)
    }
}

impl ImportRepo for Fake {
    async fn create(
        &self,
        team: TeamId,
        admin: &MacroUserIdStr<'_>,
        command: &CreateImport,
        limits: &ImportLimits,
    ) -> PortResult<ImportProgress> {
        let mut s = self.0.lock().unwrap();
        s.calls.push("create");
        if let SourceIdentity::Known { source_id } = &command.source {
            if s.binding.as_ref().is_some_and(|bound| bound != source_id) {
                return Err(ImportError::SourceMismatch.into());
            }
            s.binding = Some(source_id.clone());
        }
        if let Some((owner, requester, original)) = &s.owner
            && *owner == team
            && requester == admin
            && original.idempotency_token == command.idempotency_token
        {
            if original != command {
                return Err(ImportError::Conflict.into());
            }
            return Ok(s.progress.clone().unwrap());
        }
        s.owner = Some((team, admin.clone().into_owned(), command.clone()));
        let now = Utc::now();
        let p = ImportProgress {
            source: command.source.clone(),
            include_message_history: command.include_message_history,
            job_id: Uuid::now_v7().try_into().unwrap(),
            status: JobStatus::Uploading,
            revision: 0,
            created_at: now,
            updated_at: now,
            registration_closed_at: None,
            users_verified: false,
            limits: *limits,
            conversations: vec![],
        };
        s.progress = Some(p.clone());
        Ok(p)
    }
    async fn register(
        &self,
        team: TeamId,
        job: JobId,
        command: &RegisterUploads,
    ) -> PortResult<Vec<RegisteredUpload>> {
        let mut s = self.0.lock().unwrap();
        let p = s.open(team, job)?;
        s.calls.push("register");
        let mut pending = s.uploads.clone();
        let mut result = vec![];
        for d in &command.descriptors {
            if let Some(existing) = pending.get(&d.upload) {
                if existing.descriptor != *d {
                    return Err(ImportError::Conflict.into());
                }
                result.push(existing.clone());
                continue;
            }
            if matches!(d.upload, UploadId::ConversationPart { .. }) && s.sealed {
                return Err(ImportError::Conflict.into());
            }
            let upload = RegisteredUpload {
                descriptor: d.clone(),
                key: format!("trusted/{job}/{}", pending.len()).parse().unwrap(),
            };
            result.push(upload.clone());
            pending.insert(d.upload.clone(), upload);
        }
        if pending
            .values()
            .map(|u| u.descriptor.byte_length)
            .sum::<u64>()
            > p.limits.selected_bytes
        {
            return Err(ImportError::LimitExceeded.into());
        }
        s.uploads = pending;
        Ok(result)
    }
    async fn uploads(
        &self,
        team: TeamId,
        job: JobId,
        uploads: &[UploadId],
    ) -> PortResult<Vec<RegisteredUpload>> {
        let mut s = self.0.lock().unwrap();
        s.owned(team, job)?;
        s.calls.push("resolve");
        uploads
            .iter()
            .map(|id| {
                s.uploads
                    .get(id)
                    .cloned()
                    .ok_or_else(|| ImportError::Unavailable.into())
            })
            .collect()
    }
    async fn complete(
        &self,
        team: TeamId,
        job: JobId,
        verified: &[VerifiedUpload],
        seal: Option<&ConversationSeal>,
    ) -> PortResult<ImportProgress> {
        let mut s = self.0.lock().unwrap();
        let mut p = s.open(team, job)?;
        s.calls.push("complete_and_outbox");
        for upload in verified {
            assert_eq!(
                s.uploads.get(&upload.registered.descriptor.upload),
                Some(&upload.registered)
            );
            if upload.registered.descriptor.upload == UploadId::Users {
                p.users_verified = true;
            }
        }
        if let Some(seal) = seal {
            let parts = s
                .uploads
                .values()
                .filter(|u| u.descriptor.upload != UploadId::Users)
                .map(|u| u.descriptor.clone())
                .collect::<Vec<_>>();
            if ConversationSeal::from_descriptors(seal.slack_channel_id.clone(), &parts, &p.limits)
                .unwrap()
                != *seal
            {
                return Err(ImportError::Conflict.into());
            }
            s.sealed = true;
        }
        p.revision += 1;
        s.progress = Some(p.clone());
        Ok(p)
    }
    async fn finalize(&self, team: TeamId, job: JobId) -> PortResult<ImportProgress> {
        self.0
            .lock()
            .unwrap()
            .settle(team, job, JobStatus::Completed)
    }
    async fn cancel(&self, team: TeamId, job: JobId) -> PortResult<ImportProgress> {
        self.0
            .lock()
            .unwrap()
            .settle(team, job, JobStatus::Cancelled)
    }
    async fn progress(&self, team: TeamId, job: JobId) -> PortResult<Option<ImportProgress>> {
        Ok(self.0.lock().unwrap().owned(team, job).ok())
    }
    async fn requested_by(
        &self,
        team: TeamId,
        job: JobId,
    ) -> PortResult<Option<MacroUserIdStr<'static>>> {
        let s = self.0.lock().unwrap();
        s.owned(team, job)?;
        Ok(s.owner.as_ref().map(|(_, user, _)| user.clone()))
    }
    async fn list(&self, team: TeamId, _before: Option<JobId>) -> PortResult<Vec<ImportProgress>> {
        let s = self.0.lock().unwrap();
        Ok(s.progress
            .iter()
            .filter(|p| s.owned(team, p.job_id).is_ok())
            .cloned()
            .collect())
    }
}

impl ImportStorage for Fake {
    async fn grant(&self, upload: &RegisteredUpload) -> PortResult<UploadGrant> {
        self.0.lock().unwrap().calls.push("grant");
        Ok(UploadGrant {
            descriptor: upload.descriptor.clone(),
            url: "https://example.com".into(),
            required_headers: Default::default(),
            expires_at: Utc::now(),
        })
    }
    async fn verify(&self, upload: &RegisteredUpload) -> PortResult<VerifiedUpload> {
        assert!(upload.key.as_str().starts_with("trusted/"));
        self.0.lock().unwrap().calls.push("head");
        Ok(VerifiedUpload {
            registered: upload.clone(),
            identity: ObjectIdentity::Version("version".parse().unwrap()),
        })
    }
    async fn read(&self, _: &VerifiedUpload) -> PortResult<ByteStream> {
        panic!("admin service must never read object bodies")
    }
}
impl ImportLedger for Fake {
    async fn source_binding(&self, _: TeamId) -> PortResult<SourceBinding> {
        Ok(SourceBinding::Unbound)
    }
    async fn reserve(
        &self,
        _: TeamId,
        _: &MacroUserIdStr<'static>,
        _: &ConversationMetadata,
        _: Option<Uuid>,
    ) -> PortResult<TargetReservation> {
        panic!("admin service must not create targets")
    }
    async fn complete(&self, _: &TargetReservation, _: ConversationKind) -> PortResult<()> {
        panic!("admin service must not complete targets")
    }
}
impl ImportAuthorizer for Fake {
    async fn require_admin(&self, _: TeamId, _: &MacroUserIdStr<'_>) -> PortResult<()> {
        let mut s = self.0.lock().unwrap();
        s.calls.push("revalidate");
        if s.revoked {
            return Err(ImportError::AdminRequired.into());
        }
        Ok(())
    }
    async fn require_target(
        &self,
        _: TeamId,
        _: &MacroUserIdStr<'_>,
        _: &ConversationMetadata,
        _: Uuid,
    ) -> PortResult<()> {
        panic!("admin service must not authorize worker targets")
    }
}
impl ImportProgressAccess for Fake {
    async fn participating_targets(
        &self,
        viewer: &MacroUserIdStr<'_>,
        targets: &[Uuid],
    ) -> PortResult<Vec<Uuid>> {
        let mut state = self.0.lock().unwrap();
        state
            .disclosure_calls
            .push((viewer.to_string(), targets.to_vec()));
        if state.fail_disclosure {
            return Err(ImportError::Retryable.into());
        }
        Ok(targets
            .iter()
            .filter(|id| state.readable_targets.contains(id))
            .copied()
            .collect())
    }
}

impl ImportNotifier for Fake {
    async fn invalidate(
        &self,
        requester: &MacroUserIdStr<'_>,
        _: TeamId,
        job: JobId,
        revision: u64,
        status: JobStatus,
    ) -> PortResult<()> {
        let mut s = self.0.lock().unwrap();
        let p = s.progress.as_ref().expect("commit before notification");
        assert_eq!((p.job_id, p.revision, p.status), (job, revision, status));
        s.calls.push("notify");
        s.notified.push(requester.to_string());
        if s.fail_notification {
            return Err(ImportError::Retryable.into());
        }
        Ok(())
    }
}

#[tokio::test]
async fn receipts_revalidate_disclosure_without_hiding_selected_work_or_failing_committed_writes() {
    let (svc, fake, _) = setup();
    let command = command();
    let job = svc
        .create(access(team()), command.clone())
        .await
        .unwrap()
        .job_id;
    let readable = Uuid::now_v7();
    let hidden = Uuid::now_v7();
    let source = ConversationProgress {
        slack_channel_id: "CA".parse().unwrap(),
        name: "Source name".into(),
        kind: ConversationKind::PrivateChannel,
        archived: true,
        status: ConversationStatus::Completed,
        channel_id: Some(readable),
        part_count: Some(0),
        verified_parts: 0,
        counters: ImportCounters::default(),
        search: SearchState::NotNeeded,
        error: None,
        warnings: vec![],
    };
    {
        let mut state = fake.0.lock().unwrap();
        state.readable_targets.insert(readable);
        state.progress.as_mut().unwrap().conversations = vec![
            source.clone(),
            ConversationProgress {
                slack_channel_id: "CC".parse().unwrap(),
                channel_id: Some(hidden),
                status: ConversationStatus::Failed,
                error: Some(ImportError::InvalidInput),
                ..source
            },
        ];
    }
    let detail = svc
        .progress(access(team()), JobCommand { job_id: job })
        .await
        .unwrap();
    assert_eq!(detail.conversations[0].channel_id, Some(readable));
    assert_eq!(detail.conversations[1].channel_id, None);
    assert_eq!(detail.conversations[1].name, "Source name");
    assert_eq!(
        detail.conversations[1].error,
        Some(ImportError::InvalidInput)
    );
    assert_eq!(
        svc.list(access(team()), None).await.unwrap().jobs,
        [detail.clone()]
    );
    assert_eq!(svc.create(access(team()), command).await.unwrap(), detail);
    // Another admin must be checked as the viewer, not the original requesting admin.
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap();
    svc.progress(
        receipt(team(), EntityAccessAuth::Authenticated(other)),
        JobCommand { job_id: job },
    )
    .await
    .unwrap();
    assert_eq!(
        fake.0.lock().unwrap().disclosure_calls.last().unwrap().0,
        "macro|other@example.com"
    );
    fake.0.lock().unwrap().fail_disclosure = true;
    let complete = svc
        .complete_uploads(
            access(team()),
            job,
            CompleteUploads {
                uploads: vec![],
                seal: None,
            },
        )
        .await
        .unwrap();
    let finalized = svc
        .finalize(access(team()), JobCommand { job_id: job })
        .await
        .unwrap();
    let cancelled = svc
        .cancel(access(team()), JobCommand { job_id: job })
        .await
        .unwrap();
    for receipt in [complete, finalized, cancelled] {
        assert_eq!(receipt.conversations.len(), 2);
        assert!(receipt.conversations.iter().all(|c| c.channel_id.is_none()));
    }
    assert_eq!(
        fake.0
            .lock()
            .unwrap()
            .progress
            .as_ref()
            .unwrap()
            .conversations[1]
            .channel_id,
        Some(hidden)
    );
}

#[tokio::test]
async fn create_is_idempotent_and_source_mismatch_is_sanitized() {
    let (svc, fake, _) = setup();
    let cmd = command();
    let first = svc.create(access(team()), cmd.clone()).await.unwrap();
    assert_eq!(
        svc.create(access(team()), cmd.clone()).await.unwrap(),
        first
    );
    let mut mismatch = command();
    mismatch.source = SourceIdentity::Known {
        source_id: "T999".parse().unwrap(),
    };
    assert_eq!(
        svc.create(access(team()), mismatch).await,
        Err(ImportError::SourceMismatch)
    );
    assert_eq!(fake.0.lock().unwrap().progress.as_ref(), Some(&first));
    let mut changed = cmd;
    changed.include_message_history = false;
    assert_eq!(
        svc.create(access(team()), changed).await,
        Err(ImportError::Conflict)
    );
}

#[tokio::test]
async fn wrong_team_cannot_read_mutate_or_head() {
    let (svc, fake, _) = setup();
    let p = svc.create(access(team()), command()).await.unwrap();
    let other: TeamId = Uuid::from_u128(2).try_into().unwrap();
    let job = JobCommand { job_id: p.job_id };
    assert_eq!(
        svc.progress(access(other), job).await,
        Err(ImportError::Unavailable)
    );
    assert!(svc.list(access(other), None).await.unwrap().jobs.is_empty());
    assert_eq!(
        svc.register_uploads(
            access(other),
            p.job_id,
            RegisterUploads {
                descriptors: vec![descriptor(UploadId::Users)]
            }
        )
        .await,
        Err(ImportError::Unavailable)
    );
    assert_eq!(
        svc.complete_uploads(
            access(other),
            p.job_id,
            CompleteUploads {
                uploads: vec![UploadId::Users],
                seal: None
            }
        )
        .await,
        Err(ImportError::Unavailable)
    );
    assert_eq!(
        svc.finalize(access(other), job).await,
        Err(ImportError::Unavailable)
    );
    assert_eq!(
        svc.cancel(access(other), job).await,
        Err(ImportError::Unavailable)
    );
    assert!(!fake.0.lock().unwrap().calls.contains(&"head"));
    assert!(!fake.0.lock().unwrap().calls.contains(&"grant"));
}

#[tokio::test]
async fn create_rejects_bot_internal_and_wrong_entity_receipts() {
    let (svc, fake, _) = setup();
    for auth in [
        EntityAccessAuth::Internal,
        EntityAccessAuth::Unauthenticated,
    ] {
        assert_eq!(
            svc.create(receipt(team(), auth), command()).await,
            Err(ImportError::AdminRequired)
        );
    }
    for scope in [
        BotReceiptScope::Team {
            team_id: team().into(),
        },
        BotReceiptScope::User {
            acting_user: user(),
        },
    ] {
        let bot = EntityAccessReceipt::try_new_bot(
            BotIdStr::parse_from_str("bot|00000000-0000-0000-0000-000000000001")
                .unwrap()
                .into_owned(),
            scope,
            Entity {
                entity_id: team().to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole {
                role: TeamRole::Admin,
            },
        )
        .unwrap();
        assert_eq!(
            svc.create(bot, command()).await,
            Err(ImportError::AdminRequired)
        );
    }
    let wrong_entity = EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: team().to_string(),
            entity_type: EntityType::Channel,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Admin,
        },
    )
    .unwrap();
    assert_eq!(
        svc.create(wrong_entity, command()).await,
        Err(ImportError::AdminRequired)
    );
    assert!(fake.0.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn disabled_backend_gate_blocks_uploads_but_preserves_existing_receipts() {
    let (svc, fake, flag) = setup();
    let p = svc.create(access(team()), command()).await.unwrap();
    fake.0.lock().unwrap().calls.clear();
    flag.store(false, Ordering::SeqCst);
    let job = JobCommand { job_id: p.job_id };
    assert_eq!(
        svc.create(access(team()), command()).await,
        Err(ImportError::Disabled)
    );
    assert_eq!(
        svc.register_uploads(
            access(team()),
            p.job_id,
            RegisterUploads {
                descriptors: vec![]
            }
        )
        .await,
        Err(ImportError::Disabled)
    );
    assert_eq!(
        svc.complete_uploads(
            access(team()),
            p.job_id,
            CompleteUploads {
                uploads: vec![],
                seal: None
            }
        )
        .await,
        Err(ImportError::Disabled)
    );
    assert!(fake.0.lock().unwrap().calls.is_empty());
    assert!(svc.progress(access(team()), job).await.is_ok());
    assert!(svc.list(access(team()), None).await.is_ok());
    assert!(svc.finalize(access(team()), job).await.is_ok());
    assert!(svc.cancel(access(team()), job).await.is_ok());
}

#[tokio::test]
async fn invalid_metadata_and_create_quotas_never_reach_repo() {
    let (svc, fake, _) = setup_limits(ImportLimits {
        conversations: 1,
        ..Default::default()
    });
    let mut cmd = command();
    cmd.conversations.clear();
    assert_eq!(
        svc.create(access(team()), cmd).await,
        Err(ImportError::InvalidInput)
    );
    let mut cmd = command();
    cmd.conversations.push(cmd.conversations[0].clone());
    assert_eq!(
        svc.create(access(team()), cmd).await,
        Err(ImportError::LimitExceeded)
    );
    for name in ["", " \t", "bad\0name"] {
        let mut cmd = command();
        cmd.conversations[0].name = name.into();
        assert_eq!(
            svc.create(access(team()), cmd).await,
            Err(ImportError::InvalidInput)
        );
    }
    let mut cmd = command();
    cmd.conversations[0].message_count = Some(u64::MAX);
    assert_eq!(
        svc.create(access(team()), cmd).await,
        Err(ImportError::LimitExceeded)
    );
    assert!(fake.0.lock().unwrap().calls.is_empty());
}

#[tokio::test]
async fn duplicate_metadata_and_oversized_metadata_rejected() {
    let (svc, _, _) = setup_limits(ImportLimits {
        json_bytes: 1024,
        ..Default::default()
    });
    let mut cmd = command();
    cmd.conversations.push(cmd.conversations[0].clone());
    assert_eq!(
        svc.create(access(team()), cmd.clone()).await,
        Err(ImportError::InvalidInput)
    );
    cmd.conversations[1].slack_channel_id = "C999".parse().unwrap();
    assert_eq!(
        svc.create(access(team()), cmd).await,
        Err(ImportError::InvalidInput)
    );
    let mut cmd = command();
    cmd.conversations[0].name = "x".repeat(1025);
    assert_eq!(
        svc.create(access(team()), cmd).await,
        Err(ImportError::LimitExceeded)
    );
}

#[tokio::test]
async fn upload_quotas_duplicates_and_partial_authorization_prevent_storage_io() {
    let (svc, fake, _) = setup();
    let p = svc.create(access(team()), command()).await.unwrap();
    let mut oversized = descriptor(part(0));
    oversized.byte_length = p.limits.part_bytes + 1;
    assert_eq!(
        svc.register_uploads(
            access(team()),
            p.job_id,
            RegisterUploads {
                descriptors: vec![oversized]
            }
        )
        .await,
        Err(ImportError::LimitExceeded)
    );
    assert_eq!(
        svc.register_uploads(
            access(team()),
            p.job_id,
            RegisterUploads {
                descriptors: (0..51).map(|n| descriptor(part(n))).collect()
            }
        )
        .await,
        Err(ImportError::LimitExceeded)
    );
    assert_eq!(
        svc.register_uploads(
            access(team()),
            p.job_id,
            RegisterUploads {
                descriptors: vec![descriptor(UploadId::Users); 2]
            }
        )
        .await,
        Err(ImportError::InvalidInput)
    );
    assert!(!fake.0.lock().unwrap().calls.contains(&"grant"));
    svc.register_uploads(
        access(team()),
        p.job_id,
        RegisterUploads {
            descriptors: vec![descriptor(UploadId::Users)],
        },
    )
    .await
    .unwrap();
    for (uploads, error) in [
        (
            vec![UploadId::Users, UploadId::Users],
            ImportError::InvalidInput,
        ),
        ((0..51).map(part).collect(), ImportError::LimitExceeded),
        (vec![UploadId::Users, part(0)], ImportError::Unavailable),
    ] {
        assert_eq!(
            svc.complete_uploads(
                access(team()),
                p.job_id,
                CompleteUploads {
                    uploads,
                    seal: None
                }
            )
            .await,
            Err(error)
        );
    }
    assert!(!fake.0.lock().unwrap().calls.contains(&"head"));
}

#[tokio::test]
async fn aggregate_quota_enforced_before_grants_and_retries_do_not_consume_it() {
    let limits = ImportLimits {
        part_bytes: 10,
        json_bytes: 1024,
        selected_bytes: 1024,
        record_bytes: 10,
        ..Default::default()
    };
    let (svc, fake, _) = setup_limits(limits);
    let p = svc.create(access(team()), command()).await.unwrap();
    let mut users = descriptor(UploadId::Users);
    users.byte_length = 1024;
    for _ in 0..2 {
        svc.register_uploads(
            access(team()),
            p.job_id,
            RegisterUploads {
                descriptors: vec![users.clone()],
            },
        )
        .await
        .unwrap();
    }
    fake.0.lock().unwrap().calls.clear();
    assert_eq!(
        svc.register_uploads(
            access(team()),
            p.job_id,
            RegisterUploads {
                descriptors: vec![descriptor(part(0))]
            }
        )
        .await,
        Err(ImportError::LimitExceeded)
    );
    assert!(!fake.0.lock().unwrap().calls.contains(&"grant"));
}

#[tokio::test]
async fn completion_commits_before_best_effort_notification_and_seal_is_immutable() {
    let (svc, fake, _) = setup();
    let p = svc.create(access(team()), command()).await.unwrap();
    let d = descriptor(part(0));
    svc.register_uploads(
        access(team()),
        p.job_id,
        RegisterUploads {
            descriptors: vec![descriptor(UploadId::Users), d.clone()],
        },
    )
    .await
    .unwrap();
    {
        let mut s = fake.0.lock().unwrap();
        s.calls.clear();
        s.fail_notification = true;
    }
    let seal = ConversationSeal::from_descriptors(
        "C123".parse().unwrap(),
        std::slice::from_ref(&d),
        &p.limits,
    )
    .unwrap();
    let committed = svc
        .complete_uploads(
            access(team()),
            p.job_id,
            CompleteUploads {
                uploads: vec![UploadId::Users, part(0)],
                seal: Some(seal),
            },
        )
        .await
        .unwrap();
    assert!(committed.users_verified);
    assert_eq!(
        fake.0.lock().unwrap().calls,
        vec![
            "resolve",
            "head",
            "head",
            "complete_and_outbox",
            "revalidate",
            "notify"
        ]
    );
    assert_eq!(
        svc.progress(access(team()), JobCommand { job_id: p.job_id })
            .await
            .unwrap(),
        committed
    );
    svc.register_uploads(
        access(team()),
        p.job_id,
        RegisterUploads {
            descriptors: vec![d.clone()],
        },
    )
    .await
    .unwrap();
    let mut changed = d;
    changed.byte_length += 1;
    for descriptors in [vec![changed], vec![descriptor(part(1))]] {
        assert_eq!(
            svc.register_uploads(access(team()), p.job_id, RegisterUploads { descriptors })
                .await,
            Err(ImportError::Conflict)
        );
    }
}

#[tokio::test]
async fn shape_only_seal_and_other_admin_notify_original_requester_only() {
    let (svc, fake, _) = setup();
    let mut cmd = command();
    cmd.include_message_history = false;
    let p = svc.create(access(team()), cmd).await.unwrap();
    let seal = ConversationSeal::from_descriptors("C123".parse().unwrap(), &[], &p.limits).unwrap();
    svc.complete_uploads(
        access(team()),
        p.job_id,
        CompleteUploads {
            uploads: vec![],
            seal: Some(seal),
        },
    )
    .await
    .unwrap();
    let other = MacroUserIdStr::parse_from_str("macro|other@example.com")
        .unwrap()
        .into_owned();
    fake.0.lock().unwrap().fail_notification = true;
    let result = svc
        .finalize(
            receipt(team(), EntityAccessAuth::Authenticated(other)),
            JobCommand { job_id: p.job_id },
        )
        .await
        .unwrap();
    assert_eq!(result.status, JobStatus::Completed);
    assert!(
        fake.0
            .lock()
            .unwrap()
            .notified
            .iter()
            .all(|id| id == user().as_ref())
    );
    assert!(!fake.0.lock().unwrap().calls.contains(&"head"));
    assert_eq!(
        svc.register_uploads(
            access(team()),
            p.job_id,
            RegisterUploads {
                descriptors: vec![descriptor(UploadId::Users)]
            }
        )
        .await,
        Err(ImportError::Conflict)
    );
}

#[tokio::test]
async fn revoked_requester_is_not_notified_and_cancel_still_commits() {
    let (svc, fake, _) = setup();
    let p = svc.create(access(team()), command()).await.unwrap();
    {
        let mut s = fake.0.lock().unwrap();
        s.revoked = true;
        s.notified.clear();
    }
    let p = svc
        .cancel(access(team()), JobCommand { job_id: p.job_id })
        .await
        .unwrap();
    assert_eq!(p.status, JobStatus::Cancelled);
    assert!(fake.0.lock().unwrap().notified.is_empty());
}
