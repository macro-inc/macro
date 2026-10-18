//! Member connection and connector/admin management through the actual HTTP/domain paths.
use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn members_connect_and_list_but_only_connector_or_admin_manage(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, Some("member-business")).await;
    assert_eq!(
        request(&f.app, "GET", "/connections", Some("outsider"), json!({}))
            .await
            .0,
        StatusCode::OK
    );
    for (path, body) in [
        (format!("/connections/{}/disconnect", f.c.id), json!({})),
        (format!("/connections/{}/history", f.c.id), json!({})),
        (
            "/authorize".into(),
            json!({"provider":"instagram","reconnect_id":f.c.id}),
        ),
    ] {
        assert_eq!(
            request(&f.app, "POST", &path, Some("outsider"), body)
                .await
                .0,
            StatusCode::FORBIDDEN
        );
    }
    let (status, view) = request(
        &f.app,
        "GET",
        &format!("/connections/{}/history", f.c.id),
        Some("outsider"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(view["can_import"], false);
    let (status, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("outsider"),
        json!({"provider":"instagram"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status,connected)=request(&f.app,"POST","/authorize/complete",Some("outsider"),json!({"state":begin["state"],"browser_transaction":begin["browser_transaction"],"code":"fixture-code"})).await;
    assert_eq!(status, StatusCode::OK, "{connected}");
    assert_eq!(
        connected["user_id"],
        "macro|uninvited@native-messaging.test"
    );
    let id = connected["id"].as_str().unwrap();
    // A different current admin may manage, without receiving any channel grants.
    assert_eq!(
        request(
            &f.app,
            "POST",
            &format!("/connections/{id}/disconnect"),
            Some("owner"),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &f.app,
            "POST",
            "/authorize",
            Some("outsider"),
            json!({"provider":"instagram","reconnect_id":id})
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id<>$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        !request(&f.app, "GET", "/connections", Some("outsider"), json!({}))
            .await
            .0
            .is_success()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_completion_rechecks_manager_and_fresh_connect_cannot_take_over(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    sqlx::query!(
        "UPDATE team_user SET team_role='admin' WHERE team_id=$1 AND user_id<>$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let (_, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("outsider"),
        json!({"provider":"instagram","reconnect_id":f.c.id}),
    )
    .await;
    sqlx::query!(
        "UPDATE team_user SET team_role='member' WHERE team_id=$1 AND user_id<>$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let callback = json!({"state":begin["state"],"browser_transaction":begin["browser_transaction"],"code":"fixture-code"});
    assert_eq!(
        request(
            &f.app,
            "POST",
            "/authorize/complete",
            Some("outsider"),
            callback
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(f.remote.authorizations.load(Ordering::SeqCst), 0);
    let (_, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("outsider"),
        json!({"provider":"instagram"}),
    )
    .await;
    let callback = json!({"state":begin["state"],"browser_transaction":begin["browser_transaction"],"code":"fixture-code"});
    assert_eq!(
        request(
            &f.app,
            "POST",
            "/authorize/complete",
            Some("outsider"),
            callback
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.repo.connection(f.c.id).await.unwrap().unwrap().user_id,
        f.c.user_id
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn connector_demotion_keeps_ingestion_but_departure_blocks_immediately(pool: PgPool) {
    let f = fixture(&pool, Provider::Instagram, None).await;
    sqlx::query!(
        "UPDATE team_user SET team_role='member' WHERE team_id=$1 AND user_id=$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    f.service.maintain().await.unwrap();
    assert_eq!(
        f.repo.connection(f.c.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
    let at = connected_time(&f.repo, f.c.id).await;
    let envelope = |mid: &str| json!({"object":"instagram","entry":[{"id":f.c.account_id,"messaging":[{"sender":{"id":"customer"},"recipient":{"id":f.c.account_id},"timestamp":at.timestamp_millis(),"message":{"mid":mid,"text":"controlled fixture"}}]}]});
    signed(
        &f.app,
        Provider::Instagram,
        envelope("member-inbound"),
        true,
    )
    .await;
    drain(&f.service).await;
    let (channel, _) = f
        .repo
        .message_target(f.c.id, "member-inbound")
        .await
        .unwrap();
    let reply = json!({"idempotency_key":Uuid::now_v7(),"message":{"type":"text","text":"queued before leaving"}});
    assert_eq!(
        request(
            &f.app,
            "POST",
            &format!("/channels/{channel}/replies"),
            Some("owner"),
            reply
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id=$1 AND user_id=$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    // No maintenance tick between departure and either worker path.
    let work = f.repo.claim_send().await.unwrap().unwrap();
    assert!(f.service.messaging.process_send(&work).await.is_err());
    assert_eq!(f.remote.sends.load(Ordering::SeqCst), 0);
    signed(
        &f.app,
        Provider::Instagram,
        envelope("departed-inbound"),
        true,
    )
    .await;
    let receipt = f.repo.claim_receipt().await.unwrap().unwrap();
    assert!(
        f.service
            .process_receipt(
                &receipt,
                webhook::decode(receipt.provider, &receipt.payload).unwrap()
            )
            .await
            .is_err()
    );
    assert!(
        f.repo
            .message_target(f.c.id, "departed-inbound")
            .await
            .is_err()
    );
    let (_, accounts) = request(&f.app, "GET", "/connections", Some("outsider"), json!({})).await;
    assert_eq!(accounts[0]["health_error"], "connecting_member_access_lost");
    assert_eq!(
        f.repo.connection(f.c.id).await.unwrap().unwrap().status,
        ConnectionStatus::Connected
    );
}

struct PausedCipher {
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}
#[async_trait]
impl CredentialCipher for PausedCipher {
    async fn encrypt(&self, team: Uuid, id: Uuid, token: &AccessToken) -> PortResult<Vec<u8>> {
        self.entered.notify_one();
        self.release.notified().await;
        TestCipher.encrypt(team, id, token).await
    }
    async fn decrypt(&self, team: Uuid, id: Uuid, bytes: &[u8]) -> PortResult<AccessToken> {
        TestCipher.decrypt(team, id, bytes).await
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn former_connectors_delayed_reconnect_cannot_overwrite_a_new_admin_grant(pool: PgPool) {
    use entity_access::domain::models::{EntityType, MemberTeamRole};
    let f = fixture(&pool, Provider::Instagram, None).await;
    sqlx::query!("UPDATE team_user SET team_role=CASE WHEN user_id=$2 THEN 'member'::team_role ELSE 'admin'::team_role END WHERE team_id=$1",f.c.team_id,f.c.user_id).execute(&pool).await.unwrap();
    let native = Arc::new(fixture_native(&pool).await);
    let actor = MacroUserIdStr::try_from(f.c.user_id.clone()).unwrap();
    let access = native
        .access
        .generate_entity_access_receipt::<MemberTeamRole>(
            &actor.0,
            None,
            &f.c.team_id.to_string(),
            EntityType::Team,
        )
        .await
        .unwrap();
    let cipher = Arc::new(PausedCipher {
        entered: Default::default(),
        release: Default::default(),
    });
    let service = Arc::new(MetaService::new(
        f.repo.clone(),
        f.remote.clone(),
        cipher.clone(),
        native,
        f.service.configuration().clone(),
    ));
    let begin = service
        .begin_authorization(&access, Provider::Instagram, Some(f.c.id))
        .await
        .unwrap();
    let delayed = tokio::spawn(async move {
        service
            .complete_authorization(
                &access,
                CompleteAuthorization {
                    state: begin.state,
                    browser_transaction: begin.browser_transaction,
                    code: "fixture-code".into(),
                    business_account_id: None,
                    phone_number_id: None,
                    whatsapp_mode: None,
                },
            )
            .await
    });
    cipher.entered.notified().await;
    let (_, begin) = request(
        &f.app,
        "POST",
        "/authorize",
        Some("outsider"),
        json!({"provider":"instagram","reconnect_id":f.c.id}),
    )
    .await;
    let (status,_)=request(&f.app,"POST","/authorize/complete",Some("outsider"),json!({"state":begin["state"],"browser_transaction":begin["browser_transaction"],"code":"new-admin-code"})).await;
    assert_eq!(status, StatusCode::OK);
    cipher.release.notify_one();
    assert_eq!(
        *delayed.await.unwrap().unwrap_err().current_context(),
        MessagingError::Conflict
    );
    assert_eq!(
        f.repo.connection(f.c.id).await.unwrap().unwrap().user_id,
        "macro|uninvited@native-messaging.test"
    );
}
