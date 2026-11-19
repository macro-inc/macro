use super::*;

fn link(display_name: &str, idp_user_id: &str) -> Link {
    Link {
        display_name: display_name.to_string(),
        identity_provider_id: "idp".to_string(),
        identity_provider_name: "google_gmail".to_string(),
        identity_provider_type: "Google".to_string(),
        identity_provider_user_id: idp_user_id.to_string(),
        insert_instant: 0,
        last_login_instant: 0,
        tenant_id: "tenant".to_string(),
        token: "token".to_string(),
        user_id: "user".to_string(),
    }
}

#[test]
fn find_idp_link_selects_secondary_inbox_not_owner_primary() {
    let links = vec![
        link("gab@macro.com", "google-primary"),
        link("gabtest1@macro.com", "google-secondary"),
    ];

    let found =
        find_idp_link(links, "gabtest1@macro.com").expect("secondary inbox link should be found");

    assert_eq!(found.display_name, "gabtest1@macro.com");
    assert_eq!(found.identity_provider_user_id, "google-secondary");
}

#[test]
fn find_idp_link_ignores_email_capitalization() {
    let links = vec![
        link("another@example.com", "google-primary"),
        link("Inbox@Example.com", "google-secondary"),
    ];

    let found = find_idp_link(links, "inbox@example.com").expect("the same email should match");

    assert_eq!(found.identity_provider_user_id, "google-secondary");
}

#[test]
fn find_idp_link_returns_none_when_absent() {
    let links = vec![link("gab@macro.com", "google-primary")];

    assert!(find_idp_link(links, "missing@macro.com").is_none());
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_link_is_still_needed_by_the_addresss_account_or_the_requesters_inbox(
    pool: sqlx::PgPool,
) {
    let requester = Uuid::from_u128(0xa1);
    let account = Uuid::from_u128(0xa2);
    for (id, email) in [
        (requester, "requester@example.com"),
        (account, "own@example.com"),
    ] {
        sqlx::query!(
            "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$2,$3)",
            id,
            email,
            format!("cus_{id}")
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        r#"INSERT INTO "User" (id,email,macro_user_id) VALUES ('macro|own@example.com','own@example.com',$1)"#,
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider) VALUES ($1,'macro|requester@example.com',$2,'Held@example.com','GMAIL')",
        Uuid::from_u128(0xb1),
        requester.to_string()
    )
    .execute(&pool)
    .await
    .unwrap();
    let attempts = PgIdentityLinkAttempts(pool);
    let attempt = |email: &str| DueAttempt {
        id: Uuid::from_u128(0xc1),
        fusionauth_user_id: requester,
        email: email.into(),
    };

    assert!(
        attempts
            .link_backs_something(&attempt("Own@Example.com"))
            .await
            .unwrap(),
        "the address's own account signs in with it, whatever the case"
    );
    assert!(
        attempts
            .link_backs_something(&attempt("held@example.com"))
            .await
            .unwrap(),
        "the requester holds the inbox"
    );
    assert!(
        !attempts
            .link_backs_something(&attempt("refused@example.com"))
            .await
            .unwrap(),
        "nothing else needs it"
    );
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn a_retry_of_the_same_address_defers_the_release_until_it_ends(pool: sqlx::PgPool) {
    use macro_db_client::in_progress_user_link as attempts_db;
    let requester = Uuid::from_u128(0xa1);
    let other = Uuid::from_u128(0xa3);
    for (id, email) in [
        (requester, "requester@example.com"),
        (other, "other@example.com"),
    ] {
        sqlx::query!(
            "INSERT INTO macro_user (id,username,email,stripe_customer_id) VALUES ($1,$2,$2,$3)",
            id,
            email,
            format!("cus_{id}")
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let scopes = vec!["gmail".to_string()];
    let attempt_for = async |user: Uuid, created_link: bool| {
        let id = attempts_db::create_in_progress_google_link(&pool, &user.to_string(), &scopes)
            .await
            .unwrap();
        attempts_db::set_linked_google_grant(
            &pool,
            &id,
            "Retried@example.com",
            &scopes,
            created_link,
        )
        .await
        .unwrap();
        id
    };
    // The refused attempt created the link; the retry's callback found it.
    let refused = attempt_for(requester, true).await;
    attempts_db::discard_owned_in_progress_user_link(&pool, refused, &requester.to_string())
        .await
        .unwrap();
    let retry = attempt_for(requester, false).await;
    attempt_for(other, false).await;
    let attempts = PgIdentityLinkAttempts(pool.clone());
    let due = DueAttempt {
        id: refused,
        fusionauth_user_id: requester,
        email: "retried@example.com".into(),
    };

    assert!(
        attempts.retry_under_way(&due).await.unwrap(),
        "the retry's /email/init may still connect with the link"
    );

    sqlx::query!(
        "UPDATE in_progress_user_link SET created_at = now() - interval '25 hours' WHERE id = $1",
        retry
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !attempts.retry_under_way(&due).await.unwrap(),
        "a lapsed retry, or another account's attempt, defers nothing"
    );

    let refused_retry = attempt_for(requester, false).await;
    attempts_db::discard_owned_in_progress_user_link(&pool, refused_retry, &requester.to_string())
        .await
        .unwrap();
    let refused_flagged_retry = attempt_for(requester, true).await;
    attempts_db::discard_owned_in_progress_user_link(
        &pool,
        refused_flagged_retry,
        &requester.to_string(),
    )
    .await
    .unwrap();
    assert!(
        !attempts.retry_under_way(&due).await.unwrap(),
        "a refused retry defers nothing"
    );
}
