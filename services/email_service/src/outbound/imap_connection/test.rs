use super::*;
use imap_service_client::{Endpoint, Login, Secret, TlsMode};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn owner(db: &PgPool) -> MacroUserIdStr<'static> {
    let macro_id = MacroUserIdStr::try_from("macro|owner@example.com").unwrap();
    let id = Uuid::from_u128(1);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
            VALUES ($1, 'macro|owner@example.com', 'owner@example.com', 'cus_imap')
        "#,
        id,
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
            VALUES ('macro|owner@example.com', 'owner@example.com', $1)
        "#,
        id,
    )
    .execute(db)
    .await
    .unwrap();
    macro_id
}
fn input(id: u128) -> ImapConnectRequest {
    let login = Login {
        endpoint: Endpoint {
            host: "mail.example.com".into(),
            port: 993,
            tls: TlsMode::Implicit,
            username: "owner@example.com".into(),
        },
        password: Secret("secret".into()),
    };
    ImapConnectRequest {
        request_id: Uuid::from_u128(id),
        link_id: None,
        email: macro_user_id::email::EmailStr::parse_from_str("owner@example.com").unwrap(),
        imap: login.clone(),
        smtp: login,
        confirmed_hosts: vec!["mail.example.com".into()],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn promotion_is_inactive_until_activated_replayable_and_cannot_resurrect_disconnected_links(
    db: PgPool,
) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let request = input(2);
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = repo
        .reserve(&actor, "owner", &request, &verification)
        .await
        .unwrap();
    let active = sqlx::query_scalar!(
        r#"
        SELECT
            is_sync_active
        FROM
            email_links
        WHERE
            id = $1
        "#,
        attempt.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!active);
    assert!(
        repo.attempt(
            &MacroUserIdStr::try_from("macro|other@example.com").unwrap(),
            request.request_id
        )
        .await
        .unwrap()
        .is_none()
    );
    assert_eq!(
        repo.activate(&attempt).await.unwrap(),
        attempt.binding.link_id
    );
    assert_eq!(
        repo.activate(&attempt).await.unwrap(),
        attempt.binding.link_id
    );
    let streams = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_sync_streams
        WHERE
            link_id = $1
            AND kind = 'folder_catalog'
        "#,
        attempt.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(streams, 1);
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            is_sync_active = false,
            sync_generation = sync_generation + 1,
            disconnect_requested_at = now()
        WHERE
            id = $1
        "#,
        attempt.binding.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.attempt(&actor, request.request_id).await,
        Err(ImapConnectionError::Changed)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reservation_serializes_provider_collisions_and_abandons_only_inactive_provisional_links(
    db: PgPool,
) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let attempt = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    assert!(matches!(
        crate::outbound::mailbox_init::lock_gmail_connection(
            &mut *db.acquire().await.unwrap(),
            actor.as_ref(),
            actor.email_str()
        )
        .await,
        Err(email::domain::mailbox::initialization::InitializationError::IdentityConflict)
    ));
    repo.abandon(&attempt).await.unwrap();
    let exists = sqlx::query_scalar!(
        r#"
        SELECT
            EXISTS (
                SELECT
                    1
                FROM
                    email_links
                WHERE
                    id = $1) AS "exists!"
        "#,
        attempt.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!exists);
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
            VALUES ($1, 'macro|owner@example.com', 'owner', 'owner@example.com', 'GMAIL')
        "#,
        Uuid::from_u128(4),
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.reserve(&actor, "owner", &input(5), &verification)
            .await,
        Err(ImapConnectionError::ProviderConflict)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn verified_reconnect_clears_old_health_without_replacing_the_link(db: PgPool) {
    let actor = owner(&db).await;
    let repo = PgImapConnections(db.clone());
    let verification = Verification {
        id: Uuid::from_u128(3),
        expires_at: chrono::Utc::now() + chrono::Duration::minutes(15),
    };
    let first = repo
        .reserve(&actor, "owner", &input(2), &verification)
        .await
        .unwrap();
    repo.activate(&first).await.unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            needs_reauth = true,
            mailbox_issue = 'credentials_unreadable',
            mailbox_retry_at = now() + interval '1 hour'
        WHERE
            id = $1
        "#,
        first.binding.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE email_sync_streams
        SET provider_retry_at = now() + interval '1 hour',
            next_run_at = now() + interval '1 hour'
        WHERE link_id = $1
        "#,
        first.binding.link_id,
    )
    .execute(&db)
    .await
    .unwrap();
    let floor = sqlx::query_scalar!(
        "SELECT max(provider_retry_at) FROM email_sync_streams WHERE link_id = $1",
        first.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let mut request = input(4);
    request.link_id = Some(first.binding.link_id);
    let attempt = repo
        .reserve(&actor, "owner", &request, &verification)
        .await
        .unwrap();
    assert_eq!(
        repo.activate(&attempt).await.unwrap(),
        first.binding.link_id
    );
    let state = sqlx::query!(
        r#"
        SELECT
            needs_reauth,
            mailbox_issue,
            mailbox_retry_at,
            sync_generation,
            grant_generation
        FROM
            email_links
        WHERE
            id = $1
        "#,
        first.binding.link_id,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!state.needs_reauth);
    assert!(state.mailbox_issue.is_none());
    assert!(state.mailbox_retry_at.is_none());
    assert_eq!(state.sync_generation, first.binding.sync_generation + 1);
    assert_eq!(state.grant_generation, first.binding.grant_generation + 1);
    let carried = sqlx::query_scalar!(
        "SELECT provider_retry_at FROM email_sync_streams WHERE link_id = $1 AND generation = $2 AND kind = 'folder_catalog'",
        first.binding.link_id,
        state.sync_generation,
    ).fetch_one(&db).await.unwrap();
    assert_eq!(
        carried, floor,
        "a new password must not reset provider pacing"
    );
}
