use super::*;
use crate::domain::mailbox::imap_catchup::ImapCatchupRepository;
use crate::outbound::imap_catchup_pg::PgImapCatchup;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imap_startup_catchup_wakes_current_cursors_without_stealing_leases(db: PgPool) {
    let links = (1..=5).map(Uuid::from_u128).collect::<Vec<_>>();
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider,
            is_sync_active, needs_reauth, sync_generation, grant_generation
        )
        SELECT
            id,
            'macro|catchup-' || n::text || '@example.com',
            'catchup-owner-' || n::text,
            'catchup-' || n::text || '@example.com',
            (CASE WHEN n = 5 THEN 'OUTLOOK' ELSE 'IMAP' END)::email_user_provider_enum,
            n <> 3,
            n = 4,
            CASE WHEN n = 1 THEN 2 ELSE 1 END,
            1
        FROM unnest($1::uuid[]) WITH ORDINALITY AS links(id, n)
        "#,
        &links,
    )
    .execute(&db)
    .await
    .unwrap();
    let ids = [11, 12, 21, 22, 31, 41, 51].map(Uuid::from_u128);
    let link_ids = [
        links[0], links[0], links[1], links[1], links[2], links[3], links[4],
    ];
    let generations = [1i64, 2, 1, 1, 1, 1, 1];
    let held = Uuid::from_u128(999);
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (
            id, link_id, generation, kind, scope_id, position, next_run_at,
            lease_id, lease_until, lease_started_at
        )
        SELECT
            id, link_id, generation,
            CASE WHEN n = 4 THEN 'folder_catalog' ELSE 'mail_folder' END,
            'INBOX', 'kept-cursor',
            CASE WHEN n IN (2, 3, 4) THEN now() - interval '1 minute' ELSE now() + interval '1 day' END,
            $4, now() + interval '1 day', now() - interval '1 second'
        FROM unnest($1::uuid[], $2::uuid[], $3::bigint[]) WITH ORDINALITY AS streams(id, link_id, generation, n)
        "#,
        &ids,
        &link_ids,
        &generations,
        held,
    ).execute(&db).await.unwrap();
    let repo =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    let catchup = PgImapCatchup(db.clone());
    let mut woken = 0;
    loop {
        let lease = catchup.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
        let page = catchup.advance(&lease, 1, 0).await.unwrap();
        assert!(page.scanned <= 1);
        woken += page.woken;
        if page.complete {
            break;
        }
    }
    assert_eq!(woken, 3);
    let streams = sqlx::query!(
        r#"
        SELECT
            id,
            position,
            lease_id,
            lease_until > clock_timestamp() AS "lease_kept!",
            next_run_at <= clock_timestamp() AS "due!"
        FROM email_sync_streams
        WHERE id = ANY($1)
        ORDER BY id
        "#,
        &ids,
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(streams.len(), 7);
    for stream in streams {
        assert_eq!(stream.position.as_deref(), Some("kept-cursor"));
        assert_eq!(stream.lease_id, Some(held));
        assert!(stream.lease_kept);
        assert_eq!(
            stream.due,
            stream.id == ids[1] || stream.id == ids[2] || stream.id == ids[3]
        );
    }

    // A claim already in flight must not overwrite the newer startup wakeup
    // with its transport-error backoff while releasing its own lease.
    let mailbox = MailboxKey {
        link_id: links[1],
        sync_generation: 1,
        grant_generation: 1,
    };
    repo.release_stream(
        &StreamLease {
            id: ids[2],
            mailbox,
            folder: ProviderId::new("INBOX").unwrap(),
            pass: crate::domain::mailbox::live_pass::FolderPass::Folder,
            position: Some(StreamToken::new("kept-cursor".into())),
            initial_complete: false,
            lease_id: held,
            fence: 0,
            notification: None,
        },
        SyncRetry::Local(120),
    )
    .await
    .unwrap();
    let next = repo
        .claim_stream(Uuid::from_u128(1000), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(next.id, ids[2]);
    assert_eq!(next.position.as_ref().unwrap().expose(), "kept-cursor");
    repo.release_catalog(
        &CatalogLease {
            id: ids[3],
            mailbox,
            lease_id: held,
            fence: 0,
        },
        SyncRetry::Local(120),
    )
    .await
    .unwrap();
    let catalog = repo
        .claim_catalog(Uuid::from_u128(1001))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(catalog.id, ids[3]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn successful_imap_commits_preserve_hints_even_when_their_timestamps_precede_the_lease(
    db: PgPool,
) {
    let (_, link) = fixture_for_provider(&db, crate::domain::models::UserProvider::Imap).await;

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
    let stream = repo
        .claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();
    let catalog = repo.claim_catalog(Uuid::now_v7()).await.unwrap().unwrap();
    // Model a new generation stamped by a clock behind the lease holder.
    sqlx::query!(
        r#"
        UPDATE email_sync_streams
        SET notification_revision = notification_revision + 1,
            notified_at = lease_started_at - interval '1 second'
        WHERE link_id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    repo.commit_page(&stream, &page()).await.unwrap();
    repo.commit_catalog(&catalog, &[]).await.unwrap();
    let due = sqlx::query!(
        r#"
        SELECT id, next_run_at <= clock_timestamp() AS "due!"
        FROM email_sync_streams
        WHERE id = ANY($1)
        "#,
        &[stream.id, catalog.id],
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(due.len(), 2);
    assert!(
        due.iter().all(|row| row.due),
        "a newer hint must remain due"
    );
}
