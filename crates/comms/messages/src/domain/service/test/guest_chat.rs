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
    assert_eq!(page.messages[0].name, "author");
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
