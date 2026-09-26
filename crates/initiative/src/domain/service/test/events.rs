use super::*;
use crate::domain::events::{
    AssignedTasks, InitiativeEventPublisher, InitiativeMacroEvent, InitiativeTopicEvent,
    TaskMembershipChange,
};
use macro_event_broker::MacroEvent;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct Events(Mutex<Vec<InitiativeTopicEvent>>);

#[cfg(feature = "toolset")]
#[tokio::test]
async fn attributed_creation_preserves_the_bot_and_delegating_owner() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    repo.expect_create()
        .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));
    let mut documents = MockInitiativeDescriptionDocuments::new();
    documents
        .expect_create()
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    let events = Arc::new(Events::default());
    let attribution = activity::Attribution::delegated(
        activity::Actor::new_from_bot(bot_id::MACRO_AI_BOT_ID),
        user(OWNER),
    );
    service_with_documents(repo, documents)
        .with_event_publisher(events.clone())
        .create_attributed(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                ..Default::default()
            },
            attribution.clone(),
        )
        .await
        .unwrap();
    let recorded = events.0.lock().unwrap();
    let [InitiativeTopicEvent::Created(change)] = recorded.as_slice() else {
        panic!("one attributed creation")
    };
    assert_eq!(change.attribution, Some(attribution.into()));
}

#[cfg(feature = "toolset")]
#[tokio::test]
async fn attributed_creation_rejects_mismatched_owner_before_creating_anything() {
    for attribution in [
        activity::Attribution::direct(activity::Actor::new_from_user(user(OTHER))),
        activity::Attribution::delegated(
            activity::Actor::new_from_bot(bot_id::MACRO_AI_BOT_ID),
            user(OTHER),
        ),
        activity::Attribution::delegated(activity::Actor::new_from_user(user(OWNER)), user(OWNER)),
    ] {
        let result = service(MockInitiativeRepo::new())
            .create_attributed(
                &user(OWNER),
                CreateInitiativeRequest {
                    name: "Launch".into(),
                    ..Default::default()
                },
                attribution,
            )
            .await;
        assert!(matches!(result, Err(InitiativeError::Unauthorized)));
    }
}

impl InitiativeEventPublisher for Events {
    fn publish(
        &self,
        event: InitiativeMacroEvent,
    ) -> Pin<Box<dyn Future<Output = Result<(), InitiativeError>> + Send + '_>> {
        Box::pin(async move {
            self.0.lock().unwrap().push(event.event().event.clone());
            Ok(())
        })
    }
}

#[tokio::test]
async fn assignment_publishes_only_committed_membership_changes() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_assign_tasks().times(1).return_once(|id, _| {
        Box::pin(async move {
            Ok(AssignedTasks {
                results: vec![AssignTasksResult {
                    task_id: "task-1".into(),
                    status: AssignTaskStatus::Assigned,
                }],
                changes: vec![TaskMembershipChange {
                    task_id: "task-1".into(),
                    from: None,
                    to: Some(id),
                }],
            })
        })
    });
    let events = Arc::new(Events::default());
    let svc = service(repo).with_event_publisher(events.clone());
    svc.assign_tasks(edit_receipt(), vec![assignment("task-1")])
        .await
        .unwrap();
    let events = events.0.lock().unwrap();
    let [InitiativeTopicEvent::TasksChanged(change)] = events.as_slice() else {
        panic!("expected one committed membership event")
    };
    assert_eq!(change.changes[0].task_id, "task-1");
    assert!(change.attribution.is_some());
}

#[tokio::test]
async fn repeated_assignment_has_no_activity() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_assign_tasks()
        .times(1)
        .return_once(|_, _| Box::pin(async { Ok(AssignedTasks::default()) }));
    let events = Arc::new(Events::default());
    service(repo)
        .with_event_publisher(events.clone())
        .assign_tasks(edit_receipt(), vec![assignment("task-1")])
        .await
        .unwrap();
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn committed_deletion_purges_activity_even_when_description_cleanup_fails() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_delete()
        .times(1)
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    let mut documents = MockInitiativeDescriptionDocuments::new();
    documents.expect_purge().times(1).return_once(|_| {
        Box::pin(async {
            Err(InitiativeError::Internal(rootcause::report!(
                "storage unavailable"
            )))
        })
    });
    let events = Arc::new(Events::default());
    let result = service_with_documents(repo, documents)
        .with_event_publisher(events.clone())
        .delete(owner_receipt())
        .await;
    assert!(result.is_err());
    assert!(matches!(
        events.0.lock().unwrap().as_slice(),
        [InitiativeTopicEvent::Purged { .. }]
    ));
}
