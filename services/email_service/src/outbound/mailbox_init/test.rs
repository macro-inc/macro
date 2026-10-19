use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[derive(Clone)]
struct Grants(VerifiedMailboxGrant);
impl CompletedMailboxGrantSource for Grants {
    async fn completed_grant(
        &self,
        _: Uuid,
        owner: Uuid,
    ) -> Result<VerifiedMailboxGrant, InitializationError> {
        if owner != self.0.owner {
            return Err(InitializationError::InvalidAttempt);
        }
        Ok(self.0.clone())
    }
}

async fn actor(db: &PgPool, email: &str) -> (Uuid, MacroUserIdStr<'static>) {
    let id = macro_uuid::generate_uuid_v7();
    let macro_id = MacroUserIdStr::try_from(format!("macro|{email}")).unwrap();
    sqlx::query!(
        "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$3,$4)",
        id,
        macro_id.as_ref(),
        email,
        format!("cus_{id}")
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ($1,$2,$3)"#,
        macro_id.as_ref(),
        email,
        id
    )
    .execute(db)
    .await
    .unwrap();
    (id, macro_id)
}

async fn attempt(db: &PgPool, actor: (Uuid, MacroUserIdStr<'static>)) -> InitializeMailbox {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO in_progress_user_link (id,macro_user_id,email_provider,linked_email) VALUES ($1,$2,'OUTLOOK','mailbox@example.com')",id,actor.0)
        .execute(db).await.unwrap();
    InitializeMailbox {
        attempt: id,
        actor: actor.1,
        actor_fusion_id: actor.0,
        force_share: false,
    }
}

fn grant(owner: Uuid) -> VerifiedMailboxGrant {
    VerifiedMailboxGrant {
        scopes: vec![
            "User.Read".into(),
            "Mail.ReadWrite".into(),
            "Mail.Send".into(),
        ],
        calendar_requested: false,
        id: macro_uuid::generate_uuid_v7(),
        generation: 1,
        owner,
        email: "mailbox@example.com".into(),
        tenant_id: "tenant".into(),
        mailbox_id: "mailbox".into(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn initialization_is_atomic_idempotent_and_seeds_independent_provider_streams(db: PgPool) {
    let actor = actor(&db, "owner@example.com").await;
    let request = attempt(&db, actor.clone()).await;
    let service = MailboxInitializationService::new(
        PgMailboxInitialization(db.clone()),
        Grants(grant(actor.0)),
    );
    let link = service.initialize(request.clone()).await.unwrap();
    assert!(service.recognizes(&request).await.unwrap());
    assert_eq!(service.initialize(request.clone()).await.unwrap(), link);
    let row = sqlx::query!("SELECT provider::text AS provider,grant_generation,provider_mailbox_id FROM email_links WHERE id = $1",link).fetch_one(&db).await.unwrap();
    assert_eq!(row.provider.as_deref(), Some("OUTLOOK"));
    assert_eq!(row.grant_generation, 1);
    assert_eq!(row.provider_mailbox_id.as_deref(), Some("mailbox"));
    let streams = sqlx::query!(
        "SELECT kind FROM email_sync_streams WHERE link_id = $1 ORDER BY kind",
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(
        streams
            .iter()
            .map(|stream| stream.kind.as_str())
            .collect::<Vec<_>>(),
        vec!["contacts_catalog", "contacts_profile", "folder_catalog"]
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_projection_outbox WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(1)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM in_progress_user_link WHERE id = $1",
            request.attempt
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_promotion_keeps_one_inbox_and_both_scoped_access_edges(db: PgPool) {
    let first = actor(&db, "first@example.com").await;
    let second = actor(&db, "second@example.com").await;
    let service = MailboxInitializationService::new(
        PgMailboxInitialization(db.clone()),
        Grants(grant(first.0)),
    );
    let link = service
        .initialize(attempt(&db, first.clone()).await)
        .await
        .unwrap();
    let service = MailboxInitializationService::new(
        PgMailboxInitialization(db.clone()),
        Grants(grant(second.0)),
    );
    let mut request = attempt(&db, second.clone()).await;
    assert!(matches!(
        service.initialize(request.clone()).await,
        Err(InitializationError::SharingConfirmation { .. })
    ));
    request.force_share = true;
    assert_eq!(service.initialize(request).await.unwrap(), link);
    let row = sqlx::query!(
        "SELECT macro_id,fusionauth_user_id,sync_generation FROM email_links WHERE id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.macro_id, "macro|mailbox@example.com");
    assert_eq!(row.fusionauth_user_id, second.0.to_string());
    assert_eq!(row.sync_generation, 2);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM email_links")
            .fetch_one(&db)
            .await
            .unwrap(),
        Some(1)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM macro_user_links WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(2)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn wrong_actor_and_changed_snapshot_cannot_consume_an_attempt(db: PgPool) {
    let owner = actor(&db, "owner@example.com").await;
    let other = actor(&db, "other@example.com").await;
    let mut request = attempt(&db, owner.clone()).await;
    let grants = grant(owner.0);
    let repo = PgMailboxInitialization(db.clone());
    let before = repo.inspect(&request, &grants).await.unwrap();
    request.actor = other.1;
    request.actor_fusion_id = other.0;
    assert!(matches!(
        repo.commit(
            &request,
            &grants,
            &before,
            InitializationDecision::Create {
                owner: owner.1.clone()
            }
        )
        .await,
        Err(InitializationError::Changed)
    ));
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM email_links")
            .fetch_one(&db)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM in_progress_user_link WHERE id = $1",
            request.attempt
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(1)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mixed_provider_connection_limit_is_rechecked_without_blocking_reconnect(db: PgPool) {
    let owner = actor(&db, "limit@example.com").await;
    let req = attempt(&db, owner.clone()).await;
    let service = MailboxInitializationService::new(
        PgMailboxInitialization(db.clone()),
        Grants(grant(owner.0)),
    );
    let outlook = service.initialize(req.clone()).await.unwrap();
    let gmail = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES($1,$2,$3,'other@example.com','GMAIL')",gmail,owner.1.as_ref(),owner.0.to_string()).execute(&db).await.unwrap();
    let reconnect = attempt(&db, owner.clone()).await;
    assert_eq!(service.initialize(reconnect).await.unwrap(), outlook);
    let req = attempt(&db, owner.clone()).await;
    let mut third = grant(owner.0);
    third.email = "third@example.com".into();
    third.mailbox_id = "third".into();
    let service =
        MailboxInitializationService::new(PgMailboxInitialization(db.clone()), Grants(third));
    assert!(matches!(
        service.initialize(req).await,
        Err(InitializationError::PaymentRequired)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn gmail_reservation_counts_outlook_and_allows_only_verified_reconnect(db: PgPool) {
    let owner = actor(&db, "gmail-limit@example.com").await;
    for (address, provider) in [
        ("gmail@example.com", "GMAIL"),
        ("outlook@example.com", "OUTLOOK"),
    ] {
        sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES($1,$2,$3,$4,$5::text::email_user_provider_enum)",Uuid::now_v7(),owner.1.as_ref(),owner.0.to_string(),address,provider).execute(&db).await.unwrap();
    }
    let admission = email::domain::inbox_entitlement::InboxConnectionService(
        email::outbound::EmailPgRepo::new(db.clone()),
    );
    let gmail =
        sqlx::query_scalar!("SELECT id FROM email_links WHERE email_address='gmail@example.com'")
            .fetch_one(&db)
            .await
            .unwrap();
    assert!(
        admission
            .permits_connection(
                owner.1.clone(),
                false,
                email::domain::models::UserProvider::Gmail,
                Some(gmail)
            )
            .await
            .unwrap()
    );
    assert!(
        !admission
            .permits_connection(
                owner.1.clone(),
                false,
                email::domain::models::UserProvider::Outlook,
                Some(gmail)
            )
            .await
            .unwrap()
    );
    assert!(
        !admission
            .permits_connection(
                owner.1.clone(),
                false,
                email::domain::models::UserProvider::Gmail,
                Some(Uuid::now_v7())
            )
            .await
            .unwrap()
    );
    let mut tx = db.begin().await.unwrap();
    assert!(matches!(
        lock_gmail_connection(&mut tx, owner.1.as_ref(), "third@example.com").await,
        Err(InitializationError::PaymentRequired)
    ));
    assert!(matches!(
        lock_gmail_connection(&mut tx, owner.1.as_ref(), "outlook@example.com").await,
        Err(InitializationError::PaymentRequired)
    ));
    lock_gmail_connection(&mut tx, owner.1.as_ref(), "GMAIL@example.com")
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn admission_pause_rejects_new_mailbox_but_preserves_reconnect(db: PgPool) {
    let owner = actor(&db, "pause@example.com").await;
    let request = attempt(&db, owner.clone()).await;
    let service = MailboxInitializationService::new(
        PgMailboxInitialization(db.clone()),
        Grants(grant(owner.0)),
    )
    .with_connections_enabled(false);
    assert!(matches!(
        service.initialize(request.clone()).await,
        Err(InitializationError::Unavailable)
    ));
    let enabled = MailboxInitializationService::new(
        PgMailboxInitialization(db.clone()),
        Grants(grant(owner.0)),
    );
    let link = enabled.initialize(request).await.unwrap();
    assert_eq!(
        service
            .initialize(attempt(&db, owner.clone()).await)
            .await
            .unwrap(),
        link
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_gmail_and_outlook_connections_share_one_remaining_free_slot(db: PgPool) {
    let owner = actor(&db, "concurrent-limit@example.com").await;
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES($1,$2,$3,'first@gmail.example','GMAIL')",Uuid::new_v4(),owner.1.as_ref(),owner.0.to_string()).execute(&db).await.unwrap();
    let request = attempt(&db, owner.clone()).await;
    let service = MailboxInitializationService::new(
        PgMailboxInitialization(db.clone()),
        Grants(grant(owner.0)),
    );
    let gmail = async {
        let mut tx = db.begin().await.map_err(unavailable)?;
        lock_gmail_connection(&mut tx, owner.1.as_ref(), "second@gmail.example").await?;
        let id = Uuid::new_v4();
        sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES($1,$2,$3,'second@gmail.example','GMAIL')",id,owner.1.as_ref(),owner.0.to_string()).execute(&mut *tx).await.map_err(unavailable)?;
        tx.commit().await.map_err(unavailable)?;
        Ok::<_, InitializationError>(id)
    };
    let (gmail, outlook) = tokio::join!(gmail, service.initialize(request));
    assert_ne!(gmail.is_ok(), outlook.is_ok());
    let failure = gmail.err().or(outlook.err()).unwrap();
    assert!(matches!(failure, InitializationError::PaymentRequired));
    let count=sqlx::query_scalar!("SELECT count(*) FROM email_links l WHERE l.macro_id=$1 OR EXISTS(SELECT 1 FROM macro_user_links a WHERE a.link_id=l.id AND a.primary_macro_id=$1)",owner.1.as_ref()).fetch_one(&db).await.unwrap();
    assert_eq!(count, Some(2));
}
