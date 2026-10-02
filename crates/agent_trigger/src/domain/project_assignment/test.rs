use super::*;
use channel_sender::ChannelSender;
use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, RequiredPermission,
};
use initiative::domain::events::{InitiativeEventActor, TaskMembershipChange};
use macro_user_id::user_id::MacroUserIdStr;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("assigner@example.com").unwrap()
}

fn event(changes: Vec<TaskMembershipChange>) -> InitiativeTasksChanged {
    InitiativeTasksChanged {
        attribution: Some(InitiativeEventActor {
            actor: ChannelSender::new_from_user(user()),
            on_behalf_of: None,
        }),
        changes,
        occurred_at: Utc::now(),
    }
}

fn receipt<T: RequiredPermission>(id: String, entity_type: EntityType) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: id,
            entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn allowed_receipts(
    _: &InitiativeEventActor,
    project: InitiativeId,
    task: &str,
) -> std::pin::Pin<
    Box<dyn Future<Output = Result<Option<(ViewReceipt, EditReceipt)>, AccessError>> + Send>,
> {
    let receipts = (
        receipt(project.to_string(), EntityType::Initiative),
        receipt(task.to_owned(), EntityType::Document),
    );
    Box::pin(async move { Ok(Some(receipts)) })
}

#[tokio::test]
async fn new_tasks_and_moves_inherit_independently_with_their_own_receipts() {
    let project = InitiativeId::generate();
    let previous = InitiativeId::generate();
    let event = event(vec![
        TaskMembershipChange {
            task_id: "new-task".into(),
            from: None,
            to: Some(project),
        },
        TaskMembershipChange {
            task_id: "moved-task".into(),
            from: Some(previous),
            to: Some(project),
        },
    ]);
    let mut memberships = MockProjectMemberships::new();
    memberships
        .expect_memberships()
        .once()
        .withf(|ids| ids == &["new-task", "moved-task"])
        .return_once(move |_| {
            Box::pin(async move {
                Ok(HashMap::from([
                    ("new-task".into(), project),
                    ("moved-task".into(), project),
                ]))
            })
        });
    let mut access = MockProjectAssignmentAccess::new();
    access
        .expect_receipts()
        .times(2)
        .withf(move |actor, id, _| actor.actor.as_user() == Some(&user()) && *id == project)
        .returning(allowed_receipts);
    let mut properties = MockProjectAgentInheritance::new();
    properties
        .expect_inherit()
        .once()
        .withf(move |source, target| {
            source.entity().entity_id == project.to_string()
                && target.entity().entity_id == "new-task"
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));
    properties
        .expect_inherit()
        .once()
        .withf(move |source, target| {
            source.entity().entity_id == project.to_string()
                && target.entity().entity_id == "moved-task"
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));
    ProjectAssignmentService::new(properties, memberships, access)
        .process(&event)
        .await
        .unwrap();
}

#[tokio::test]
async fn removals_unchanged_membership_and_unattributed_events_do_nothing() {
    let project = InitiativeId::generate();
    let service = ProjectAssignmentService::new(
        MockProjectAgentInheritance::new(),
        MockProjectMemberships::new(),
        MockProjectAssignmentAccess::new(),
    );
    let mut event = event(vec![
        TaskMembershipChange {
            task_id: "removed".into(),
            from: Some(project),
            to: None,
        },
        TaskMembershipChange {
            task_id: "unchanged".into(),
            from: Some(project),
            to: Some(project),
        },
    ]);
    service.process(&event).await.unwrap();
    event.changes[0].to = Some(InitiativeId::generate());
    event.attribution = None;
    service.process(&event).await.unwrap();
    event.attribution = Some(InitiativeEventActor {
        actor: ChannelSender::new_from_bot(bot_id::BotId::TEST_A),
        on_behalf_of: None,
    });
    service.process(&event).await.unwrap();
}

#[tokio::test]
async fn superseded_moves_and_tasks_without_membership_are_skipped() {
    let project = InitiativeId::generate();
    let event = event(vec![
        TaskMembershipChange {
            task_id: "moved-again".into(),
            from: None,
            to: Some(project),
        },
        TaskMembershipChange {
            task_id: "unassigned".into(),
            from: None,
            to: Some(project),
        },
    ]);
    let mut memberships = MockProjectMemberships::new();
    memberships.expect_memberships().once().return_once(|_| {
        Box::pin(async {
            Ok(HashMap::from([(
                "moved-again".into(),
                InitiativeId::generate(),
            )]))
        })
    });
    ProjectAssignmentService::new(
        MockProjectAgentInheritance::new(),
        memberships,
        MockProjectAssignmentAccess::new(),
    )
    .process(&event)
    .await
    .unwrap();
}

#[tokio::test]
async fn revoked_access_skips_only_the_affected_task() {
    let project = InitiativeId::generate();
    let event = event(vec![
        TaskMembershipChange {
            task_id: "revoked".into(),
            from: None,
            to: Some(project),
        },
        TaskMembershipChange {
            task_id: "allowed".into(),
            from: None,
            to: Some(project),
        },
    ]);
    let mut memberships = MockProjectMemberships::new();
    memberships
        .expect_memberships()
        .once()
        .return_once(move |_| {
            Box::pin(async move {
                Ok(HashMap::from([
                    ("revoked".into(), project),
                    ("allowed".into(), project),
                ]))
            })
        });
    let mut access = MockProjectAssignmentAccess::new();
    access
        .expect_receipts()
        .once()
        .withf(|_, _, task| task == "revoked")
        .returning(|_, _, _| Box::pin(async { Ok(None) }));
    access
        .expect_receipts()
        .once()
        .withf(|_, _, task| task == "allowed")
        .returning(allowed_receipts);
    let mut properties = MockProjectAgentInheritance::new();
    properties
        .expect_inherit()
        .once()
        .withf(|_, task| task.entity().entity_id == "allowed")
        .returning(|_, _| Box::pin(async { Ok(()) }));
    ProjectAssignmentService::new(properties, memberships, access)
        .process(&event)
        .await
        .unwrap();
}

#[tokio::test]
async fn delegated_changes_recheck_the_delegating_users_access() {
    let project = InitiativeId::generate();
    let mut event = event(vec![TaskMembershipChange {
        task_id: "task".into(),
        from: None,
        to: Some(project),
    }]);
    event.attribution = Some(InitiativeEventActor {
        actor: ChannelSender::new_from_bot(bot_id::BotId::TEST_A),
        on_behalf_of: Some(user()),
    });
    let mut memberships = MockProjectMemberships::new();
    memberships
        .expect_memberships()
        .once()
        .return_once(move |_| {
            Box::pin(async move { Ok(HashMap::from([("task".into(), project)])) })
        });
    let mut access = MockProjectAssignmentAccess::new();
    access
        .expect_receipts()
        .once()
        .withf(|actor, _, _| actor.on_behalf_of.as_ref() == Some(&user()))
        .returning(allowed_receipts);
    let mut properties = MockProjectAgentInheritance::new();
    properties
        .expect_inherit()
        .once()
        .returning(|_, _| Box::pin(async { Ok(()) }));
    ProjectAssignmentService::new(properties, memberships, access)
        .process(&event)
        .await
        .unwrap();
}

#[tokio::test]
async fn inheritance_failure_is_propagated_for_retry() {
    let project = InitiativeId::generate();
    let event = event(vec![TaskMembershipChange {
        task_id: "task".into(),
        from: None,
        to: Some(project),
    }]);
    let mut memberships = MockProjectMemberships::new();
    memberships
        .expect_memberships()
        .once()
        .return_once(move |_| {
            Box::pin(async move { Ok(HashMap::from([("task".into(), project)])) })
        });
    let mut access = MockProjectAssignmentAccess::new();
    access.expect_receipts().once().returning(allowed_receipts);
    let mut properties = MockProjectAgentInheritance::new();
    properties.expect_inherit().once().returning(|_, _| {
        Box::pin(async { Err(PropertiesErr::Repo(anyhow::anyhow!("database unavailable"))) })
    });
    assert!(matches!(
        ProjectAssignmentService::new(properties, memberships, access)
            .process(&event)
            .await,
        Err(ProjectAssignmentError::Properties(_))
    ));
}

#[tokio::test]
async fn invalid_assignment_does_not_block_later_tasks() {
    for failure in [
        PropertiesErr::Validation("invalid stored assignees".into()),
        PropertiesErr::PermissionDenied,
        PropertiesErr::NotFound,
    ] {
        let project = InitiativeId::generate();
        let event = event(vec![
            TaskMembershipChange {
                task_id: "invalid".into(),
                from: None,
                to: Some(project),
            },
            TaskMembershipChange {
                task_id: "valid".into(),
                from: None,
                to: Some(project),
            },
        ]);
        let mut memberships = MockProjectMemberships::new();
        memberships
            .expect_memberships()
            .once()
            .return_once(move |_| {
                Box::pin(async move {
                    Ok(HashMap::from([
                        ("invalid".into(), project),
                        ("valid".into(), project),
                    ]))
                })
            });
        let mut access = MockProjectAssignmentAccess::new();
        access
            .expect_receipts()
            .times(2)
            .returning(allowed_receipts);
        let mut properties = MockProjectAgentInheritance::new();
        properties
            .expect_inherit()
            .once()
            .withf(|_, task| task.entity().entity_id == "invalid")
            .return_once(move |_, _| Box::pin(async move { Err(failure) }));
        properties
            .expect_inherit()
            .once()
            .withf(|_, task| task.entity().entity_id == "valid")
            .returning(|_, _| Box::pin(async { Ok(()) }));

        ProjectAssignmentService::new(properties, memberships, access)
            .process(&event)
            .await
            .unwrap();
    }
}

#[test]
fn denied_access_is_skipped_but_broken_access_checks_are_retried() {
    assert!(
        current_access::<()>(Err(AccessError::Unauthorized))
            .unwrap()
            .is_none()
    );
    assert!(
        current_access::<()>(Err(AccessError::NotFound("unassigned")))
            .unwrap()
            .is_none()
    );
    assert!(current_access::<()>(Err(AccessError::internal("failed"))).is_err());
    assert_eq!(current_access(Ok(42)).unwrap(), Some(42));
}
