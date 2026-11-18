use super::*;
use crate::domain::model::{CrmError, MailboxDomainConflict};
use crate::inbound::axum_router::blocked_domains;

const GUARD_OWNER: &str = "macro|owner@mail.example.com";
// Reserved example domains are not personal providers; build a synthetic fixture.
const PERSONAL_DOMAIN: &str = "gmail.com";

fn member_email() -> String {
    format!("member@{PERSONAL_DOMAIN}")
}

fn member_id() -> String {
    format!("macro|{}", member_email())
}

#[derive(Clone)]
struct GuardCredential;
impl JwtValidator for GuardCredential {
    fn validate_credential(
        &self,
        token: &str,
    ) -> Result<ValidatedCredential, rootcause::Report<MacroAuthorizationError>> {
        let mut credential = FixtureCredential.validate_credential(token)?;
        credential.identity.user_id = if token == "owner" {
            GUARD_OWNER.into()
        } else {
            member_id()
        };
        Ok(credential)
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mailbox_domain_guard_covers_privacy_sdk_and_existing_entries(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, GUARD_OWNER).await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        GUARD_OWNER
    )
    .execute(&pool)
    .await?;
    insert_email_link(&pool, GUARD_OWNER, "owner@mail.example.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let member_user = member_id();
    let member_email = member_email();
    let member_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        member_id,
        member_user
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        member_user,
        member_id
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO team_user (team_id, user_id, team_role, crm_access) VALUES ($1, $2, 'member', false)", team, member_user)
        .execute(&pool).await?;
    let member_link = insert_email_link(&pool, &member_user, &member_email).await?;
    let state = CrmRouterState {
        service: Arc::new(CrmServiceImpl::new(
            repo.clone(),
            NoOpCompanyMetadataResolver,
        )),
        stage_service: Arc::new(()),
        entity_access_service: Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
            pool.clone(),
        ))),
        authorization_state: MacroAuthorizationState::new(Arc::new(
            MacroAuthorizationServiceImpl::new(
                GuardCredential,
                InternalAuthConfig {
                    api_key: "fixture-only".into(),
                    default_user_id: None,
                },
                NoBotAuthorizer,
                NoUserApiKeyAuthorizer,
            ),
        )),
    };
    let app = Router::new()
        .route(
            "/crm/email-privacy",
            get(email_privacy::get_handler::<_, (), _, _>)
                .put(email_privacy::update_handler::<_, (), _, _>),
        )
        .route(
            "/crm/blocked-domains/{domain}",
            axum::routing::put(blocked_domains::block_handler::<_, (), _, _>),
        )
        .with_state(state);

    // Settings remain readable while a mailbox sync holds its lifecycle row.
    let mut mailbox_write = pool.begin().await?;
    sqlx::query!(
        "SELECT id FROM email_links WHERE id = $1 FOR UPDATE",
        member_link
    )
    .fetch_one(&mut *mailbox_write)
    .await?;
    let settings = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        request(&app, "owner", None),
    )
    .await?;
    assert_eq!(settings.0, StatusCode::OK);
    mailbox_write.rollback().await?;

    // A team block protects every member, even without viewing permission or consent.
    for (actor, scope, domain, reason) in [
        (
            "owner",
            "team",
            "MAIL.EXAMPLE.COM",
            MailboxDomainConflict::Company,
        ),
        (
            "owner",
            "team",
            "example.com",
            MailboxDomainConflict::Company,
        ),
        (
            "owner",
            "personal",
            "mail.example.com",
            MailboxDomainConflict::Company,
        ),
        (
            "owner",
            "personal",
            "example.com",
            MailboxDomainConflict::Company,
        ),
        (
            "member",
            "team",
            "example.com",
            MailboxDomainConflict::Company,
        ),
        (
            "owner",
            "team",
            "gmail.com",
            MailboxDomainConflict::PersonalProvider,
        ),
        (
            "member",
            "personal",
            "gmail.com",
            MailboxDomainConflict::PersonalProvider,
        ),
    ] {
        let (status, body) = request(
            &app,
            actor,
            Some(json!({"action":"add_domain", "scope":scope, "domain":domain})),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{scope} {domain}");
        assert_eq!(body, json!({"message": reason.to_string()}));
    }
    for (domain, reason) in [
        ("mail.example.com", MailboxDomainConflict::Company),
        ("example.com", MailboxDomainConflict::Company),
        ("gmail.com", MailboxDomainConflict::PersonalProvider),
    ] {
        assert_eq!(
            request_path(
                &app,
                "owner",
                &format!("/crm/blocked-domains/{domain}"),
                Some(json!({}))
            )
            .await,
            (
                StatusCode::BAD_REQUEST,
                json!({"message": reason.to_string()})
            )
        );
    }
    assert!(repo.list_blocked_domains(&team).await?.is_empty());
    assert!(
        repo.email_privacy(team, GUARD_OWNER)
            .await?
            .personal_domains
            .is_empty()
    );

    for scope in ["team", "personal"] {
        for domain in ["sub.mail.example.com", "ample.com", "unrelated.example.org"] {
            assert_eq!(
                request(
                    &app,
                    "owner",
                    Some(json!({"action":"add_domain", "scope":scope, "domain":domain}))
                )
                .await
                .0,
                StatusCode::OK
            );
        }
    }
    assert_eq!(
        request_path(
            &app,
            "owner",
            "/crm/blocked-domains/other.example.org",
            Some(json!({}))
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    // The caller may personally exclude a domain used only by a teammate.
    assert_eq!(
        request(
            &app,
            "owner",
            Some(json!({"action":"add_domain", "scope":"personal", "domain":"gmail.com"}))
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            "member",
            Some(json!({"action":"add_domain", "scope":"personal", "domain":"example.com"}))
        )
        .await
        .0,
        StatusCode::OK
    );

    // Company exclusions use the same veto, including the archive operation.
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    for result in [
        repo.set_email_sync(&team, &company, false).await,
        repo.set_company_hidden(&team, &company, true).await,
    ] {
        assert!(matches!(
            result,
            Err(CrmError::BlocksConnectedMailbox(
                MailboxDomainConflict::Company
            ))
        ));
    }
    assert_eq!(fetch_email_sync(&pool, company).await?, Some(true));
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(false));

    // Simulate entries from an older writer. Reading warns without repairing them.
    sqlx::query!("INSERT INTO crm_blocked_domains (team_id, domain) VALUES ($1, 'example.com'), ($1, 'gmail.com')", team).execute(&pool).await?;
    sqlx::query!("INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain) VALUES ($1, $2, 'example.com')", team, GUARD_OWNER).execute(&pool).await?;
    let (status, settings) = request(&app, "owner", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        settings["team_domain_warnings"],
        json!({"example.com":"company", "gmail.com":"personal_provider"})
    );
    assert_eq!(
        settings["personal_domain_warnings"],
        json!({"example.com":"company"})
    );
    assert!(
        settings["team_domains"]
            .as_array()
            .unwrap()
            .contains(&json!("example.com"))
    );
    for scope in ["team", "personal"] {
        assert_eq!(
            request(
                &app,
                "owner",
                Some(json!({"action":"remove_domain", "scope":scope, "domain":"example.com"}))
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        request(&app, "owner", None).await.1["personal_domain_warnings"],
        json!({})
    );

    // Secondary and unavailable connections, and nonmembers, are not affected mailboxes.
    let secondary_email = format!("secondary@{PERSONAL_DOMAIN}");
    sqlx::query!(
        "UPDATE email_links SET email_address = $2 WHERE id = $1",
        member_link,
        secondary_email
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.email_privacy(team, GUARD_OWNER)
            .await?
            .team_domain_warnings
            .is_empty()
    );
    sqlx::query!(
        "UPDATE email_links SET email_address = $2, needs_reauth = true WHERE id = $1",
        member_link,
        member_email
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.email_privacy(team, GUARD_OWNER)
            .await?
            .team_domain_warnings
            .is_empty()
    );
    sqlx::query!("UPDATE email_links SET needs_reauth = false, disconnect_requested_at = now() WHERE id = $1", member_link).execute(&pool).await?;
    assert!(
        repo.email_privacy(team, GUARD_OWNER)
            .await?
            .team_domain_warnings
            .is_empty()
    );
    sqlx::query!(
        "UPDATE email_links SET disconnect_requested_at = NULL, deleting_at = now() WHERE id = $1",
        member_link
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.email_privacy(team, GUARD_OWNER)
            .await?
            .team_domain_warnings
            .is_empty()
    );
    sqlx::query!(
        "UPDATE email_links SET deleting_at = NULL WHERE id = $1",
        member_link
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        member_user
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.email_privacy(team, GUARD_OWNER)
            .await?
            .team_domain_warnings
            .is_empty()
    );
    Ok(())
}
