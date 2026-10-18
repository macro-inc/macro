//! OAuth handoff must never exchange a code without the initiating browser proof.
use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_requires_browser_transaction_before_any_provider_effect(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, Some("fresh-instagram")).await;
    let (status, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":"instagram"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = request(
        &f.app,
        "POST",
        "/authorize/complete",
        Some("owner"),
        json!({"state":begin["state"],"code":"fixture-code"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        f.repo
            .account(
                Provider::Instagram,
                &"fresh-instagram".to_owned().try_into().unwrap()
            )
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(f.remote.subscriptions.load(Ordering::SeqCst), 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_handoff_wrong_user_expiry_and_replay_have_no_effect(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, Some("fresh-instagram")).await;
    let (_, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":"instagram"}),
    )
    .await;
    let valid = json!({"state":begin["state"], "browser_transaction":begin["browser_transaction"], "code":"fixture-code"});
    // A copied Meta URL has state but never the independent proof.
    let mut wrong = valid.clone();
    wrong["browser_transaction"] = json!("f".repeat(64));
    assert_eq!(
        request(&f.app, "POST", "/authorize/complete", Some("owner"), wrong)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    // Give another controlled Macro user admin rights: the OAuth owner check must
    // still reject them, independently of the ordinary endpoint admin check.
    sqlx::query!(
        "UPDATE team_user SET team_role='admin' WHERE team_id=$1 AND user_id<>$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(
            &f.app,
            "POST",
            "/authorize/complete",
            Some("outsider"),
            valid.clone()
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &f.app,
            "GET",
            &format!(
                "/oauth/instagram/callback?state={}&code=fixture-code",
                begin["state"].as_str().unwrap()
            ),
            None,
            json!({})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 0);
    assert_eq!(f.repo.connections(f.c.team_id).await.unwrap().len(), 1);
    assert_eq!(f.remote.subscriptions.load(Ordering::SeqCst), 0);
    assert_eq!(f.remote.history_requests.load(Ordering::SeqCst), 0);
    let (status, connected) = request(
        &f.app,
        "POST",
        "/authorize/complete",
        Some("owner"),
        valid.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{connected}");
    assert_eq!(connected["team_id"], json!(f.c.team_id));
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 1);
    assert_eq!(
        request(&f.app, "POST", "/authorize/complete", Some("owner"), valid)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 1);
    let (_, expired) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":"instagram"}),
    )
    .await;
    sqlx::query!(
        "UPDATE meta_messaging_oauth SET expires_at=now()-interval '1 second' WHERE team_id=$1",
        f.c.team_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(request(&f.app, "POST", "/authorize/complete", Some("owner"), json!({"state":expired["state"],"browser_transaction":expired["browser_transaction"],"code":"expired"})).await.0, StatusCode::FORBIDDEN);
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 1);
    assert_eq!(f.repo.connections(f.c.team_id).await.unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_departed_member_and_changed_team_are_rejected(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, Some("fresh-instagram")).await;
    let (_, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":"instagram"}),
    )
    .await;
    let body = json!({"state":begin["state"],"browser_transaction":begin["browser_transaction"],"code":"fixture-code"});
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id=$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !request(
            &f.app,
            "POST",
            "/authorize/complete",
            Some("owner"),
            body.clone()
        )
        .await
        .0
        .is_success()
    );
    let other_team = Uuid::now_v7();
    let other_owner = user(&pool, "other-team-owner", None).await;
    sqlx::query!(
        "INSERT INTO team (id,name,owner_id) VALUES ($1,'Changed team',$2)",
        other_team,
        other_owner
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id,user_id,team_role) VALUES ($1,$2,'owner')",
        other_team,
        other_owner
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id,user_id,team_role) VALUES ($1,$2,'admin')",
        other_team,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(&f.app, "POST", "/authorize/complete", Some("owner"), body)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 0);
    assert_eq!(f.repo.connections(other_team).await.unwrap().len(), 0);
}

async fn reconnect(pool: PgPool, account: Option<&str>) {
    let f = fixture(&pool, Provider::Instagram, account).await;
    let before_credential = f.repo.credential(f.c.id).await.unwrap();
    let at = connected_time(&f.repo, f.c.id).await;
    let inbound = json!({"object":"instagram","entry":[{"id":f.c.account_id,"messaging":[{"sender":{"id":"customer"},"recipient":{"id":f.c.account_id},"timestamp":at.timestamp_millis(),"message":{"mid":"before-reconnect","text":"Existing conversation"}}]}]});
    assert_eq!(
        signed(&f.app, Provider::Instagram, inbound, true).await,
        StatusCode::OK
    );
    drain(&f.service).await;
    let original_message = f
        .repo
        .message_target(f.c.id, "before-reconnect")
        .await
        .unwrap();
    let (_, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("owner"),
        json!({"provider":"instagram","reconnect_id":f.c.id}),
    )
    .await;
    let (status, result) = request(&f.app, "POST", "/authorize/complete", Some("owner"), json!({"state":begin["state"],"browser_transaction":begin["browser_transaction"],"code":"fixture-code"})).await;
    assert_eq!(
        status,
        if account.is_none() {
            StatusCode::OK
        } else {
            StatusCode::CONFLICT
        },
        "{result}"
    );
    if account.is_none() {
        assert_eq!(result["id"], json!(f.c.id));
    }
    let saved = f.repo.connection(f.c.id).await.unwrap().unwrap();
    assert_eq!(saved.account_id, f.c.account_id);
    assert_eq!(saved.team_id, f.c.team_id);
    assert_eq!(
        f.repo
            .message_target(f.c.id, "before-reconnect")
            .await
            .unwrap(),
        original_message
    );
    if account.is_some() {
        assert_eq!(f.repo.credential(f.c.id).await.unwrap(), before_credential);
    }
    assert_eq!(f.repo.connections(f.c.team_id).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_reconnect_preserves_identity(pool: PgPool) {
    reconnect(pool, None).await;
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_reconnect_rejects_another_account(pool: PgPool) {
    reconnect(pool, Some("wrong-instagram")).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn instagram_legacy_state_without_browser_proof_cannot_exchange(pool: PgPool) {
    use sha2::Digest;
    let f = fixture(&pool, Provider::Instagram, Some("fresh-instagram")).await;
    let state = "a".repeat(64);
    f.repo
        .begin_authorization(&OAuthAttempt {
            state_sha256: Sha256::digest(state.as_bytes()).to_vec(),
            team_id: f.c.team_id,
            user_id: f.c.user_id.clone(),
            provider: Provider::Instagram,
            reconnect_id: None,
            expires_at: Utc::now() + chrono::Duration::minutes(10),
        })
        .await
        .unwrap();
    assert_eq!(
        request(
            &f.app,
            "POST",
            "/authorize/complete",
            Some("owner"),
            json!({"state":state,"code":"legacy-code"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 0);
    assert_eq!(f.repo.connections(f.c.team_id).await.unwrap().len(), 1);
}
