use super::*;
use crate::composition::reference_reconciliation::WorkerReferenceReconciler;
use slack_integration::domain::{
    ports::ReferenceReconciler,
    slack::{mrkdwn::MrkdwnConverter, users::UserDirectory},
};

pub(super) fn linked(message: &mut HistoricalMessage, source: &str) {
    let text = MrkdwnConverter {
        users: &UserDirectory::default(),
        channels: &Default::default(),
    }
    .convert_with_references(source, false)
    .unwrap();
    message.content = text.body;
    message.user_mentions = text.user_mentions;
    message.body_references = text.references;
}
fn reconciler(pool: &PgPool) -> WorkerReferenceReconciler {
    WorkerReferenceReconciler::new(pool.clone(), ImportLimits::default())
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn patches_intents_and_search_rollback_at_every_boundary(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::PublicChannel, 1).await;
    let plan = target(&pool, &context).await;
    let mut batch = batch(&context, plan.channel_id, &[2], end());
    linked(&mut batch.messages[0], "<#C1|self>");
    let fallback = batch.messages[0].content.clone();
    let candidate = batch.messages[0].id;
    sink(&pool).commit(batch.clone()).await.unwrap();
    // Redelivery cannot create a second intent or count history twice.
    sink(&pool).commit(batch).await.unwrap();
    let row = sqlx::query!("SELECT message_id FROM slack_import_message_reference")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(row.message_id, candidate);
    let job = context.lease.event.job_id;
    let repo = repo(&pool);
    repo.finalize(team, job).await.unwrap();
    repo.settle(&context.lease, ConversationStatus::Completed, None)
        .await
        .unwrap();
    assert_eq!(
        repo.progress(team, job).await.unwrap().unwrap().status,
        JobStatus::Processing
    );
    pool.execute(include_str!("../fail_inserts.sql"))
        .await
        .unwrap();
    let before = counts(&pool).await;
    for (table, operation) in [
        ("comms_messages", "UPDATE"),
        ("slack_import_message_reference", "UPDATE"),
        ("slack_import_outbox", "INSERT"),
    ] {
        // Closed test-only identifiers for fault injection DDL.
        pool.execute(format!("CREATE TRIGGER fail_reference AFTER {operation} ON {table} FOR EACH ROW EXECUTE FUNCTION fail_import_insert()").as_str()).await.unwrap();
        assert!(reconciler(&pool).reconcile_references(50).await.is_err());
        assert_eq!(counts(&pool).await, before);
        let body = sqlx::query_scalar!(
            "SELECT content FROM comms_messages WHERE id = $1",
            row.message_id
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(body, fallback);
        assert!(repo.pending_search(50).await.unwrap().is_empty());
        assert!(
            sqlx::query_scalar!(
                "SELECT completed_at IS NULL AS \"pending!\" FROM slack_import_message_reference"
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        );
        pool.execute(format!("DROP TRIGGER fail_reference ON {table}").as_str())
            .await
            .unwrap();
    }
    // A new process object resumes only durable evidence, without S3 or archive data.
    reconciler(&pool).reconcile_references(1).await.unwrap();
    let body = sqlx::query!(
        "SELECT content, created_at, updated_at, edited_at FROM comms_messages WHERE id = $1",
        row.message_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(body.content.contains(&plan.channel_id.to_string()));
    assert_eq!(body.created_at, body.updated_at);
    assert!(body.edited_at.is_none());
    assert_eq!(counts(&pool).await.0, before.0);
    let progress = repo.progress(team, job).await.unwrap().unwrap();
    assert_eq!(progress.conversations[0].counters.imported, 1);
    assert_eq!(progress.conversations[0].counters.duplicates, 0);
    assert_eq!(progress.status, JobStatus::Processing);
    let search = repo.pending_search(50).await.unwrap().pop().unwrap();
    assert_eq!(search.generation, 2);
    repo.record_search(&search, SearchState::Completed)
        .await
        .unwrap();
    reconciler(&pool).reconcile_references(50).await.unwrap();
    assert_eq!(
        repo.progress(team, job).await.unwrap().unwrap().status,
        JobStatus::Completed
    );
    // Cleanup cannot delete historical messages or dedupe mappings.
    sqlx::query!(
        "DELETE FROM slack_import_job WHERE id = $1",
        Uuid::from(job)
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(counts(&pool).await.0, 1);
    assert_eq!(counts(&pool).await.2, 1);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn cancelled_partial_import_rechecks_access_and_never_reopens_fallbacks(pool: PgPool) {
    let team = team(&pool).await;
    let context = claim(&pool, team, ConversationKind::PrivateChannel, 2).await;
    let plan = target(&pool, &context).await;
    let mut first = batch(
        &context,
        plan.channel_id,
        &[1],
        Checkpoint {
            part_index: 0,
            record_index: 1,
        },
    );
    linked(&mut first.messages[0], "<#C1|source> <#C404|missing>");
    let fallback = first.messages[0].content.clone();
    sink(&pool).commit(first).await.unwrap();
    let repo = repo(&pool);
    let job = context.lease.event.job_id;
    repo.cancel(team, job).await.unwrap();
    sqlx::query!("UPDATE slack_import_conversation SET lease_expires_at = now() - interval '1 minute' WHERE job_id = $1", Uuid::from(job)).execute(&pool).await.unwrap();
    repo.reconcile(50).await.unwrap();
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1",
        plan.channel_id
    )
    .execute(&pool)
    .await
    .unwrap();
    reconciler(&pool).reconcile_references(50).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT content FROM comms_messages")
            .fetch_one(&pool)
            .await
            .unwrap(),
        fallback
    );
    assert!(matches!(
        repo.claim(&context.lease.event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap(),
        ClaimOutcome::Obsolete
    ));
    let search = repo.pending_search(50).await.unwrap().pop().unwrap();
    assert_eq!(search.generation, 1, "fallback did not dirty search again");
    repo.record_search(&search, SearchState::Completed)
        .await
        .unwrap();
    assert_eq!(
        repo.progress(team, job).await.unwrap().unwrap().status,
        JobStatus::Cancelled
    );
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = NULL WHERE channel_id = $1",
        plan.channel_id
    )
    .execute(&pool)
    .await
    .unwrap();
    reconciler(&pool).reconcile_references(50).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT content FROM comms_messages")
            .fetch_one(&pool)
            .await
            .unwrap(),
        fallback
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn forward_conversation_order_and_split_parts(pool: PgPool) {
    linked_conversations(pool, ["C1", "C2"]).await;
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn reverse_conversation_order_and_split_parts(pool: PgPool) {
    linked_conversations(pool, ["C2", "C1"]).await;
}

async fn linked_conversations(pool: PgPool, order: [&str; 2]) {
    let team = team(&pool).await;
    let repo = repo(&pool);
    let limits = ImportLimits::default();
    let conversations = ["C1", "C2"]
        .into_iter()
        .map(|id| ConversationMetadata {
            slack_channel_id: id.parse().unwrap(),
            kind: ConversationKind::PublicChannel,
            name: id.into(),
            folder: id.parse().unwrap(),
            member_ids: vec![],
            creator_id: None,
            created_at: Some("1.000001".parse().unwrap()),
            archived: false,
            message_count: None,
        })
        .collect();
    let job = repo
        .create(
            team,
            &user(),
            &CreateImport {
                idempotency_token: Uuid::now_v7().try_into().unwrap(),
                source: SourceIdentity::ConfirmedUnknown,
                include_message_history: true,
                conversations,
            },
            &limits,
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
    for id in ["C1", "C2"] {
        for part_index in 0..2 {
            descriptors.push(UploadDescriptor {
                upload: UploadId::ConversationPart {
                    slack_channel_id: id.parse().unwrap(),
                    part_index,
                },
                sha256: "b".repeat(64).parse().unwrap(),
                byte_length: 100,
                record_count: Some(1),
            });
        }
    }
    let uploads: Vec<_> = repo
        .register(
            team,
            job,
            &RegisterUploads {
                descriptors: descriptors.clone(),
            },
        )
        .await
        .unwrap()
        .into_iter()
        .map(|registered| VerifiedUpload {
            registered,
            identity: ObjectIdentity::Version("v1".parse().unwrap()),
        })
        .collect();
    repo.complete(team, job, &uploads, None).await.unwrap();
    for (index, id) in ["C1", "C2"].into_iter().enumerate() {
        let seal = ConversationSeal::from_descriptors(
            id.parse().unwrap(),
            &descriptors[1 + index * 2..3 + index * 2],
            &limits,
        )
        .unwrap();
        repo.complete(team, job, &[], Some(&seal)).await.unwrap();
    }
    repo.finalize(team, job).await.unwrap();
    let mut channels = std::collections::HashMap::new();
    for id in order {
        let event = ImportEvent {
            job_id: job,
            slack_channel_id: id.parse().unwrap(),
            generation: 1,
        };
        let ClaimOutcome::Claimed(context) = repo
            .claim(&event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap()
        else {
            panic!("claim");
        };
        let plan = target(&pool, &context).await;
        channels.insert(id, plan.channel_id);
        for part in 0..2 {
            let mut batch = batch(
                &context,
                plan.channel_id,
                &[part + 1],
                Checkpoint {
                    part_index: part + 1,
                    record_index: 0,
                },
            );
            linked(
                &mut batch.messages[0],
                "<#C1|one> <#C2|two> <#C404|missing> https://example.slack.com/archives/C2/p1000001",
            );
            sink(&pool).commit(batch).await.unwrap();
            reconciler(&pool).reconcile_references(50).await.unwrap();
            assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM slack_import_message_reference WHERE completed_at IS NOT NULL").fetch_one(&pool).await.unwrap(), Some(0));
        }
        repo.settle(&context.lease, ConversationStatus::Completed, None)
            .await
            .unwrap();
    }
    reconciler(&pool).reconcile_references(50).await.unwrap();
    let rows = sqlx::query!("SELECT content FROM comms_messages")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(rows.len(), 4);
    for row in rows {
        assert!(row.content.contains(&channels["C1"].to_string()));
        assert!(row.content.contains(&channels["C2"].to_string()));
        assert!(row.content.contains("#missing"));
        // Production has no trusted workspace-domain evidence; keep this external.
        assert!(row.content.contains("<m-link>"));
        assert!(!row.content.contains("channel_message_id"));
    }
    let progress = repo.progress(team, job).await.unwrap().unwrap();
    assert_eq!(progress.status, JobStatus::Processing);
    assert!(
        progress
            .conversations
            .iter()
            .all(|c| c.counters.imported == 2 && c.counters.processed == 2)
    );
    for search in repo.pending_search(50).await.unwrap() {
        repo.record_search(&search, SearchState::Completed)
            .await
            .unwrap();
    }
    assert_eq!(
        repo.progress(team, job).await.unwrap().unwrap().status,
        JobStatus::Completed
    );
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn later_duplicate_job_cannot_patch_first_committed_body(pool: PgPool) {
    let team = team(&pool).await;
    let first = claim(&pool, team, ConversationKind::PublicChannel, 1).await;
    let plan = target(&pool, &first).await;
    let second = claim(&pool, team, ConversationKind::PublicChannel, 1).await;
    sink(&pool)
        .bind(
            &second.lease,
            &TargetPlan {
                metadata: second.metadata.clone(),
                ..plan.clone()
            },
            &[],
        )
        .await
        .unwrap();
    let mut a = batch(&first, plan.channel_id, &[1], end());
    let mut b = batch(&second, plan.channel_id, &[1], end());
    linked(&mut a.messages[0], "first <#C1|source>");
    linked(&mut b.messages[0], "second <#C1|source>");
    let sink = sink(&pool);
    let (a, b) = tokio::join!(sink.commit(a), sink.commit(b));
    assert_eq!(a.unwrap().imported + b.unwrap().imported, 1);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM slack_import_message_reference")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
    let intent = sqlx::query!("SELECT job_id, message_id FROM slack_import_message_reference")
        .fetch_one(&pool)
        .await
        .unwrap();
    let map = sqlx::query_scalar!("SELECT message_id FROM slack_import_message_map")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(intent.message_id, map);
    let repo = repo(&pool);
    for context in [&first, &second] {
        repo.finalize(team, context.lease.event.job_id)
            .await
            .unwrap();
        repo.settle(&context.lease, ConversationStatus::Completed, None)
            .await
            .unwrap();
    }
    // A live edit after the winning commit is never overwritten by either job.
    sqlx::query!(
        "UPDATE comms_messages SET content = 'live', edited_at = now() WHERE id = $1",
        map
    )
    .execute(&pool)
    .await
    .unwrap();
    reconciler(&pool).reconcile_references(50).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT content FROM comms_messages")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "live"
    );
}
