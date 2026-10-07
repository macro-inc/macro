use super::*;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use targets::*;

#[derive(Default)]
struct State {
    objects: HashMap<ObjectKey, Vec<u8>>,
    targets: HashMap<Uuid, TargetFacts>,
    dm: Option<TargetFacts>,
    reserved: Option<Uuid>,
    complete: usize,
    plans: Vec<TargetPlan>,
    warnings: Vec<ImportWarning>,
    created: Vec<TargetPlan>,
    commits: Vec<HistoricalBatch>,
    mappings: HashMap<SourceMessageId, Uuid>,
    stored: HashMap<Uuid, HistoricalMessage>,
    checkpoint: Checkpoint,
    counters: ImportCounters,
    settlements: Vec<(ConversationStatus, Option<ImportError>)>,
    fail_commit: Option<usize>,
    admin_revoked: bool,
    target_denied: bool,
    claims: usize,
    requester: Option<(TeamId, MacroUserIdStr<'static>)>,
    claim: Option<ClaimedConversation>,
    search_state: Option<SearchState>,
    search_failure: bool,
    submissions: Vec<(JobId, Vec<Uuid>, u64)>,
    receipts: Vec<Uuid>,
    polls: Vec<Uuid>,
    recorded_search: Vec<SearchState>,
    announcements: Vec<JoinAnnouncement>,
    fail_announce: bool,
    fail_bind: bool,
    trace: Vec<&'static str>,
}

#[derive(Clone, Default)]
struct Fake(Arc<Mutex<State>>);

type Importer = ConversationImporter<Fake, Fake, Fake, Fake, Fake, Fake, Fake>;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}
fn ts(seconds: u32) -> SlackTimestamp {
    format!("{seconds}.000001").parse().unwrap()
}
fn now() -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000, 0).unwrap()
}

fn importer(fake: &Fake, limits: ImportLimits) -> Importer {
    ConversationImporter::new(
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        fake.clone(),
        ImporterConfig { limits },
    )
    .unwrap()
}

fn upload(fake: &Fake, identity: UploadId, key: &str, bytes: Vec<u8>) -> VerifiedUpload {
    let record_count = match identity {
        UploadId::Users => None,
        _ => Some(bytes.iter().filter(|b| **b == b'\n').count() as u32),
    };
    let registered = RegisteredUpload {
        descriptor: UploadDescriptor {
            upload: identity,
            sha256: format!("{:x}", Sha256::digest(&bytes)).parse().unwrap(),
            byte_length: bytes.len() as u64,
            record_count,
        },
        key: key.parse().unwrap(),
    };
    fake.0
        .lock()
        .unwrap()
        .objects
        .insert(registered.key.clone(), bytes);
    VerifiedUpload {
        registered,
        identity: ObjectIdentity::EntityTag("pinned".parse().unwrap()),
    }
}

fn fixture(kind: ConversationKind, parts: &[&str]) -> (Fake, ClaimedConversation) {
    let fake = Fake::default();
    let team_id = Uuid::now_v7().try_into().unwrap();
    let job_id = Uuid::now_v7().try_into().unwrap();
    let slack_channel_id: ConversationId = "C123".parse().unwrap();
    let users = upload(&fake, UploadId::Users, "users", serde_json::to_vec(&serde_json::json!([
        {"id":"U0","name":"importer","profile":{"email":"admin@example.com","display_name":"Importer Admin"}},
        {"id":"U1","name":"alice","profile":{"email":"Alice+Raw@Example.com","display_name":"Alice"}},
        {"id":"U2","name":"bob","profile":{"email":"Bob@Example.com","display_name":"Bob"}},
        {"id":"U3","name":"phantom"}
    ])).unwrap());
    let parts = parts
        .iter()
        .enumerate()
        .map(|(index, bytes)| {
            upload(
                &fake,
                UploadId::ConversationPart {
                    slack_channel_id: slack_channel_id.clone(),
                    part_index: index as u32,
                },
                &format!("part-{index}"),
                bytes.as_bytes().to_vec(),
            )
        })
        .collect();
    let context = ClaimedConversation {
        lease: Lease {
            event: ImportEvent {
                job_id,
                slack_channel_id: slack_channel_id.clone(),
                generation: 1,
            },
            owner: Uuid::now_v7().try_into().unwrap(),
            token: Uuid::now_v7().try_into().unwrap(),
            generation: 1,
            expires_at: now() + Duration::minutes(3),
            heartbeat_at: now(),
            attempts: 1,
        },
        team_id,
        requested_by: user("admin@example.com"),
        metadata: ConversationMetadata {
            slack_channel_id,
            kind,
            name: "archive".into(),
            folder: "archive".parse().unwrap(),
            member_ids: vec!["U1".parse().unwrap(), "U2".parse().unwrap()],
            creator_id: None,
            created_at: None,
            archived: false,
            message_count: None,
        },
        users,
        parts,
        checkpoint: Checkpoint::default(),
        job_created_at: now(),
    };
    let mut state = fake.0.lock().unwrap();
    state.requester = Some((team_id, context.requested_by.clone()));
    state.claim = Some(context.clone());
    drop(state);
    (fake, context)
}

fn source(context: &ClaimedConversation, seconds: u32) -> SourceMessageId {
    SourceMessageId {
        team_id: context.team_id,
        slack_channel_id: context.metadata.slack_channel_id.clone(),
        ts: ts(seconds),
    }
}

fn facts(plan: &TargetPlan) -> TargetFacts {
    let kind = match plan.metadata.kind {
        ConversationKind::PublicChannel => TargetKind::Team(plan.team_id),
        ConversationKind::PrivateChannel | ConversationKind::GroupDirectMessage => {
            TargetKind::Private
        }
        ConversationKind::DirectMessage => TargetKind::DirectMessage,
    };
    TargetFacts {
        id: plan.channel_id,
        kind,
        dm_members: if kind == TargetKind::DirectMessage {
            plan.members.clone()
        } else {
            HashSet::new()
        },
    }
}

impl ImportStorage for Fake {
    async fn grant(&self, _: &RegisteredUpload) -> PortResult<UploadGrant> {
        unreachable!()
    }
    async fn verify(&self, _: &RegisteredUpload) -> PortResult<VerifiedUpload> {
        unreachable!()
    }
    async fn read(&self, upload: &VerifiedUpload) -> PortResult<ByteStream> {
        assert!(matches!(upload.identity, ObjectIdentity::EntityTag(_)));
        let bytes = self.0.lock().unwrap().objects[&upload.registered.key].clone();
        let chunks: Vec<_> = bytes.chunks(7).map(|chunk| Ok(chunk.to_vec())).collect();
        Ok(Box::pin(futures::stream::iter(chunks)))
    }
}

impl ImportAuthorizer for Fake {
    async fn require_admin(&self, _: TeamId, _: &MacroUserIdStr<'_>) -> PortResult<()> {
        if self.0.lock().unwrap().admin_revoked {
            Err(ImportError::AdminRequired.into())
        } else {
            Ok(())
        }
    }
    async fn require_target(
        &self,
        _: TeamId,
        _: &MacroUserIdStr<'_>,
        _: &ConversationMetadata,
        _: Uuid,
    ) -> PortResult<()> {
        if self.0.lock().unwrap().target_denied {
            Err(ImportError::Unavailable.into())
        } else {
            Ok(())
        }
    }
}

impl ImportLedger for Fake {
    async fn source_binding(&self, _: TeamId) -> PortResult<SourceBinding> {
        unreachable!()
    }
    async fn reserve(
        &self,
        team: TeamId,
        _: &MacroUserIdStr<'static>,
        metadata: &ConversationMetadata,
        existing: Option<Uuid>,
    ) -> PortResult<TargetReservation> {
        let mut state = self.0.lock().unwrap();
        let id = *state
            .reserved
            .get_or_insert_with(|| existing.unwrap_or_else(Uuid::now_v7));
        if existing.is_some_and(|existing| existing != id) {
            return Err(ImportError::Conflict.into());
        }
        Ok(TargetReservation {
            team_id: team,
            slack_channel_id: metadata.slack_channel_id.clone(),
            channel_id: id,
            status: ReservationStatus::Pending,
        })
    }
    async fn complete(&self, _: &TargetReservation, _: ConversationKind) -> PortResult<()> {
        self.0.lock().unwrap().complete += 1;
        Ok(())
    }
}

impl ImportTargets for Fake {
    async fn find_dm(&self, _: &[MacroUserIdStr<'static>; 2]) -> PortResult<Option<TargetFacts>> {
        Ok(self.0.lock().unwrap().dm.clone())
    }
    async fn inspect(&self, id: Uuid) -> PortResult<Option<TargetFacts>> {
        Ok(self.0.lock().unwrap().targets.get(&id).cloned())
    }
    async fn create(&self, _: &Lease, plan: &TargetPlan) -> PortResult<(TargetFacts, bool)> {
        let mut state = self.0.lock().unwrap();
        let facts = facts(plan);
        state.targets.insert(plan.channel_id, facts.clone());
        state.created.push(plan.clone());
        Ok((facts, true))
    }
    async fn bind(
        &self,
        _: &Lease,
        plan: &TargetPlan,
        warnings: &[ImportWarning],
    ) -> PortResult<()> {
        let mut state = self.0.lock().unwrap();
        if state.fail_bind {
            return Err(ImportError::Internal.into());
        }
        state.trace.push("bind");
        state.plans.push(plan.clone());
        state.warnings.extend_from_slice(warnings);
        Ok(())
    }
    async fn warn(&self, _: &Lease, warning: ImportWarning) -> PortResult<()> {
        self.0.lock().unwrap().warnings.push(warning);
        Ok(())
    }
}

impl JoinAnnouncer for Fake {
    async fn announce(&self, announcement: JoinAnnouncement) -> PortResult<()> {
        let mut state = self.0.lock().unwrap();
        state.trace.push("announce");
        state.announcements.push(announcement);
        if state.fail_announce {
            Err(ImportError::Internal.into())
        } else {
            Ok(())
        }
    }
}

impl HistoricalSink for Fake {
    async fn lookup(
        &self,
        sources: &[SourceMessageId],
    ) -> PortResult<Vec<(SourceMessageId, Uuid)>> {
        let state = self.0.lock().unwrap();
        Ok(sources
            .iter()
            .filter_map(|source| state.mappings.get(source).map(|id| (source.clone(), *id)))
            .collect())
    }
    async fn commit(&self, batch: HistoricalBatch) -> PortResult<ImportCounters> {
        let mut state = self.0.lock().unwrap();
        if state.fail_commit == Some(state.commits.len()) {
            state.fail_commit = None;
            return Err(ImportError::Retryable.into());
        }
        assert!(
            (batch.checkpoint.part_index, batch.checkpoint.record_index)
                > (state.checkpoint.part_index, state.checkpoint.record_index)
        );
        state.counters.processed += batch.messages.len() as u64 + batch.skipped;
        state.counters.skipped += batch.skipped;
        for message in &batch.messages {
            if state.mappings.contains_key(&message.source) {
                state.counters.duplicates += 1;
                continue;
            }
            state.counters.imported += 1;
            state.counters.reactions += message.reactions.len() as u64;
            state.mappings.insert(message.source.clone(), message.id);
            state.stored.insert(message.id, message.clone());
        }
        state.checkpoint = batch.checkpoint;
        state.commits.push(batch);
        Ok(state.counters)
    }
}

impl ExecutionRepo for Fake {
    async fn requester(
        &self,
        _: &ImportEvent,
    ) -> PortResult<Option<(TeamId, MacroUserIdStr<'static>)>> {
        Ok(self.0.lock().unwrap().requester.clone())
    }
    async fn claim(&self, _: &ImportEvent, _: WorkerId) -> PortResult<ClaimOutcome> {
        let mut state = self.0.lock().unwrap();
        state.claims += 1;
        Ok(ClaimOutcome::Claimed(Box::new(
            state.claim.clone().unwrap(),
        )))
    }
    async fn heartbeat(&self, _: &Lease) -> PortResult<Lease> {
        unreachable!()
    }
    async fn settle(
        &self,
        _: &Lease,
        status: ConversationStatus,
        error: Option<ImportError>,
    ) -> PortResult<()> {
        self.0.lock().unwrap().settlements.push((status, error));
        Ok(())
    }
    async fn pending_events(&self, _: u32) -> PortResult<Vec<ImportEvent>> {
        unreachable!()
    }
    async fn mark_published(&self, _: &ImportEvent) -> PortResult<()> {
        unreachable!()
    }
    async fn dead_letter(&self, _: &ImportEvent) -> PortResult<WorkerOutcome> {
        unreachable!()
    }
    async fn reconcile(&self, _: u32) -> PortResult<()> {
        unreachable!()
    }
    async fn pending_search(&self, _: u32) -> PortResult<Vec<SearchBackfill>> {
        unreachable!()
    }
    async fn record_search(&self, _: &SearchBackfill, state: SearchState) -> PortResult<()> {
        self.0.lock().unwrap().recorded_search.push(state);
        Ok(())
    }
}

impl Clock for Fake {
    fn now(&self) -> DateTime<Utc> {
        now()
    }
}
impl SearchBackfillClient for Fake {
    async fn submit(&self, request: &SearchBackfill) -> PortResult<Uuid> {
        let mut state = self.0.lock().unwrap();
        if state.search_failure {
            return Err(ImportError::Retryable.into());
        }
        state.submissions.push((
            request.job_id,
            request.channel_ids.clone(),
            request.generation,
        ));
        let receipt = Uuid::now_v7();
        state.receipts.push(receipt);
        Ok(receipt)
    }
    async fn progress(&self, receipt: Uuid) -> PortResult<SearchState> {
        let mut state = self.0.lock().unwrap();
        state.polls.push(receipt);
        Ok(state
            .search_state
            .clone()
            .unwrap_or(SearchState::Submitted {
                receipt_id: receipt,
            }))
    }
}

#[tokio::test]
async fn all_four_shapes_resolve_full_members_without_roster_and_zero_history() {
    for kind in [
        ConversationKind::PublicChannel,
        ConversationKind::PrivateChannel,
        ConversationKind::DirectMessage,
        ConversationKind::GroupDirectMessage,
    ] {
        let (fake, mut context) = fixture(kind, &[]);
        if kind != ConversationKind::DirectMessage {
            context.metadata.member_ids.push("U3".parse().unwrap());
        }
        importer(&fake, ImportLimits::default())
            .import(&context)
            .await
            .unwrap();
        let state = fake.0.lock().unwrap();
        let plan = &state.plans[0];
        assert!(plan.members.contains(&user("alice+raw@example.com")));
        assert!(plan.members.contains(&user("bob@example.com")));
        assert_eq!(plan.created_at, context.job_created_at);
        assert!(state.warnings.contains(&ImportWarning::CreationTimeFromJob));
        if kind == ConversationKind::DirectMessage {
            assert_eq!(plan.members.len(), 2);
            assert!(!plan.members.contains(&context.requested_by));
            assert!(plan.members.contains(&plan.owner));
        } else {
            assert_eq!(plan.members.len(), 3);
            assert_eq!(plan.owner, context.requested_by);
        }
        if kind == ConversationKind::GroupDirectMessage {
            assert_eq!(plan.name, "Alice, Bob, phantom");
        }
        assert!(state.commits.is_empty());
        assert_eq!(state.settlements, [(ConversationStatus::Completed, None)]);
    }
}

#[tokio::test]
async fn invalid_dm_pairs_are_skipped_without_reservation_or_admin_membership() {
    for members in [vec!["U1", "U3"], vec!["U1", "U1"], vec!["U1", "U2", "U3"]] {
        let (fake, mut context) = fixture(ConversationKind::DirectMessage, &[]);
        context.metadata.member_ids = members.iter().map(|id| id.parse().unwrap()).collect();
        importer(&fake, ImportLimits::default())
            .import(&context)
            .await
            .unwrap();
        let state = fake.0.lock().unwrap();
        assert!(state.reserved.is_none());
        assert_eq!(state.warnings, [ImportWarning::UnresolvableDirectMessage]);
        assert_eq!(state.settlements[0].0, ConversationStatus::Skipped);
    }
}

#[tokio::test]
async fn unauthorized_dm_discovery_never_reserves_binds_or_exposes_target() {
    let (fake, context) = fixture(ConversationKind::DirectMessage, &[]);
    let target = TargetFacts {
        id: Uuid::now_v7(),
        kind: TargetKind::DirectMessage,
        dm_members: HashSet::from([user("alice+raw@example.com"), user("bob@example.com")]),
    };
    {
        let mut state = fake.0.lock().unwrap();
        state.dm = Some(target);
        state.target_denied = true;
    }
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    assert!(state.reserved.is_none());
    assert_eq!(state.warnings, [ImportWarning::TargetUnavailable]);
    assert!(state.plans.is_empty());
    assert!(state.created.is_empty());
    assert_eq!(
        state.settlements,
        [(ConversationStatus::Skipped, Some(ImportError::Unavailable))]
    );
}

#[tokio::test]
async fn reused_targets_reject_public_cross_team_wrong_kind_and_denied_private() {
    let cases = [
        (ConversationKind::PublicChannel, TargetKind::Public, false),
        (
            ConversationKind::PublicChannel,
            TargetKind::Team(Uuid::now_v7().try_into().unwrap()),
            false,
        ),
        (ConversationKind::PublicChannel, TargetKind::Private, false),
        (ConversationKind::PrivateChannel, TargetKind::Private, true),
    ];
    for (source_kind, target_kind, denied) in cases {
        let (fake, context) = fixture(source_kind, &[]);
        let id = Uuid::now_v7();
        {
            let mut state = fake.0.lock().unwrap();
            state.reserved = Some(id);
            state.targets.insert(
                id,
                TargetFacts {
                    id,
                    kind: target_kind,
                    dm_members: HashSet::new(),
                },
            );
            state.target_denied = denied;
        }
        importer(&fake, ImportLimits::default())
            .import(&context)
            .await
            .unwrap();
        let state = fake.0.lock().unwrap();
        assert!(state.plans.is_empty());
        assert!(state.created.is_empty());
        assert_eq!(state.complete, 0);
        assert_eq!(
            state.settlements,
            [(ConversationStatus::Skipped, Some(ImportError::Unavailable))]
        );
    }
}

#[tokio::test]
async fn authorized_reuse_does_not_recreate_target() {
    for kind in [
        ConversationKind::PublicChannel,
        ConversationKind::PrivateChannel,
        ConversationKind::DirectMessage,
    ] {
        let (fake, context) = fixture(kind, &[]);
        let id = Uuid::now_v7();
        let target = TargetFacts {
            id,
            kind: match kind {
                ConversationKind::PublicChannel => TargetKind::Team(context.team_id),
                ConversationKind::DirectMessage => TargetKind::DirectMessage,
                _ => TargetKind::Private,
            },
            dm_members: HashSet::from([user("alice+raw@example.com"), user("bob@example.com")]),
        };
        {
            let mut state = fake.0.lock().unwrap();
            state.reserved = Some(id);
            state.targets.insert(id, target.clone());
            if kind == ConversationKind::DirectMessage {
                state.dm = Some(target);
            }
        }
        importer(&fake, ImportLimits::default())
            .import(&context)
            .await
            .unwrap();
        let state = fake.0.lock().unwrap();
        assert!(state.created.is_empty());
        assert_eq!(state.plans[0].channel_id, id);
        assert!(!state.plans[0].members.contains(&context.requested_by));
    }
}

#[tokio::test]
async fn admin_revocation_prevents_claim_and_rechecks_already_claimed_work() {
    let (fake, context) = fixture(ConversationKind::PublicChannel, &[]);
    fake.0.lock().unwrap().admin_revoked = true;
    let importer = importer(&fake, ImportLimits::default());
    assert_eq!(
        importer
            .claim(&context.lease.event, context.lease.owner)
            .await
            .unwrap_err()
            .into_current_context(),
        ImportError::AdminRequired
    );
    importer.import(&context).await.unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.claims, 0);
    assert!(state.created.is_empty());
    assert_eq!(
        state.settlements,
        [(ConversationStatus::Failed, Some(ImportError::AdminRequired))]
    );
}

#[tokio::test]
async fn native_conversion_persists_safe_templates_and_only_active_mentions() {
    let parts = [concat!(
        r#"{"ts":"1.000001","text":"<#C1|self> <#C2|forward> <@U1> `<@U1>` https://example.slack.com/archives/C2/p2000001"}"#,
        "\n",
    )];
    let (fake, context) = fixture(ConversationKind::PublicChannel, &parts);
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    let message = &state.stored[&state.mappings[&source(&context, 1)]];
    assert_eq!(message.user_mentions, vec![user("alice+raw@example.com")]);
    assert_eq!(message.body_references.len(), 3);
    assert!(message.content.contains("<m-link>"));
    assert!(!message.content.contains("m-document-mention"));
    let template = crate::domain::slack::references::ConvertedText {
        body: message.content.clone(),
        user_mentions: message.user_mentions.clone(),
        references: message.body_references.clone(),
    };
    assert_eq!(template.render(&[]).unwrap(), message.content);
}

#[tokio::test]
async fn conversion_threads_skipped_roots_and_source_metadata_survive_bounded_batches() {
    let parts = [
        "{\"ts\":\"1.000001\",\"text\":\"root\",\"user\":\"U1\",\"replies\":[{\"ts\":\"3.000001\"}]}\n{\"ts\":\"2.000001\",\"text\":\"\",\"files\":[{}]}\n",
        "{\"ts\":\"3.000001\",\"thread_ts\":\"1.000001\",\"text\":\"*reply*\",\"username\":\"Archive Bot\",\"subtype\":\"bot_message\",\"reactions\":[{\"name\":\"thumbsup\",\"users\":[\"U1\",\"U1\",\"U3\"]}]}\n{\"ts\":\"4.000001\",\"thread_ts\":\"2.000001\",\"text\":\"orphan\"}\n{\"ts\":\"5.000001\",\"text\":\"not a reply\"}\n",
    ];
    for batch_size in [1, 5] {
        let (fake, context) = fixture(ConversationKind::PublicChannel, &parts);
        let limits = ImportLimits {
            database_batch_messages: batch_size,
            ..ImportLimits::default()
        };
        importer(&fake, limits).import(&context).await.unwrap();
        let state = fake.0.lock().unwrap();
        let message = |seconds| &state.stored[&state.mappings[&source(&context, seconds)]];
        assert_eq!(message(3).parent_id, Some(message(1).id));
        assert_eq!(message(3).content, "**reply**");
        assert_eq!(message(3).imported_author.as_deref(), Some("Archive Bot"));
        assert_eq!(message(3).sender, HistoricalSender::SystemBot);
        assert_eq!(message(3).reactions.len(), 1);
        assert_eq!(message(3).reactions[0].created_at, ts(3));
        assert_eq!(message(4).orphaned_thread_ts, Some(ts(2)));
        assert_eq!(message(4).parent_id, None);
        assert_eq!(message(5).parent_id, None);
        assert_eq!(message(1).source, source(&context, 1));
        assert_eq!(
            message(1).sender,
            HistoricalSender::User(user("alice+raw@example.com"))
        );
        assert_eq!(message(1).imported_author, None);
        assert_eq!(message(3).import_order, 2);
        assert_eq!(
            state.counters,
            ImportCounters {
                processed: 5,
                imported: 4,
                skipped: 1,
                reactions: 1,
                duplicates: 0
            }
        );
        assert_eq!(
            state.checkpoint,
            Checkpoint {
                part_index: 2,
                record_index: 0
            }
        );
        assert_eq!(state.plans[0].created_at, timestamp(ts(1)).unwrap());
        assert!(
            state
                .warnings
                .contains(&ImportWarning::CreationTimeFromMessage)
        );
        assert!(
            state
                .commits
                .iter()
                .all(|batch| batch.messages.len() <= batch_size as usize)
        );
    }
}

#[tokio::test]
async fn cross_job_parent_and_duplicate_mapping_win_without_overwriting_live_edits() {
    let (fake, context) = fixture(
        ConversationKind::PrivateChannel,
        &["{\"ts\":\"1.000001\",\"text\":\"original\"}\n"],
    );
    let importer = importer(&fake, ImportLimits::default());
    importer.import(&context).await.unwrap();
    let root = fake.0.lock().unwrap().mappings[&source(&context, 1)];
    fake.0
        .lock()
        .unwrap()
        .stored
        .get_mut(&root)
        .unwrap()
        .content = "live edit".into();
    let mut second = context.clone();
    second.lease.event.job_id = Uuid::now_v7().try_into().unwrap();
    second.parts = vec![upload(&fake, UploadId::ConversationPart { slack_channel_id: second.metadata.slack_channel_id.clone(), part_index: 0 }, "later", b"{\"ts\":\"1.000001\",\"text\":\"export edit\"}\n{\"ts\":\"2.000001\",\"thread_ts\":\"1.000001\",\"text\":\"reply\"}\n".to_vec())];
    {
        let mut state = fake.0.lock().unwrap();
        state.checkpoint = Checkpoint::default();
        state.counters = ImportCounters::default();
    }
    importer.import(&second).await.unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.stored[&root].content, "live edit");
    assert_eq!(
        state.stored[&state.mappings[&source(&context, 2)]].parent_id,
        Some(root)
    );
    assert_eq!(state.counters.imported, 1);
    assert_eq!(state.counters.duplicates, 1);
}

#[tokio::test]
async fn parent_from_an_earlier_job_need_not_be_present_in_the_current_archive() {
    let (fake, context) = fixture(
        ConversationKind::PrivateChannel,
        &["{\"ts\":\"2.000001\",\"thread_ts\":\"1.000001\",\"text\":\"reply\"}\n"],
    );
    let root = Uuid::now_v7();
    fake.0
        .lock()
        .unwrap()
        .mappings
        .insert(source(&context, 1), root);
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    let reply = &state.stored[&state.mappings[&source(&context, 2)]];
    assert_eq!(reply.parent_id, Some(root));
    assert_eq!(reply.orphaned_thread_ts, None);
    assert_eq!(state.counters.imported, 1);
}

#[tokio::test]
async fn retry_after_committed_batch_replays_prefix_without_double_counting() {
    let (fake, mut context) = fixture(
        ConversationKind::PublicChannel,
        &[
            "{\"ts\":\"1.000001\",\"text\":\"root\"}\n{\"ts\":\"2.000001\",\"thread_ts\":\"1.000001\",\"text\":\"reply\"}\n{\"ts\":\"3.000001\",\"text\":\"last\"}\n",
        ],
    );
    let importer = importer(
        &fake,
        ImportLimits {
            database_batch_messages: 1,
            ..ImportLimits::default()
        },
    );
    fake.0.lock().unwrap().fail_commit = Some(1);
    assert_eq!(
        importer
            .import(&context)
            .await
            .unwrap_err()
            .into_current_context(),
        ImportError::Retryable
    );
    {
        let state = fake.0.lock().unwrap();
        assert_eq!(state.counters.imported, 1);
        assert!(state.settlements.is_empty());
        context.checkpoint = state.checkpoint;
    }
    context.lease.generation += 1;
    importer.import(&context).await.unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.counters.processed, 3);
    assert_eq!(state.counters.imported, 3);
    assert_eq!(state.counters.duplicates, 0);
    let root = state.mappings[&source(&context, 1)];
    assert_eq!(
        state.stored[&state.mappings[&source(&context, 2)]].parent_id,
        Some(root)
    );
    assert_eq!(state.created.len(), 1);
}

#[tokio::test]
async fn monotonic_normalized_time_is_validated_across_parts_and_replayed_prefix() {
    for checkpoint in [
        Checkpoint::default(),
        Checkpoint {
            part_index: 1,
            record_index: 0,
        },
    ] {
        for second in [
            "{\"ts\":\"1.000001\",\"text\":\"duplicate\"}\n",
            "{\"ts\":\"9.000001\",\"subtype\":\"message_changed\",\"message\":{\"ts\":\"0.000001\",\"text\":\"older inner identity\"}}\n",
        ] {
            let (fake, mut context) = fixture(
                ConversationKind::PublicChannel,
                &["{\"ts\":\"1.000001\",\"text\":\"root\"}\n", second],
            );
            context.checkpoint = checkpoint;
            importer(&fake, ImportLimits::default())
                .import(&context)
                .await
                .unwrap();
            let state = fake.0.lock().unwrap();
            assert_eq!(
                state.settlements[0],
                (ConversationStatus::Failed, Some(ImportError::InvalidInput))
            );
            assert!(state.commits.is_empty());
        }
    }
}

#[tokio::test]
async fn byte_record_manifest_and_digest_limits_are_rechecked() {
    for case in 0..11 {
        let (fake, mut context) = fixture(
            ConversationKind::PublicChannel,
            &["{\"ts\":\"1.000001\",\"text\":\"hello\"}\n"],
        );
        let mut limits = ImportLimits::default();
        match case {
            0 => limits.record_bytes = 10,
            1 => limits.part_bytes = 10,
            2 => context.parts[0].registered.descriptor.record_count = Some(2),
            3 => context.parts[0].registered.descriptor.sha256 = "0".repeat(64).parse().unwrap(),
            4 => context.parts[0].registered.descriptor.byte_length += 1,
            5 => {
                context.parts[0].registered.descriptor.upload = UploadId::ConversationPart {
                    slack_channel_id: "COTHER".parse().unwrap(),
                    part_index: 0,
                }
            }
            6 => limits.database_batch_bytes = 1,
            7 => {
                let mut state = fake.0.lock().unwrap();
                state
                    .objects
                    .get_mut(&context.users.registered.key)
                    .unwrap()
                    .push(b' ');
            }
            8 => context.parts[0].registered.descriptor.record_count = Some(20_001),
            9 => limits.json_bytes = 10,
            10 => {
                let key = &context.parts[0].registered.key;
                fake.0.lock().unwrap().objects.get_mut(key).unwrap().pop();
                context.parts[0].registered.descriptor.byte_length -= 1;
            }
            _ => unreachable!(),
        }
        if case == 1 {
            limits.record_bytes = 10;
        }
        importer(&fake, limits).import(&context).await.unwrap();
        let state = fake.0.lock().unwrap();
        assert_eq!(
            state.settlements[0].0,
            ConversationStatus::Failed,
            "case {case}"
        );
        assert!(state.commits.is_empty());
    }
}

#[tokio::test]
async fn skipped_only_records_checkpoint_and_byte_ceiling_split_batches() {
    let (fake, context) = fixture(
        ConversationKind::PublicChannel,
        &[
            "{\"ts\":\"1.000001\",\"text\":\"\"}\n{\"ts\":\"2.000001\",\"subtype\":\"channel_join\"}\n",
        ],
    );
    importer(
        &fake,
        ImportLimits {
            database_batch_messages: 1,
            ..ImportLimits::default()
        },
    )
    .import(&context)
    .await
    .unwrap();
    {
        let state = fake.0.lock().unwrap();
        assert_eq!(state.commits.len(), 2);
        assert_eq!(state.counters.skipped, 2);
    }
    let (fake, context) = fixture(
        ConversationKind::PublicChannel,
        &["{\"ts\":\"1.000001\",\"text\":\"one\"}\n{\"ts\":\"2.000001\",\"text\":\"two\"}\n"],
    );
    importer(
        &fake,
        ImportLimits {
            database_batch_bytes: 700,
            ..ImportLimits::default()
        },
    )
    .import(&context)
    .await
    .unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.commits.len(), 2);
    assert!(state.commits.iter().all(|batch| {
        batch
            .messages
            .iter()
            .map(|message| historical_message_bytes(message).unwrap())
            .sum::<u64>()
            <= 700
    }));
}

#[tokio::test]
async fn failed_missing_and_stale_search_receipts_retry_and_only_publication_completes() {
    let fake = Fake::default();
    let mut request = SearchBackfill {
        job_id: Uuid::now_v7().try_into().unwrap(),
        channel_ids: vec![Uuid::now_v7()],
        generation: 7,
        state: SearchState::Pending,
        updated_at: now(),
    };
    fake.0.lock().unwrap().search_failure = true;
    assert!(
        reconcile_search(&fake, &fake, &fake, &request)
            .await
            .is_err()
    );
    assert!(fake.0.lock().unwrap().recorded_search.is_empty());
    fake.0.lock().unwrap().search_failure = false;
    reconcile_search(&fake, &fake, &fake, &request)
        .await
        .unwrap();
    let receipt = fake.0.lock().unwrap().receipts[0];
    assert_eq!(
        fake.0.lock().unwrap().recorded_search,
        [SearchState::Submitted {
            receipt_id: receipt
        }]
    );
    request.state = SearchState::Submitted {
        receipt_id: receipt,
    };
    reconcile_search(&fake, &fake, &fake, &request)
        .await
        .unwrap();
    assert_eq!(fake.0.lock().unwrap().recorded_search.len(), 1);
    request.updated_at = now() - Duration::minutes(31);
    reconcile_search(&fake, &fake, &fake, &request)
        .await
        .unwrap();
    assert_eq!(fake.0.lock().unwrap().receipts.len(), 2);
    fake.0.lock().unwrap().search_state = Some(SearchState::Failed);
    reconcile_search(&fake, &fake, &fake, &request)
        .await
        .unwrap();
    assert_eq!(fake.0.lock().unwrap().receipts.len(), 3);
    fake.0.lock().unwrap().search_state = Some(SearchState::Completed);
    reconcile_search(&fake, &fake, &fake, &request)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.recorded_search.last(), Some(&SearchState::Completed));
    assert!(state.polls.iter().all(|id| *id == receipt));
    assert!(
        state
            .submissions
            .iter()
            .all(|scope| scope == &(request.job_id, request.channel_ids.clone(), 7))
    );
}

#[tokio::test]
async fn new_public_channel_announces_sorted_members_once_after_bind() {
    let (fake, context) = fixture(ConversationKind::PublicChannel, &[]);
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.trace, ["bind", "announce"]);
    assert_eq!(state.announcements.len(), 1);
    let announcement = &state.announcements[0];
    assert_eq!(announcement.team_id, context.team_id);
    assert_eq!(announcement.joined, user("admin@example.com"));
    assert_eq!(announcement.joined_name.as_deref(), Some("Importer Admin"));
    assert_eq!(
        announcement.members,
        vec![
            user("admin@example.com"),
            user("alice+raw@example.com"),
            user("bob@example.com"),
        ]
    );
    assert_eq!(state.settlements, [(ConversationStatus::Completed, None)]);
}

#[tokio::test]
async fn resolved_dm_announces_its_two_members() {
    let (fake, context) = fixture(ConversationKind::DirectMessage, &[]);
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.announcements.len(), 1);
    let announcement = &state.announcements[0];
    assert_eq!(announcement.joined, context.requested_by);
    assert_eq!(announcement.joined_name.as_deref(), Some("Importer Admin"));
    assert_eq!(
        announcement.members,
        vec![user("alice+raw@example.com"), user("bob@example.com")]
    );
    assert!(!announcement.members.contains(&context.requested_by));
}

#[tokio::test]
async fn unresolvable_dm_announces_nothing() {
    let (fake, mut context) = fixture(ConversationKind::DirectMessage, &[]);
    context.metadata.member_ids = vec!["U1".parse().unwrap(), "U3".parse().unwrap()];
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    assert!(state.announcements.is_empty());
    assert!(state.trace.is_empty());
    assert_eq!(state.settlements[0].0, ConversationStatus::Skipped);
}

#[tokio::test]
async fn unauthorized_existing_target_announces_nothing() {
    let (fake, context) = fixture(ConversationKind::PublicChannel, &[]);
    let id = Uuid::now_v7();
    {
        let mut state = fake.0.lock().unwrap();
        state.reserved = Some(id);
        state.targets.insert(
            id,
            TargetFacts {
                id,
                kind: TargetKind::Team(context.team_id),
                dm_members: HashSet::new(),
            },
        );
        state.target_denied = true;
    }
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    assert!(state.announcements.is_empty());
    assert!(state.plans.is_empty());
    assert!(state.trace.is_empty());
    assert_eq!(
        state.settlements,
        [(ConversationStatus::Skipped, Some(ImportError::Unavailable))]
    );
}

#[tokio::test]
async fn failed_bind_announces_nothing() {
    let (fake, context) = fixture(ConversationKind::PublicChannel, &[]);
    fake.0.lock().unwrap().fail_bind = true;
    let error = importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap_err();
    assert_eq!(error.into_current_context(), ImportError::Internal);
    let state = fake.0.lock().unwrap();
    assert!(state.announcements.is_empty());
    assert!(state.plans.is_empty());
    assert!(state.trace.is_empty());
    assert!(state.settlements.is_empty());
}

#[tokio::test]
async fn announcer_error_still_completes_after_one_announcement() {
    let (fake, context) = fixture(ConversationKind::PublicChannel, &[]);
    fake.0.lock().unwrap().fail_announce = true;
    importer(&fake, ImportLimits::default())
        .import(&context)
        .await
        .unwrap();
    let state = fake.0.lock().unwrap();
    assert_eq!(state.trace, ["bind", "announce"]);
    assert_eq!(state.announcements.len(), 1);
    assert_eq!(
        state.announcements[0].members,
        vec![
            user("admin@example.com"),
            user("alice+raw@example.com"),
            user("bob@example.com"),
        ]
    );
    assert_eq!(state.settlements, [(ConversationStatus::Completed, None)]);
}
