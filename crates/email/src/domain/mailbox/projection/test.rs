use super::*;
use crate::domain::mailbox::{DatabaseFailure, EffectFailure};
use crate::domain::models::error::LOCK_NOT_AVAILABLE;
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
        attempts: 1,
        unfinished_claims: 0,
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

#[tokio::test]
async fn persisted_projection_restores_invocation_when_publishing_later() {
    use macro_event_broker::MacroEvent;
    let context = context();
    let id = Uuid::now_v7();
    let event: ProjectionEvent = serde_json::from_value(serde_json::json!({
        "kind": "organization", "thread_id": Uuid::now_v7(),
        "agent_correlation_id": id,
    }))
    .unwrap();
    let persisted = serde_json::to_vec(&event).unwrap();
    let restored: ProjectionEvent = serde_json::from_slice(&persisted).unwrap();
    let published = agent_correlation::context::scope(restored.agent_correlation_id(), async {
        organization_event(
            &context.link,
            Uuid::now_v7(),
            context.link.macro_id.clone(),
            &crate::domain::models::mailbox_action::MailboxAction::Category {
                name: "TRASH".into(),
                present: true,
            },
        )
    })
    .await;
    assert_eq!(published.event().agent_correlation_id, Some(id));
    let legacy: ProjectionEvent = serde_json::from_value(
        serde_json::json!({"kind": "organization", "thread_id": Uuid::now_v7()}),
    )
    .unwrap();
    assert_eq!(legacy.agent_correlation_id(), None);
}

#[test]
fn refused_attachments_stop_sooner_and_worker_failures_never_count() {
    let gone = MailboxError::Provider(EmailApiError::NotFound);
    assert_eq!(attachment_failure_limit(&gone), Some(3));

    let upload = MailboxError::Effect(EffectFailure::AttachmentUpload {
        attachment_id: Uuid::nil(),
    });
    assert_eq!(attachment_failure_limit(&upload), Some(50));

    let lock_timeout = MailboxError::database(DatabaseFailure::Sqlstate(LOCK_NOT_AVAILABLE.into()));
    for error in [lock_timeout, MailboxError::Stale] {
        assert_eq!(attachment_failure_limit(&error), None);
    }
}

/// Serves one event and records what projecting it publishes.
struct OneEvent {
    event: std::sync::Mutex<Option<ProjectionEvent>>,
    context: std::sync::Mutex<Option<ProjectionContext>>,
    current_generation: bool,
}

impl MailboxProjectionRepository for OneEvent {
    async fn renew_projection(&self, _: &ProjectionLease) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn claim_projection(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<ProjectionLease>, MailboxError> {
        Ok(self
            .event
            .lock()
            .unwrap()
            .take()
            .map(|event| ProjectionLease {
                id: Uuid::now_v7(),
                lease_id,
                mailbox: MailboxKey {
                    link_id: Uuid::nil(),
                    sync_generation: 1,
                    grant_generation: 1,
                },
                event,
                from_current_generation: self.current_generation,
                attempts: 1,
                unfinished_claims: 0,
            }))
    }
    async fn projection_context(
        &self,
        _: &ProjectionLease,
    ) -> Result<Option<ProjectionContext>, MailboxError> {
        Ok(self.context.lock().unwrap().take())
    }
    async fn finish_projection(
        &self,
        _: &ProjectionLease,
        retry: Option<MessageRetry>,
    ) -> Result<(), MailboxError> {
        assert!(retry.is_none());
        Ok(())
    }
}

#[derive(Default, Clone)]
struct Published(std::sync::Arc<std::sync::Mutex<Vec<macro_event_broker::Event<EmailTopicEvent>>>>);

impl MailboxProjectionEffects for Published {
    async fn publish(&self, event: EmailMacroEvent) -> Result<(), MailboxError> {
        use macro_event_broker::MacroEvent;
        self.0.lock().unwrap().push(event.event().clone());
        Ok(())
    }
    async fn refresh(
        &self,
        _: Uuid,
        _: &HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn notify(&self, _: MailboxNotification) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn contacts(&self, _: CorrespondenceProjection) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn attachments(
        &self,
        _: MailboxKey,
        _: &ProjectionContext,
        _: bool,
    ) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn invitations(&self, _: Uuid, _: &[CalendarInvitation]) -> Result<(), MailboxError> {
        Ok(())
    }
}

/// The events that report labels a thread gained, and those labels.
async fn gains(
    event: serde_json::Value,
    context: ProjectionContext,
    current_generation: bool,
) -> Vec<(macro_event_broker::Event<EmailTopicEvent>, Vec<Uuid>)> {
    let published = Published::default();
    let repository = OneEvent {
        event: std::sync::Mutex::new(Some(serde_json::from_value(event).unwrap())),
        context: std::sync::Mutex::new(Some(context)),
        current_generation,
    };
    MailboxProjectionService::new(repository, published.clone())
        .project_once()
        .await
        .unwrap();
    let events = published.0.lock().unwrap().clone();
    events
        .into_iter()
        .filter_map(|event| {
            let gained = match &event.event {
                EmailTopicEvent::MessageReceived(metadata) => metadata.labels_gained.clone(),
                EmailTopicEvent::ThreadLabelsUpdated(metadata) => metadata.labels_gained.clone(),
                _ => Vec::new(),
            };
            (!gained.is_empty()).then_some((event, gained))
        })
        .collect()
}

fn gained(event_id: Uuid, automated: bool) -> serde_json::Value {
    serde_json::json!({
        "event_id": event_id, "label_ids": [Uuid::from_u128(9)],
        "message_id": null, "automated": automated,
    })
}

fn message_event(
    is_import: bool,
    is_new: bool,
    labels_gained: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "message", "message_id": Uuid::now_v7(), "thread_id": Uuid::now_v7(),
        "provider_id": "message", "is_import": is_import, "is_new": is_new, "was_draft": false,
        "is_draft": false, "is_sent": false, "calendar_parts": [], "labels_gained": labels_gained,
    })
}

#[tokio::test]
async fn arriving_mail_reports_its_categories_on_its_received_event() {
    let reported = gains(
        message_event(false, true, gained(Uuid::now_v7(), false)),
        context(),
        true,
    )
    .await;
    assert_eq!(reported.len(), 1);
    assert!(matches!(
        reported[0].0.event,
        EmailTopicEvent::MessageReceived(_)
    ));
    assert_eq!(reported[0].1, [Uuid::from_u128(9)]);
}

#[tokio::test]
async fn sent_mail_reports_its_categories_on_a_label_event_and_spam_reports_none() {
    let mut sent = context();
    sent.message.as_mut().unwrap().message.is_sent = true;
    let id = Uuid::now_v7();
    let reported = gains(message_event(false, true, gained(id, false)), sent, true).await;
    assert_eq!(reported.len(), 1);
    assert_eq!(reported[0].0.event_id, id);
    assert!(matches!(
        reported[0].0.event,
        EmailTopicEvent::ThreadLabelsUpdated(_)
    ));

    let mut junk = context();
    junk.message.as_mut().unwrap().in_junk = true;
    let reported = gains(
        message_event(false, true, gained(Uuid::now_v7(), false)),
        junk,
        true,
    )
    .await;
    assert!(reported.is_empty());
}

#[tokio::test]
async fn a_stored_message_reports_its_new_categories_under_their_own_id() {
    let id = Uuid::now_v7();
    let reported = gains(
        message_event(false, false, gained(id, false)),
        context(),
        true,
    )
    .await;
    assert_eq!(reported.len(), 1);
    assert_eq!(reported[0].0.event_id, id);
    let EmailTopicEvent::ThreadLabelsUpdated(metadata) = &reported[0].0.event else {
        unreachable!()
    };
    assert_eq!(metadata.origin, EmailEventOrigin::ProviderSync);
    assert!(!metadata.automated);
}

#[tokio::test]
async fn imports_and_older_generations_report_no_categories() {
    for (case, event, current) in [
        (
            "import",
            message_event(true, true, gained(Uuid::now_v7(), false)),
            true,
        ),
        (
            "older generation",
            message_event(false, false, gained(Uuid::now_v7(), false)),
            false,
        ),
        (
            "nothing gained",
            message_event(false, false, serde_json::Value::Null),
            true,
        ),
    ] {
        assert!(gains(event, context(), current).await.is_empty(), "{case}");
    }
}

#[tokio::test]
async fn a_category_written_in_macro_keeps_who_wrote_it() {
    let routine = Uuid::now_v7();
    let event = serde_json::json!({
        "kind": "organization", "thread_id": Uuid::now_v7(), "actor": "macro|owner@example.com",
        "action": {"kind": "category", "value": {"name": "Finance", "present": true}},
        "routine_id": routine, "labels_gained": gained(Uuid::now_v7(), true),
    });
    let reported = gains(event, context(), true).await;
    assert_eq!(reported.len(), 1);
    assert_eq!(reported[0].0.routine_id, Some(routine));
    let EmailTopicEvent::ThreadLabelsUpdated(metadata) = &reported[0].0.event else {
        unreachable!()
    };
    assert!(metadata.automated);
    assert_eq!(metadata.origin, EmailEventOrigin::UserAction);
}
