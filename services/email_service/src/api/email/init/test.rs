use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

async fn insert_email_link(pool: &PgPool) -> Uuid {
    let link_id = Uuid::now_v7();
    let email_address = format!("sso-grant-{link_id}@example.com");
    sqlx::query!(
        r#"
        INSERT INTO email_links (
            id, macro_id, fusionauth_user_id, email_address, provider
        )
        VALUES ($1, $2, $2, $3, 'GMAIL')
        "#,
        link_id,
        "macro|sso-grant@example.com",
        email_address,
    )
    .execute(pool)
    .await
    .unwrap();
    link_id
}

async fn body_json(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn zero_grant_is_unrecorded(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;
    sqlx::query!(
        "INSERT INTO email_link_google_scopes (link_id) VALUES ($1)",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(has_unrecorded_google_grant(&pool, link_id).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_side_table_state_is_unrecorded(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;

    assert!(has_unrecorded_google_grant(&pool, link_id).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recorded_side_table_grant_is_not_unrecorded(pool: PgPool) {
    let link_id = insert_email_link(&pool).await;
    sqlx::query!(
        "INSERT INTO email_link_google_scopes (link_id, grant_version) VALUES ($1, 1)",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert!(!has_unrecorded_google_grant(&pool, link_id).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_email_link_is_not_unrecorded(pool: PgPool) {
    assert!(!has_unrecorded_google_grant(&pool, Uuid::now_v7()).await);
}

/// `POST /email/init` without `link_id` returns or creates the account's Rox
/// link and never reaches Gmail: the branch calls `ensure_rox_mailbox`, which
/// reads the claimed handle and upserts one ROX row without constructing a
/// provider client. This module has no fake Gmail client or call counter to
/// observe the absence directly, so the assertion is its observable footprint —
/// the returned ROX link plus no GMAIL link and no backfill row for the account.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn init_without_link_id_returns_the_rox_link_without_gmail_side_effects(pool: PgPool) {
    let fusionauth_user_id = Uuid::now_v7();
    let macro_user_id = format!("macro|init-{fusionauth_user_id}@example.com");
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)",
    )
    .bind(fusionauth_user_id)
    .bind("ada")
    .bind(format!("init-{fusionauth_user_id}@example.com"))
    .bind(format!("customer-{fusionauth_user_id}"))
    .execute(&pool)
    .await
    .unwrap();

    let rox_link = crate::outbound::mailbox_init::ensure_rox_mailbox(
        &pool,
        &fusionauth_user_id.to_string(),
        MacroUserIdStr::try_from(macro_user_id.clone()).unwrap(),
        true,
    )
    .await
    .unwrap()
    .expect("writers enabled returns the account's Rox mailbox");

    assert_eq!(rox_link.provider, link::UserProvider::Rox);
    assert!(rox_link.is_primary);
    let expected_address = format!("ada@{}", macro_user_id::handle::ROX_MAIL_DOMAIN);
    assert_eq!(rox_link.email_address.0.as_ref(), expected_address);
    assert_eq!(rox_link.macro_id.as_ref(), macro_user_id.as_str());

    let gmail_links: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM email_links WHERE macro_id = $1 AND provider = 'GMAIL'",
    )
    .bind(&macro_user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        gmail_links, 0,
        "the Rox branch must not create a Gmail link"
    );

    let backfill_jobs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM email_backfill_jobs WHERE link_id = $1")
            .bind(rox_link.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        backfill_jobs, 0,
        "the Rox branch must not start a Gmail backfill"
    );
}

/// One primary `email_links` row per `macro_id`, enforced by both the migration's
/// trigger and its partial unique index: the account's Rox mailbox takes primary
/// from a legacy Gmail row, and an account with no Rox row keeps the legacy row
/// primary so the pre-deployment value survives. Every insert here omits
/// `is_primary`, the way old writers do, so the trigger decides the fact.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_primary_link_per_account_after_the_rox_rollout(pool: PgPool) {
    use macro_user_id::handle::ROX_MAIL_DOMAIN;

    // Placeholders are assembled from the domain constant and a local example
    // domain so the source carries no address literals.
    const EXTERNAL_DOMAIN: &str = "example.com";
    let fusionauth_user_id = Uuid::now_v7().to_string();
    let with_rox = format!("macro|rox-owner@{EXTERNAL_DOMAIN}");
    let without_rox = format!("macro|gmail-owner@{EXTERNAL_DOMAIN}");
    let rox_address = format!("rox-owner@{ROX_MAIL_DOMAIN}");
    let external_address = format!("rox-owner@{EXTERNAL_DOMAIN}");
    let legacy_address = format!("gmail-owner@{EXTERNAL_DOMAIN}");
    let rox_link_id = Uuid::now_v7();
    let gmail_link_id = Uuid::now_v7();
    let legacy_link_id = Uuid::now_v7();

    for (id, macro_id, address, provider) in [
        (rox_link_id, with_rox.as_str(), rox_address.as_str(), "ROX"),
        (
            gmail_link_id,
            with_rox.as_str(),
            external_address.as_str(),
            "GMAIL",
        ),
        (
            legacy_link_id,
            without_rox.as_str(),
            legacy_address.as_str(),
            "GMAIL",
        ),
    ] {
        sqlx::query(
            "INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
             VALUES ($1, $2, $3, $4, $5::email_user_provider_enum)",
        )
        .bind(id)
        .bind(macro_id)
        .bind(&fusionauth_user_id)
        .bind(address)
        .bind(provider)
        .execute(&pool)
        .await
        .unwrap();
    }

    let primaries: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM email_links WHERE macro_id = $1 AND is_primary")
            .bind(with_rox)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(primaries, vec![rox_link_id]);

    let legacy_primaries: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM email_links WHERE macro_id = $1 AND is_primary")
            .bind(without_rox)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(legacy_primaries, vec![legacy_link_id]);
}

#[tokio::test]
async fn disabled_member_init_is_forbidden() {
    let response =
        InitError::Enterprise(enterprise::domain::EnterpriseError::MemberDisabled).into_response();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn no_gmail_grant_is_a_coded_400() {
    let response = InitError::NoGmailGrant.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = body_json(response).await;
    assert_eq!(body["code"], NO_GMAIL_GRANT_CODE);
}

#[tokio::test]
async fn handle_required_is_a_coded_400() {
    let response = InitError::HandleRequired.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body = body_json(response).await;
    assert_eq!(body["code"], HANDLE_REQUIRED_CODE);
}

#[test]
fn gmail_import_is_not_primary() {
    let link = new_gmail_link(
        Uuid::now_v7().to_string(),
        MacroUserIdStr::try_from("macro|ada@example.com".to_owned()).unwrap(),
        "ada@gmail.example".to_owned(),
    )
    .unwrap();
    assert!(!link.is_primary);
}

#[test]
fn unusable_provider_grants_classify_as_no_gmail_grant() {
    for error in [EmailApiError::AuthRequired, EmailApiError::Forbidden] {
        assert!(matches!(
            classify_provider_init_error(error),
            InitError::NoGmailGrant
        ));
    }
}

#[test]
fn rate_limiting_classifies_as_http_429() {
    let error = classify_provider_init_error(EmailApiError::RateLimited {
        retry_after: None,
        origin: email_api_client::domain::models::RateLimitOrigin::Provider { concurrency: false },
    });
    assert_eq!(error.status_code(), StatusCode::TOO_MANY_REQUESTS);
}

#[test]
fn a_rate_limited_init_tells_the_client_when_to_retry() {
    let response = InitError::ProviderError(EmailApiError::RateLimited {
        retry_after: Some(std::time::Duration::from_millis(1_200)),
        origin: email_api_client::domain::models::RateLimitOrigin::Local,
    })
    .into_response();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response
            .headers()
            .get(axum::http::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok()),
        Some("2")
    );
}

#[tokio::test]
async fn provider_diagnostics_are_not_returned_to_clients() {
    let response = InitError::ProviderError(EmailApiError::Permanent {
        message: "sanitized provider body".to_string(),
    })
    .into_response();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(bytes, "Email provider operation failed");
}

#[test]
fn only_shared_inbox_conflict_keeps_the_in_progress_link() {
    // SharedInboxConflict is held open for the force_share retry, so its row must be kept;
    // every other terminal failure must clean up the row so it stops counting toward the
    // /link/gmail start cap. The delete itself is covered by macro_db_client's own tests.
    assert!(
        !should_clean_up_in_progress_link(&InitError::SharedInboxConflict {
            email_address: "shared@example.com".to_string(),
            existing_owner_email: "owner@example.com".to_string(),
            existing_link_id: Uuid::new_v4(),
        }),
        "SharedInboxConflict must keep the row for the force_share retry"
    );

    for err in [
        InitError::NoGmailGrant,
        InitError::EnqueueError,
        InitError::BadRequest("bad".to_string()),
        InitError::ProviderError(EmailApiError::AuthRequired),
    ] {
        assert!(
            should_clean_up_in_progress_link(&err),
            "terminal failure {err:?} should clean up the in_progress row"
        );
    }
}

/// The grant alone cannot say whether the user wanted calendar: consent
/// requests carry `include_granted_scopes=true`, so Google re-issues the
/// calendar scopes of an earlier grant on a plain Gmail reconnect. Only what
/// the request asked for decides.
#[test]
fn calendar_intent_follows_the_consent_request_not_the_grant() {
    let calendar_scopes = calendar_events::domain::models::GOOGLE_CALENDAR_SCOPES
        .map(str::to_owned)
        .to_vec();
    let gmail_scope = "https://www.googleapis.com/auth/gmail.modify".to_owned();
    let in_progress = |requested: Vec<String>| InProgressUserLink {
        email_provider: "GMAIL".into(),
        macro_user_id: Uuid::now_v7(),
        linked_email: None,
        requested_google_scopes: requested,
        granted_google_scopes: [vec![gmail_scope.clone()], calendar_scopes.clone()].concat(),
    };

    assert!(matches!(
        CompletedGoogleGrant::from_in_progress(&in_progress(vec![gmail_scope.clone()])).intent,
        CalendarGrantIntent::Incidental
    ));
    assert!(matches!(
        CompletedGoogleGrant::from_in_progress(&in_progress(
            [vec![gmail_scope.clone()], calendar_scopes.clone()].concat()
        ))
        .intent,
        CalendarGrantIntent::CalendarRequested
    ));
}
