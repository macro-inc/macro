use std::collections::HashSet;

use channels::domain::historical::{HistoricalChannel, HistoricalChannelKind};
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use import::{domain::ports::CanonicalImportRepo, outbound::pg_import_repo::PgImportRepo};
use macro_user_id::user_id::MacroUserIdStr;
use slack_integration::{
    domain::{
        importer::targets::{ImportTargets, TargetPlan},
        models::*,
        ports::{ExecutionRepo, HistoricalSink, ImportAuthorizer, ImportLedger, ImportRepo},
    },
    outbound::{import_ledger::CanonicalImportLedger, pg_slack_import_repo::PgSlackImportRepo},
};
use sqlx::{Executor, PgPool};
use uuid::Uuid;

use super::{
    authorizer::WorkerAuthorizer, channel_sink::ChannelImportSink, target_key, target_kind,
};

type Access = EntityAccessServiceImpl<PgAccessRepository>;
type Sink = ChannelImportSink<Access>;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|t17@example.com").unwrap()
}
fn other() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|other@example.com").unwrap()
}
fn authorizer(pool: &PgPool) -> WorkerAuthorizer<Access> {
    WorkerAuthorizer::new(
        pool.clone(),
        EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone())),
    )
}
fn sink(pool: &PgPool) -> Sink {
    ChannelImportSink::new(pool.clone(), authorizer(pool), ImportLimits::default()).unwrap()
}
fn repo(pool: &PgPool) -> PgSlackImportRepo {
    PgSlackImportRepo::new(pool.clone(), ImportLimits::default())
}

async fn team(pool: &PgPool) -> TeamId {
    let account = Uuid::now_v7();
    let team = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 't17', 't17@example.com', 't17-customer')", account).execute(pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|t17@example.com', 't17@example.com', $1)"#, account).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Atomic history', 'macro|t17@example.com')", team).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, 'macro|t17@example.com', 'owner')", team).execute(pool).await.unwrap();
    team.try_into().unwrap()
}

async fn claim(
    pool: &PgPool,
    team: TeamId,
    kind: ConversationKind,
    records: u32,
) -> ClaimedConversation {
    let repo = repo(pool);
    let job = repo
        .create(
            team,
            &user(),
            &CreateImport {
                idempotency_token: Uuid::now_v7().try_into().unwrap(),
                source: SourceIdentity::ConfirmedUnknown,
                include_message_history: records > 0,
                conversations: vec![ConversationMetadata {
                    slack_channel_id: "C1".parse().unwrap(),
                    kind,
                    name: "historical".into(),
                    folder: "historical".parse().unwrap(),
                    member_ids: vec![],
                    creator_id: None,
                    created_at: Some("1.000001".parse().unwrap()),
                    archived: false,
                    message_count: None,
                }],
            },
            &ImportLimits::default(),
        )
        .await
        .unwrap()
        .job_id;
    let mut descriptors = vec![UploadDescriptor {
        upload: UploadId::Users,
        sha256: "a".repeat(64).parse().unwrap(),
        byte_length: 10,
        record_count: None,
    }];
    if records > 0 {
        descriptors.push(UploadDescriptor {
            upload: UploadId::ConversationPart {
                slack_channel_id: "C1".parse().unwrap(),
                part_index: 0,
            },
            sha256: "b".repeat(64).parse().unwrap(),
            byte_length: 100,
            record_count: Some(records),
        });
    }
    let seal = ConversationSeal::from_descriptors(
        "C1".parse().unwrap(),
        &descriptors[1..],
        &ImportLimits::default(),
    )
    .unwrap();
    let uploads: Vec<_> = repo
        .register(team, job, &RegisterUploads { descriptors })
        .await
        .unwrap()
        .into_iter()
        .map(|registered| VerifiedUpload {
            registered,
            identity: ObjectIdentity::Version("v1".parse().unwrap()),
        })
        .collect();
    repo.complete(team, job, &uploads, Some(&seal))
        .await
        .unwrap();
    let ClaimOutcome::Claimed(context) = repo
        .claim(
            &ImportEvent {
                job_id: job,
                slack_channel_id: "C1".parse().unwrap(),
                generation: 1,
            },
            Uuid::now_v7().try_into().unwrap(),
        )
        .await
        .unwrap()
    else {
        panic!("expected claim")
    };
    *context
}

async fn plan(pool: &PgPool, context: &ClaimedConversation) -> TargetPlan {
    let ledger = CanonicalImportLedger::new(PgImportRepo::new(pool.clone()));
    let reserved = ledger
        .reserve(context.team_id, &user(), &context.metadata, None)
        .await
        .unwrap();
    TargetPlan {
        channel_id: reserved.channel_id,
        metadata: context.metadata.clone(),
        team_id: context.team_id,
        requested_by: user(),
        owner: user(),
        members: HashSet::from([user(), other()]),
        name: "original".into(),
        created_at: chrono::DateTime::from_timestamp(1, 1000).unwrap(),
    }
}
async fn target(pool: &PgPool, context: &ClaimedConversation) -> TargetPlan {
    let plan = plan(pool, context).await;
    let sink = sink(pool);
    let (_, created) = sink.create(&context.lease, &plan).await.unwrap();
    assert!(created);
    sink.bind(&context.lease, &plan, &[ImportWarning::CreationTimeFromJob])
        .await
        .unwrap();
    plan
}
fn message(context: &ClaimedConversation, channel: Uuid, seconds: u32) -> HistoricalMessage {
    let ts: SlackTimestamp = format!("{seconds}.000001").parse().unwrap();
    HistoricalMessage {
        id: Uuid::now_v7(),
        source: SourceMessageId {
            team_id: context.team_id,
            slack_channel_id: context.metadata.slack_channel_id.clone(),
            ts,
        },
        channel_id: channel,
        parent_id: None,
        orphaned_thread_ts: None,
        sender: HistoricalSender::User(user()),
        imported_author: Some("Source name".into()),
        content: "history".into(),
        import_order: u64::from(seconds),
        reactions: vec![
            HistoricalReaction {
                user_id: other(),
                emoji: "x".into(),
                created_at: ts
            };
            2
        ],
    }
}
fn batch(
    context: &ClaimedConversation,
    channel: Uuid,
    seconds: &[u32],
    checkpoint: Checkpoint,
) -> HistoricalBatch {
    HistoricalBatch {
        lease: context.lease.clone(),
        messages: seconds
            .iter()
            .map(|s| message(context, channel, *s))
            .collect(),
        checkpoint,
        skipped: 0,
    }
}
fn end() -> Checkpoint {
    Checkpoint {
        part_index: 1,
        record_index: 0,
    }
}
async fn counts(pool: &PgPool) -> (i64, i64, i64, i64) {
    let row = sqlx::query!(r#"SELECT (SELECT count(*) FROM comms_messages) AS "messages!", (SELECT count(*) FROM comms_reactions) AS "reactions!", (SELECT count(*) FROM slack_import_message_map) AS "mappings!", (SELECT count(*) FROM slack_import_outbox WHERE kind = 'search') AS "search!""#).fetch_one(pool).await.unwrap();
    (row.messages, row.reactions, row.mappings, row.search)
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn failures_after_each_insert_roll_back_every_batch_effect(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::PublicChannel, 1).await;
    let plan = target(&pool, &context).await;
    let before = counts(&pool).await;
    pool.execute(include_str!("fail_inserts.sql"))
        .await
        .unwrap();
    for table in [
        "slack_import_message_map",
        "comms_messages",
        "comms_reactions",
    ] {
        // Identifiers are this test's closed list, not archive input. DDL is dynamic.
        pool.execute(format!("CREATE TRIGGER fail_insert AFTER INSERT ON {table} FOR EACH ROW EXECUTE FUNCTION fail_import_insert()").as_str()).await.unwrap();
        assert!(
            sink(&pool)
                .commit(batch(&context, plan.channel_id, &[2], end()))
                .await
                .is_err(),
            "{table}"
        );
        assert_eq!(counts(&pool).await, before, "{table}");
        let progress = repo(&pool)
            .progress(team, context.lease.event.job_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            progress.conversations[0].counters,
            ImportCounters::default()
        );
        assert_eq!(progress.conversations[0].search, SearchState::NotNeeded);
        pool.execute(format!("DROP TRIGGER fail_insert ON {table}").as_str())
            .await
            .unwrap();
    }
    let counters = sink(&pool)
        .commit(batch(&context, plan.channel_id, &[2], end()))
        .await
        .unwrap();
    assert_eq!(counters.imported, 1);
    assert_eq!(counters.reactions, 1);
    assert_eq!(
        counts(&pool).await,
        (before.0 + 1, before.1 + 1, before.2 + 1, before.3 + 1)
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn overlapping_jobs_remap_speculative_parents_without_duplicate_reactions(pool: PgPool) {
    let team = team(&pool).await;
    let first = claim(&pool, team, ConversationKind::PublicChannel, 2).await;
    let plan = target(&pool, &first).await;
    let second = claim(&pool, team, ConversationKind::PublicChannel, 2).await;
    sink(&pool).bind(&second.lease, &plan, &[]).await.unwrap();
    let mut a = batch(&first, plan.channel_id, &[2, 3], end());
    a.messages[1].parent_id = Some(a.messages[0].id);
    let mut b = batch(&second, plan.channel_id, &[2, 4], end());
    b.messages[1].parent_id = Some(b.messages[0].id);
    let sink = sink(&pool);
    let (a, b) = tokio::join!(sink.commit(a), sink.commit(b));
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.imported + b.imported, 3);
    assert_eq!(a.duplicates + b.duplicates, 1);
    assert_eq!(a.reactions + b.reactions, 3);
    let root = sink
        .lookup(&[message(&first, plan.channel_id, 2).source])
        .await
        .unwrap()[0]
        .1;
    let replies = sqlx::query_scalar!(
        "SELECT thread_id FROM comms_messages WHERE channel_id = $1 AND id <> $2",
        plan.channel_id,
        root
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(replies, vec![Some(root), Some(root)]);
    // Replaying a committed checkpoint never increments any counter.
    let replay = sink
        .commit(batch(&first, plan.channel_id, &[2, 3], end()))
        .await
        .unwrap();
    assert_eq!(replay, a);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn stale_lease_and_cancellation_keep_committed_search_work(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::PublicChannel, 2).await;
    let plan = target(&pool, &context).await;
    let first = sink(&pool)
        .commit(batch(
            &context,
            plan.channel_id,
            &[2],
            Checkpoint {
                part_index: 0,
                record_index: 1,
            },
        ))
        .await
        .unwrap();
    assert_eq!(first.imported, 1);
    repo(&pool)
        .cancel(team, context.lease.event.job_id)
        .await
        .unwrap();
    sqlx::query!("UPDATE slack_import_conversation SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(context.lease.event.job_id)).execute(&pool).await.unwrap();
    let before = counts(&pool).await;
    let error = sink(&pool)
        .commit(batch(&context, plan.channel_id, &[3], end()))
        .await
        .unwrap_err();
    assert_eq!(*error.current_context(), ImportError::LeaseLost);
    repo(&pool).reconcile(10).await.unwrap();
    assert_eq!(counts(&pool).await, before);
    let progress = repo(&pool)
        .progress(team, context.lease.event.job_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(progress.status, JobStatus::Cancelled);
    assert_eq!(progress.conversations[0].counters, first);
    let search = repo(&pool).pending_search(10).await.unwrap();
    assert_eq!(search.len(), 1);
    assert_eq!(search[0].channel_ids, vec![plan.channel_id]);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn reclaimed_generation_and_admin_revocation_block_writes(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::PublicChannel, 2).await;
    let plan = target(&pool, &context).await;
    sqlx::query!("UPDATE slack_import_conversation SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(context.lease.event.job_id)).execute(&pool).await.unwrap();
    let ClaimOutcome::Claimed(reclaimed) = repo(&pool)
        .claim(&context.lease.event, Uuid::now_v7().try_into().unwrap())
        .await
        .unwrap()
    else {
        panic!("reclaim")
    };
    let sink = sink(&pool);
    let next = Checkpoint {
        part_index: 0,
        record_index: 1,
    };
    let (stale, fresh) = tokio::join!(
        sink.commit(batch(&context, plan.channel_id, &[2], next)),
        sink.commit(batch(&reclaimed, plan.channel_id, &[2], next))
    );
    assert_eq!(
        *stale.unwrap_err().current_context(),
        ImportError::LeaseLost
    );
    assert_eq!(fresh.unwrap().imported, 1);
    let before = counts(&pool).await;
    sqlx::query!(
        "UPDATE team_user SET team_role = 'member' WHERE team_id = $1",
        Uuid::from(team)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        *sink
            .commit(batch(&reclaimed, plan.channel_id, &[3], end()))
            .await
            .unwrap_err()
            .current_context(),
        ImportError::Unavailable
    );
    assert!(sink.bind(&reclaimed.lease, &plan, &[]).await.is_err());
    assert_eq!(counts(&pool).await, before);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn new_dm_has_exact_pair_and_no_importing_admin(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::DirectMessage, 0).await;
    let mut plan = plan(&pool, &context).await;
    let stranger = MacroUserIdStr::parse_from_str("macro|stranger@example.com").unwrap();
    plan.owner = other();
    plan.members = HashSet::from([other(), stranger]);
    let sink = sink(&pool);
    let (facts, created) = sink.create(&context.lease, &plan).await.unwrap();
    assert!(created);
    assert_eq!(facts.dm_members, plan.members);
    assert!(!facts.dm_members.contains(&user()));
    sink.bind(&context.lease, &plan, &[]).await.unwrap();
    let mut invalid = plan.clone();
    invalid.members.insert(user());
    assert!(sink.bind(&context.lease, &invalid, &[]).await.is_err());
    assert_eq!(
        sink.inspect(plan.channel_id)
            .await
            .unwrap()
            .unwrap()
            .dm_members,
        plan.members
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn stable_reservation_recovers_creation_and_preserves_existing_state(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::PrivateChannel, 0).await;
    let mut plan = plan(&pool, &context).await;
    let other = other();
    let sink = sink(&pool);
    let (first, created) = sink.create(&context.lease, &plan).await.unwrap();
    assert!(created);
    // Crash before ledger completion/bind: reserved ID and ready provenance survive.
    let again = PgImportRepo::new(pool.clone())
        .reserve_target(
            &user(),
            &target_key(team, &context.metadata.slack_channel_id).unwrap(),
            target_kind(context.metadata.kind),
            None,
        )
        .await
        .unwrap();
    assert_eq!(again.channel_id, first.id);
    assert!(again.ready);
    plan.name = "must not overwrite".into();
    plan.created_at = chrono::Utc::now();
    let (_, created) = sink.create(&context.lease, &plan).await.unwrap();
    assert!(!created);
    sqlx::query!("UPDATE comms_channel_participants SET left_at = now(), role = 'admin' WHERE channel_id = $1 AND user_id = $2", plan.channel_id, other.as_ref()).execute(&pool).await.unwrap();
    sink.bind(&context.lease, &plan, &[ImportWarning::CreationTimeFromJob])
        .await
        .unwrap();
    sink.bind(&context.lease, &plan, &[ImportWarning::CreationTimeFromJob])
        .await
        .unwrap();
    let channel = sqlx::query!(
        "SELECT name, created_at, auto_join_team, team_id FROM comms_channels WHERE id = $1",
        plan.channel_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(channel.name.as_deref(), Some("original"));
    assert_eq!(channel.created_at.timestamp(), 1);
    assert!(!channel.auto_join_team);
    assert!(channel.team_id.is_none());
    let member = sqlx::query!(r#"SELECT role::text AS "role!", left_at FROM comms_channel_participants WHERE channel_id = $1 AND user_id = $2"#, plan.channel_id, other.as_ref()).fetch_one(&pool).await.unwrap();
    assert_eq!(member.role, "admin");
    assert!(member.left_at.is_some());
    let progress = repo(&pool)
        .progress(team, context.lease.event.job_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(progress.conversations[0].warnings.len(), 1);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn private_reuse_requires_management_or_compatible_prior_provenance(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::PrivateChannel, 1).await;
    let channel = Uuid::now_v7();
    let mut tx = pool.begin().await.unwrap();
    PgChannelsRepo::ensure_reserved_channel_in(
        &mut tx,
        &HistoricalChannel {
            id: channel,
            name: "private".into(),
            kind: HistoricalChannelKind::Private,
            owner: other(),
            participants: HashSet::from([user()]),
            created_at: chrono::Utc::now(),
        },
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let auth = authorizer(&pool);
    let requester = user();
    assert!(
        auth.require_target(team, &user(), &context.metadata, channel)
            .await
            .is_err()
    );
    sqlx::query!("UPDATE comms_channel_participants SET role = 'admin' WHERE channel_id = $1 AND user_id = $2", channel, requester.as_ref()).execute(&pool).await.unwrap();
    auth.require_target(team, &user(), &context.metadata, channel)
        .await
        .unwrap();
    let ledger = CanonicalImportLedger::new(PgImportRepo::new(pool.clone()));
    let reservation = ledger
        .reserve(team, &user(), &context.metadata, Some(channel))
        .await
        .unwrap();
    ledger
        .complete(&reservation, context.metadata.kind)
        .await
        .unwrap();
    sqlx::query!("UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2", channel, requester.as_ref()).execute(&pool).await.unwrap();
    auth.require_target(team, &user(), &context.metadata, channel)
        .await
        .unwrap();
    // Provenance is not permission to keep writing after visibility/type changes.
    sqlx::query!(
        "UPDATE comms_channels SET channel_type = 'public' WHERE id = $1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        auth.require_target(team, &user(), &context.metadata, channel)
            .await
            .is_err()
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn unrelated_dm_pair_is_not_granted_provenance_and_pair_races_fail_closed(pool: PgPool) {
    use channels::{
        domain::{dm::DmPair, historical::DmCreation},
        outbound::pg_channels_repo::historical::ensure_dm_in,
    };
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::DirectMessage, 0).await;
    let mut plan = plan(&pool, &context).await;
    let stranger = MacroUserIdStr::parse_from_str("macro|stranger@example.com").unwrap();
    plan.owner = other();
    plan.members = HashSet::from([other(), stranger.clone()]);
    let pair = DmPair::new(other(), stranger.clone()).unwrap();
    let mut tx = pool.begin().await.unwrap();
    let winner = ensure_dm_in(
        &mut tx,
        pair,
        DmCreation::Historical {
            id: Uuid::now_v7(),
            created_at: plan.created_at,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let auth = authorizer(&pool);
    assert!(
        auth.require_target(team, &user(), &context.metadata, winner.id)
            .await
            .is_err()
    );
    // Discovery raced after the canonical candidate was reserved: do not substitute
    // the winner or create a duplicate DM, and never add the admin as a third member.
    assert!(sink(&pool).create(&context.lease, &plan).await.is_err());
    assert!(
        sink(&pool)
            .inspect(plan.channel_id)
            .await
            .unwrap()
            .is_none()
    );
    let winner = sink(&pool).inspect(winner.id).await.unwrap().unwrap();
    assert_eq!(winner.dm_members, plan.members);
    assert!(!winner.dm_members.contains(&user()));
}
