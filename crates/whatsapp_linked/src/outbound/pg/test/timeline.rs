use super::*;
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_viewer_without_whatsapp_reads_history_and_unread_but_cannot_send(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    session
        .ingest_event(alice, &text(20, CUSTOMER_JID, "VIEWER", "Shared history"))
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::ExternalChat,
        &CAROL.to_owned().try_into().unwrap(),
        Some(AccessLevel::View),
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let access_service = entity_access::domain::service::EntityAccessServiceImpl::new(
        entity_access::outbound::PgAccessRepository::new(pool.clone()),
    );
    use entity_access::domain::ports::EntityAccessService;
    let receipt = access_service
        .generate_entity_access_receipt::<MessageView>(
            &macro_user_id::user_id::MacroUserIdStr::try_from(CAROL.to_owned())
                .unwrap()
                .0,
            None,
            &binding.id.to_string(),
            EntityType::ExternalChat,
        )
        .await
        .unwrap();
    let detail = linked.chats.detail(&receipt).await.unwrap();
    assert_eq!(detail.chat.name, "Customer escalations");
    assert_eq!(detail.chat.unread_count, 1);
    assert_eq!(detail.chat.send_reason, Some(ReplyBlock::NoAccount));
    assert!(detail.sending_identity.is_none());
    let messages = linked
        .chats
        .messages(&receipt, None, Some(50))
        .await
        .unwrap();
    assert_eq!(messages.messages[0].body, "Shared history");
    let bot_access = EntityAccessReceipt::<MessageView>::try_new_bot(
        "bot|00000000-0000-0000-0000-000000000123"
            .to_owned()
            .try_into()
            .unwrap(),
        entity_access::domain::models::BotReceiptScope::User {
            acting_user: CAROL.to_owned().try_into().unwrap(),
        },
        Entity {
            entity_id: binding.id.to_string(),
            entity_type: EntityType::ExternalChat,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();
    assert_eq!(
        linked
            .chats
            .messages(&bot_access, None, Some(50))
            .await
            .unwrap()
            .messages[0]
            .body,
        "Shared history"
    );
    let bot_detail = linked.chats.detail(&bot_access).await.unwrap();
    assert!(!bot_detail.chat.can_send);
    assert!(bot_detail.sending_identity.is_none());
    assert!(
        linked
            .chats
            .mark_read(&bot_access, messages.messages[0].id)
            .await
            .is_err()
    );
    linked
        .chats
        .mark_read(&receipt, messages.messages[0].id)
        .await
        .unwrap();
    assert_eq!(
        linked
            .store
            .chat_facts(binding.id, CAROL)
            .await
            .unwrap()
            .unread_count,
        0
    );
    let request = SendReply {
        idempotency_key: Uuid::now_v7(),
        message: ReplyContent::Text {
            text: "cannot send".into(),
            mentions: vec![],
        },
        reply_to: None,
    };
    assert_eq!(
        *linked
            .chats
            .send_reply(&receipt, &request, SendAuthority::UserApiToken)
            .await
            .unwrap_err()
            .current_context(),
        ExternalChatError::Disconnected
    );
    assert!(
        linked
            .chats
            .upload_attachment(
                &receipt,
                "test.txt",
                "text/plain",
                b"test",
                SendAuthority::UserApiToken
            )
            .await
            .is_err()
    );
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::ExternalChat,
        &CAROL.to_owned().try_into().unwrap(),
        None,
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(
        access_service
            .generate_entity_access_receipt::<MessageView>(
                &macro_user_id::user_id::MacroUserIdStr::try_from(CAROL.to_owned())
                    .unwrap()
                    .0,
                None,
                &binding.id.to_string(),
                EntityType::ExternalChat
            )
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn timeline_cursor_and_read_cursor_are_group_scoped_and_monotone(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let mut early = text(30, CUSTOMER_JID, "EARLY", "older");
    early.source_at = Utc::now();
    let mut late = text(31, CUSTOMER_JID, "LATE", "newer");
    late.source_at = early.source_at + Duration::seconds(1);
    session.ingest_event(alice, &early).await.unwrap();
    session.ingest_event(alice, &late).await.unwrap();
    let receipt = receipt::<MessageView>(BOB, binding.id);
    let page = linked
        .chats
        .messages(&receipt, None, Some(1))
        .await
        .unwrap();
    assert_eq!(page.messages[0].body, "newer");
    let next = linked
        .chats
        .messages(&receipt, page.next_cursor, Some(1))
        .await
        .unwrap();
    assert_eq!(next.messages[0].body, "older");
    assert!(next.next_cursor.is_none());
    linked
        .chats
        .mark_read(&receipt, page.messages[0].id)
        .await
        .unwrap();
    linked
        .chats
        .mark_read(&receipt, next.messages[0].id)
        .await
        .unwrap();
    assert_eq!(
        linked
            .store
            .chat_facts(binding.id, BOB)
            .await
            .unwrap()
            .unread_count,
        0
    );
    assert!(
        linked
            .store
            .mark_read(Uuid::now_v7(), &person(BOB), page.messages[0].id)
            .await
            .is_err()
    );
    let mut elsewhere = early;
    elsewhere.group_jid = "999@g.us".into();
    elsewhere.event_id = Uuid::now_v7();
    session.enqueue_inbound(alice, &elsewhere).await.unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE event_id=$1"#,
            elsewhere.event_id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}

#[derive(Default)]
struct Notifications(std::sync::Mutex<Vec<Uuid>>);
#[async_trait]
impl ChatPublisher for Notifications {
    async fn publish(&self, effect: &ChatEffect) -> ExternalChatResult<()> {
        self.0.lock().unwrap().push(effect.message_id);
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notifications_are_once_for_live_messages_and_never_history_or_edits(pool: PgPool) {
    let (linked, session, _, _, alice, _) = adopted(&pool).await;
    let notifications = Arc::new(Notifications::default());
    let effects =
        external_chat::domain::effects::EffectsService::new(linked.store, notifications.clone());
    let mut history = text(40, CUSTOMER_JID, "HISTORY", "old message");
    if let InboundKind::Message(message) = &mut history.kind {
        message.history = true;
    }
    session.ingest_event(alice, &history).await.unwrap();
    effects.publish_pending().await.unwrap();
    assert!(notifications.0.lock().unwrap().is_empty());
    let live = text(41, CUSTOMER_JID, "LIVE", "new message");
    session.ingest_event(alice, &live).await.unwrap();
    effects.publish_pending().await.unwrap();
    assert_eq!(notifications.0.lock().unwrap().len(), 1);
    session.ingest_event(alice, &live).await.unwrap();
    effects.publish_pending().await.unwrap();
    let mut edit = text(42, CUSTOMER_JID, "EDIT", "changed message");
    if let InboundKind::Message(message) = &mut edit.kind {
        message.kind = MessageKind::Edit;
        message.revision = 1;
        message.target = Some(Target {
            source_id: "LIVE".into(),
            sender_jid: CUSTOMER_JID.into(),
        });
    }
    session.ingest_event(alice, &edit).await.unwrap();
    effects.publish_pending().await.unwrap();
    assert_eq!(notifications.0.lock().unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn canonical_team_sharing_is_owner_only_and_reversible(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    let owner = receipt::<MessageView>(ALICE, binding.id);
    let viewer = receipt::<MessageView>(BOB, binding.id);
    let update = models_permissions::share_permission::UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(Some(AccessLevel::View)),
        channel_share_permissions: None,
    };
    assert!(
        linked
            .chats
            .update_permissions(&viewer, &update, SendAuthority::Human)
            .await
            .is_err()
    );
    assert!(linked.chats.list(&person(CAROL)).await.unwrap().is_empty());
    linked
        .chats
        .update_permissions(&owner, &update, SendAuthority::Human)
        .await
        .unwrap();
    let shared = linked.chats.list(&person(CAROL)).await.unwrap();
    assert_eq!(shared[0].id, binding.id);
    assert_eq!(shared[0].send_reason, Some(ReplyBlock::NoAccount));
    assert_eq!(
        linked
            .chats
            .permissions(&owner)
            .await
            .unwrap()
            .team_share_access_level,
        Some(AccessLevel::View)
    );
    linked
        .chats
        .update_permissions(
            &owner,
            &models_permissions::share_permission::UpdateSharePermissionRequestV2 {
                team_share_access_level: Some(None),
                ..update
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert!(linked.chats.list(&person(CAROL)).await.unwrap().is_empty());
    session
        .ingest_event(alice, &text(50, CUSTOMER_JID, "PUBLIC", "Link sharing"))
        .await
        .unwrap();
    use models_permissions::share_permission::{LinkShare, UpdateSharePermissionRequestV2};
    let public = UpdateSharePermissionRequestV2 {
        link_share: Some(Some(LinkShare::Public)),
        link_share_access_level: Some(Some(AccessLevel::View)),
        team_share_access_level: None,
        channel_share_permissions: None,
    };
    for refused in [AccessLevel::Comment, AccessLevel::Edit] {
        let error = linked
            .chats
            .update_permissions(
                &owner,
                &UpdateSharePermissionRequestV2 {
                    link_share_access_level: Some(Some(refused)),
                    ..public.clone()
                },
                SendAuthority::Human,
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error.current_context(),
            ExternalChatError::Invalid(_)
        ));
    }
    linked
        .chats
        .update_permissions(&owner, &public, SendAuthority::Human)
        .await
        .unwrap();
    // Public links grant known-ID access, never global group discovery.
    assert!(linked.chats.list(&person(CAROL)).await.unwrap().is_empty());
    use entity_access::domain::ports::EntityAccessService;
    let access = entity_access::domain::service::EntityAccessServiceImpl::new(
        entity_access::outbound::PgAccessRepository::new(pool.clone()),
    );
    let carol = macro_user_id::user_id::MacroUserIdStr::try_from(CAROL.to_owned()).unwrap();
    assert_eq!(
        access
            .get_access_level(
                Some(&carol.0),
                &binding.id.to_string(),
                EntityType::ExternalChat
            )
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    let shared = access
        .generate_entity_access_receipt::<MessageView>(
            &carol.0,
            None,
            &binding.id.to_string(),
            EntityType::ExternalChat,
        )
        .await
        .unwrap();
    let page = linked
        .chats
        .messages(&shared, None, Some(50))
        .await
        .unwrap();
    linked
        .chats
        .mark_read(&shared, page.messages[0].id)
        .await
        .unwrap();
    assert_eq!(linked.chats.list(&person(CAROL)).await.unwrap().len(), 1);
    linked
        .chats
        .update_permissions(
            &owner,
            &UpdateSharePermissionRequestV2 {
                link_share: None,
                link_share_access_level: Some(None),
                ..public.clone()
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let permission = linked.chats.permissions(&owner).await.unwrap();
    assert_eq!(permission.link_share, Some(LinkShare::Public));
    assert_eq!(permission.link_share_access_level, Some(AccessLevel::View));
    assert_eq!(
        access
            .get_access_level(
                Some(&carol.0),
                &binding.id.to_string(),
                EntityType::ExternalChat
            )
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    linked
        .chats
        .update_permissions(
            &owner,
            &UpdateSharePermissionRequestV2 {
                link_share: Some(None),
                link_share_access_level: None,
                ..public
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert_eq!(
        access
            .get_access_level(
                Some(&carol.0),
                &binding.id.to_string(),
                EntityType::ExternalChat
            )
            .await
            .unwrap(),
        None
    );
    assert!(linked.chats.list(&person(CAROL)).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_sender_uses_own_roster_without_adopting_again(pool: PgPool) {
    let (linked, session, _, binding, alice, bob) = adopted(&pool).await;
    sqlx::query!(
        "DELETE FROM whatsapp_chat_membership WHERE chat_id=$1 AND account_id=$2",
        binding.id,
        bob.account_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let access = receipt::<MessageView>(BOB, binding.id);
    let detail = linked.chats.detail(&access).await.unwrap();
    assert!(detail.chat.can_send);
    assert_eq!(detail.sending_identity.as_deref(), Some(BOB_JID));
    let progress = linked
        .chats
        .send_reply(
            &access,
            &SendReply {
                idempotency_key: Uuid::now_v7(),
                message: ReplyContent::Text {
                    text: "from Bob's own connection".into(),
                    mentions: vec![],
                },
                reply_to: None,
            },
            SendAuthority::UserApiToken,
        )
        .await
        .unwrap();
    assert!(session.claim_sends(alice, 10).await.unwrap().is_empty());
    let claimed = session.claim_sends(bob, 10).await.unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, progress.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_group_mentioned_in_a_channel_is_readable_by_its_current_members(pool: PgPool) {
    let (linked, _, _, binding, _, _) = adopted(&pool).await;
    let channel = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id, created_at, updated_at) VALUES ($1, 'ops', 'private', $2, now(), now())",
        channel,
        ALICE
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at) VALUES ($1, $2, 'member', now())",
        channel,
        CAROL
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(linked.chats.list(&person(CAROL)).await.unwrap().is_empty());
    // What mentioning the group in the channel writes.
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::channel_share::insert_if_absent(
        &mut tx,
        &binding.id,
        EntityType::ExternalChat,
        &channel,
        AccessLevel::View,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let listed = linked.chats.list(&person(CAROL)).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, binding.id);
    assert_eq!(listed[0].send_reason, Some(ReplyBlock::NoAccount));
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1 AND user_id = $2",
        channel,
        CAROL
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        linked.chats.list(&person(CAROL)).await.unwrap().is_empty(),
        "leaving the channel ends access"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_owners_own_session_changes_sharing(pool: PgPool) {
    let (linked, _, _, binding, _, _) = adopted(&pool).await;
    let owner = receipt::<MessageView>(ALICE, binding.id);
    let public = models_permissions::share_permission::UpdateSharePermissionRequestV2 {
        link_share: Some(Some(
            models_permissions::share_permission::LinkShare::Public,
        )),
        link_share_access_level: Some(Some(AccessLevel::View)),
        team_share_access_level: None,
        channel_share_permissions: None,
    };
    for authority in [SendAuthority::UserApiToken, SendAuthority::Automation] {
        let error = linked
            .chats
            .update_permissions(&owner, &public, authority)
            .await
            .unwrap_err();
        assert_eq!(error.current_context(), &ExternalChatError::Forbidden);
    }
    assert_eq!(
        linked.chats.permissions(&owner).await.unwrap().link_share,
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owner_sees_and_revokes_channel_grants(pool: PgPool) {
    use models_permissions::share_permission::{
        UpdateSharePermissionRequestV2,
        channel_share_permission::{
            ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
        },
    };
    let (linked, _, _, binding, _, _) = adopted(&pool).await;
    let owner = receipt::<MessageView>(ALICE, binding.id);
    let channel = Uuid::now_v7().to_string();
    let grants = |operation, access_level| UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: None,
        channel_share_permissions: Some(vec![UpdateChannelSharePermission {
            operation,
            channel_id: channel.clone(),
            access_level,
        }]),
    };
    // A mention of the chat by its owner left this grant.
    let mut transaction = pool.begin().await.unwrap();
    entity_access_db_utils::channel_share::insert_if_absent(
        &mut transaction,
        &binding.id,
        entity_access_db_utils::EntityType::ExternalChat,
        &Uuid::parse_str(&channel).unwrap(),
        AccessLevel::View,
    )
    .await
    .unwrap();
    transaction.commit().await.unwrap();
    assert_eq!(
        linked
            .chats
            .permissions(&owner)
            .await
            .unwrap()
            .channel_share_permissions,
        Some(vec![ChannelSharePermission {
            channel_id: channel.clone(),
            access_level: AccessLevel::View,
        }])
    );
    let error = linked
        .chats
        .update_permissions(
            &owner,
            &grants(UpdateOperation::Replace, Some(AccessLevel::Edit)),
            SendAuthority::Human,
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error.current_context(),
        ExternalChatError::Invalid(_)
    ));
    linked
        .chats
        .update_permissions(
            &owner,
            &grants(UpdateOperation::Remove, None),
            SendAuthority::Human,
        )
        .await
        .unwrap();
    assert_eq!(
        linked
            .chats
            .permissions(&owner)
            .await
            .unwrap()
            .channel_share_permissions,
        Some(vec![])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_message_reads_like_its_timeline_entry(pool: PgPool) {
    let (linked, session, _, binding, alice, _) = adopted(&pool).await;
    for (event, source) in [(1, "ONE"), (2, "TWO")] {
        session
            .ingest_event(alice, &text(event, CUSTOMER_JID, source, source))
            .await
            .unwrap();
    }
    let viewer = receipt::<MessageView>(BOB, binding.id);
    let page = linked
        .chats
        .messages(&viewer, None, Some(50))
        .await
        .unwrap();
    let older = page.messages.last().unwrap();
    let one = linked.chats.message(&viewer, older.id).await.unwrap();
    assert_eq!((one.id, one.body.as_str()), (older.id, older.body.as_str()));
    let missing = linked
        .chats
        .message(&viewer, Uuid::now_v7())
        .await
        .unwrap_err();
    assert_eq!(missing.current_context(), &ExternalChatError::NotFound);
}
