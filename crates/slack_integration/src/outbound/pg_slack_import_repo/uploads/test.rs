use super::*;

const ADMIN: &str = "macro|archive@example.com";

fn admin() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(ADMIN).unwrap()
}

async fn fixture(pool: &PgPool) -> (PgSlackImportRepo, TeamId, TeamId) {
    let user = Uuid::now_v7();
    let team = Uuid::now_v7();
    let foreign = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'archive', 'archive@example.com', 'archive-customer'), ($2, 'foreign', 'foreign@example.com', 'foreign-customer')",
        user, foreign,
    ).execute(pool).await.unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'archive@example.com', $2), ('macro|foreign@example.com', 'foreign@example.com', $3)"#,
        ADMIN,
        user,
        foreign,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Archive', $3), ($2, 'Foreign', 'macro|foreign@example.com')",
        team,
        foreign,
        ADMIN,
    )
    .execute(pool)
    .await
    .unwrap();
    (
        PgSlackImportRepo::new(pool.clone(), ImportLimits::default()),
        team.try_into().unwrap(),
        foreign.try_into().unwrap(),
    )
}

fn metadata(id: &str) -> ConversationMetadata {
    ConversationMetadata {
        slack_channel_id: id.parse().unwrap(),
        kind: ConversationKind::PrivateChannel,
        name: "Source name".into(),
        folder: "source-folder".parse().unwrap(),
        member_ids: vec!["U2".parse().unwrap(), "U1".parse().unwrap()],
        creator_id: Some("U2".parse().unwrap()),
        created_at: Some("1700000000.000001".parse().unwrap()),
        archived: true,
        message_count: Some(12),
    }
}

fn command(history: bool, conversations: &[&str]) -> CreateImport {
    CreateImport {
        idempotency_token: Uuid::now_v7().try_into().unwrap(),
        source: SourceIdentity::ConfirmedUnknown,
        include_message_history: history,
        conversations: conversations.iter().map(|id| metadata(id)).collect(),
    }
}

async fn create(
    repo: &PgSlackImportRepo,
    team: TeamId,
    history: bool,
    conversations: &[&str],
) -> JobId {
    repo.create(
        team,
        &admin(),
        &command(history, conversations),
        &repo.limits,
    )
    .await
    .unwrap()
    .job_id
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

fn part(index: u32) -> UploadDescriptor {
    descriptor(UploadId::ConversationPart {
        slack_channel_id: "C1".parse().unwrap(),
        part_index: index,
    })
}

fn seal(parts: &[UploadDescriptor]) -> ConversationSeal {
    ConversationSeal::from_descriptors("C1".parse().unwrap(), parts, &ImportLimits::default())
        .unwrap()
}

async fn register(
    repo: &PgSlackImportRepo,
    team: TeamId,
    job: JobId,
    descriptors: &[UploadDescriptor],
) -> Vec<VerifiedUpload> {
    repo.register(
        team,
        job,
        &RegisterUploads {
            descriptors: descriptors.to_vec(),
        },
    )
    .await
    .unwrap()
    .into_iter()
    .map(|registered| VerifiedUpload {
        registered,
        identity: ObjectIdentity::Version("version-one".parse().unwrap()),
    })
    .collect()
}

fn error<T: std::fmt::Debug>(result: PortResult<T>, expected: ImportError) {
    assert_eq!(result.unwrap_err().into_current_context(), expected);
}

async fn outbox_count(pool: &PgPool, job: JobId) -> i64 {
    sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM slack_import_outbox WHERE job_id = $1",
        Uuid::from(job)
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn create_replays_semantic_metadata_and_scopes_tokens(pool: PgPool) {
    let (repo, team, foreign) = fixture(&pool).await;
    let mut command = command(true, &["C2", "C1"]);
    let original = repo
        .create(team, &admin(), &command, &repo.limits)
        .await
        .unwrap();
    command.conversations.reverse();
    for metadata in &mut command.conversations {
        metadata.member_ids.reverse();
    }
    assert_eq!(
        repo.create(team, &admin(), &command, &repo.limits)
            .await
            .unwrap(),
        original
    );
    let other = repo
        .create(foreign, &admin(), &command, &repo.limits)
        .await
        .unwrap();
    assert_ne!(original.job_id, other.job_id);
    let row = sqlx::query!(
        r#"SELECT kind, name, folder, member_ids, creator_id, source_created_at, archived, message_count
           FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = 'C1'"#,
        Uuid::from(original.job_id),
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(row.kind, "private_channel");
    assert_eq!(row.name, "Source name");
    assert_eq!(row.folder, "source-folder");
    assert_eq!(row.member_ids, ["U1", "U2"]);
    assert_eq!(row.creator_id.as_deref(), Some("U2"));
    assert_eq!(row.source_created_at, Some(1700000000000001));
    assert!(row.archived);
    assert_eq!(row.message_count, Some(12));
    command.conversations[0].name = "changed".into();
    error(
        repo.create(team, &admin(), &command, &repo.limits).await,
        ImportError::Conflict,
    );
    let mut duplicate = command.clone();
    duplicate
        .conversations
        .push(duplicate.conversations[0].clone());
    error(
        repo.create(team, &admin(), &duplicate, &repo.limits).await,
        ImportError::InvalidInput,
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn confirmed_selection_is_the_durable_upload_and_work_scope(pool: PgPool) {
    use crate::domain::ports::{ExecutionRepo, ImportRepo};

    let (repo, team, _) = fixture(&pool).await;
    let mut selected = command(true, &["CA", "CC"]);
    for metadata in &mut selected.conversations {
        metadata.folder = metadata.slack_channel_id.as_str().parse().unwrap();
    }
    let original = repo
        .create(team, &admin(), &selected, &repo.limits)
        .await
        .unwrap();
    let job = original.job_id;
    // Same names do not collapse distinct source IDs. The receipt survives without the ZIP.
    assert_eq!(original.source, selected.source);
    assert!(original.include_message_history);
    assert_eq!(
        original
            .conversations
            .iter()
            .map(|c| c.slack_channel_id.as_str())
            .collect::<Vec<_>>(),
        ["CA", "CC"]
    );
    assert!(
        original
            .conversations
            .iter()
            .all(|c| c.name == "Source name"
                && c.kind == ConversationKind::PrivateChannel
                && c.archived)
    );
    assert_eq!(repo.progress(team, job).await.unwrap().unwrap(), original);
    assert_eq!(repo.list(team, None).await.unwrap(), [original.clone()]);
    for altered in [
        CreateImport {
            include_message_history: false,
            ..selected.clone()
        },
        CreateImport {
            conversations: vec![metadata("CA"), metadata("CB")],
            ..selected.clone()
        },
    ] {
        error(
            repo.create(team, &admin(), &altered, &repo.limits).await,
            ImportError::Conflict,
        );
    }
    assert_eq!(
        repo.create(team, &admin(), &selected, &repo.limits)
            .await
            .unwrap(),
        original
    );

    let unselected = descriptor(UploadId::ConversationPart {
        slack_channel_id: "CB".parse().unwrap(),
        part_index: 0,
    });
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![unselected.clone()],
            },
        )
        .await,
        ImportError::Unavailable,
    );
    error(
        repo.uploads(team, job, &[unselected.upload.clone()]).await,
        ImportError::Unavailable,
    );
    let forged = VerifiedUpload {
        registered: RegisteredUpload {
            key: object_key(team, job, &unselected.upload).unwrap(),
            descriptor: unselected,
        },
        identity: ObjectIdentity::Version("forged".parse().unwrap()),
    };
    error(
        repo.complete(team, job, &[forged], None).await,
        ImportError::Unavailable,
    );
    let unselected_seal =
        ConversationSeal::from_descriptors("CB".parse().unwrap(), &[], &repo.limits).unwrap();
    error(
        repo.complete(team, job, &[], Some(&unselected_seal)).await,
        ImportError::Unavailable,
    );
    let event = ImportEvent {
        job_id: job,
        slack_channel_id: "CB".parse().unwrap(),
        generation: 1,
    };
    assert!(repo.requester(&event).await.unwrap().is_none());
    assert!(matches!(
        repo.claim(&event, Uuid::now_v7().try_into().unwrap())
            .await
            .unwrap(),
        ClaimOutcome::Obsolete
    ));
    assert_eq!(outbox_count(&pool, job).await, 0);

    // Empty selected history still requires users. Only A becomes ready; C remains a selected skip.
    let seal =
        ConversationSeal::from_descriptors("CA".parse().unwrap(), &[], &repo.limits).unwrap();
    repo.complete(team, job, &[], Some(&seal)).await.unwrap();
    assert_eq!(outbox_count(&pool, job).await, 0);
    let users = register(&repo, team, job, &[descriptor(UploadId::Users)]).await;
    repo.complete(team, job, &users, None).await.unwrap();
    let finalized = repo.finalize(team, job).await.unwrap();
    assert_eq!(outbox_count(&pool, job).await, 1);
    assert_eq!(finalized.conversations.len(), 2);
    assert_eq!(
        finalized.conversations[0].status,
        ConversationStatus::Queued
    );
    assert_eq!(
        finalized.conversations[1].status,
        ConversationStatus::Skipped
    );
    assert_eq!(
        finalized.conversations[1].warnings,
        [ImportWarning::UploadsIncomplete]
    );
    assert_eq!(repo.progress(team, job).await.unwrap().unwrap(), finalized);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn source_binding_and_job_commit_atomically(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let mut known = command(true, &["C1"]);
    known.source = SourceIdentity::Known {
        source_id: "T1".parse().unwrap(),
    };
    let admin = admin();
    let (first, replay) = futures::join!(
        repo.create(team, &admin, &known, &repo.limits),
        repo.create(team, &admin, &known, &repo.limits),
    );
    assert_eq!(first.unwrap().job_id, replay.unwrap().job_id);
    let mut mismatch = known.clone();
    mismatch.idempotency_token = Uuid::now_v7().try_into().unwrap();
    mismatch.source = SourceIdentity::Known {
        source_id: "T2".parse().unwrap(),
    };
    error(
        repo.create(team, &admin, &mismatch, &repo.limits).await,
        ImportError::SourceMismatch,
    );
    assert_eq!(repo.list(team, None).await.unwrap().len(), 1);
    // An exact create retry stays readable after registration closes.
    let job = repo.list(team, None).await.unwrap()[0].job_id;
    close(&pool, job).await;
    assert_eq!(
        repo.create(team, &admin, &known, &repo.limits)
            .await
            .unwrap()
            .job_id,
        job
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn list_is_bounded_exclusive_and_team_scoped(pool: PgPool) {
    let (repo, team, foreign) = fixture(&pool).await;
    let mut ids = Vec::new();
    for _ in 0..52 {
        ids.push(create(&repo, team, false, &[]).await);
    }
    let other = create(&repo, foreign, false, &[]).await;
    let first = repo.list(team, None).await.unwrap();
    assert_eq!(first.len(), 50);
    ids.reverse();
    assert_eq!(
        first.iter().map(|p| p.job_id).collect::<Vec<_>>(),
        ids[..50]
    );
    let next = repo.list(team, Some(first[49].job_id)).await.unwrap();
    assert_eq!(next.iter().map(|p| p.job_id).collect::<Vec<_>>(), ids[50..]);
    assert!(repo.progress(team, other).await.unwrap().is_none());
    assert!(first.iter().all(|p| p.conversations.is_empty()));
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn completion_requires_seal_and_users_uploaded_last_releases_all(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1", "C2"]).await;
    let parts = [part(0), part(1)];
    let uploads = register(&repo, team, job, &parts).await;
    let progress = repo.complete(team, job, &uploads, None).await.unwrap();
    assert_eq!(progress.conversations[0].verified_parts, 2);
    assert_eq!(
        progress.conversations[0].status,
        ConversationStatus::AwaitingUploads
    );
    let progress = repo
        .complete(team, job, &[], Some(&seal(&parts)))
        .await
        .unwrap();
    assert_eq!(
        progress.conversations[0].status,
        ConversationStatus::AwaitingUploads
    );
    let empty =
        ConversationSeal::from_descriptors("C2".parse().unwrap(), &[], &repo.limits).unwrap();
    repo.complete(team, job, &[], Some(&empty)).await.unwrap();
    assert_eq!(outbox_count(&pool, job).await, 0);
    let users = register(&repo, team, job, &[descriptor(UploadId::Users)]).await;
    let progress = repo.complete(team, job, &users, None).await.unwrap();
    assert!(progress.users_verified);
    assert!(
        progress
            .conversations
            .iter()
            .all(|c| c.status == ConversationStatus::Queued)
    );
    assert_eq!(outbox_count(&pool, job).await, 2);
    assert_eq!(
        repo.complete(team, job, &users, None).await.unwrap(),
        progress
    );
    assert_eq!(
        repo.complete(team, job, &uploads, Some(&seal(&parts)))
            .await
            .unwrap(),
        progress
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn seals_reject_missing_middle_wrong_hash_and_truncated_sets_atomically(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    let parts = [part(0), part(1), part(2)];
    let uploads = register(&repo, team, job, &[parts[0].clone(), parts[2].clone()]).await;
    error(
        repo.complete(team, job, &uploads, Some(&seal(&parts)))
            .await,
        ImportError::Conflict,
    );
    // Invalid seals roll back object verification too.
    assert_eq!(
        repo.progress(team, job)
            .await
            .unwrap()
            .unwrap()
            .conversations[0]
            .verified_parts,
        0
    );
    register(&repo, team, job, &[part(1)]).await;
    error(
        repo.complete(team, job, &[], Some(&seal(&parts[..2])))
            .await,
        ImportError::Conflict,
    );
    let mut wrong_hash = seal(&parts);
    wrong_hash.manifest_sha256 = "b".repeat(64).parse().unwrap();
    error(
        repo.complete(team, job, &[], Some(&wrong_hash)).await,
        ImportError::Conflict,
    );
    repo.complete(team, job, &uploads, Some(&seal(&parts)))
        .await
        .unwrap();
    let users = register(&repo, team, job, &[descriptor(UploadId::Users)]).await;
    let waiting = repo.complete(team, job, &users, None).await.unwrap();
    assert_eq!(
        waiting.conversations[0].status,
        ConversationStatus::AwaitingUploads
    );
    let middle = register(&repo, team, job, &[part(1)]).await;
    let ready = repo.complete(team, job, &middle, None).await.unwrap();
    assert_eq!(ready.conversations[0].status, ConversationStatus::Queued);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn descriptors_and_seals_are_immutable_but_exact_retries_succeed(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    let original = register(&repo, team, job, &[part(0)]).await;
    let progress = repo.progress(team, job).await.unwrap().unwrap();
    assert_eq!(register(&repo, team, job, &[part(0)]).await, original);
    assert_eq!(repo.progress(team, job).await.unwrap().unwrap(), progress);
    let mut changed_hash = part(0);
    changed_hash.sha256 = "b".repeat(64).parse().unwrap();
    let mut changed_size = part(0);
    changed_size.byte_length += 1;
    let mut changed_records = part(0);
    changed_records.record_count = Some(2);
    for descriptor in [changed_hash, changed_size, changed_records] {
        error(
            repo.register(
                team,
                job,
                &RegisterUploads {
                    descriptors: vec![descriptor],
                },
            )
            .await,
            ImportError::Conflict,
        );
    }
    repo.complete(team, job, &[], Some(&seal(&[part(0)])))
        .await
        .unwrap();
    assert_eq!(register(&repo, team, job, &[part(0)]).await, original);
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![part(1)],
            },
        )
        .await,
        ImportError::Conflict,
    );
    error(
        repo.complete(team, job, &[], Some(&seal(&[]))).await,
        ImportError::Conflict,
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn zero_part_shape_and_empty_history_still_require_users(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    for history in [false, true] {
        let job = create(&repo, team, history, &["C1"]).await;
        if !history {
            error(
                repo.register(
                    team,
                    job,
                    &RegisterUploads {
                        descriptors: vec![part(0)],
                    },
                )
                .await,
                ImportError::Conflict,
            );
        }
        let progress = repo
            .complete(team, job, &[], Some(&seal(&[])))
            .await
            .unwrap();
        assert_eq!(progress.conversations[0].part_count, Some(0));
        assert_eq!(
            progress.conversations[0].status,
            ConversationStatus::AwaitingUploads
        );
        let users = register(&repo, team, job, &[descriptor(UploadId::Users)]).await;
        let progress = repo.complete(team, job, &users, None).await.unwrap();
        assert_eq!(progress.conversations[0].status, ConversationStatus::Queued);
        assert_eq!(outbox_count(&pool, job).await, 1);
        assert!(repo.uploads(team, job, &[part(0).upload]).await.is_err());
    }
    let empty_job = create(&repo, team, false, &[]).await;
    let users = register(&repo, team, empty_job, &[descriptor(UploadId::Users)]).await;
    assert!(
        repo.complete(team, empty_job, &users, None)
            .await
            .unwrap()
            .conversations
            .is_empty()
    );
    assert_eq!(outbox_count(&pool, empty_job).await, 0);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn keys_do_not_authorize_foreign_jobs_teams_or_part_identities(pool: PgPool) {
    let (repo, team, foreign) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    let other_job = create(&repo, team, true, &["C1"]).await;
    let uploads = register(
        &repo,
        team,
        job,
        &[descriptor(UploadId::Users), part(0), part(1)],
    )
    .await;
    register(
        &repo,
        team,
        other_job,
        &[descriptor(UploadId::Users), part(0)],
    )
    .await;
    error(
        repo.complete(team, other_job, &uploads[..1], None).await,
        ImportError::UploadMismatch,
    );
    error(
        repo.complete(foreign, job, &uploads, None).await,
        ImportError::Unavailable,
    );
    error(
        repo.register(
            foreign,
            job,
            &RegisterUploads {
                descriptors: vec![part(0)],
            },
        )
        .await,
        ImportError::Unavailable,
    );
    error(
        repo.uploads(foreign, job, &[UploadId::Users]).await,
        ImportError::Unavailable,
    );
    error(
        repo.complete(foreign, job, &[], Some(&seal(&[part(0), part(1)])))
            .await,
        ImportError::Unavailable,
    );
    for replacement in [UploadId::Users, part(1).upload] {
        let mut changed = uploads[1].clone();
        changed.registered.descriptor.upload = replacement;
        error(
            repo.complete(team, job, &[changed], None).await,
            ImportError::UploadMismatch,
        );
    }
    let mut forged = uploads[1].clone();
    forged.registered.key = format!("slack-import/{team}/{job}/unregistered.ndjson")
        .parse()
        .unwrap();
    error(
        repo.complete(team, job, &[forged], None).await,
        ImportError::UploadMismatch,
    );
    error(
        repo.complete(
            team,
            job,
            &[],
            Some(&ConversationSeal {
                slack_channel_id: "C2".parse().unwrap(),
                ..seal(&[])
            }),
        )
        .await,
        ImportError::Unavailable,
    );
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn verification_pins_cannot_change_and_duplicate_completion_is_stable(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    let mut users = register(&repo, team, job, &[descriptor(UploadId::Users)]).await;
    users[0].identity = ObjectIdentity::EntityTag("opaque-etag".parse().unwrap());
    let first = repo
        .complete(team, job, &users, Some(&seal(&[])))
        .await
        .unwrap();
    assert_eq!(
        repo.complete(team, job, &users, Some(&seal(&[])))
            .await
            .unwrap(),
        first
    );
    let mut changed = users[0].clone();
    changed.identity = ObjectIdentity::Version("version-two".parse().unwrap());
    error(
        repo.complete(team, job, &[changed], None).await,
        ImportError::UploadMismatch,
    );
    assert_eq!(outbox_count(&pool, job).await, 1);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn concurrent_readiness_publishes_one_event_and_counts_bytes_once(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    let command = RegisterUploads {
        descriptors: vec![descriptor(UploadId::Users), part(0)],
    };
    let (one, two) = futures::join!(
        repo.register(team, job, &command),
        repo.register(team, job, &command)
    );
    assert_eq!(one.unwrap(), two.unwrap());
    let bytes = sqlx::query_scalar!(
        "SELECT registered_bytes FROM slack_import_job WHERE id = $1",
        Uuid::from(job)
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(bytes, 20);
    let uploads = register(&repo, team, job, &command.descriptors).await;
    let seal = seal(&[part(0)]);
    let (one, two) = futures::join!(
        repo.complete(team, job, &uploads, Some(&seal)),
        repo.complete(team, job, &uploads, Some(&seal)),
    );
    assert_eq!(one.unwrap(), two.unwrap());
    assert_eq!(outbox_count(&pool, job).await, 1);
    let generation = sqlx::query_scalar!("SELECT event_generation FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = 'C1'", Uuid::from(job))
        .fetch_one(&pool).await.unwrap();
    assert_eq!(generation, 1);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn registration_racing_seal_cannot_extend_a_sealed_manifest(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    register(&repo, team, job, &[part(0)]).await;
    let addition = RegisterUploads {
        descriptors: vec![part(1)],
    };
    let original_seal = seal(&[part(0)]);
    let (registration, sealing) = futures::join!(
        repo.register(team, job, &addition),
        repo.complete(team, job, &[], Some(&original_seal)),
    );
    match (registration, sealing) {
        (Ok(_), Err(error)) => {
            assert_eq!(error.into_current_context(), ImportError::Conflict);
            repo.complete(team, job, &[], Some(&seal(&[part(0), part(1)])))
                .await
                .unwrap();
        }
        (Err(error), Ok(progress)) => {
            assert_eq!(error.into_current_context(), ImportError::Conflict);
            assert_eq!(progress.conversations[0].part_count, Some(1));
        }
        outcome => panic!("exactly one racing operation must succeed: {outcome:?}"),
    }
    assert_eq!(outbox_count(&pool, job).await, 0);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn users_first_and_concurrent_last_completions_queue_only_sealed_work(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    let uploads = register(&repo, team, job, &[descriptor(UploadId::Users), part(0)]).await;
    let progress = repo.complete(team, job, &uploads, None).await.unwrap();
    assert!(progress.users_verified);
    assert_eq!(
        progress.conversations[0].status,
        ConversationStatus::AwaitingUploads
    );
    assert_eq!(outbox_count(&pool, job).await, 0);
    repo.complete(team, job, &[], Some(&seal(&[part(0)])))
        .await
        .unwrap();
    assert_eq!(outbox_count(&pool, job).await, 1);

    let job = create(&repo, team, true, &["C1"]).await;
    let uploads = register(&repo, team, job, &[descriptor(UploadId::Users), part(0)]).await;
    repo.complete(team, job, &[], Some(&seal(&[part(0)])))
        .await
        .unwrap();
    let (users, parts) = futures::join!(
        repo.complete(team, job, &uploads[..1], None),
        repo.complete(team, job, &uploads[1..], None),
    );
    users.unwrap();
    parts.unwrap();
    let progress = repo.progress(team, job).await.unwrap().unwrap();
    assert_eq!(progress.conversations[0].status, ConversationStatus::Queued);
    assert_eq!(outbox_count(&pool, job).await, 1);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn absent_metadata_stays_absent_and_unknown_binding_can_be_refined(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let mut command = command(false, &["D1"]);
    let metadata = &mut command.conversations[0];
    metadata.kind = ConversationKind::DirectMessage;
    metadata.created_at = None;
    metadata.creator_id = None;
    metadata.message_count = None;
    let first = repo
        .create(team, &admin(), &command, &repo.limits)
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT source_created_at, resolved_created_at, creator_id, message_count FROM slack_import_conversation WHERE job_id = $1 AND slack_channel_id = 'D1'",
        Uuid::from(first.job_id),
    ).fetch_one(&pool).await.unwrap();
    assert!(row.source_created_at.is_none());
    assert!(row.resolved_created_at.is_none());
    assert!(row.creator_id.is_none());
    assert!(row.message_count.is_none());
    command.idempotency_token = Uuid::now_v7().try_into().unwrap();
    command.source = SourceIdentity::Known {
        source_id: "T1".parse().unwrap(),
    };
    repo.create(team, &admin(), &command, &repo.limits)
        .await
        .unwrap();
    command.idempotency_token = Uuid::now_v7().try_into().unwrap();
    command.source = SourceIdentity::Known {
        source_id: "T2".parse().unwrap(),
    };
    error(
        repo.create(team, &admin(), &command, &repo.limits).await,
        ImportError::SourceMismatch,
    );
    assert_eq!(repo.list(team, None).await.unwrap().len(), 2);
}

async fn close(pool: &PgPool, job: JobId) {
    sqlx::query!(
        "UPDATE slack_import_job SET registration_closed_at = now(), cancel_requested_at = now(), status = 'cancelled' WHERE id = $1",
        Uuid::from(job),
    ).execute(pool).await.unwrap();
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn closed_jobs_accept_only_exact_replays_without_resurrection(pool: PgPool) {
    let (repo, team, _) = fixture(&pool).await;
    let job = create(&repo, team, true, &["C1"]).await;
    let uploads = register(&repo, team, job, &[descriptor(UploadId::Users), part(0)]).await;
    repo.complete(team, job, &uploads[..1], None).await.unwrap();
    close(&pool, job).await;
    let replay = repo.complete(team, job, &uploads[..1], None).await.unwrap();
    assert_eq!(replay.status, JobStatus::Cancelled);
    error(
        repo.complete(team, job, &uploads[1..], None).await,
        ImportError::Conflict,
    );
    error(
        repo.complete(team, job, &[], Some(&seal(&[part(0)]))).await,
        ImportError::Conflict,
    );
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![part(0)],
            },
        )
        .await,
        ImportError::Conflict,
    );
    assert_eq!(outbox_count(&pool, job).await, 0);
}

#[sqlx::test(migrations = "../macro_db_client/migrations")]
async fn bounds_and_batch_failures_leave_no_partial_registration(pool: PgPool) {
    let (mut repo, team, _) = fixture(&pool).await;
    repo.limits.selected_bytes = 15;
    let job = create(&repo, team, true, &["C1"]).await;
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![part(0), part(1)],
            },
        )
        .await,
        ImportError::LimitExceeded,
    );
    error(
        repo.uploads(team, job, &[part(0).upload]).await,
        ImportError::Unavailable,
    );
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![part(0), part(0)],
            },
        )
        .await,
        ImportError::InvalidInput,
    );
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: (0..51).map(part).collect(),
            },
        )
        .await,
        ImportError::LimitExceeded,
    );
    let mut bad_users = descriptor(UploadId::Users);
    bad_users.record_count = Some(1);
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![bad_users],
            },
        )
        .await,
        ImportError::LimitExceeded,
    );
    let mut oversized = part(0);
    oversized.byte_length = repo.limits.part_bytes + 1;
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![oversized],
            },
        )
        .await,
        ImportError::LimitExceeded,
    );
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![part(u32::MAX)],
            },
        )
        .await,
        ImportError::LimitExceeded,
    );
    let mut unknown = part(0);
    unknown.upload = UploadId::ConversationPart {
        slack_channel_id: "C404".parse().unwrap(),
        part_index: 0,
    };
    error(
        repo.register(
            team,
            job,
            &RegisterUploads {
                descriptors: vec![unknown],
            },
        )
        .await,
        ImportError::Unavailable,
    );
}
