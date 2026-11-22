mod reads;
use super::*;
use chrono::{Duration, Utc};

async fn schema(pool: &PgPool) {
    sqlx::raw_sql(include_str!("test_schema.sql"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261119055601_imap_engine_accounts.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261119060448_imap_verification_limits.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261119060953_imap_account_owners.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261119062515_imap_idle_hosts.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261119063611_imap_account_folder_preferences.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261119063901_normalize_imap_account_state.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!("../../../../macro_db_client/migrations/20261119073802_imap_unconsumed_verification_expiry.sql")).execute(pool).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn two_replicas_serialize_commands_and_reject_stale_or_other_provider_bindings(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    let second_link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
        VALUES
            ($1, 'macro|owner@example.net', 'IMAP'),
            ($2, 'macro|other@example.net', 'GMAIL')
        "#,
        link,
        second_link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let first = PgRepository::new(pool.clone());
    let second = PgRepository::new(pool.clone());
    let verification = Uuid::now_v7();
    first
        .put_verification(VerifiedAccount {
            verification: Verification {
                id: verification,
                expires_at: Utc::now() + Duration::minutes(15),
            },
            user_id: "macro|owner@example.net".into(),
            ciphertext: vec![1, 2, 3],
            consumed_by: None,
        })
        .await
        .unwrap();
    first
        .connect(
            binding,
            "macro|owner@example.net",
            vec![4, 5, 6],
            verification,
        )
        .await
        .unwrap();
    let mut command = first.acquire(binding).await.unwrap();
    assert!(matches!(
        second.acquire(binding).await,
        Err(Error::Throttled)
    ));
    let reader = crate::domain::service::Engine::new(
        std::sync::Arc::new(PgRepository::new(pool.clone())),
        std::sync::Arc::new(crate::domain::service::test::TestCipher),
        std::sync::Arc::new(crate::outbound::protocol::ProtocolTransport::new(
            crate::outbound::network::Connector::new(Default::default()).unwrap(),
        )),
    );
    assert_eq!(
        reader
            .execute(
                binding,
                Operation::Organization {
                    id: "absent".into()
                }
            )
            .await
            .unwrap(),
        serde_json::Value::Null
    );
    first.renew(&command).await.unwrap();
    command.state.sends_today = 7;
    first.save(&mut command).await.unwrap();
    first.release(&command).await.unwrap();
    let visible = second.acquire(binding).await.unwrap();
    assert!(matches!(first.renew(&command).await, Err(Error::Conflict)));
    assert_eq!(visible.state.sends_today, 7);
    second.release(&visible).await.unwrap();
    assert!(matches!(
        second
            .acquire(Binding {
                grant_generation: 2,
                ..binding
            })
            .await,
        Err(Error::Conflict)
    ));
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            sync_generation = 2,
            grant_generation = 2
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(first.acquire(binding).await, Err(Error::Conflict)));
    assert!(matches!(
        first.credentials(binding).await,
        Err(Error::Conflict)
    ));
    assert!(!first.claim_owner(binding, Uuid::now_v7()).await.unwrap());
    let other_verification = Uuid::now_v7();
    first
        .put_verification(VerifiedAccount {
            verification: Verification {
                id: other_verification,
                expires_at: Utc::now() + Duration::minutes(15),
            },
            user_id: "macro|other@example.net".into(),
            ciphertext: vec![1],
            consumed_by: None,
        })
        .await
        .unwrap();
    assert_eq!(
        first
            .connect(
                Binding {
                    link_id: second_link,
                    sync_generation: 1,
                    grant_generation: 1
                },
                "macro|other@example.net",
                vec![1],
                other_verification
            )
            .await
            .unwrap_err(),
        Error::Conflict
    );
}

#[sqlx::test(migrations = false)]
async fn connection_owner_takeover_is_fenced_and_old_owner_cannot_release_successor(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    let a = Uuid::now_v7();
    let b = Uuid::now_v7();
    let verification = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
            VALUES ($1, 'owner', 'IMAP')
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let repo = PgRepository::new(pool.clone());
    repo.put_verification(VerifiedAccount {
        verification: Verification {
            id: verification,
            expires_at: Utc::now() + Duration::minutes(15),
        },
        user_id: "owner".into(),
        ciphertext: vec![1],
        consumed_by: None,
    })
    .await
    .unwrap();
    repo.connect(binding, "owner", vec![2], verification)
        .await
        .unwrap();
    let mut size_limited = repo.acquire(binding).await.unwrap();
    size_limited.state.mailbox_issue =
        Some(models_email::service::link::MailboxIssue::SnapshotTooLarge);
    size_limited.state.sync_size_failures = 6;
    size_limited.state.sync_retry_at = Some(Utc::now() + Duration::hours(24));
    repo.save_health(&mut size_limited).await.unwrap();
    repo.release(&size_limited).await.unwrap();
    // A manual reconnect advances the binding and clears the durable delay
    // without deleting the mailbox index or logging in to a provider here.
    let reconnect = Uuid::now_v7();
    repo.put_verification(VerifiedAccount {
        verification: Verification {
            id: reconnect,
            expires_at: Utc::now() + Duration::minutes(15),
        },
        user_id: "owner".into(),
        ciphertext: vec![3],
        consumed_by: None,
    })
    .await
    .unwrap();
    let binding = Binding {
        sync_generation: 2,
        ..binding
    };
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            sync_generation = 2
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.connect(binding, "owner", vec![3], reconnect)
        .await
        .unwrap();
    let reconnected = repo.acquire(binding).await.unwrap();
    assert_eq!(reconnected.state.mailbox_issue, None);
    assert_eq!(reconnected.state.sync_size_failures, 0);
    assert_eq!(reconnected.state.sync_retry_at, None);
    repo.release(&reconnected).await.unwrap();
    // Cancellation during hydration drops the still-uncommitted claim. A peer
    // fails fast on its row lock and can acquire immediately after rollback.
    let (tx, staged) = repo.begin_acquisition(binding).await.unwrap();
    assert!(matches!(repo.acquire(binding).await, Err(Error::Throttled)));
    let first_owner = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        repo.claim_owner(binding, a),
    )
    .await;
    drop(staged);
    drop(tx);
    assert!(
        first_owner
            .expect("first ownership claim must not wait on hydration's non-key lock")
            .unwrap()
    );
    let before = sqlx::query_scalar!(r#"SELECT now() AS "now!""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    let leased = repo.acquire(binding).await.unwrap();
    let after = sqlx::query_scalar!(r#"SELECT now() AS "now!""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    let lease_until = sqlx::query_scalar!(
        r#"
        SELECT
            lease_until
        FROM
            imap_accounts
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&pool)
    .await
    .unwrap()
    .unwrap();
    let budget = chrono::Duration::from_std(COMMAND_LEASE_BUDGET).unwrap();
    assert!(lease_until >= before + budget && lease_until <= after + budget);
    assert!(SYNC_ROUND_BUDGET < COMMAND_LEASE_BUDGET);
    repo.release(&leased).await.unwrap();
    let before_owner = sqlx::query_scalar!(r#"SELECT now() AS "now!""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(repo.claim_owner(binding, a).await.unwrap());
    let owner_until = sqlx::query_scalar!(
        r#"
        SELECT
            lease_until
        FROM
            imap_account_owners
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let now = sqlx::query_scalar!(r#"SELECT now() AS "now!""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(owner_until <= now + chrono::Duration::from_std(OWNER_LEASE_BUDGET).unwrap());
    assert!(owner_until >= before_owner + chrono::Duration::from_std(OWNER_LEASE_BUDGET).unwrap());
    assert!(!repo.claim_owner(binding, b).await.unwrap());
    assert!(repo.claim_owner(binding, a).await.unwrap());
    sqlx::query!(
        r#"
        UPDATE
            imap_account_owners
        SET
            lease_until = now() - interval '1 second'
        WHERE
            link_id = $1
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.claim_owner(binding, b).await.unwrap());
    assert!(!repo.claim_owner(binding, a).await.unwrap());
    repo.release_owner(binding, a).await.unwrap();
    assert!(!repo.claim_owner(binding, a).await.unwrap());
    repo.release_owner(binding, b).await.unwrap();
    assert!(repo.claim_owner(binding, a).await.unwrap());
}

#[sqlx::test(migrations = false)]
async fn consumed_verification_is_scrubbed_and_same_binding_can_replay_after_expiry(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    let verification = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
            VALUES ($1, 'owner', 'IMAP')
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let repo = PgRepository::new(pool.clone());
    repo.put_verification(VerifiedAccount {
        verification: Verification {
            id: verification,
            expires_at: Utc::now() + Duration::minutes(15),
        },
        user_id: "owner".into(),
        ciphertext: vec![1, 2, 3],
        consumed_by: None,
    })
    .await
    .unwrap();
    repo.connect(binding, "owner", vec![9, 8, 7], verification)
        .await
        .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            imap_verifications
        SET
            expires_at = now() - interval '1 minute'
        WHERE
            id = $1
        "#,
        verification,
    )
    .execute(&pool)
    .await
    .unwrap();
    let receipt = repo.verification(verification).await.unwrap();
    assert!(receipt.ciphertext.is_empty());
    assert_eq!(receipt.consumed_by, Some(link));
    repo.connect(binding, "owner", Vec::new(), verification)
        .await
        .unwrap();
    assert_eq!(repo.credentials(binding).await.unwrap().1, vec![9, 8, 7]);
    assert_eq!(
        repo.connect(
            Binding {
                grant_generation: 2,
                ..binding
            },
            "owner",
            Vec::new(),
            verification
        )
        .await
        .unwrap_err(),
        Error::Conflict
    );
}

#[sqlx::test(migrations = false)]
async fn large_mailbox_point_reads_and_writes_preserve_unloaded_rows(pool: PgPool) {
    schema(&pool).await;
    let link = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
            VALUES ($1, 'macro|owner@example.net', 'IMAP')
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let health = serde_json::to_value(AccountState::default()).unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_accounts (link_id, user_id, sync_generation, grant_generation, credential_ciphertext, state)
            VALUES ($1, 'macro|owner@example.net', 1, 1, decode('01', 'hex'), $2)
        "#,
        link,
        health,
    ).execute(&pool).await.unwrap();
    let folder = FolderState {
        monitored: true,
        virtual_label: None,
        uid_next: None,
        phantom: None,
        detected_role: None,
        folder: Folder {
            sync_enabled: true,
            id: "inbox".into(),
            parent_id: None,
            name: "INBOX".into(),
            role: FolderRole::Inbox,
            has_children: false,
            total_items: Some(100_000),
        },
        path: "INBOX".into(),
        uid_validity: 1,
        highest_modseq: Some(1),
        sync_tier: Some(SyncTier::Condstore),
        sequence: 0,
        journal: Vec::new(),
    };
    let folder = serde_json::to_value(folder).unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_state_entries (link_id, kind, key, document)
            VALUES ($1, 'folder', 'inbox', $2)
        "#,
        link,
        folder,
    )
    .execute(&pool)
    .await
    .unwrap();
    let message = serde_json::to_value(Message {
        id: "placeholder".into(),
        thread_id: "thread".into(),
        folder_id: "inbox".into(),
        flags: Vec::new(),
        tags: Vec::new(),
        version: "v1".into(),
        mime_base64: String::new(),
        source_complete: false,
        classification: None,
        received_at: Utc::now(),
        size: 10,
        is_sent: false,
        draft_correlation: None,
    })
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_state_entries (link_id, kind, key, folder_id, received_at, document)
        SELECT
            $1,
            'message',
            'm:' || lpad(n::text, 6, '0'),
            'inbox',
            now(),
            jsonb_set($2, '{id}', to_jsonb ('m:' || lpad(n::text, 6, '0')))
        FROM
            generate_series(1, 100000) n
        "#,
        link,
        message,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_state_entries (link_id, kind, key, folder_id, message_id, document)
        SELECT
            $1,
            'location',
            'inbox:1:' || n,
            'inbox',
            'm:' || lpad(n::text, 6, '0'),
            jsonb_build_object(
                'folder_id', 'inbox',
                'uid_validity', 1,
                'uid', n,
                'message_id', 'm:' || lpad(n::text, 6, '0'),
                'fingerprint', 'fp:' || n
            )
        FROM
            generate_series(1, 100000) n
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("ANALYZE imap_state_entries")
        .execute(&pool)
        .await
        .unwrap();
    let repo = PgRepository::new(pool.clone());
    let binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    let (mut loading, staged) = repo.begin_acquisition(binding).await.unwrap();
    let idle = sqlx::query_scalar!(
        r#"SELECT current_setting('idle_in_transaction_session_timeout') AS "timeout!""#
    )
    .fetch_one(&mut *loading)
    .await
    .unwrap();
    drop(staged);
    drop(loading);
    assert_eq!(idle, "4min");
    let full_started = std::time::Instant::now();
    let full = repo
        .acquire_scoped(binding, StateSelection::Sync)
        .await
        .unwrap();
    assert_eq!(full.state.messages.len(), 100_000);
    assert_eq!(full.state.locations.len(), 100_000);
    assert_eq!(full.state.folders.len(), 1);
    repo.release(&full).await.unwrap();
    eprintln!(
        "100k-message complete sync load: {:?}",
        full_started.elapsed()
    );
    let untouched = sqlx::query_scalar!(
        r#"
        SELECT
            xmin::text
        FROM
            imap_state_entries
        WHERE
            link_id = $1
            AND kind = 'message'
            AND key = 'm:000002'
        "#,
        link,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let started = std::time::Instant::now();
    let mut account = repo
        .acquire_scoped(binding, StateSelection::Message("m:000001".into()))
        .await
        .unwrap();
    assert_eq!(account.state.messages.len(), 1);
    assert_eq!(account.state.locations.len(), 1);
    assert_eq!(account.checkpoint.len(), 3);
    account
        .state
        .messages
        .get_mut("m:000001")
        .unwrap()
        .flags
        .push("\\Seen".into());
    repo.save(&mut account).await.unwrap();
    repo.release(&account).await.unwrap();
    eprintln!(
        "100k-message bounded point read+write: {:?}",
        started.elapsed()
    );
    let mut health = repo
        .acquire_scoped(binding, StateSelection::Message("m:000001".into()))
        .await
        .unwrap();
    let checkpoint = health.checkpoint.clone();
    health.state.notification_pending = true;
    health
        .state
        .messages
        .get_mut("m:000001")
        .unwrap()
        .flags
        .push("\\Flagged".into());
    repo.save_health(&mut health).await.unwrap();
    assert_eq!(health.checkpoint, checkpoint);
    repo.release(&health).await.unwrap();
    let observed = repo
        .acquire_scoped(binding, StateSelection::Message("m:000001".into()))
        .await
        .unwrap();
    assert!(observed.state.notification_pending);
    assert_eq!(observed.state.messages["m:000001"].flags, vec!["\\Seen"]);
    repo.release(&observed).await.unwrap();
    let still_untouched = sqlx::query_scalar!(
        r#"
        SELECT
            xmin::text
        FROM
            imap_state_entries
        WHERE
            link_id = $1
            AND kind = 'message'
            AND key = 'm:000002'
        "#,
        link,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(untouched, still_untouched);
    let count = sqlx::query_scalar!(
        r#"
        SELECT
            count(*)
        FROM
            imap_state_entries
        WHERE
            link_id = $1
            AND kind = 'message'
        "#,
        link,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, Some(100_000));
    let scalar = sqlx::query_scalar!(
        r#"
        SELECT
            state
        FROM
            imap_accounts
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(scalar["messages"], serde_json::json!({}));
    let started = std::time::Instant::now();
    let page = repo
        .acquire_scoped(
            binding,
            StateSelection::Changes {
                folder: "inbox".into(),
                after: Some("m:050000".into()),
                sequence: 0,
            },
        )
        .await
        .unwrap();
    assert_eq!(page.state.locations.len(), 501);
    assert!(page.state.messages.is_empty());
    repo.release(&page).await.unwrap();
    eprintln!(
        "100k-message keyset page hydration: {:?}",
        started.elapsed()
    );
    let recent = repo
        .acquire_scoped(binding, StateSelection::Recent(100))
        .await
        .unwrap();
    assert_eq!(recent.state.messages.len(), 100);
    assert_eq!(recent.state.locations.len(), 100);
    repo.release(&recent).await.unwrap();
}

#[sqlx::test(migrations = false)]
async fn owner_settings_survive_refusal_and_reconnect_fences_stale_edit(pool: PgPool) {
    use crate::domain::account_settings::{SettingsRepository, UpdateFolderSettings};
    schema(&pool).await;
    let repo = PgRepository::new(pool.clone());
    let link = Uuid::now_v7();
    let mut binding = Binding {
        link_id: link,
        sync_generation: 1,
        grant_generation: 1,
    };
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
            VALUES ($1, 'settings-owner', 'IMAP')
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    async fn promote(repo: &PgRepository, b: Binding) {
        let v = Uuid::now_v7();
        repo.put_verification(VerifiedAccount {
            verification: Verification {
                id: v,
                expires_at: Utc::now() + Duration::minutes(15),
            },
            user_id: "settings-owner".into(),
            ciphertext: vec![2],
            consumed_by: None,
        })
        .await
        .unwrap();
        repo.connect(b, "settings-owner", vec![3], v).await.unwrap();
    }
    promote(&repo, binding).await;
    let mut limited = repo.acquire(binding).await.unwrap();
    limited.state.mailbox_issue = Some(models_email::service::link::MailboxIssue::SnapshotTooLarge);
    limited.state.sync_size_failures = 6;
    limited.state.sync_retry_at = Some(Utc::now() + Duration::hours(24));
    repo.save_health(&mut limited).await.unwrap();
    repo.release(&limited).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_state_entries (link_id, kind, key, document)
        SELECT
            $1,
            'folder',
            n::text,
            jsonb_build_object(
                'folder', jsonb_build_object(
                    'id', n::text,
                    'name', n::text,
                    'role', 'other',
                    'hasChildren', false
                ),
                'monitored', n <= 200
            )
        FROM
            generate_series(1, 240) n
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let catalog = repo.folders(binding).await.unwrap();
    assert_eq!(catalog.len(), 240);
    assert_eq!(catalog.iter().filter(|entry| entry.monitored).count(), 200);
    let prefs = UpdateFolderSettings {
        expected_revision: 0,
        role_overrides: Default::default(),
        excluded_folder_ids: Default::default(),
        watched_folder_ids: Default::default(),
    };
    assert_eq!(repo.update(binding, &prefs).await.unwrap(), 1);
    let state = sqlx::query_scalar!(
        r#"
        SELECT
            state
        FROM
            imap_accounts
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let state: AccountState = serde_json::from_value(state).unwrap();
    assert_eq!(state.sync_retry_at, None);
    assert_eq!(state.sync_size_failures, 6);
    assert!(matches!(
        repo.update(binding, &prefs).await,
        Err(Error::Conflict)
    ));
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            needs_reauth = true
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.credentials(binding).await.is_err());
    assert_eq!(
        repo.credentials_for_settings(binding).await.unwrap().0,
        "settings-owner"
    );
    binding.sync_generation = 2;
    binding.grant_generation = 2;
    promote(&repo, binding).await;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            sync_generation = 2,
            grant_generation = 2,
            needs_reauth = false
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(repo.preferences(binding).await.unwrap().revision, 2);
    assert!(matches!(
        repo.update(
            binding,
            &UpdateFolderSettings {
                expected_revision: 1,
                ..prefs
            }
        )
        .await,
        Err(Error::Conflict)
    ));
}

#[sqlx::test(migrations = false)]
async fn replicas_preserve_full_owned_capacity_and_only_fill_unowned_slots(pool: PgPool) {
    schema(&pool).await;
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, provider)
        SELECT
            md5('capacity-' || n)::uuid,
            'macro|owner@example.net',
            'IMAP'
        FROM
            generate_series(1, 2101) n
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let state = serde_json::to_value(AccountState::default()).unwrap();
    sqlx::query!(
        r#"
        INSERT INTO imap_accounts (link_id, user_id, sync_generation, grant_generation, credential_ciphertext, state)
        SELECT
            id,
            macro_id,
            1,
            1,
            decode('01', 'hex'),
            $1
        FROM
            email_links
        "#,
        state,
    ).execute(&pool).await.unwrap();
    let repo = PgRepository::new(pool.clone());
    let first = repo.bindings(2000, &[]).await.unwrap();
    assert_eq!(first.len(), 2000);
    let first_ids = first.iter().map(|b| b.link_id).collect::<Vec<_>>();
    let owner = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO imap_account_owners (link_id, owner_id, sync_generation, grant_generation, lease_until)
        SELECT
            link_id,
            $2,
            sync_generation,
            grant_generation,
            now() + interval '5 minutes'
        FROM
            imap_accounts
        WHERE
            link_id = ANY ($1)
        "#,
        &first_ids,
        owner,
    ).execute(&pool).await.unwrap();
    sqlx::query!(
        r#"
        UPDATE
            imap_accounts
        SET
            updated_at = now() + interval '1 hour'
        WHERE
            link_id = ANY ($1)
        "#,
        &first_ids,
    )
    .execute(&pool)
    .await
    .unwrap();
    let retained = repo.bindings(2000, &first_ids).await.unwrap();
    assert_eq!(
        retained
            .iter()
            .map(|b| b.link_id)
            .collect::<std::collections::BTreeSet<_>>(),
        first_ids.iter().copied().collect(),
        "successful sync timestamps must not rotate healthy owned actors out"
    );
    let second = repo.bindings(2000, &[]).await.unwrap();
    assert_eq!(second.len(), 101);
    assert!(second.iter().all(|b| !first_ids.contains(&b.link_id)));
    let second_ids = second.iter().map(|b| b.link_id).collect::<Vec<_>>();
    let second_owner = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO imap_account_owners (link_id, owner_id, sync_generation, grant_generation, lease_until)
        SELECT
            link_id,
            $2,
            sync_generation,
            grant_generation,
            now() + interval '5 minutes'
        FROM
            imap_accounts
        WHERE
            link_id = ANY ($1)
        "#,
        &second_ids,
        second_owner,
    ).execute(&pool).await.unwrap();
    assert!(repo.bindings(2000, &[]).await.unwrap().is_empty());
    let changed = first[0].link_id;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            sync_generation = 2,
            grant_generation = 2
        WHERE
            id = $1
        "#,
        changed,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            imap_accounts
        SET
            sync_generation = 2,
            grant_generation = 2
        WHERE
            link_id = $1
        "#,
        changed,
    )
    .execute(&pool)
    .await
    .unwrap();
    let refreshed = repo.bindings(2000, &first_ids).await.unwrap();
    assert!(
        refreshed
            .iter()
            .any(|b| b.link_id == changed && b.sync_generation == 2 && b.grant_generation == 2),
        "the scheduler must receive the successor binding so it cancels the old generation"
    );
    let expired = first[1];
    sqlx::query!(
        r#"
        UPDATE
            imap_account_owners
        SET
            lease_until = now() - interval '1 second'
        WHERE
            link_id = $1
        "#,
        expired.link_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let refill = repo.bindings(2000, &second_ids).await.unwrap();
    assert_eq!(refill.len(), 102);
    assert!(refill.iter().any(|b| b.link_id == expired.link_id));
    assert!(repo.claim_owner(expired, second_owner).await.unwrap());
}
