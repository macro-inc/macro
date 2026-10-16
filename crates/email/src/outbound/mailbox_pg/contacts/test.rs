use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn fixture(db: &PgPool) -> (PgMailboxSync, Uuid) {
    let (repo, link) = super::super::test::fixture(db).await;
    sqlx::query!("INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'contacts','root')",macro_uuid::generate_uuid_v7(),link).execute(db).await.unwrap();
    (repo, link)
}
fn page(emails: &[&str]) -> AddressBookPage {
    AddressBookPage {
        contacts: vec![AddressBookContact {
            id: ProviderId::new("saved").unwrap(),
            name: Some("Saved name".into()),
            emails: emails.iter().map(|e| (*e).into()).collect(),
        }],
        removed: vec![],
        position: StreamPosition::Checkpoint(StreamToken::new("checkpoint".into())),
    }
}
async fn due(db: &PgPool, link: Uuid) {
    sqlx::query!("UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1 AND kind = 'contacts'",link).execute(db).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn multiple_addresses_and_deletion_restore_header_names_without_deleting_contacts(
    db: PgPool,
) {
    let (repo, link) = fixture(&db).await;
    let header = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO email_contacts(id,link_id,email_address,name) VALUES ($1,$2,'a@example.com','Header name')",header,link).execute(&db).await.unwrap();
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    AddressBookRepository::commit_page(&repo, &work, &page(&["a@example.com", "b@example.com"]))
        .await
        .unwrap();
    let names = sqlx::query_scalar!(
        "SELECT name FROM email_contacts WHERE link_id = $1 ORDER BY email_address",
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(
        names,
        vec![Some("Saved name".into()), Some("Saved name".into())]
    );
    due(&db, link).await;
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    AddressBookRepository::commit_page(
        &repo,
        &work,
        &AddressBookPage {
            contacts: vec![],
            removed: vec![ProviderId::new("saved").unwrap()],
            position: StreamPosition::Checkpoint(StreamToken::new("after-delete".into())),
        },
    )
    .await
    .unwrap();
    let rows = sqlx::query!(
        "SELECT id,name FROM email_contacts WHERE link_id = $1 ORDER BY email_address",
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].id, header);
    assert_eq!(rows[0].name.as_deref(), Some("Header name"));
    assert_eq!(rows[1].name, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stale_generation_commits_neither_cursor_nor_contact(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        "UPDATE email_links SET grant_generation = grant_generation + 1 WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        AddressBookRepository::commit_page(&repo, &work, &page(&["a@example.com"])).await,
        Err(MailboxError::Stale)
    ));
    let contacts = sqlx::query_scalar!(
        "SELECT count(*) FROM email_address_book_sources WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(contacts, Some(0));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT position FROM email_sync_streams WHERE id = $1",
            work.stream.id
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_cursor_only_retires_missing_entries_at_final_page(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    AddressBookRepository::commit_page(&repo, &work, &page(&["a@example.com"]))
        .await
        .unwrap();
    due(&db, link).await;
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    repo.reset(&work).await.unwrap();
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    AddressBookRepository::commit_page(
        &repo,
        &work,
        &AddressBookPage {
            contacts: vec![],
            removed: vec![],
            position: StreamPosition::Continue(StreamToken::new("next".into())),
        },
    )
    .await
    .unwrap();
    assert!(
        sqlx::query_scalar!(
            "SELECT deleted_at FROM email_address_book_sources WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .is_none()
    );
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    AddressBookRepository::commit_page(
        &repo,
        &work,
        &AddressBookPage {
            contacts: vec![],
            removed: vec![],
            position: StreamPosition::Checkpoint(StreamToken::new("fresh".into())),
        },
    )
    .await
    .unwrap();
    assert!(
        sqlx::query_scalar!(
            "SELECT deleted_at FROM email_address_book_sources WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap()
        .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_in_flight_photo_cannot_restore_a_deleted_contact(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    AddressBookRepository::commit_page(&repo, &work, &page(&["a@example.com"]))
        .await
        .unwrap();
    let photo = repo
        .claim_photo(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    due(&db, link).await;
    let work = repo
        .claim(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    AddressBookRepository::commit_page(
        &repo,
        &work,
        &AddressBookPage {
            contacts: vec![],
            removed: vec![ProviderId::new("saved").unwrap()],
            position: StreamPosition::Checkpoint(StreamToken::new("deleted".into())),
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        repo.commit_photo(&photo, Some("hash"), Some("https://images.invalid/avatar"))
            .await,
        Err(MailboxError::Stale)
    ));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT sfs_photo_url FROM email_contacts WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        None
    );
}
