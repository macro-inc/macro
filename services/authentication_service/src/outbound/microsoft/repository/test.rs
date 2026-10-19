use super::*;
use crate::domain::microsoft::token::MicrosoftRefreshToken;
use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn owner(db: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'outlook-tester', 'outlook-owner@example.com', 'cus_outlook_test')",id).execute(db).await.unwrap();
    id
}

fn pending(owner: Uuid) -> LinkAttempt {
    LinkAttempt {
        id: macro_uuid::generate_uuid_v7(),
        owner,
        identity_provider_id: "microsoft".into(),
        redirect_uri: "https://auth.example.com/callback".into(),
        return_uri: None,
        verifier: Zeroizing::new("verifier".into()),
        nonce: "nonce".into(),
        calendar_requested: false,
        expires_at: Utc::now() + Duration::minutes(10),
    }
}
fn identity() -> VerifiedGrant {
    VerifiedGrant {
        tenant_id: "tenant".into(),
        subject_id: "subject".into(),
        mailbox_id: "mailbox".into(),
        email: "outlook-test@example.com".into(),
        scopes: vec!["Mail.ReadWrite".into()],
        refresh_token: MicrosoftRefreshToken::new("refresh".into()),
    }
}
fn envelope(seed: u8) -> EncryptedMicrosoftToken {
    EncryptedMicrosoftToken {
        refresh_token_ciphertext: vec![seed; 32],
        encrypted_data_key: vec![seed; 32],
        nonce: vec![seed; 12],
        encryption_version: 1,
        kms_key_id: "test-key".into(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn credential_acquisition_fences_mailbox_custody_and_revocation_preserves_active_or_newer_grants(
    db: PgPool,
) {
    let repo = PgMicrosoftGrants::new(db.clone());
    let owner = owner(&db).await;
    let attempt = pending(owner);
    repo.begin_link(&attempt).await.unwrap();
    let attempt = repo.claim_link(attempt.id).await.unwrap();
    let grant = macro_uuid::generate_uuid_v7();
    repo.complete_link(&attempt, &identity(), &envelope(1), grant)
        .await
        .unwrap();
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider,grant_id,grant_generation) VALUES ($1,'macro|outlook-test@example.com',$2,'outlook-test@example.com','OUTLOOK',$3,1)",link,owner.to_string(),grant).execute(&db).await.unwrap();
    assert!(repo.active_grant(link, 1, 1).await.is_ok());
    assert!(repo.disconnecting_grant(link, 1, 1).await.is_err());
    sqlx::query!(
        "UPDATE email_links SET sync_generation = 2 WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.active_grant(link, 1, 1).await,
        Err(MicrosoftAuthError::ReauthorizationRequired)
    ));
    assert!(repo.active_grant(link, 1, 2).await.is_ok());
    repo.revoke_released_grant(grant, 1, &owner.to_string())
        .await
        .unwrap();
    assert!(repo.active_grant(link, 1, 2).await.is_ok());
    sqlx::query!(
        "UPDATE email_links SET is_sync_active = false WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.disconnecting_grant(link, 1, 2).await.is_err());
    sqlx::query!(
        "UPDATE email_links SET disconnect_requested_at=now() WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.disconnecting_grant(link, 1, 2).await.is_ok());
    assert!(repo.disconnecting_grant(link, 1, 1).await.is_err());
    assert!(repo.active_grant(link, 1, 2).await.is_err());
    repo.revoke_released_grant(grant, 1, "someone-else")
        .await
        .unwrap();
    repo.revoke_released_grant(grant, 0, &owner.to_string())
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM microsoft_oauth_grant_versions WHERE grant_id = $1",
            grant
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(1)
    );
    repo.revoke_released_grant(grant, 1, &owner.to_string())
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM microsoft_oauth_grant_versions WHERE grant_id = $1",
            grant
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
    repo.revoke_released_grant(grant, 1, &owner.to_string())
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn callback_claim_is_once_and_rejects_google_attempts(db: PgPool) {
    let repo = PgMicrosoftGrants::new(db.clone());
    let attempt = pending(owner(&db).await);
    repo.begin_link(&attempt).await.unwrap();
    assert!(repo.claim_link(attempt.id).await.is_ok());
    assert!(matches!(
        repo.claim_link(attempt.id).await,
        Err(MicrosoftAuthError::InvalidAttempt)
    ));
    let other = pending(attempt.owner);
    repo.begin_link(&other).await.unwrap();
    sqlx::query!(
        "UPDATE in_progress_user_link SET email_provider = 'GMAIL' WHERE id = $1",
        other.id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.claim_link(other.id).await,
        Err(MicrosoftAuthError::InvalidAttempt)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_stages_exact_attempt_and_fences_rotation_only_after_adoption(db: PgPool) {
    let repo = PgMicrosoftGrants::new(db.clone());
    let owner = owner(&db).await;
    let first = pending(owner);
    repo.begin_link(&first).await.unwrap();
    let first = repo.claim_link(first.id).await.unwrap();
    let first_id = macro_uuid::generate_uuid_v7();
    repo.complete_link(&first, &identity(), &envelope(1), first_id)
        .await
        .unwrap();
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider,grant_id,grant_generation) VALUES ($1,'macro|outlook-test@example.com',$2,'outlook-test@example.com','OUTLOOK',$3,1)",link,owner.to_string(),first_id).execute(&db).await.unwrap();
    let grant = repo.active_grant(link, 1, 1).await.unwrap();
    let lease = macro_uuid::generate_uuid_v7();
    assert!(repo.acquire_refresh(&grant, lease).await.unwrap());
    assert!(
        !repo
            .acquire_refresh(&grant, macro_uuid::generate_uuid_v7())
            .await
            .unwrap()
    );

    let second = pending(owner);
    repo.begin_link(&second).await.unwrap();
    let second = repo.claim_link(second.id).await.unwrap();
    let second_id = macro_uuid::generate_uuid_v7();
    repo.complete_link(&second, &identity(), &envelope(2), second_id)
        .await
        .unwrap();
    // Closing the browser after consent cannot invalidate the working inbox.
    assert_eq!(repo.active_grant(link, 1, 1).await.unwrap().id, first_id);
    assert!(
        repo.finish_refresh(&grant, lease, &envelope(3), &identity().scopes)
            .await
            .unwrap()
    );
    let first_metadata = repo.completed_grant(first.id, owner).await.unwrap();
    let second_metadata = repo.completed_grant(second.id, owner).await.unwrap();
    assert_eq!(
        (first_metadata.grant_id, first_metadata.generation),
        (first_id, 1)
    );
    assert_eq!(
        (second_metadata.grant_id, second_metadata.generation),
        (second_id, 2)
    );
    assert!(
        repo.completed_grant(second.id, Uuid::new_v4())
            .await
            .is_err()
    );
    let refreshed = repo.active_grant(link, 1, 1).await.unwrap();
    let stale_lease = macro_uuid::generate_uuid_v7();
    assert!(repo.acquire_refresh(&refreshed, stale_lease).await.unwrap());
    // The email initializer adopts the grant only with an authorized link commit.
    sqlx::query!(
        "UPDATE email_links SET grant_id=$2,grant_generation=2,sync_generation=2 WHERE id=$1",
        link,
        second_id
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.active_grant(link, 1, 1).await.is_err());
    assert!(
        !repo
            .finish_refresh(&refreshed, stale_lease, &envelope(4), &[])
            .await
            .unwrap()
    );
    repo.release_refresh(&refreshed, stale_lease, true)
        .await
        .unwrap();
    assert!(
        !repo
            .acquire_refresh(&refreshed, Uuid::new_v4())
            .await
            .unwrap()
    );
    let adopted = repo.active_grant(link, 2, 2).await.unwrap();
    assert_eq!(adopted.id, second_id);
    assert_eq!(
        adopted.envelope.refresh_token_ciphertext,
        envelope(2).refresh_token_ciphertext
    );
    assert_eq!(adopted.revision, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_cannot_replace_a_mailbox_identity_with_same_email(db: PgPool) {
    let repo = PgMicrosoftGrants::new(db.clone());
    let owner = owner(&db).await;
    let first = pending(owner);
    repo.begin_link(&first).await.unwrap();
    let first = repo.claim_link(first.id).await.unwrap();
    repo.complete_link(
        &first,
        &identity(),
        &envelope(1),
        macro_uuid::generate_uuid_v7(),
    )
    .await
    .unwrap();
    let second = pending(owner);
    repo.begin_link(&second).await.unwrap();
    let second = repo.claim_link(second.id).await.unwrap();
    let mut replacement = identity();
    replacement.mailbox_id = "different-mailbox".into();
    assert!(matches!(
        repo.complete_link(
            &second,
            &replacement,
            &envelope(2),
            macro_uuid::generate_uuid_v7()
        )
        .await,
        Err(MicrosoftAuthError::OwnershipConflict)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn expired_unadopted_grants_are_collected_without_deleting_custodian_credentials(db: PgPool) {
    let repo = PgMicrosoftGrants::new(db.clone());
    let owner = owner(&db).await;
    let link = Uuid::new_v4();
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider) VALUES ($1,'macro|outlook-test@example.com',$2,'outlook-test@example.com','OUTLOOK')",link,owner.to_string()).execute(&db).await.unwrap();
    let mut grants = Vec::new();
    for _ in 0..3 {
        let attempt = pending(owner);
        repo.begin_link(&attempt).await.unwrap();
        let attempt = repo.claim_link(attempt.id).await.unwrap();
        let id = Uuid::new_v4();
        repo.complete_link(&attempt, &identity(), &envelope(1), id)
            .await
            .unwrap();
        grants.push(id);
        if grants.len() < 3 {
            repo.abandon_link(attempt.id).await.unwrap();
        }
    }
    sqlx::query!("INSERT INTO email_mailbox_custodians(link_id,actor_id,fusionauth_user_id,grant_id,grant_generation,granted_scopes) VALUES($1,'macro|outlook-test@example.com',$2,$3,2,'{}')",link,owner.to_string(),grants[1]).execute(&db).await.unwrap();
    sqlx::query!("UPDATE microsoft_oauth_grant_versions SET created_at=now()-interval '2 days'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        crate::domain::microsoft::collect_expired_grants(&repo)
            .await
            .unwrap(),
        1
    );
    let retained = sqlx::query_scalar!(
        "SELECT grant_id FROM microsoft_oauth_grant_versions ORDER BY generation"
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(retained, vec![grants[1], grants[2]]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_owner_grants_expire_without_another_sign_in_and_teardown_grants_survive(
    db: PgPool,
) {
    let repo = PgMicrosoftGrants::new(db.clone());
    let owner = owner(&db).await;
    let mut grants = Vec::new();
    for _ in 0..4 {
        let attempt = pending(owner);
        repo.begin_link(&attempt).await.unwrap();
        let attempt = repo.claim_link(attempt.id).await.unwrap();
        let grant = macro_uuid::generate_uuid_v7();
        repo.complete_link(&attempt, &identity(), &envelope(1), grant)
            .await
            .unwrap();
        repo.abandon_link(attempt.id).await.unwrap();
        grants.push(grant);
    }
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider,grant_id,grant_generation) VALUES($1,'macro|outlook-test@example.com',$2,'outlook-test@example.com','OUTLOOK',$3,2)",link,owner.to_string(),grants[1]).execute(&db).await.unwrap();
    sqlx::query!("UPDATE email_links SET grant_id=$2,grant_generation=3,is_sync_active=false,disconnect_requested_at=now() WHERE id=$1",link,grants[2]).execute(&db).await.unwrap();
    sqlx::query!("INSERT INTO email_mailbox_custodians(link_id,actor_id,fusionauth_user_id,grant_id,grant_generation,granted_scopes) VALUES($1,'macro|outlook-test@example.com',$2,$3,4,'{}')",link,owner.to_string(),grants[3]).execute(&db).await.unwrap();
    sqlx::query!("DELETE FROM macro_user WHERE id=$1", owner)
        .execute(&db)
        .await
        .unwrap();
    sqlx::query!("UPDATE microsoft_oauth_grant_versions SET created_at=now()-interval '2 days'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        crate::domain::microsoft::collect_expired_grants(&repo)
            .await
            .unwrap(),
        2
    );
    let retained = sqlx::query_scalar!(
        "SELECT grant_id FROM microsoft_oauth_grant_versions ORDER BY generation"
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(retained, vec![grants[2], grants[3]]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grant_expiry_cannot_race_an_in_progress_mailbox_adoption(db: PgPool) {
    let repo = PgMicrosoftGrants::new(db.clone());
    let owner = owner(&db).await;
    let attempt = pending(owner);
    repo.begin_link(&attempt).await.unwrap();
    let attempt = repo.claim_link(attempt.id).await.unwrap();
    let grant = macro_uuid::generate_uuid_v7();
    repo.complete_link(&attempt, &identity(), &envelope(1), grant)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE in_progress_user_link SET created_at=now()-interval '2 days' WHERE id=$1",
        attempt.id
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!("UPDATE microsoft_oauth_grant_versions SET created_at=now()-interval '2 days' WHERE grant_id=$1",grant).execute(&db).await.unwrap();
    let mut adoption = db.begin().await.unwrap();
    sqlx::query!("DELETE FROM in_progress_user_link WHERE id=$1", attempt.id)
        .execute(&mut *adoption)
        .await
        .unwrap();
    assert_eq!(
        crate::domain::microsoft::collect_expired_grants(&repo)
            .await
            .unwrap(),
        0
    );
    sqlx::query!("INSERT INTO email_links(id,macro_id,fusionauth_user_id,email_address,provider,grant_id,grant_generation) VALUES($1,'macro|outlook-test@example.com',$2,'outlook-test@example.com','OUTLOOK',$3,1)",macro_uuid::generate_uuid_v7(),owner.to_string(),grant).execute(&mut *adoption).await.unwrap();
    adoption.commit().await.unwrap();
    assert_eq!(
        crate::domain::microsoft::collect_expired_grants(&repo)
            .await
            .unwrap(),
        0
    );
}
