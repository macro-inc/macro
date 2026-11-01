use super::*;
use models_email::service::{address::ContactInfo, link::UserProvider};

fn context() -> ProjectionContext {
    let link_id = Uuid::now_v7();
    let owner = MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap();
    let now = chrono::Utc::now();
    let message = serde_json::from_value(serde_json::json!({
        "db_id":Uuid::now_v7(),"thread_db_id":Uuid::now_v7(),"link_id":link_id,"provider_id":"message","provider_thread_id":"conversation",
        "subject":"Subject","snippet":"Snippet","internal_date_ts":now,"is_read":false,"is_starred":false,"is_draft":false,"is_sent":false,
        "has_attachments":false,"to":[],"cc":[],"bcc":[],"labels":[],"attachments":[],"attachments_draft":[],"attachments_forwarded":[],"created_at":now,"updated_at":now,
        "from":{"email":"sender@example.com","name":"Sender"}
    })).unwrap();
    ProjectionContext {
        link: Link {
            id: link_id,
            macro_id: owner.clone(),
            fusionauth_user_id: "owner".into(),
            email_address: macro_user_id::email::EmailStr::try_from("owner@example.com".to_owned())
                .unwrap(),
            provider: UserProvider::Outlook,
            is_sync_active: true,
            is_primary: true,
            needs_reauth: false,
            last_sync_error_at: None,
            created_at: now,
            updated_at: now,
        },
        message: Some(ProjectedMessage {
            message,
            in_inbox: true,
            in_trash: false,
            in_junk: false,
            is_present: true,
            thread_inbox_visible: true,
            is_signal: true,
            version: Some("v1".into()),
        }),
        viewers: HashSet::from([
            owner,
            MacroUserIdStr::try_from("macro|staff@macro.com".to_owned()).unwrap(),
        ]),
    }
}

#[test]
fn historical_imports_and_removed_messages_never_notify() {
    let mut context = context();
    let current = context.message.as_mut().unwrap();
    assert!(should_notify(false, true, current));
    assert!(!should_notify(true, true, current));
    assert!(!should_notify(false, false, current));
    current.is_present = false;
    assert!(!should_notify(false, true, current));
}

#[test]
fn sent_drafts_trash_and_macro_notifications_do_not_notify() {
    let mut context = context();
    let current = context.message.as_mut().unwrap();
    current.message.is_sent = true;
    assert!(!should_notify(false, true, current));
    current.message.is_sent = false;
    current.message.is_draft = true;
    assert!(!should_notify(false, true, current));
    current.message.is_draft = false;
    current.in_trash = true;
    assert!(!should_notify(false, true, current));
    current.in_trash = false;
    current.message.from = Some(ContactInfo {
        email: "notifications@notification.macro.com".into(),
        ..Default::default()
    });
    assert!(!should_notify(false, true, current));
}

#[test]
fn notification_retry_preserves_ids_and_staff_push_policy() {
    let context = context();
    let lease = ProjectionLease {
        id: Uuid::now_v7(),
        lease_id: Uuid::now_v7(),
        mailbox: MailboxKey {
            link_id: context.link.id,
            sync_generation: 1,
            grant_generation: 1,
        },
        event: ProjectionEvent::LinkConnected {
            actor_id: context.link.macro_id.to_string(),
            is_new: true,
        },
        from_current_generation: true,
    };
    let first = notifications(&lease, &context);
    let retry = notifications(&lease, &context);
    assert_eq!(first.len(), 2);
    assert_eq!(
        first.iter().map(|n| n.id).collect::<Vec<_>>(),
        retry.iter().map(|n| n.id).collect::<Vec<_>>()
    );
    assert!(first[0].push);
    assert!(!first[1].push);
    assert_ne!(first[0].id, first[1].id);
}

#[test]
fn user_category_keeps_its_event_type_and_publication_identity() {
    use macro_event_broker::MacroEvent;
    let context = context();
    let id = Uuid::now_v7();
    let action = crate::domain::models::mailbox_action::MailboxAction::Category {
        name: "TRASH".into(),
        present: true,
    };
    let first = organization_event(
        &context.link,
        Uuid::now_v7(),
        context.link.macro_id.clone(),
        &action,
    )
    .with_event_id(id);
    assert_eq!(first.event().event_id, id);
    assert!(matches!(
        first.event().event,
        EmailTopicEvent::ThreadLabelsUpdated(_)
    ));
}
