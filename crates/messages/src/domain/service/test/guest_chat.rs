use super::*;
use crate::domain::service::guest_chat::*;

struct Authorizer {
    call: Uuid,
    guest: Uuid,
}
#[async_trait::async_trait]
impl GuestCallAuthorizer for Authorizer {
    async fn authorize(&self, call: Uuid, token: &str) -> Result<GuestCallAccess, MessageError> {
        if call != self.call || token != "active-session" {
            return Err(MessageError::Forbidden);
        }
        Ok(GuestCallAccess {
            guest_id: self.guest,
            name: "Visitor".into(),
        })
    }
}
fn setup() -> (Repo, Events, GuestChatService<Repo, Events>, Uuid, Uuid) {
    let mut repo = fixture();
    let call = Uuid::now_v7();
    let guest = Uuid::now_v7();
    repo.message.id = call;
    repo.message.parent = MessageParent::Call(call);
    repo.message.imported_author = None;
    repo.state.root_id = call;
    let events = Events::default();
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );
    (repo, events, service, call, guest)
}

#[tokio::test]
async fn guest_read_and_post_require_current_session_for_the_same_call() {
    let (repo, events, service, call, _) = setup();
    for (call_id, token) in [(call, "expired"), (Uuid::now_v7(), "active-session")] {
        assert!(matches!(
            service.read(call_id, token).await,
            Err(MessageError::Forbidden)
        ));
        assert!(matches!(
            service
                .post(
                    call_id,
                    token,
                    GuestChatPost {
                        id: Uuid::now_v7(),
                        content: "Hello".into()
                    }
                )
                .await,
            Err(MessageError::Forbidden)
        ));
    }
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn guest_reads_the_member_thread_and_posts_with_server_owned_attribution() {
    let (repo, events, service, call, guest) = setup();
    let page = service.read(call, "active-session").await.unwrap();
    assert_eq!(page.messages.len(), 1);
    assert_eq!(page.messages[0].content, "root");
    assert_eq!(page.messages[0].name, "Author Example");
    assert!(!page.messages[0].is_you);
    let message = service
        .post(
            call,
            "active-session",
            GuestChatPost {
                id: Uuid::now_v7(),
                content: "Hello".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(message.name, "Visitor");
    assert!(message.guest && message.is_you);
    let writes = repo.creates.lock().unwrap();
    assert_eq!(writes[0].canonical_root_id, Some(call));
    assert_eq!(writes[0].parent, MessageParent::Call(call));
    assert_eq!(writes[0].actor, ChannelSender::new_from_guest(guest));
    assert!(writes[0].input.mentions.is_empty());
    assert!(writes[0].input.attachments.is_empty());
    assert_eq!(events.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn guest_retries_recover_the_original_without_publishing_again() {
    let (mut repo, events, _, call, guest) = setup();
    let id = Uuid::now_v7();
    repo.client_message_id = Some(id);
    repo.message.sender_id = ChannelSender::new_from_guest(guest);
    repo.message.guest_name = Some("Visitor".into());
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );
    let message = service
        .post(
            call,
            "active-session",
            GuestChatPost {
                id,
                content: "Retry".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(message.id, call);
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn guest_posts_reject_empty_oversize_and_invalid_ids() {
    let (repo, _, service, call, _) = setup();
    for (id, content) in [
        (Uuid::now_v7(), " ".into()),
        (Uuid::now_v7(), "x".repeat(16001)),
        (Uuid::nil(), "hello".into()),
    ] {
        assert!(matches!(
            service
                .post(call, "active-session", GuestChatPost { id, content })
                .await,
            Err(MessageError::Invalid(_))
        ));
    }
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(serde_json::from_value::<GuestChatPost>(serde_json::json!({"id": Uuid::now_v7(), "content": "hello", "sender_id": "macro|owner@example.com"})).is_err());
}

#[tokio::test]
async fn guest_thread_is_empty_before_first_post_and_redacts_account_identity() {
    let (mut repo, events, _, call, guest) = setup();
    repo.message.parent = MessageParent::Channel(Uuid::now_v7());
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );
    let empty = service.read_thread(call, "active-session").await.unwrap();
    assert!(empty.thread.is_none());
    assert_eq!(
        empty.viewer_id,
        ChannelSender::new_from_guest(guest).as_ref()
    );

    repo.message.parent = MessageParent::Call(call);
    repo.message.reactions = vec![CountedReaction {
        emoji: "👍".into(),
        users: vec![repo.message.sender_id.as_ref().to_owned()],
        names: None,
    }];
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo, events)),
        Arc::new(Authorizer { call, guest }),
    );
    let page = service.read_thread(call, "active-session").await.unwrap();
    let json = serde_json::to_string(&page).unwrap();
    assert!(!json.contains("author@example.com"));
    let thread = page.thread.unwrap();
    assert!(thread.root.sender_id.as_ref().starts_with("participant:"));
    assert_eq!(thread.root.imported_author.unwrap().name, "Author Example");
    assert_eq!(
        thread.root.reactions[0].names.as_ref().unwrap()[&thread.root.reactions[0].users[0]],
        "Author Example"
    );
}

#[tokio::test]
async fn guest_quotes_round_trip_through_real_member_sender_ids() {
    let (mut repo, events, _, call, guest) = setup();
    let member = repo.message.sender_id.as_ref().to_owned();
    let opaque = format!("participant:{}", Uuid::new_v5(&call, member.as_bytes()));
    let quote = |sender: &str| {
        format!(
            "<m-reply-target>{{\"parent\":{{\"type\":\"call\",\"id\":\"{call}\"}},\"targetMessageId\":\"{call}\",\"targetThreadId\":\"{call}\",\"displayText\":\"root\",\"senderId\":\"{sender}\"}}</m-reply-target>\n\nreply"
        )
    };
    let mut guest_reply = repo.message.clone();
    guest_reply.id = Uuid::now_v7();
    guest_reply.thread_id = Some(call);
    guest_reply.sender_id = ChannelSender::new_from_guest(guest);
    guest_reply.guest_name = Some("Visitor".into());
    guest_reply.content = quote(&member);
    let guest_reply_id = guest_reply.id;
    repo.replies = vec![guest_reply];
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );

    let thread = service.read_thread(call, "active-session").await.unwrap();
    let guest_quote = &thread.thread.unwrap().replies[0].content;
    assert!(guest_quote.contains(&opaque));
    assert!(!guest_quote.contains(&member));
    let posted = service
        .post_message(
            call,
            "active-session",
            GuestChatPost {
                id: Uuid::now_v7(),
                content: quote(&opaque),
            },
        )
        .await
        .unwrap();
    assert!(posted.content.contains(&opaque));
    assert!(!posted.content.contains(&member));
    let writes = repo.creates.lock().unwrap();
    assert!(writes[0].input.content.contains(&member));
    assert!(!writes[0].input.content.contains(&opaque));
    assert!(matches!(&events.0.lock().unwrap()[0].change,
        MessageChange::Posted { message, .. } if message.content.contains(&member)));
    let patched = service
        .patch_message(
            call,
            "active-session",
            guest_reply_id,
            GuestChatPatch {
                content: quote(&opaque),
            },
        )
        .await
        .unwrap();
    assert!(patched.content.contains(&opaque));
    assert!(repo.edits.lock().unwrap()[0].content.contains(&member));
}

#[test]
fn malformed_quotes_do_not_expose_account_ids_to_guests() {
    let call = Uuid::now_v7();
    let senders = HashMap::new();
    let account = "macro|author@example.com";
    for content in [
        format!("before <m-reply-target>{{\"senderId\":\"{account}\""),
        format!("before <m-reply-target>{{\"senderId\":\"{account}\"</m-reply-target> after"),
    ] {
        let redacted = rewrite_quote_content(&content, call, &senders, false).unwrap();
        assert!(!redacted.contains(account));
        assert!(!redacted.contains("<m-reply-target>"));
    }
    let safe = "<m-reply-target>{\"senderId\":\"guest:123\"}</m-reply-target>";
    assert_eq!(
        rewrite_quote_content(safe, call, &senders, false).unwrap(),
        safe
    );
}

#[test]
fn guest_quotes_require_a_verified_target_and_sender() {
    let call = Uuid::now_v7();
    let account_target = Uuid::now_v7();
    let guest_target = Uuid::now_v7();
    let bot_target = Uuid::now_v7();
    let account = "macro|author@example.com".to_owned();
    let guest = ChannelSender::new_from_guest(Uuid::now_v7())
        .as_ref()
        .to_owned();
    let bot = ChannelSender::new_from_bot(bot_id::MACRO_AI_BOT_ID)
        .as_ref()
        .to_owned();
    let senders = HashMap::from([
        (account_target, account.clone()),
        (guest_target, guest.clone()),
        (bot_target, bot.clone()),
    ]);
    let quote = |parent: Uuid, target: Uuid, sender: &str| {
        format!(
            "<m-reply-target>{{\"parent\":{{\"type\":\"call\",\"id\":\"{parent}\"}},\"targetMessageId\":\"{target}\",\"senderId\":\"{sender}\"}}</m-reply-target>\n\nreply"
        )
    };

    let opaque = format!("participant:{}", Uuid::new_v5(&call, account.as_bytes()));
    let account_quote =
        rewrite_quote_content(&quote(call, account_target, &opaque), call, &senders, true).unwrap();
    assert!(account_quote.contains(&account));
    for (target, sender) in [(guest_target, guest.as_str()), (bot_target, bot.as_str())] {
        let content = quote(call, target, sender);
        let rewritten = rewrite_quote_content(&content, call, &senders, true).unwrap();
        assert!(rewritten.contains(&format!("\"senderId\":\"{sender}\"")));
        assert!(rewritten.ends_with("\n\nreply"));
    }
    for content in [
        quote(Uuid::now_v7(), account_target, &opaque),
        quote(call, Uuid::now_v7(), &opaque),
        quote(call, account_target, &account),
        quote(
            call,
            account_target,
            "participant:00000000-0000-5000-8000-000000000001",
        ),
        quote(
            call,
            guest_target,
            "guest|00000000-0000-7000-8000-000000000001",
        ),
        "<m-reply-target>broken</m-reply-target>\n\nreply".into(),
    ] {
        assert!(matches!(
            rewrite_quote_content(&content, call, &senders, true),
            Err(MessageError::Invalid(_))
        ));
    }
}

#[tokio::test]
async fn unverified_guest_quotes_are_not_posted_or_patched() {
    let (mut repo, events, _, call, guest) = setup();
    let mut own_reply = repo.message.clone();
    own_reply.id = Uuid::now_v7();
    own_reply.thread_id = Some(call);
    own_reply.sender_id = ChannelSender::new_from_guest(guest);
    repo.replies = vec![own_reply.clone()];
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );
    let forged = format!(
        "<m-reply-target>{{\"parent\":{{\"type\":\"call\",\"id\":\"{call}\"}},\"targetMessageId\":\"{call}\",\"senderId\":\"macro|outside@example.com\"}}</m-reply-target>\n\nreply"
    );

    assert!(matches!(
        service
            .post_message(
                call,
                "active-session",
                GuestChatPost {
                    id: Uuid::now_v7(),
                    content: forged.clone(),
                }
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
    assert!(matches!(
        service
            .patch_message(
                call,
                "active-session",
                own_reply.id,
                GuestChatPatch { content: forged }
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
    assert!(repo.creates.lock().unwrap().is_empty());
    assert!(repo.edits.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn guest_edits_share_the_post_character_limit() {
    let (mut repo, events, _, call, guest) = setup();
    repo.message.sender_id = ChannelSender::new_from_guest(guest);
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );

    for content in [String::new(), " ".into(), "a".repeat(16_001)] {
        assert!(matches!(
            service
                .patch_message(call, "active-session", call, GuestChatPatch { content })
                .await,
            Err(MessageError::Invalid(_))
        ));
    }
    assert!(repo.edits.lock().unwrap().is_empty());
    assert!(events.0.lock().unwrap().is_empty());

    service
        .patch_message(
            call,
            "active-session",
            call,
            GuestChatPatch {
                content: "a".repeat(16_000),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        repo.edits.lock().unwrap()[0].content.chars().count(),
        16_000
    );
}

#[tokio::test]
async fn guest_mutations_require_ownership_and_publish_changes() {
    let (mut repo, events, _, call, guest) = setup();
    repo.message.sender_id = ChannelSender::new_from_guest(guest);
    repo.message.guest_name = Some("Visitor".into());
    let other = repo.message.clone();
    let mut own_reply = other.clone();
    own_reply.id = Uuid::now_v7();
    own_reply.thread_id = Some(call);
    let mut other_reply = own_reply.clone();
    other_reply.id = Uuid::now_v7();
    other_reply.sender_id = ChannelSender::new_from_guest(Uuid::now_v7());
    repo.replies = vec![own_reply.clone(), other_reply.clone()];
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );
    assert!(
        service
            .patch_message(
                call,
                "active-session",
                other_reply.id,
                GuestChatPatch {
                    content: "edit".into()
                }
            )
            .await
            .is_err_and(|e| matches!(e, MessageError::Forbidden))
    );
    assert!(
        service
            .delete_message(call, "active-session", other_reply.id)
            .await
            .is_err_and(|e| matches!(e, MessageError::Forbidden))
    );
    service
        .patch_message(
            call,
            "active-session",
            own_reply.id,
            GuestChatPatch {
                content: "edit".into(),
            },
        )
        .await
        .unwrap();
    service
        .delete_message(call, "active-session", own_reply.id)
        .await
        .unwrap();
    service
        .react_message(
            call,
            "active-session",
            other_reply.id,
            "👍".into(),
            true,
            None,
        )
        .await
        .unwrap();
    service
        .react_message(
            call,
            "active-session",
            other_reply.id,
            "👍".into(),
            false,
            None,
        )
        .await
        .unwrap();
    assert_eq!(repo.edits.lock().unwrap().len(), 1);
    assert_eq!(repo.deletes.lock().unwrap().len(), 1);
    assert_eq!(events.0.lock().unwrap().len(), 4);
    assert!(matches!(
        service.read_thread(call, "departed").await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service
            .post_message(
                call,
                "departed",
                GuestChatPost {
                    id: Uuid::now_v7(),
                    content: "text".into()
                }
            )
            .await,
        Err(MessageError::Forbidden)
    ));
    assert!(matches!(
        service
            .react_message(call, "departed", own_reply.id, "👍".into(), true, None)
            .await,
        Err(MessageError::Forbidden)
    ));
}

#[tokio::test]
async fn deleting_guest_root_preserves_member_replies_and_allows_new_posts() {
    let (mut repo, events, _, call, guest) = setup();
    repo.message.sender_id = ChannelSender::new_from_guest(guest);
    repo.message.guest_name = Some("Visitor".into());
    let mut member_reply = repo.message.clone();
    member_reply.id = Uuid::now_v7();
    member_reply.thread_id = Some(call);
    member_reply.sender_id =
        ChannelSender::try_from("macro|author@example.com".to_owned()).unwrap();
    member_reply.content = "Member reply".into();
    repo.replies = vec![member_reply.clone()];
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo.clone(), events.clone())),
        Arc::new(Authorizer { call, guest }),
    );

    service
        .delete_message(call, "active-session", call)
        .await
        .unwrap();

    assert_eq!(*repo.deletes.lock().unwrap(), vec![call]);
    assert!(repo.thread_deletes.lock().unwrap().is_empty());
    assert!(matches!(
        &events.0.lock().unwrap()[0].change,
        MessageChange::MessageDeleted { message } if message.id == call
    ));
    let thread = service.read_thread(call, "active-session").await.unwrap();
    let thread = thread.thread.unwrap();
    assert!(thread.root.deleted_at.is_some());
    assert_eq!(thread.replies.len(), 1);
    assert_eq!(thread.replies[0].id, member_reply.id);
    assert_eq!(thread.replies[0].content, "Member reply");

    let posted = service
        .post_message(
            call,
            "active-session",
            GuestChatPost {
                id: Uuid::now_v7(),
                content: "New reply".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(posted.content, "New reply");
    assert_eq!(
        repo.creates.lock().unwrap()[0].canonical_root_id,
        Some(call)
    );
}

#[tokio::test]
async fn guest_posts_request_the_canonical_call_root() {
    let (repo, events, service, call, _) = setup();
    for content in ["first", "reply"] {
        service
            .post_message(
                call,
                "active-session",
                GuestChatPost {
                    id: Uuid::now_v7(),
                    content: content.into(),
                },
            )
            .await
            .unwrap();
    }
    let writes = repo.creates.lock().unwrap();
    assert_eq!(writes.len(), 2);
    assert!(
        writes
            .iter()
            .all(|write| write.canonical_root_id == Some(call) && write.input.thread_id.is_none())
    );
    assert_eq!(events.0.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn new_guest_routes_reject_a_call_discussion_in_its_channel() {
    let (mut repo, events, _, call, guest) = setup();
    repo.call_thread = Some(CallThreadFacts {
        channel_id: Uuid::now_v7(),
        created_by: repo.message.sender_id.as_ref().to_owned(),
    });
    let service = GuestChatService::new(
        Arc::new(MessageService::new(repo, events)),
        Arc::new(Authorizer { call, guest }),
    );
    assert!(matches!(
        service.read_thread(call, "active-session").await,
        Err(MessageError::Invalid(_))
    ));
    assert!(matches!(
        service
            .post_message(
                call,
                "active-session",
                GuestChatPost {
                    id: Uuid::now_v7(),
                    content: "text".into()
                }
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
    assert!(matches!(
        service
            .patch_message(
                call,
                "active-session",
                call,
                GuestChatPatch {
                    content: "text".into()
                }
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
    assert!(matches!(
        service.delete_message(call, "active-session", call).await,
        Err(MessageError::Invalid(_))
    ));
    assert!(matches!(
        service
            .react_message(call, "active-session", call, "👍".into(), true, None)
            .await,
        Err(MessageError::Invalid(_))
    ));
}
