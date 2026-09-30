use super::*;

pub(crate) async fn fixture(
    pool: &PgPool,
    records: Option<u32>,
) -> (PgSlackImportRepo, TeamId, ImportEvent) {
    fixture_parts(pool, records, 1).await
}

pub(crate) async fn fixture_parts(
    pool: &PgPool,
    records: Option<u32>,
    parts: u32,
) -> (PgSlackImportRepo, TeamId, ImportEvent) {
    let user = Uuid::now_v7();
    let team = Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'lifecycle', 'lifecycle@example.com', 'lifecycle-customer')", user).execute(pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|lifecycle@example.com', 'lifecycle@example.com', $1)"#, user).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO team (id, name, owner_id) VALUES ($1, 'Lifecycle', 'macro|lifecycle@example.com')", team).execute(pool).await.unwrap();
    let team = team.try_into().unwrap();
    let repo = PgSlackImportRepo::new(pool.clone(), ImportLimits::default());
    let job = repo
        .create(
            team,
            &MacroUserIdStr::parse_from_str("macro|lifecycle@example.com").unwrap(),
            &CreateImport {
                idempotency_token: Uuid::now_v7().try_into().unwrap(),
                source: SourceIdentity::ConfirmedUnknown,
                include_message_history: records.is_some(),
                conversations: vec![ConversationMetadata {
                    slack_channel_id: "C1".parse().unwrap(),
                    kind: ConversationKind::PublicChannel,
                    name: "source".into(),
                    folder: "source".parse().unwrap(),
                    member_ids: vec![],
                    creator_id: None,
                    created_at: None,
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
    if let Some(records) = records {
        for part_index in 0..parts {
            descriptors.push(UploadDescriptor {
                upload: UploadId::ConversationPart {
                    slack_channel_id: "C1".parse().unwrap(),
                    part_index,
                },
                sha256: "b".repeat(64).parse().unwrap(),
                byte_length: 100,
                record_count: Some(records),
            });
        }
    }
    let seal = ConversationSeal::from_descriptors(
        "C1".parse().unwrap(),
        &descriptors[1..],
        &ImportLimits::default(),
    )
    .unwrap();
    let verified: Vec<_> = repo
        .register(team, job, &RegisterUploads { descriptors })
        .await
        .unwrap()
        .into_iter()
        .map(|registered| VerifiedUpload {
            registered,
            identity: ObjectIdentity::Version("v1".parse().unwrap()),
        })
        .collect();
    repo.complete(team, job, &verified, Some(&seal))
        .await
        .unwrap();
    (
        repo,
        team,
        ImportEvent {
            job_id: job,
            slack_channel_id: "C1".parse().unwrap(),
            generation: 1,
        },
    )
}

pub(crate) async fn claim(repo: &PgSlackImportRepo, event: &ImportEvent) -> ClaimedConversation {
    let ClaimOutcome::Claimed(claimed) = repo
        .claim(event, Uuid::now_v7().try_into().unwrap())
        .await
        .unwrap()
    else {
        panic!("expected claim");
    };
    *claimed
}

pub(crate) async fn expire(pool: &PgPool, event: &ImportEvent) {
    sqlx::query!("UPDATE slack_import_conversation SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1 AND slack_channel_id = $2", Uuid::from(event.job_id), event.slack_channel_id.as_str()).execute(pool).await.unwrap();
}

fn assert_error<T>(result: PortResult<T>, expected: ImportError) {
    match result {
        Err(error) => assert_eq!(error.into_current_context(), expected),
        Ok(_) => panic!("expected error"),
    }
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn claim_heartbeat_reclaim_fences_stale_worker(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(3)).await;
    assert_eq!(repo.requester(&event).await.unwrap().unwrap().0, team);
    let first = claim(&repo, &event).await;
    assert_eq!(first.parts.len(), 1);
    assert_eq!(first.checkpoint, Checkpoint::default());
    assert_eq!(first.lease.attempts, 1);
    assert!(matches!(
        repo.claim(&event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap(),
        ClaimOutcome::ActiveLease
    ));
    let renewed = repo.heartbeat(&first.lease).await.unwrap();
    assert!(renewed.expires_at >= first.lease.expires_at);
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Defer
    );
    expire(&pool, &event).await;
    assert_error(repo.heartbeat(&renewed).await, ImportError::LeaseLost);
    let second = claim(&repo, &event).await;
    assert_eq!(second.lease.generation, first.lease.generation + 1);
    assert_eq!(second.lease.attempts, 2);
    assert_ne!(second.lease.token, first.lease.token);
    assert_error(
        repo.settle(&first.lease, ConversationStatus::Failed, None)
            .await,
        ImportError::LeaseLost,
    );
    assert_error(
        repo.settle(&second.lease, ConversationStatus::Completed, None)
            .await,
        ImportError::Conflict,
    );
    repo.settle(
        &second.lease,
        ConversationStatus::Failed,
        Some(ImportError::Internal),
    )
    .await
    .unwrap();
    let progress = repo.finalize(team, event.job_id).await.unwrap();
    assert_eq!(progress.status, JobStatus::Failed);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn finalize_cancel_race_and_duplicate_terminal_updates(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let (finalized, cancelled) = futures::join!(
        repo.finalize(team, event.job_id),
        repo.cancel(team, event.job_id)
    );
    finalized.unwrap();
    cancelled.unwrap();
    let before = repo.progress(team, event.job_id).await.unwrap().unwrap();
    assert_eq!(before.status, JobStatus::Cancelled);
    assert_eq!(before.conversations[0].status, ConversationStatus::Skipped);
    assert_eq!(repo.finalize(team, event.job_id).await.unwrap(), before);
    assert_eq!(repo.cancel(team, event.job_id).await.unwrap(), before);
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    repo.mark_published(&event).await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id).await.unwrap().unwrap(),
        before
    );
    assert!(repo.pending_events(50).await.unwrap().is_empty());
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn cancel_claim_race_and_running_completion(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let (claim, cancel) = futures::join!(
        repo.claim(&event, Uuid::now_v7().try_into().unwrap()),
        repo.cancel(team, event.job_id)
    );
    cancel.unwrap();
    match claim.unwrap() {
        ClaimOutcome::Claimed(claimed) => {
            assert_eq!(
                repo.progress(team, event.job_id)
                    .await
                    .unwrap()
                    .unwrap()
                    .status,
                JobStatus::Cancelling
            );
            repo.heartbeat(&claimed.lease).await.unwrap();
            repo.settle(&claimed.lease, ConversationStatus::Completed, None)
                .await
                .unwrap();
            assert_error(
                repo.settle(&claimed.lease, ConversationStatus::Completed, None)
                    .await,
                ImportError::LeaseLost,
            );
        }
        ClaimOutcome::Obsolete => (),
        ClaimOutcome::ActiveLease => panic!("no other worker"),
    }
    let progress = repo.progress(team, event.job_id).await.unwrap().unwrap();
    assert_eq!(progress.status, JobStatus::Cancelled);
    assert!(matches!(
        repo.claim(&event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap(),
        ClaimOutcome::Obsolete
    ));
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn lost_publish_ack_recovers_and_reconcile_supersedes_old_dlq(pool: PgPool) {
    let (repo, _, event) = fixture(&pool, None).await;
    assert_eq!(repo.pending_events(1).await.unwrap(), vec![event.clone()]);
    assert!(repo.pending_events(1).await.unwrap().is_empty());
    sqlx::query!("UPDATE slack_import_outbox SET available_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(event.job_id)).execute(&pool).await.unwrap();
    assert_eq!(repo.pending_events(1).await.unwrap(), vec![event.clone()]);
    repo.mark_published(&event).await.unwrap();
    repo.mark_published(&event).await.unwrap();
    assert!(repo.pending_events(1).await.unwrap().is_empty());
    let old = claim(&repo, &event).await;
    expire(&pool, &event).await;
    repo.reconcile(50).await.unwrap();
    let new = repo.pending_events(1).await.unwrap().pop().unwrap();
    assert_eq!(new.generation, event.generation + 1);
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert_error(repo.heartbeat(&old.lease).await, ImportError::LeaseLost);
    let claimed = claim(&repo, &new).await;
    assert_eq!(claimed.lease.attempts, 2);
    assert_eq!(repo.dead_letter(&new).await.unwrap(), WorkerOutcome::Defer);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn cancellation_expired_lease_settles_without_restart(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let running = claim(&repo, &event).await;
    assert_eq!(
        repo.cancel(team, event.job_id).await.unwrap().status,
        JobStatus::Cancelling
    );
    expire(&pool, &event).await;
    repo.reconcile(50).await.unwrap();
    let progress = repo.progress(team, event.job_id).await.unwrap().unwrap();
    assert_eq!(progress.status, JobStatus::Cancelled);
    assert_eq!(
        progress.conversations[0].status,
        ConversationStatus::Skipped
    );
    assert!(repo.pending_events(50).await.unwrap().is_empty());
    assert_error(repo.heartbeat(&running.lease).await, ImportError::LeaseLost);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn retry_budget_and_dlq_are_duplicate_safe(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    for attempt in 1..=MAX_ATTEMPTS {
        let running = claim(&repo, &event).await;
        assert_eq!(running.lease.attempts, attempt as u32);
        expire(&pool, &event).await;
    }
    assert!(matches!(
        repo.claim(&event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap(),
        ClaimOutcome::Obsolete
    ));
    let before = repo.finalize(team, event.job_id).await.unwrap();
    assert_eq!(before.status, JobStatus::Failed);
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert_eq!(
        repo.progress(team, event.job_id).await.unwrap().unwrap(),
        before
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn expiry_precedes_s3_lifecycle_and_empty_jobs_settle(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    sqlx::query!("UPDATE slack_import_job SET staging_expires_at = clock_timestamp() + interval '12 hours' WHERE id = $1", Uuid::from(event.job_id)).execute(&pool).await.unwrap();
    assert!(matches!(
        repo.claim(&event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap(),
        ClaimOutcome::Obsolete
    ));
    repo.reconcile(50).await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::Failed
    );
    let empty = repo
        .create(
            team,
            &MacroUserIdStr::parse_from_str("macro|lifecycle@example.com").unwrap(),
            &CreateImport {
                idempotency_token: Uuid::now_v7().try_into().unwrap(),
                source: SourceIdentity::ConfirmedUnknown,
                include_message_history: false,
                conversations: vec![],
            },
            &ImportLimits::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        repo.finalize(team, empty.job_id).await.unwrap().status,
        JobStatus::Completed
    );
    assert_eq!(
        repo.cancel(team, empty.job_id).await.unwrap().status,
        JobStatus::Completed
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn dead_letter_settles_queued_work_once(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(1)).await;
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    let before = repo.finalize(team, event.job_id).await.unwrap();
    assert_eq!(before.status, JobStatus::Failed);
    assert_eq!(before.conversations[0].status, ConversationStatus::Failed);
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
    assert_eq!(
        repo.progress(team, event.job_id).await.unwrap().unwrap(),
        before
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn expiry_closes_abandoned_uploads_and_expired_importing(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(1)).await;
    let running = claim(&repo, &event).await;
    let abandoned = repo
        .create(
            team,
            &running.requested_by,
            &CreateImport {
                idempotency_token: Uuid::now_v7().try_into().unwrap(),
                source: SourceIdentity::ConfirmedUnknown,
                include_message_history: true,
                conversations: vec![running.metadata.clone()],
            },
            &ImportLimits::default(),
        )
        .await
        .unwrap()
        .job_id;
    sqlx::query!("UPDATE slack_import_job SET staging_expires_at = clock_timestamp() + interval '12 hours' WHERE team_id = $1", Uuid::from(team)).execute(&pool).await.unwrap();
    assert_error(repo.heartbeat(&running.lease).await, ImportError::LeaseLost);
    expire(&pool, &event).await;
    repo.reconcile(50).await.unwrap();
    let failed = repo.progress(team, event.job_id).await.unwrap().unwrap();
    assert_eq!(failed.status, JobStatus::Failed);
    let skipped = repo.progress(team, abandoned).await.unwrap().unwrap();
    assert_eq!(skipped.status, JobStatus::Completed);
    assert_eq!(skipped.conversations[0].status, ConversationStatus::Skipped);
    assert_eq!(
        skipped.conversations[0].warnings,
        vec![ImportWarning::UploadsIncomplete]
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn shape_only_completion_ignores_late_dlq(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let running = claim(&repo, &event).await;
    repo.settle(&running.lease, ConversationStatus::Completed, None)
        .await
        .unwrap();
    assert_eq!(
        repo.finalize(team, event.job_id).await.unwrap().status,
        JobStatus::Completed
    );
    assert_eq!(
        repo.dead_letter(&event).await.unwrap(),
        WorkerOutcome::Acknowledge
    );
}
