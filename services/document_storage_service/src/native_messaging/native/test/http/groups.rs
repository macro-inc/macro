//! Signed HTTP/database group journeys with controlled provider effects.
use super::*;
mod cleanup;
use channels::domain::ports::ChannelService;
use meta_messaging::domain::groups::{ports::*, *};

#[async_trait]
impl GroupProvider for ProviderFixture {
    async fn require_group_eligibility(&self, _: &Connection, _: &AccessToken) -> PortResult<()> {
        if self.group_ineligible.load(Ordering::SeqCst) {
            Err(MessagingError::GroupIneligible.into())
        } else {
            Ok(())
        }
    }
    async fn create_group(&self, _: &Connection, _: &AccessToken, _: &str) -> GroupCreateResult {
        let attempt = self.group_creates.fetch_add(1, Ordering::SeqCst) + 1;
        if self.pause_group_create.load(Ordering::SeqCst) {
            self.operation_entered.notify_one();
            self.operation_release.notified().await;
        }
        match self.group_outcome.load(Ordering::SeqCst) {
            1 => GroupCreateResult::Unknown,
            2 => GroupCreateResult::Rejected("131204".into()),
            _ => GroupCreateResult::Pending(format!("request-{attempt}").try_into().unwrap()),
        }
    }
    async fn delete_group(
        &self,
        _: &Connection,
        _: &AccessToken,
        _: &ProviderId,
    ) -> PortResult<()> {
        self.group_deletes.fetch_add(1, Ordering::SeqCst);
        self.group_delete_error
            .lock()
            .unwrap()
            .clone()
            .map_or(Ok(()), |e| Err(e.into()))
    }
    async fn remove_group_participant(
        &self,
        _: &Connection,
        _: &AccessToken,
        _: &ProviderId,
        _: &ProviderId,
    ) -> PortResult<()> {
        self.group_removes.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

async fn platform(pool: &PgPool) -> Fixture {
    let mut f = fixture(pool, Provider::Whatsapp, None).await;
    sqlx::query!("UPDATE meta_messaging_connection SET whatsapp_mode='platform',registration_status='registered',developer_account=false WHERE id=$1",f.c.id).execute(pool).await.unwrap();
    f.c = f.repo.connection(f.c.id).await.unwrap().unwrap();
    f
}

async fn drain_groups(service: &MetaService) {
    while let Some(work) = service.repository.claim_receipt().await.unwrap() {
        let batch = meta_messaging::inbound::webhook::decode(work.provider, &work.payload).unwrap();
        service.process_receipt_attempt(&work, batch).await.unwrap();
    }
}

async fn group_fact(f: &Fixture, field: &str, fact: Value) {
    let envelope = json!({"object":"whatsapp_business_account","entry":[{"id":"waba","changes":[{"field":field,"value":{"metadata":{"phone_number_id":f.c.account_id},"groups":[fact]}}]}]});
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, envelope, true).await,
        StatusCode::OK
    );
    drain_groups(&f.service).await;
}

async fn create(f: &Fixture, channel: Uuid) -> Value {
    let (status, body) = request(
        &f.app,
        "POST",
        &format!("/connections/{}/groups", f.c.id),
        Some("owner"),
        json!({"channel_id":channel,"subject":"Customer project"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn bind(f: &Fixture, request_id: &str, group_id: &str, at: i64) {
    group_fact(f,"group_lifecycle_update",json!({"timestamp":at.to_string(),"type":"group_create","request_id":request_id,"group_id":group_id,"subject":"Customer project","invite_link":"https://chat.whatsapp.com/fixture"})).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completed_creation_replays_only_the_authorized_channel_account_and_generation(
    pool: PgPool,
) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    bind(&f, "request-1", "completed", Utc::now().timestamp()).await;
    assert!(f.repo.group_attempt(channel).await.unwrap().is_none());
    // The initial response was lost; even a later provider rename cannot change
    // which original request is safe to replay.
    group_fact(&f, "group_settings_update", json!({"timestamp":(Utc::now().timestamp()+1).to_string(),"type":"group_settings_update","group_id":"completed","group_subject":{"text":"Renamed","update_successful":true}})).await;
    let busy = f.repo.lock_subscription(&f.c).await.unwrap().unwrap();
    assert_eq!(create(&f, channel).await["state"], "bound");
    let path = format!("/channels/{channel}/group/retry");
    let (status, body) = request(&f.app, "POST", &path, Some("owner"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["state"], "bound");
    drop(busy);
    assert_eq!(
        request(&f.app, "POST", &path, Some("outsider"), json!({}))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let create_path = format!("/connections/{}/groups", f.c.id);
    assert_eq!(
        request(
            &f.app,
            "POST",
            &create_path,
            Some("owner"),
            json!({"channel_id":channel,"subject":"Different request"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query!(
        "UPDATE meta_messaging_conversation SET group_creation_subject=NULL WHERE channel_id=$1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(&f.app, "POST", &path, Some("owner"), json!({}))
            .await
            .0,
        StatusCode::CONFLICT
    );
    sqlx::query!("UPDATE meta_messaging_conversation SET group_creation_subject='Customer project' WHERE channel_id=$1", channel).execute(&pool).await.unwrap();
    let mut other = f.c.clone();
    other.id = Uuid::now_v7();
    other.account_id = "other-phone".to_owned().try_into().unwrap();
    let other = f
        .repo
        .connect(&other, b"fixture-token", None)
        .await
        .unwrap();
    f.repo
        .health(&other, ConnectionStatus::Connected, None)
        .await
        .unwrap();
    assert_eq!(
        request(
            &f.app,
            "POST",
            &format!("/connections/{}/groups", other.id),
            Some("owner"),
            json!({"channel_id":channel,"subject":"Customer project"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    sqlx::query!("UPDATE meta_messaging_connection SET connected_at=connected_at+interval '1 second' WHERE id=$1", f.c.id).execute(&pool).await.unwrap();
    assert_eq!(
        request(&f.app, "POST", &path, Some("owner"), json!({}))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &f.app,
            "POST",
            &create_path,
            Some("owner"),
            json!({"channel_id":channel,"subject":"Customer project"})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(f.remote.group_creates.load(Ordering::SeqCst), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn group_timeout_explicit_retry_fences_old_callbacks_and_dropped_clients(pool: PgPool) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    f.remote.group_outcome.store(1, Ordering::SeqCst);
    assert_eq!(create(&f, channel).await["state"], "unknown");
    assert_eq!(create(&f, channel).await["state"], "unknown");
    assert_eq!(f.remote.group_creates.load(Ordering::SeqCst), 1);
    f.remote.group_outcome.store(0, Ordering::SeqCst);
    let (status, _) = request(
        &f.app,
        "POST",
        &format!("/channels/{channel}/group/retry"),
        Some("owner"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    bind(&f, "request-1", "abandoned", Utc::now().timestamp()).await;
    assert!(f.repo.conversation(channel).await.unwrap().is_none());
    bind(&f, "request-2", "current", Utc::now().timestamp()).await;
    assert_eq!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .customer_id
            .as_str(),
        "current"
    );
    assert_eq!(f.remote.group_creates.load(Ordering::SeqCst), 2);

    let channel2 = Uuid::now_v7();
    f.remote.pause_group_create.store(true, Ordering::SeqCst);
    let app = f.app.clone();
    let connection = f.c.id;
    let client = tokio::spawn(async move {
        request(
            &app,
            "POST",
            &format!("/connections/{connection}/groups"),
            Some("owner"),
            json!({"channel_id":channel2,"subject":"Customer project"}),
        )
        .await
    });
    f.remote.operation_entered.notified().await;
    client.abort();
    assert!(f.repo.group_attempt(channel2).await.unwrap().is_some());
    let (status, _) = request(
        &f.app,
        "POST",
        &format!("/channels/{channel2}/group/retry"),
        Some("owner"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    f.remote.operation_release.notify_one();
    f.group_tasks.close();
    f.group_tasks.wait().await;
    assert_eq!(
        f.repo
            .group_attempt(channel2)
            .await
            .unwrap()
            .unwrap()
            .setup
            .state,
        GroupSetupState::Pending
    );
    assert_eq!(f.remote.group_creates.load(Ordering::SeqCst), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn group_membership_identity_window_status_and_native_guards(pool: PgPool) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    let at = Utc::now().timestamp();
    bind(&f, "request-1", "project-group", at - 10).await;
    group_fact(&f,"group_participants_update",json!({"timestamp":(at-5).to_string(),"type":"group_participants_add","group_id":"project-group","added_participants":[{"user_id":"US.A","username":"alice"}]})).await;
    assert!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_none()
    );
    let members = f.repo.group_participants(channel).await.unwrap();
    let author = members[0].external_sender_id;
    let payload = json!({"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"metadata":{"phone_number_id":f.c.account_id},"messages":[{"id":"group-message","group_id":"project-group","from_user_id":"US.A","timestamp":at.to_string(),"type":"text","text":{"body":"Hello team"}}]}}]}]});
    assert_eq!(
        signed(&f.app, Provider::Whatsapp, payload, true).await,
        StatusCode::OK
    );
    drain_groups(&f.service).await;
    assert_eq!(
        f.repo
            .message_target(f.c.id, "group-message")
            .await
            .unwrap()
            .0,
        channel
    );
    assert!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_some()
    );
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_conversation WHERE connection_id=$1 AND kind='direct'",f.c.id).fetch_one(&pool).await.unwrap(),Some(0));
    assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_customer_alias WHERE connection_id=$1 AND identifier='project-group'",f.c.id).fetch_one(&pool).await.unwrap(),Some(0));
    group_fact(&f,"group_participants_update",json!({"timestamp":(at+2).to_string(),"type":"group_participants_remove","group_id":"project-group","removed_participants":[{"input":"US.A"}]})).await;
    group_fact(&f,"group_participants_update",json!({"timestamp":(at+1).to_string(),"type":"group_participants_add","group_id":"project-group","added_participants":[{"user_id":"US.A"}]})).await;
    assert!(f.repo.group_participants(channel).await.unwrap().is_empty());
    group_fact(&f,"group_participants_update",json!({"timestamp":(at+4).to_string(),"type":"group_participants_remove","group_id":"project-group","removed_participants":[{"input":"US.B"}]})).await;
    f.repo
        .update_identity(
            &f.c,
            &IdentityUpdate {
                provenance: Provenance::Customer,
                account_id: f.c.account_id.clone(),
                previous: "US.A".to_owned().try_into().unwrap(),
                current: "US.B".to_owned().try_into().unwrap(),
                previous_phone: None,
                phone: None,
                timestamp: Utc::now(),
            },
        )
        .await
        .unwrap();
    assert!(
        f.repo.group_participants(channel).await.unwrap().is_empty(),
        "identity changes cannot undo newer departure facts"
    );
    group_fact(&f,"group_participants_update",json!({"timestamp":(at+5).to_string(),"type":"group_participants_add","group_id":"project-group","added_participants":[{"user_id":"US.B"}]})).await;
    assert_eq!(
        f.repo.group_participants(channel).await.unwrap()[0].external_sender_id,
        author
    );
    let link = request(
        &f.app,
        "GET",
        &format!("/channels/{channel}/group/link"),
        Some("owner"),
        json!({}),
    )
    .await;
    assert_eq!(link.0, StatusCode::OK);
    let view = request(
        &f.app,
        "GET",
        &format!("/channels/{channel}"),
        Some("owner"),
        json!({}),
    )
    .await;
    assert!(!view.1.to_string().contains("chat.whatsapp.com"));
    assert_eq!(
        request(
            &f.app,
            "DELETE",
            &format!("/channels/{channel}/group/participants/{author}"),
            Some("owner"),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        f.repo.group_participants(channel).await.unwrap().len(),
        1,
        "HTTP acceptance is not membership confirmation"
    );
    group_fact(
        &f,
        "group_status_update",
        json!({"timestamp":(at+5).to_string(),"type":"group_suspend","group_id":"project-group"}),
    )
    .await;
    group_fact(&f,"group_status_update",json!({"timestamp":(at+4).to_string(),"type":"group_suspend_cleared","group_id":"project-group"})).await;
    assert_eq!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .group_status,
        Some(GroupStatus::Suspended)
    );
    let denied = request(
        &f.app,
        "POST",
        &format!("/channels/{channel}/replies"),
        Some("owner"),
        json!({"idempotency_key":Uuid::now_v7(),"message":{"type":"text","text":"blocked"}}),
    )
    .await;
    assert!(!denied.0.is_success());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn group_create_permissions_and_deletion_rejections_keep_native_channel(pool: PgPool) {
    let f = platform(&pool).await;
    sqlx::query!(
        "UPDATE team_user SET team_role='admin' WHERE team_id=$1 AND user_id<>$2",
        f.c.team_id,
        f.c.user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let channel = Uuid::now_v7();
    assert_eq!(
        request(
            &f.app,
            "POST",
            &format!("/connections/{}/groups", f.c.id),
            Some("outsider"),
            json!({"channel_id":channel,"subject":"Denied"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(f.remote.group_creates.load(Ordering::SeqCst), 0);
    f.remote.group_ineligible.store(true, Ordering::SeqCst);
    assert!(
        !request(
            &f.app,
            "POST",
            &format!("/connections/{}/groups", f.c.id),
            Some("owner"),
            json!({"channel_id":channel,"subject":"Customer project"})
        )
        .await
        .0
        .is_success()
    );
    f.remote.group_ineligible.store(false, Ordering::SeqCst);
    create(&f, channel).await;
    bind(&f, "request-1", "delete-group", Utc::now().timestamp()).await;
    assert!(
        !request(
            &f.app,
            "GET",
            &format!("/channels/{channel}/group/link"),
            Some("outsider"),
            json!({})
        )
        .await
        .0
        .is_success()
    );
    for error in [
        MessagingError::ProviderRejected,
        MessagingError::GroupUnconfirmed,
        MessagingError::Unavailable,
    ] {
        *f.remote.group_delete_error.lock().unwrap() = Some(error);
        assert!(
            f.service
                .delete_group(
                    channel,
                    &f.c.user_id,
                    meta_messaging::domain::policy::SendAuthority::Human
                )
                .await
                .is_err()
        );
        assert!(f.repo.conversation(channel).await.unwrap().is_some());
    }
    *f.remote.group_delete_error.lock().unwrap() = None;
    let native =
        channels::domain::service::ChannelServiceImpl::new(PgChannelsRepo::new(pool.clone()));
    assert!(
        native
            .delete_channel(
                ChannelSender::new_from_user(
                    MacroUserIdStr::try_from(f.c.user_id.clone()).unwrap()
                ),
                channel
            )
            .await
            .is_err(),
        "ordinary native deletion fails closed for managed groups"
    );
    assert_eq!(
        request(
            &f.app,
            "DELETE",
            &format!("/channels/{channel}/group"),
            Some("owner"),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(f.repo.conversation(channel).await.unwrap().is_none());
    bind(&f, "request-1", "delete-group", Utc::now().timestamp()).await;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_channels WHERE id=$1", channel)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn early_group_facts_retry_boundedly_and_unknown_requests_are_terminal(pool: PgPool) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    let at = Utc::now().timestamp();
    group_fact(&f,"group_participants_update",json!({"timestamp":at.to_string(),"type":"group_participants_add","group_id":"early-group","added_participants":[{"user_id":"US.EARLY"}]})).await;
    let receipt=sqlx::query!("SELECT id,status,error_code FROM meta_messaging_receipt WHERE error_code='group_binding_pending'").fetch_one(&pool).await.unwrap();
    assert_eq!(receipt.status, "pending");
    // Once setup becomes stale it no longer holds unrelated facts in retry.
    sqlx::query!("UPDATE meta_messaging_group_setup SET started_at=now()-interval '5 minutes' WHERE channel_id=$1",channel).execute(&pool).await.unwrap();
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET available_at=now() WHERE id=$1",
        receipt.id
    )
    .execute(&pool)
    .await
    .unwrap();
    drain_groups(&f.service).await;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT status FROM meta_messaging_receipt WHERE id=$1",
            receipt.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        "complete"
    );
    bind(&f, "request-1", "early-group", at - 1).await;
    assert!(
        f.repo.group_participants(channel).await.unwrap().is_empty(),
        "stale unrelated facts are not replayed on bind"
    );
    group_fact(&f,"group_participants_update",json!({"timestamp":(at+1).to_string(),"type":"group_participants_add","group_id":"early-group","added_participants":[{"user_id":"US.EARLY"}]})).await;
    assert_eq!(f.repo.group_participants(channel).await.unwrap().len(), 1);
    assert!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .last_customer_message_at
            .is_none()
    );
    bind(&f, "late-unknown", "must-not-adopt", at).await;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM meta_messaging_receipt WHERE status='pending'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );

    let waiting = Uuid::now_v7();
    create(&f, waiting).await;
    group_fact(
        &f,
        "group_status_update",
        json!({"timestamp":at.to_string(),"type":"group_suspend","group_id":"never-bound"}),
    )
    .await;
    sqlx::query!(
        "UPDATE meta_messaging_receipt SET attempts=9,available_at=now() WHERE status='pending'"
    )
    .execute(&pool)
    .await
    .unwrap();
    drain_groups(&f.service).await;
    let terminal = sqlx::query!(
        "SELECT status,error_code,completed_at FROM meta_messaging_receipt WHERE attempts=10"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(terminal.status, "failed");
    assert_eq!(
        terminal.error_code.as_deref(),
        Some("group_binding_pending")
    );
    assert!(
        f.repo.claim_receipt().await.unwrap().is_none(),
        "exhausted facts retain a diagnostic without being rescheduled"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn group_native_roles_subject_order_and_remote_delete_fence(pool: PgPool) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    let at = Utc::now().timestamp();
    bind(&f, "request-1", "roles-group", at - 10).await;
    let teammate = "macro|uninvited@native-messaging.test";
    sqlx::query!(
        "INSERT INTO comms_channel_participants(channel_id,user_id,role) VALUES ($1,$2,'member')",
        channel,
        teammate
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(
            &f.app,
            "GET",
            &format!("/channels/{channel}/group/link"),
            Some("outsider"),
            json!({})
        )
        .await
        .0,
        StatusCode::OK,
        "copy does not require an open reply window"
    );
    assert!(
        f.repo.group_participants(channel).await.unwrap().is_empty(),
        "adding a teammate does not add a WhatsApp participant"
    );
    group_fact(&f,"group_participants_update",json!({"timestamp":(at-5).to_string(),"type":"group_participants_add","group_id":"roles-group","added_participants":[{"user_id":"US.MEMBER"}]})).await;
    let participant = f.repo.group_participants(channel).await.unwrap()[0].external_sender_id;
    assert!(
        !request(
            &f.app,
            "DELETE",
            &format!("/channels/{channel}/group/participants/{participant}"),
            Some("outsider"),
            json!({})
        )
        .await
        .0
        .is_success()
    );
    sqlx::query!(
        "UPDATE comms_channel_participants SET role='admin' WHERE channel_id=$1 AND user_id=$2",
        channel,
        teammate
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        request(
            &f.app,
            "DELETE",
            &format!("/channels/{channel}/group/participants/{participant}"),
            Some("outsider"),
            json!({})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert!(
        f.service
            .delete_group(
                channel,
                teammate,
                meta_messaging::domain::policy::SendAuthority::Human
            )
            .await
            .is_err()
    );
    group_fact(&f,"group_settings_update",json!({"timestamp":at.to_string(),"type":"group_settings_update","group_id":"roles-group","group_subject":{"text":"New remote subject","update_successful":true}})).await;
    group_fact(&f,"group_settings_update",json!({"timestamp":(at-1).to_string(),"type":"group_settings_update","group_id":"roles-group","group_subject":{"text":"Stale remote subject","update_successful":true}})).await;
    assert_eq!(
        sqlx::query_scalar!("SELECT name FROM comms_channels WHERE id=$1", channel)
            .fetch_one(&pool)
            .await
            .unwrap()
            .as_deref(),
        Some("New remote subject")
    );
    assert!(
        f.service
            .discard_group_setup(
                channel,
                &f.c.user_id,
                meta_messaging::domain::policy::SendAuthority::Human
            )
            .await
            .is_err(),
        "stale local-discard confirmation cannot delete a now-bound group"
    );
    sqlx::query!(
        "UPDATE meta_messaging_conversation SET last_customer_message_at=now() WHERE channel_id=$1",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(request(&f.app,"POST",&format!("/channels/{channel}/replies"),Some("owner"),json!({"idempotency_key":Uuid::now_v7(),"message":{"type":"text","text":"Queued before deletion"}})).await.0,StatusCode::OK);
    let work = f.repo.claim_send().await.unwrap().unwrap();
    group_fact(&f,"group_lifecycle_update",json!({"timestamp":(at+1).to_string(),"type":"group_delete","group_id":"roles-group","request_id":"remote-delete"})).await;
    group_fact(&f,"group_status_update",json!({"timestamp":(at+2).to_string(),"type":"group_suspend_cleared","group_id":"roles-group"})).await;
    assert!(matches!(
        f.service
            .messaging
            .process_send(&work)
            .await
            .unwrap_err()
            .current_context(),
        MessagingError::GroupReadOnly
    ));
    assert_eq!(f.remote.sends.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.repo
            .conversation(channel)
            .await
            .unwrap()
            .unwrap()
            .group_status,
        Some(GroupStatus::Deleted)
    );
    sqlx::query!(
        "UPDATE meta_messaging_connection SET status='disconnected' WHERE id=$1",
        f.c.id
    )
    .execute(&pool)
    .await
    .unwrap();
    f.service
        .delete_group(
            channel,
            &f.c.user_id,
            meta_messaging::domain::policy::SendAuthority::Human,
        )
        .await
        .unwrap();
    assert_eq!(
        f.remote.group_deletes.load(Ordering::SeqCst),
        0,
        "confirmed remote deletion needs no second provider delete"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn group_phone_upgrade_preserves_author_and_quote_namespace(pool: PgPool) {
    let f = platform(&pool).await;
    let channel = Uuid::now_v7();
    create(&f, channel).await;
    let at = Utc::now().timestamp();
    bind(&f, "request-1", "US.SAME", at - 5).await;
    let native = fixture_native(&pool).await;
    let mut retired = incoming(&f.c, "retired-direct");
    retired.customer_id = "15550000001".to_owned().try_into().unwrap();
    retired.customer_phone = Some(retired.customer_id.clone());
    native.ingest(&f.c, &retired, vec![]).await.unwrap();
    let retired_channel = f
        .repo
        .message_target(f.c.id, "retired-direct")
        .await
        .unwrap()
        .0;
    for (message_id, identity) in [
        ("legacy", json!({"from":"15550000001"})),
        (
            "bsuid",
            json!({"from":"15550000001","from_user_id":"US.PERSON"}),
        ),
    ] {
        if message_id == "bsuid" {
            sqlx::query!("UPDATE meta_messaging_conversation SET customer_phone=NULL,customer_phone_at=now() WHERE channel_id=$1",retired_channel).execute(&pool).await.unwrap();
        }
        let mut message = identity;
        message["id"] = json!(message_id);
        message["group_id"] = json!("US.SAME");
        message["timestamp"] = json!(at.to_string());
        message["type"] = json!("text");
        message["text"] = json!({"body":"Group message"});
        assert_eq!(signed(&f.app,Provider::Whatsapp,json!({"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"metadata":{"phone_number_id":f.c.account_id},"messages":[message]}}]}]}),true).await,StatusCode::OK);
        drain_groups(&f.service).await;
    }
    let legacy = f.repo.message_target(f.c.id, "legacy").await.unwrap();
    let upgraded = f.repo.message_target(f.c.id, "bsuid").await.unwrap();
    let authors = sqlx::query_scalar!(
        "SELECT sender_id FROM comms_messages WHERE id=ANY($1)",
        &[legacy.1, upgraded.1]
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(authors.len(), 2);
    assert_eq!(authors[0], authors[1]);
    assert_eq!(f.repo.group_participants(channel).await.unwrap().len(), 1);
    assert_eq!(
        f.repo.group_participants(channel).await.unwrap()[0]
            .customer_id
            .as_str(),
        "US.PERSON"
    );
    assert_eq!(
        f.repo
            .conversation(retired_channel)
            .await
            .unwrap()
            .unwrap()
            .customer_id
            .as_str(),
        "15550000001",
        "group-only identity evidence must not rekey a retired direct history"
    );
    let mut replay = incoming(&f.c, "legacy");
    replay.customer_id = "15550000001".to_owned().try_into().unwrap();
    replay.group_id = Some("US.SAME".to_owned().try_into().unwrap());
    replay.timestamp = chrono::DateTime::from_timestamp(at, 0).unwrap();
    native.ingest(&f.c, &replay, vec![]).await.unwrap();
    assert_eq!(
        f.repo.group_participants(channel).await.unwrap().len(),
        1,
        "duplicate legacy messages cannot resurrect an obsolete participant"
    );
    // The same opaque peer spelling is legal in separate destination namespaces.
    let mut direct = incoming(&f.c, "direct-quote");
    direct.customer_id = "US.SAME".to_owned().try_into().unwrap();
    native.ingest(&f.c, &direct, vec![]).await.unwrap();
    let conversation = f.repo.conversation(channel).await.unwrap().unwrap();
    assert!(
        !f.repo
            .has_message(
                &conversation,
                &"direct-quote".to_owned().try_into().unwrap()
            )
            .await
            .unwrap()
    );
    assert!(
        f.repo
            .has_message(&conversation, &"bsuid".to_owned().try_into().unwrap())
            .await
            .unwrap()
    );
}
