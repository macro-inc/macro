use super::super::lifecycle::test::{claim, expire, fixture, fixture_parts};
use super::*;
use crate::domain::ports::{ExecutionRepo, ImportRepo};

fn checkpoint(part_index: u32, record_index: u32) -> Checkpoint {
    Checkpoint {
        part_index,
        record_index,
    }
}

async fn target(pool: &PgPool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!("INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'historical', 'private', 'macro|lifecycle@example.com')", id).execute(pool).await.unwrap();
    id
}

fn message(team: TeamId, channel: Uuid, seconds: u32) -> HistoricalMessage {
    HistoricalMessage {
        id: Uuid::now_v7(),
        source: SourceMessageId {
            team_id: team,
            slack_channel_id: "C1".parse().unwrap(),
            ts: format!("{seconds}.000001").parse().unwrap(),
        },
        channel_id: channel,
        parent_id: None,
        orphaned_thread_ts: None,
        sender: HistoricalSender::User(
            MacroUserIdStr::parse_from_str("macro|lifecycle@example.com").unwrap(),
        ),
        imported_author: None,
        content: "historical".into(),
        user_mentions: vec![],
        body_references: vec![],
        import_order: 0,
        reactions: vec![],
    }
}

// Emulate the composition root calling the message owner's helper in the SAME
// transaction. Production import helpers never write comms tables.
async fn insert_message(batch: &mut FencedBatch<'_, '_>, message: &HistoricalMessage) {
    let HistoricalSender::User(sender) = &message.sender else {
        panic!("user fixture")
    };
    sqlx::query!(
        "INSERT INTO comms_messages (id, channel_id, sender_id, content) VALUES ($1, $2, $3, $4)",
        message.id,
        message.channel_id,
        sender.as_ref(),
        message.content,
    )
    .execute(&mut **batch.transaction())
    .await
    .unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn shape_only_target_binding_is_fenced_and_immutable(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, None).await;
    let running = claim(&repo, &event).await;
    let channel = target(&pool).await;
    let other = target(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    bind_target(&mut tx, &running.lease, channel).await.unwrap();
    bind_target(&mut tx, &running.lease, channel).await.unwrap();
    assert!(bind_target(&mut tx, &running.lease, other).await.is_err());
    tx.commit().await.unwrap();
    repo.settle(&running.lease, ConversationStatus::Completed, None)
        .await
        .unwrap();
    let progress = repo.finalize(team, event.job_id).await.unwrap();
    assert_eq!(progress.status, JobStatus::Completed);
    assert_eq!(progress.conversations[0].channel_id, Some(channel));
    let mut tx = pool.begin().await.unwrap();
    assert!(bind_target(&mut tx, &running.lease, channel).await.is_err());
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn concurrent_jobs_share_first_committed_message_mapping(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(1)).await;
    let first = claim(&repo, &event).await;
    let second_job = repo
        .create(
            team,
            &first.requested_by,
            &CreateImport {
                idempotency_token: Uuid::now_v7().try_into().unwrap(),
                source: SourceIdentity::ConfirmedUnknown,
                include_message_history: true,
                conversations: vec![first.metadata.clone()],
            },
            &ImportLimits::default(),
        )
        .await
        .unwrap()
        .job_id;
    let descriptors = vec![
        first.users.registered.descriptor.clone(),
        first.parts[0].registered.descriptor.clone(),
    ];
    let seal = ConversationSeal::from_descriptors(
        event.slack_channel_id.clone(),
        &descriptors[1..],
        &ImportLimits::default(),
    )
    .unwrap();
    let uploads: Vec<_> = repo
        .register(team, second_job, &RegisterUploads { descriptors })
        .await
        .unwrap()
        .into_iter()
        .map(|registered| VerifiedUpload {
            registered,
            identity: ObjectIdentity::Version("v1".parse().unwrap()),
        })
        .collect();
    repo.complete(team, second_job, &uploads, Some(&seal))
        .await
        .unwrap();
    let second = claim(
        &repo,
        &ImportEvent {
            job_id: second_job,
            ..event.clone()
        },
    )
    .await;
    let channel = target(&pool).await;
    let first_message = message(team, channel, 1);
    let second_message = message(team, channel, 1);
    async fn commit(
        pool: &PgPool,
        lease: &Lease,
        message: &HistoricalMessage,
    ) -> (Uuid, ImportCounters) {
        let mut tx = pool.begin().await.unwrap();
        let BatchStart::Ready(mut batch) = begin_batch(
            &mut tx,
            lease,
            checkpoint(0, 0),
            checkpoint(1, 0),
            Some(message.channel_id),
        )
        .await
        .unwrap() else {
            panic!("new batch");
        };
        let mappings = batch
            .reserve_mappings(std::slice::from_ref(message))
            .await
            .unwrap();
        if mappings[0].inserted {
            insert_message(&mut batch, message).await;
        }
        let counters = batch.finish(0, 0).await.unwrap();
        tx.commit().await.unwrap();
        (mappings[0].message_id, counters)
    }
    let (left, right) = futures::join!(
        commit(&pool, &first.lease, &first_message),
        commit(&pool, &second.lease, &second_message)
    );
    assert_eq!(left.0, right.0);
    assert_eq!(left.1.imported + right.1.imported, 1);
    assert_eq!(left.1.duplicates + right.1.duplicates, 1);
    use crate::domain::ports::SourceMessageReader;
    let sources = [
        first_message.source.clone(),
        SourceMessageId {
            ts: "1.000002".parse().unwrap(),
            ..first_message.source.clone()
        },
    ];
    let before = repo.progress(team, event.job_id).await.unwrap();
    let found = repo.reference_mappings(team, &sources).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].message, left.0);
    assert_eq!(found[0].channel, channel);
    assert_eq!(found[0].source.ts.to_string(), "1.000001");
    assert_eq!(before, repo.progress(team, event.job_id).await.unwrap());
    let other_team = Uuid::now_v7().try_into().unwrap();
    assert!(repo.reference_mappings(other_team, &sources).await.is_err());
    let foreign = SourceMessageId {
        team_id: other_team,
        ..sources[0].clone()
    };
    assert!(
        repo.reference_mappings(other_team, &[foreign])
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn checkpoints_cross_part_boundaries_without_counting_twice(pool: PgPool) {
    let (repo, team, event) = fixture_parts(&pool, Some(2), 2).await;
    let running = claim(&repo, &event).await;
    let mut tx = pool.begin().await.unwrap();
    // End-of-part must be spelled as the next part, not an ambiguous extra line.
    assert!(
        begin_batch(
            &mut tx,
            &running.lease,
            checkpoint(0, 0),
            checkpoint(0, 2),
            None
        )
        .await
        .is_err()
    );
    let BatchStart::Ready(batch) = begin_batch(
        &mut tx,
        &running.lease,
        checkpoint(0, 0),
        checkpoint(1, 1),
        None,
    )
    .await
    .unwrap() else {
        panic!("new batch");
    };
    assert_eq!(batch.finish(3, 0).await.unwrap().processed, 3);
    tx.commit().await.unwrap();
    expire(&pool, &event).await;
    let resumed = claim(&repo, &event).await;
    assert_eq!(resumed.checkpoint, checkpoint(1, 1));
    let mut tx = pool.begin().await.unwrap();
    let BatchStart::Ready(batch) = begin_batch(
        &mut tx,
        &resumed.lease,
        checkpoint(1, 1),
        checkpoint(2, 0),
        None,
    )
    .await
    .unwrap() else {
        panic!("last batch");
    };
    assert_eq!(batch.finish(1, 0).await.unwrap().processed, 4);
    tx.commit().await.unwrap();
    repo.settle(&resumed.lease, ConversationStatus::Completed, None)
        .await
        .unwrap();
    assert_eq!(
        repo.finalize(team, event.job_id)
            .await
            .unwrap()
            .conversations[0]
            .counters
            .skipped,
        4
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn skipped_records_checkpoint_replay_and_reclaim(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(3)).await;
    let running = claim(&repo, &event).await;
    let mut tx = pool.begin().await.unwrap();
    let BatchStart::Ready(batch) = begin_batch(
        &mut tx,
        &running.lease,
        checkpoint(0, 0),
        checkpoint(0, 2),
        None,
    )
    .await
    .unwrap() else {
        panic!("new batch");
    };
    let counters = batch.finish(2, 0).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(counters.skipped, 2);
    let mut tx = pool.begin().await.unwrap();
    let BatchStart::Replayed(replayed) = begin_batch(
        &mut tx,
        &running.lease,
        checkpoint(0, 0),
        checkpoint(0, 2),
        None,
    )
    .await
    .unwrap() else {
        panic!("replay");
    };
    assert_eq!(counters, replayed);
    tx.commit().await.unwrap();
    expire(&pool, &event).await;
    let resumed = claim(&repo, &event).await;
    assert_eq!(resumed.checkpoint, checkpoint(0, 2));
    let mut tx = pool.begin().await.unwrap();
    assert!(
        begin_batch(
            &mut tx,
            &running.lease,
            checkpoint(0, 2),
            checkpoint(1, 0),
            None
        )
        .await
        .is_err()
    );
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    let BatchStart::Ready(batch) = begin_batch(
        &mut tx,
        &resumed.lease,
        checkpoint(0, 2),
        checkpoint(1, 0),
        None,
    )
    .await
    .unwrap() else {
        panic!("remaining batch");
    };
    assert_eq!(batch.finish(1, 0).await.unwrap().skipped, 3);
    tx.commit().await.unwrap();
    repo.settle(&resumed.lease, ConversationStatus::Completed, None)
        .await
        .unwrap();
    let progress = repo.finalize(team, event.job_id).await.unwrap();
    assert_eq!(progress.status, JobStatus::Completed);
    assert_eq!(progress.conversations[0].counters.processed, 3);
    assert!(repo.pending_search(50).await.unwrap().is_empty());
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn mappings_messages_counters_and_search_rollback_together(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(1)).await;
    let running = claim(&repo, &event).await;
    let channel = target(&pool).await;
    let message = message(team, channel, 1);
    // A mapping without a message cannot commit because its FK is deferred.
    let mut tx = pool.begin().await.unwrap();
    let BatchStart::Ready(mut batch) = begin_batch(
        &mut tx,
        &running.lease,
        checkpoint(0, 0),
        checkpoint(1, 0),
        Some(channel),
    )
    .await
    .unwrap() else {
        panic!("new batch");
    };
    assert!(
        batch
            .reserve_mappings(std::slice::from_ref(&message))
            .await
            .unwrap()[0]
            .inserted
    );
    batch.finish(0, 0).await.unwrap();
    assert!(tx.commit().await.is_err());
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .conversations[0]
            .counters,
        ImportCounters::default()
    );
    assert!(repo.pending_search(50).await.unwrap().is_empty());
    let mut tx = pool.begin().await.unwrap();
    let BatchStart::Ready(mut batch) = begin_batch(
        &mut tx,
        &running.lease,
        checkpoint(0, 0),
        checkpoint(1, 0),
        Some(channel),
    )
    .await
    .unwrap() else {
        panic!("retry");
    };
    assert!(
        batch
            .reserve_mappings(std::slice::from_ref(&message))
            .await
            .unwrap()[0]
            .inserted
    );
    insert_message(&mut batch, &message).await;
    batch.finish(0, 0).await.unwrap();
    tx.commit().await.unwrap();
    let found = lookup(
        &mut pool.acquire().await.unwrap(),
        std::slice::from_ref(&message.source),
    )
    .await
    .unwrap();
    assert_eq!(found, vec![(message.source, message.id)]);
    let progress = repo.progress(team, event.job_id).await.unwrap().unwrap();
    assert_eq!(progress.conversations[0].counters.imported, 1);
    assert_eq!(progress.conversations[0].search, SearchState::Pending);
    assert_eq!(repo.pending_search(50).await.unwrap().len(), 1);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn duplicates_keep_first_mapping_and_partial_failure_keeps_search(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(3)).await;
    let running = claim(&repo, &event).await;
    let channel = target(&pool).await;
    let original = message(team, channel, 1);
    for index in 0..2 {
        let mut candidate = original.clone();
        if index == 1 {
            candidate.id = Uuid::now_v7();
        }
        let mut tx = pool.begin().await.unwrap();
        let BatchStart::Ready(mut batch) = begin_batch(
            &mut tx,
            &running.lease,
            checkpoint(0, index),
            checkpoint(0, index + 1),
            Some(channel),
        )
        .await
        .unwrap() else {
            panic!("new batch");
        };
        let maps = batch
            .reserve_mappings(std::slice::from_ref(&candidate))
            .await
            .unwrap();
        assert_eq!(maps[0].message_id, original.id);
        assert_eq!(maps[0].inserted, index == 0);
        if maps[0].inserted {
            insert_message(&mut batch, &candidate).await;
        }
        batch.finish(0, 0).await.unwrap();
        tx.commit().await.unwrap();
    }
    repo.settle(
        &running.lease,
        ConversationStatus::Failed,
        Some(ImportError::Internal),
    )
    .await
    .unwrap();
    let progress = repo.finalize(team, event.job_id).await.unwrap();
    assert_eq!(progress.status, JobStatus::Processing);
    assert_eq!(progress.conversations[0].counters.imported, 1);
    assert_eq!(progress.conversations[0].counters.duplicates, 1);
    let request = repo.pending_search(50).await.unwrap().pop().unwrap();
    repo.record_search(&request, SearchState::Completed)
        .await
        .unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .status,
        JobStatus::CompletedWithErrors
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn stale_search_ack_cannot_clear_new_dirty_generation(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(3)).await;
    let running = claim(&repo, &event).await;
    let channel = target(&pool).await;
    let mut requests = Vec::new();
    for index in 0..2 {
        let message = message(team, channel, index + 1);
        let mut tx = pool.begin().await.unwrap();
        let BatchStart::Ready(mut batch) = begin_batch(
            &mut tx,
            &running.lease,
            checkpoint(0, index),
            checkpoint(0, index + 1),
            Some(channel),
        )
        .await
        .unwrap() else {
            panic!("new batch");
        };
        batch
            .reserve_mappings(std::slice::from_ref(&message))
            .await
            .unwrap();
        insert_message(&mut batch, &message).await;
        batch.finish(0, 0).await.unwrap();
        tx.commit().await.unwrap();
        requests.push(repo.pending_search(50).await.unwrap().pop().unwrap());
    }
    repo.record_search(&requests[0], SearchState::Completed)
        .await
        .unwrap();
    assert_eq!(repo.pending_search(50).await.unwrap()[0].generation, 2);
    let receipt_id = Uuid::now_v7();
    repo.record_search(&requests[1], SearchState::Submitted { receipt_id })
        .await
        .unwrap();
    // A duplicate acceptance may not overwrite a newer receipt or reset its poll clock.
    repo.record_search(
        &requests[1],
        SearchState::Submitted {
            receipt_id: Uuid::now_v7(),
        },
    )
    .await
    .unwrap();
    sqlx::query!("UPDATE slack_import_outbox SET available_at = clock_timestamp() - interval '1 second' WHERE job_id = $1 AND kind = 'search'", Uuid::from(event.job_id)).execute(&pool).await.unwrap();
    let submitted = repo.pending_search(50).await.unwrap().pop().unwrap();
    assert_eq!(submitted.state, SearchState::Submitted { receipt_id });
    // Partial cancellation must retain the search outbox after lease settlement.
    repo.cancel(team, event.job_id).await.unwrap();
    expire(&pool, &event).await;
    repo.reconcile(50).await.unwrap();
    assert_eq!(repo.pending_search(50).await.unwrap().len(), 1);
    repo.record_search(&submitted, SearchState::Completed)
        .await
        .unwrap();
    assert!(repo.pending_search(50).await.unwrap().is_empty());
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .conversations[0]
            .search,
        SearchState::Completed
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn invalid_checkpoints_and_late_fence_roll_back(pool: PgPool) {
    let (repo, team, event) = fixture(&pool, Some(3)).await;
    let running = claim(&repo, &event).await;
    let mut tx = pool.begin().await.unwrap();
    assert!(
        begin_batch(
            &mut tx,
            &running.lease,
            checkpoint(0, 1),
            checkpoint(0, 2),
            None
        )
        .await
        .is_err()
    );
    assert!(
        begin_batch(
            &mut tx,
            &running.lease,
            checkpoint(0, 0),
            checkpoint(0, 4),
            None
        )
        .await
        .is_err()
    );
    assert!(
        begin_batch(
            &mut tx,
            &running.lease,
            checkpoint(0, 0),
            checkpoint(2, 0),
            None
        )
        .await
        .is_err()
    );
    let BatchStart::Ready(mut batch) = begin_batch(
        &mut tx,
        &running.lease,
        checkpoint(0, 0),
        checkpoint(0, 2),
        None,
    )
    .await
    .unwrap() else {
        panic!("new batch");
    };
    // Simulate time elapsing while the coordinator is inside the transaction.
    sqlx::query!("UPDATE slack_import_conversation SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE job_id = $1", Uuid::from(event.job_id)).execute(&mut **batch.transaction()).await.unwrap();
    assert!(batch.finish(2, 0).await.is_err());
    tx.rollback().await.unwrap();
    assert_eq!(
        repo.progress(team, event.job_id)
            .await
            .unwrap()
            .unwrap()
            .conversations[0]
            .counters
            .processed,
        0
    );
}
