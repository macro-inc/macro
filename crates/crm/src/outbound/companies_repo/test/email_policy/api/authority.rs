use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sync_and_billing_changes_preserve_legacy_and_modern_tokens(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, _) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    for kind in ["legacy", "policy"] {
        let before = request(&app, "owner", "/policy", None).await.1;
        assert_eq!(before["token"]["kind"], kind);
        sqlx::query!(
            "UPDATE email_links SET is_sync_active=NOT is_sync_active,updated_at=now() WHERE id=$1",
            link
        )
        .execute(&pool)
        .await?;
        sqlx::query!("INSERT INTO email_gmail_histories(link_id,history_id) VALUES($1,'100') ON CONFLICT(link_id) DO UPDATE SET history_id='101',updated_at=now()",link).execute(&pool).await?;
        sqlx::query!("UPDATE team_user SET plan=CASE WHEN plan='premium' THEN 'max'::seat_plan ELSE 'premium'::seat_plan END WHERE team_id=$1 AND user_id=$2",team,OWNER).execute(&pool).await?;
        let after = request(&app, "owner", "/policy", None).await.1;
        assert_eq!(
            after["token"], before["token"],
            "sync and plan fields do not decide sharing authority"
        );
        let command = json!({"if_policy":before["token"],"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
        let (status, outcome) = request(&app, "agent", "/policy", Some(command)).await;
        assert_eq!(status, StatusCode::OK, "{outcome}");
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pending_reauth_refuses_a_grant_but_a_cleared_same_grant_preserves_intent(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    for kind in ["legacy", "policy"] {
        let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
        assert_eq!(token["kind"], kind);
        sqlx::query!("UPDATE email_links SET needs_reauth=true,last_sync_error_at=now(),updated_at=now() WHERE id=$1",link).execute(&pool).await?;
        let command =
            json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
        assert_eq!(
            request(&app, "agent", "/policy", Some(command.clone()))
                .await
                .0,
            StatusCode::CONFLICT
        );
        let current = request(&app, "owner", "/policy", None).await.1["token"].clone();
        let while_pending = json!({"if_policy":current,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
        assert_eq!(
            request(&app, "agent", "/policy", Some(while_pending))
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        sqlx::query!("UPDATE email_links SET needs_reauth=false,last_sync_error_at=NULL,updated_at=now() WHERE id=$1",link).execute(&pool).await?;
        let (status, outcome) = request(&app, "agent", "/policy", Some(command)).await;
        assert_eq!(
            status,
            StatusCode::OK,
            "a cleared reauth on the same link and grant is accepted: {outcome}"
        );
        let withdraw = json!({"if_policy":outcome["token"],"request_id":Uuid::now_v7(),"change":{"action":"withdraw"}});
        assert_eq!(
            request(&app, "owner", "/policy", Some(withdraw)).await.0,
            StatusCode::OK
        );
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revoked_enabled_consent_and_changed_grants_or_roles_conflict(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, _) = setup(&pool).await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let initial =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    let (status, enabled) = request(&app, "agent", "/policy", Some(initial)).await;
    assert_eq!(status, StatusCode::OK, "{enabled}");
    sqlx::query!("UPDATE email_links SET needs_reauth=true WHERE id=$1", link)
        .execute(&pool)
        .await?;
    sqlx::query!(
        "UPDATE email_links SET needs_reauth=false WHERE id=$1",
        link
    )
    .execute(&pool)
    .await?;
    let command = json!({"if_policy":enabled["token"],"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::CONFLICT,
        "actual withdrawal changes the policy version even after reauth clears"
    );
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    sqlx::query!(
        "UPDATE email_links SET grant_id=$2,grant_generation=grant_generation+1 WHERE id=$1",
        link,
        Uuid::now_v7()
    )
    .execute(&pool)
    .await?;
    let command =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::CONFLICT
    );
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    sqlx::query!(
        "UPDATE team_user SET team_role='admin' WHERE team_id=$1 AND user_id=$2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    let command =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::CONFLICT
    );
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    sqlx::query!(
        "UPDATE team_user SET crm_access=false WHERE team_id=$1 AND user_id=$2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    let command =
        json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::CONFLICT
    );
    let current = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let command =
        json!({"if_policy":current,"request_id":Uuid::now_v7(),"change":{"action":"enable_all"}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command)).await.0,
        StatusCode::OK,
        "CRM viewing denial does not prevent own sharing controls"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn revision_history_is_owner_only_and_remains_readable_without_authoring_or_crm_viewing(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _link, repo) = setup(&pool).await?;
    let rollout = Arc::new(AtomicBool::new(true));
    let app = app(&pool, rollout.clone());
    for address in ["first@example.com", "second@example.org"] {
        let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
        let command = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":{"schema_version":1,"include":[{"kind":"address","address":address}]}}});
        let (status, outcome) = request(&app, "agent", "/policy", Some(command)).await;
        assert_eq!(status, StatusCode::OK, "{outcome}");
    }
    rollout.store(false, Ordering::SeqCst);
    sqlx::query!(
        "UPDATE team_user SET crm_access=false WHERE team_id=$1 AND user_id=$2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    let before = metadata(&pool, team).await?;
    let (status, history) = request(&app, "owner", "/history", None).await;
    assert_eq!(status, StatusCode::OK, "{history}");
    assert_eq!(history["events"].as_array().expect("events").len(), 2);
    for (revision, address) in [(1, "first@example.com"), (2, "second@example.org")] {
        let (status, definition) =
            request(&app, "owner", &format!("/revisions/{revision}"), None).await;
        assert_eq!(status, StatusCode::OK, "{definition}");
        assert_eq!(definition["rules"]["include"][0]["address"], address);
        assert!(
            repo.email_rule_revision(Uuid::now_v7(), OWNER, revision)
                .await?
                .is_none()
        );
        assert!(
            repo.email_rule_revision(team, "macro|other@example.com", revision)
                .await?
                .is_none()
        );
    }
    assert_eq!(metadata(&pool, team).await?, before);
    Ok(())
}
