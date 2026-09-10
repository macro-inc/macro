use super::*;
use chrono::Utc;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Clone, Default)]
struct DeliveryLog {
    live: Arc<Mutex<HashSet<String>>>,
    notices: Arc<Mutex<Vec<(String, CommentNotificationReason)>>>,
    live_failure: bool,
}
impl MessageRealtime for DeliveryLog {
    async fn subscribers(&self, _: &MessageParent) -> Result<HashSet<String>, rootcause::Report> {
        Ok(["viewer", "revoked"].map(str::to_owned).into())
    }
    async fn send(
        &self,
        _: &MessageEvent,
        users: HashSet<String>,
    ) -> Result<(), rootcause::Report> {
        if self.live_failure {
            return Err(rootcause::report!("gateway unavailable"));
        }
        *self.live.lock().unwrap() = users;
        Ok(())
    }
}
impl DiscussionNotifier for DeliveryLog {
    async fn send(
        &self,
        notification: DiscussionNotification<'_>,
    ) -> Result<(), rootcause::Report> {
        self.notices
            .lock()
            .unwrap()
            .push((notification.recipient, notification.reason));
        Ok(())
    }
}
struct Access;
impl MessageAudienceAccess for Access {
    async fn viewers(
        &self,
        _: &MessageParent,
        mut users: HashSet<String>,
    ) -> Result<HashSet<String>, rootcause::Report> {
        users.remove("revoked");
        Ok(users)
    }
}
struct Context;
impl DiscussionContextReader for Context {
    async fn context(
        &self,
        _: &MessageParent,
        _: Uuid,
    ) -> Result<DiscussionContext, rootcause::Report> {
        Ok(DiscussionContext {
            name: "Document".into(),
            owner: "owner".into(),
            file_type: None,
            is_task: false,
            participants: vec!["revoked".into(), "viewer".into()],
            assignees: vec![],
            sender_profile_picture: None,
            link_share_access: Some(entity_access::domain::models::AccessLevel::View),
        })
    }
}
fn event() -> MessageEvent {
    let actor = "macro|author@example.com".to_owned();
    let parent = MessageParent::parse("document", "legacy-document").unwrap();
    let message = Message {
        id: Uuid::from_u128(3),
        parent: parent.clone(),
        thread_id: Some(Uuid::from_u128(2)),
        sender_id: actor.clone().try_into().unwrap(),
        bot_profile: None,
        mentions: vec![],
        imported_author: None,
        triggered_by: None,
        content: "A private discussion".into(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    };
    MessageEvent {
        parent,
        actor,
        nonce: None,
        change: MessageChange::Posted {
            notification_policy: Default::default(),
            message,
            mentions: vec![
                SimpleMention {
                    entity_type: "user".into(),
                    entity_id: "viewer".into(),
                },
                SimpleMention {
                    entity_type: "user".into(),
                    entity_id: "revoked".into(),
                },
            ],
        },
    }
}

#[tokio::test]
async fn revoked_viewers_receive_neither_content_nor_notifications() {
    let log = DeliveryLog::default();
    DiscussionDelivery::new(Context, Access, log.clone(), log.clone())
        .publish(event())
        .await
        .unwrap();
    assert_eq!(
        *log.live.lock().unwrap(),
        HashSet::from(["viewer".to_owned()])
    );
    assert_eq!(
        *log.notices.lock().unwrap(),
        vec![
            ("owner".into(), CommentNotificationReason::Owner),
            ("viewer".into(), CommentNotificationReason::Mention),
        ]
    );
}

#[tokio::test]
async fn realtime_outage_does_not_skip_notifications() {
    let log = DeliveryLog {
        live_failure: true,
        ..Default::default()
    };
    assert!(
        DiscussionDelivery::new(Context, Access, log.clone(), log.clone())
            .publish(event())
            .await
            .is_err()
    );
    assert_eq!(log.notices.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn edits_and_reactions_only_publish_live_updates() {
    let log = DeliveryLog::default();
    let mut event = event();
    let MessageChange::Posted { message, .. } = event.change else {
        unreachable!()
    };
    event.change = MessageChange::ReactionChanged { message };
    DiscussionDelivery::new(Context, Access, log.clone(), log.clone())
        .publish(event)
        .await
        .unwrap();
    assert!(!log.live.lock().unwrap().is_empty());
    assert!(log.notices.lock().unwrap().is_empty());
}

#[derive(Clone, Default)]
struct Shares(Arc<Mutex<Vec<Uuid>>>);
impl DiscussionMentionSharing for Shares {
    async fn grant(
        &self,
        document: Uuid,
        _: Vec<String>,
        _: entity_access::domain::models::AccessLevel,
    ) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().push(document);
        Ok(())
    }
}

#[tokio::test]
async fn document_mentions_inherit_link_sharing_for_uuid_parents() {
    let log = DeliveryLog::default();
    let shares = Shares::default();
    let delivery =
        DiscussionDelivery::new(Context, Access, log.clone(), log).with_sharing(shares.clone());
    delivery.publish(event()).await.unwrap();
    assert!(shares.0.lock().unwrap().is_empty());
    let mut document_event = event();
    let document = Uuid::from_u128(22);
    document_event.parent = MessageParent::parse("document", &document.to_string()).unwrap();
    delivery.publish(document_event).await.unwrap();
    assert_eq!(*shares.0.lock().unwrap(), vec![document]);
}
