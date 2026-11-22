use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imap_and_outlook_workers_claim_their_own_provider_without_rollout_evaluation(db: PgPool) {
    use crate::domain::mailbox::progress::MailboxProgressRepository;

    let (outlook, outlook_link) = fixture(&db).await;
    let imap_link = Uuid::from_u128(42);
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, grant_generation)
            VALUES ($1, 'macro|imap@example.com', 'imap-owner', 'imap@example.com', 'IMAP', 1)
        "#,
        imap_link,
    ).execute(&db).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id)
            VALUES ($1, $2, 1, 'mail_folder', 'folder')
        "#,
        Uuid::from_u128(43),
        imap_link,
    )
    .execute(&db)
    .await
    .unwrap();
    let imap =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    let immediate = imap
        .claim_stream(Uuid::from_u128(44), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(immediate.mailbox.link_id, imap_link);
    imap.release_stream(&immediate, 0).await.unwrap();
    let lease = outlook
        .claim_stream(Uuid::from_u128(45), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lease.mailbox.link_id, outlook_link);
    assert!(
        outlook
            .claim_stream(Uuid::from_u128(46), StreamKind::MailFolder)
            .await
            .unwrap()
            .is_none()
    );
    // Graph's missing-mailbox diagnosis must not pause the IMAP inbox.
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            mailbox_unavailable_at = now()
        WHERE
            id = $1
        "#,
        outlook_link,
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = imap
        .claim_stream(Uuid::from_u128(47), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lease.mailbox.link_id, imap_link);
    let backlogs = imap.backlogs().await.unwrap();
    assert_eq!(backlogs.len(), 1);
    assert_eq!(backlogs[0].link_id, imap_link);
    assert!(!backlogs[0].mailbox_unavailable);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn blocked_imap_ingestion_records_one_recoverable_move_with_the_message(db: PgPool) {
    use email_api_client::domain::models::MailboxState;
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'IMAP'
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let repo =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    let stream = repo
        .claim_stream(Uuid::from_u128(100), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    let work = repo
        .claim_message(Uuid::from_u128(101))
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_mailbox_settings_work (id, link_id, kind, resource_key, desired)
            VALUES ($1, $2, 'sender_block', 'blocked@example.com', true)
        "#,
        Uuid::from_u128(102),
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(
        repo.sender_blocked(work.mailbox, "BLOCKED@example.com")
            .await
            .unwrap()
    );
    assert!(
        !repo
            .sender_blocked(work.mailbox, "other@example.com")
            .await
            .unwrap()
    );
    let message = snapshot(
        link,
        work.provider_id.as_str(),
        MailboxState {
            in_inbox: true,
            ..Default::default()
        },
        "v1",
    );
    repo.ingest_blocked(&work, message.clone(), BlockedSenderDestination::Junk)
        .await
        .unwrap();
    repo.ingest_blocked(&work, message, BlockedSenderDestination::Junk)
        .await
        .unwrap();
    let row = sqlx::query!(
        r#"
        SELECT
            count(*) AS "commands!"
        FROM
            email_mailbox_commands c
            JOIN email_mailbox_command_targets t ON t.command_id = c.id
            JOIN email_messages m ON m.id = t.message_id
        WHERE
            c.link_id = $1
            AND m.provider_id = $2
            AND c.intent = '{"kind":"junk","value":true}'::jsonb
        "#,
        link,
        work.provider_id.as_str(),
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.commands, 1);
    let visible = sqlx::query_scalar!(
        r#"
        SELECT
            inbox_visible
        FROM
            email_threads
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!visible);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imap_notifications_cannot_wake_or_revoke_a_reconnected_binding(db: PgPool) {
    use crate::domain::mailbox::imap_notifications::ImapNotificationService;
    use imap_engine::domain::models::{Binding, Notification};
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'IMAP',
            sync_generation = 2
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_sync_streams
        SET
            generation = 2,
            next_run_at = now() + interval '1 day'
        WHERE
            link_id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let service = ImapNotificationService(
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap),
    );
    service
        .receive(Notification {
            binding: Binding {
                link_id: link,
                sync_generation: 1,
                grant_generation: 1,
            },
            credentials_rejected: true,
            mailbox_issue: None,
            sync_retry_at: None,
        })
        .await
        .unwrap();
    let reauth = sqlx::query_scalar!(
        r#"
        SELECT
            needs_reauth
        FROM
            email_links
        WHERE
            id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!reauth);
    service
        .receive(Notification {
            binding: Binding {
                link_id: link,
                sync_generation: 2,
                grant_generation: 1,
            },
            credentials_rejected: false,
            mailbox_issue: None,
            sync_retry_at: None,
        })
        .await
        .unwrap();
    let due = sqlx::query_scalar!(
        r#"
        SELECT
            next_run_at <= now() AS "due!"
        FROM
            email_sync_streams
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(due);
    for _ in 0..2 {
        service
            .receive(Notification {
                binding: Binding {
                    link_id: link,
                    sync_generation: 2,
                    grant_generation: 1,
                },
                credentials_rejected: true,
                mailbox_issue: None,
                sync_retry_at: None,
            })
            .await
            .unwrap();
    }
    let notifications = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_projection_outbox
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(notifications, 1);
}

#[derive(Clone, Copy)]
struct MalformedThenValid;
impl MailboxGateway for MalformedThenValid {
    async fn folders(
        &self,
        _: MailboxKey,
    ) -> Result<
        email_api_client::domain::models::MailFolderCatalog,
        email_api_client::domain::models::EmailApiError,
    > {
        unreachable!()
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
        _: email_api_client::domain::models::RoundStart,
    ) -> Result<MailboxChangePage, email_api_client::domain::models::EmailApiError> {
        unreachable!()
    }
    async fn message(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        _: &[MailFolder],
    ) -> Result<
        Option<email_api_client::domain::models::MailboxMessage>,
        email_api_client::domain::models::EmailApiError,
    > {
        if id.as_str() == "a-malformed" {
            return Err(email_api_client::domain::models::EmailApiError::Permanent {
                message: "IMAP message MIME is invalid or exceeds parsing limits".into(),
            });
        }
        Ok(Some(snapshot(
            mailbox.link_id,
            id.as_str(),
            email_api_client::domain::models::MailboxState {
                in_inbox: true,
                ..Default::default()
            },
            "v1",
        )))
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn malformed_imap_mail_does_not_hold_later_messages_behind_it(db: PgPool) {
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'IMAP'
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import)
        VALUES
            ($1, 1, 'a-malformed', true),
            ($1, 1, 'b-good', true)
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let repo =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    let service =
        MailboxSyncService::new(repo.clone(), MalformedThenValid, MalformedThenValid, repo);
    assert!(matches!(
        service.reconcile_once().await,
        Err(MailboxError::Provider(
            email_api_client::domain::models::EmailApiError::Permanent { .. }
        ))
    ));
    assert!(service.reconcile_once().await.unwrap());
    let stored = sqlx::query_scalar!(
        r#"
        SELECT
            provider_id
        FROM
            email_messages
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(stored, vec![Some("b-good".into())]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imap_excluded_trash_and_ancestors_preserve_roles_without_scheduling_body_rechecks(
    db: PgPool,
) {
    use email_api_client::domain::models::{FolderRole, MailboxState};
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'IMAP'
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let repo =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id)
            VALUES ($1, $2, 1, 'folder_catalog', 'mail')
        "#,
        Uuid::now_v7(),
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let mut folders = vec![
        MailFolder {
            sync_enabled: true,
            id: ProviderId::new("trash").unwrap(),
            parent_id: None,
            name: "Trash".into(),
            role: FolderRole::Trash,
            has_children: true,
            total_items: Some(0),
        },
        MailFolder {
            sync_enabled: true,
            id: ProviderId::new("folder").unwrap(),
            parent_id: Some(ProviderId::new("trash").unwrap()),
            name: "Retained".into(),
            role: FolderRole::Other,
            has_children: false,
            total_items: Some(1),
        },
    ];
    let catalog = repo.claim_catalog(Uuid::now_v7()).await.unwrap().unwrap();
    repo.commit_catalog(&catalog, &folders).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import)
            VALUES ($1, 1, 'same-message', true)
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let work = repo.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    repo.ingest(
        &work,
        snapshot(
            link,
            "same-message",
            MailboxState {
                in_trash: true,
                ..Default::default()
            },
            "stable",
        ),
    )
    .await
    .unwrap();
    repo.complete_message(&work).await.unwrap();
    for excluded in [0, 1] {
        for (index, folder) in folders.iter_mut().enumerate() {
            folder.sync_enabled = index != excluded;
        }
        sqlx::query!(
            r#"
            UPDATE
                email_sync_streams
            SET
                next_run_at = now()
            WHERE
                link_id = $1
                AND kind = 'folder_catalog'
            "#,
            link,
        )
        .execute(&db)
        .await
        .unwrap();
        let catalog = repo.claim_catalog(Uuid::now_v7()).await.unwrap().unwrap();
        repo.commit_catalog(&catalog, &folders).await.unwrap();
        let retained = repo.folders(catalog.mailbox).await.unwrap();
        assert_eq!(
            retained.len(),
            2,
            "paused folders remain a complete role catalog"
        );
        assert_eq!(
            MailFolder::effective_role(&retained, Some(&folders[1].id)),
            FolderRole::Trash
        );
        assert!(
            !retained
                .iter()
                .find(|f| f.id == folders[excluded].id)
                .unwrap()
                .sync_enabled
        );
        let active = sqlx::query_scalar!(
            r#"
            SELECT
                count(*)
            FROM
                email_sync_streams
            WHERE
                link_id = $1
                AND kind = 'mail_folder'
                AND scope_id = $2
            "#,
            link,
            folders[excluded].id.as_str(),
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(active, Some(0));
        assert!(
            repo.claim_message(Uuid::now_v7()).await.unwrap().is_none(),
            "pausing a folder must not schedule downloads of retained message bodies"
        );
        let state = sqlx::query_scalar!(
            r#"
            SELECT
                (mailbox_state ->> 'in_trash')::boolean
            FROM
                email_messages
            WHERE
                link_id = $1
                AND provider_id = 'same-message'
            "#,
            link,
        )
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(state, Some(true));
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn size_health_is_fenced_edge_triggered_and_cleared_without_reauth(db: PgPool) {
    use crate::domain::mailbox::imap_notifications::ImapNotificationService;
    use imap_engine::domain::models::{Binding, Notification};
    use models_email::service::link::MailboxIssue;
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'IMAP',
            sync_generation = 2
        WHERE
            id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let service = ImapNotificationService(
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap),
    );
    let binding = Binding {
        link_id: link,
        sync_generation: 2,
        grant_generation: 1,
    };
    let count_before = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_projection_outbox
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let retry_at = chrono::Utc::now() + chrono::Duration::hours(1);
    for _ in 0..2 {
        service
            .receive(Notification {
                binding,
                credentials_rejected: false,
                mailbox_issue: Some(MailboxIssue::SnapshotTooLarge),
                sync_retry_at: Some(retry_at),
            })
            .await
            .unwrap();
    }
    service
        .receive(Notification {
            binding: Binding {
                sync_generation: 1,
                ..binding
            },
            credentials_rejected: false,
            mailbox_issue: None,
            sync_retry_at: None,
        })
        .await
        .unwrap();
    let current = sqlx::query!(
        r#"
        SELECT
            mailbox_issue,
            mailbox_retry_at,
            needs_reauth
        FROM
            email_links
        WHERE
            id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(current.mailbox_issue.as_deref(), Some("snapshot_too_large"));
    assert!(!current.needs_reauth);
    assert_eq!(
        current.mailbox_retry_at.map(|value| value.timestamp()),
        Some(retry_at.timestamp())
    );
    let count_after = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_projection_outbox
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count_after, count_before + 1);
    service
        .receive(Notification {
            binding,
            credentials_rejected: false,
            mailbox_issue: Some(MailboxIssue::SnapshotTooLarge),
            sync_retry_at: Some(retry_at + chrono::Duration::hours(1)),
        })
        .await
        .unwrap();
    let later_deadline_event = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_projection_outbox
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(later_deadline_event, count_before + 2);

    service
        .receive(Notification {
            binding,
            credentials_rejected: false,
            mailbox_issue: None,
            sync_retry_at: None,
        })
        .await
        .unwrap();
    let cleared = sqlx::query!(
        r#"
        SELECT
            mailbox_issue,
            mailbox_retry_at,
            needs_reauth
        FROM
            email_links
        WHERE
            id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(cleared.mailbox_issue.is_none());
    assert!(cleared.mailbox_retry_at.is_none());
    assert!(!cleared.needs_reauth);
}
