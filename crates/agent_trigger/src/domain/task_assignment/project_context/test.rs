use super::*;
use crate::domain::{
    project_assignment::{MockProjectAssignmentAccess, MockProjectMemberships},
    task_assignment::MockTaskAssignmentContext,
};
use bot_id::BotId;
use entity_access::domain::models::{
    AccessError, AccessLevel, BotReceiptScope, Entity, EntityPermission, EntityType,
    RequiredPermission,
};
use initiative::domain::models::{InitiativeBasic, InitiativeError, InitiativeId};
use macro_user_id::user_id::MacroUserIdStr;
use properties::{EditReceipt, ViewReceipt};
use std::{collections::HashMap, pin::Pin};
use trigger_context::ProjectRef;

mockall::mock! {
    Projects {}
    impl InitiativeReader for Projects {
        fn read_basic<'a>(
            &'a self,
            id: InitiativeId,
        ) -> Pin<Box<dyn Future<Output = std::result::Result<Option<InitiativeBasic>, InitiativeError>> + Send + 'a>>;
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("assigner@example.com").unwrap()
}

fn receipt<T: RequiredPermission>(id: &str, entity_type: EntityType) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: id.to_owned(),
            entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn task_access() -> EntityAccessReceipt<MessageWrite> {
    receipt("task", EntityType::Document)
}

fn bot_access(scope: BotReceiptScope) -> EntityAccessReceipt<MessageWrite> {
    EntityAccessReceipt::try_new_bot(
        BotId::TEST_A.into_storage_id(),
        scope,
        Entity {
            entity_id: "task".to_owned(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn brief() -> TaskBrief {
    TaskBrief {
        title: "Fix export".to_owned(),
        markdown: "Include archived rows.".to_owned(),
        status: Some("In Progress".to_owned()),
        priority: None,
        due: None,
        assignee_ids: vec![BotId::TEST_A.to_string()],
        project: Some(ProjectRef {
            id: InitiativeId::generate().as_uuid(),
            name: "Stale project".to_owned(),
        }),
    }
}

fn tasks(value: Option<TaskBrief>) -> MockTaskAssignmentContext {
    let mut tasks = MockTaskAssignmentContext::new();
    tasks
        .expect_task_brief()
        .once()
        .withf(|access| access.entity().entity_id == "task")
        .return_once(move |_| Box::pin(async move { Ok(value) }));
    tasks
}

fn membership(project: Option<InitiativeId>) -> MockProjectMemberships {
    let mut memberships = MockProjectMemberships::new();
    memberships
        .expect_memberships()
        .once()
        .withf(|ids| ids == &["task"])
        .return_once(move |_| {
            Box::pin(async move {
                Ok(project
                    .map(|id| HashMap::from([("task".to_owned(), id)]))
                    .unwrap_or_default())
            })
        });
    memberships
}

fn allowed(
    _: &InitiativeEventActor,
    project: InitiativeId,
    task: &str,
) -> std::pin::Pin<
    Box<
        dyn Future<Output = std::result::Result<Option<(ViewReceipt, EditReceipt)>, AccessError>>
            + Send,
    >,
> {
    let result = (
        receipt(&project.to_string(), EntityType::Initiative),
        receipt(task, EntityType::Document),
    );
    Box::pin(async move { Ok(Some(result)) })
}

fn named(project: InitiativeId, name: &'static str) -> MockProjects {
    let mut projects = MockProjects::new();
    projects
        .expect_read_basic()
        .once()
        .withf(move |id| *id == project)
        .return_once(move |id| {
            Box::pin(async move {
                Ok(Some(InitiativeBasic {
                    id,
                    name: name.to_owned(),
                    owner_id: user(),
                }))
            })
        });
    projects
}

#[tokio::test]
async fn current_project_replaces_stale_context_after_authorizing_the_same_user() {
    let project = InitiativeId::generate();
    let original = brief();
    let mut access = MockProjectAssignmentAccess::new();
    access
        .expect_receipts()
        .once()
        .withf(move |actor, id, task| {
            actor.actor.as_user() == Some(&user())
                && actor.on_behalf_of.is_none()
                && *id == project
                && task == "task"
        })
        .returning(allowed);
    let result = ProjectTaskAssignmentContext::new(
        tasks(Some(original)),
        membership(Some(project)),
        access,
        named(project, "Exports"),
    )
    .task_brief(task_access())
    .await
    .unwrap();
    assert_eq!(
        result,
        Some(TaskBrief {
            title: "Fix export".to_owned(),
            markdown: "Include archived rows.".to_owned(),
            status: Some("In Progress".to_owned()),
            priority: None,
            due: None,
            assignee_ids: vec![BotId::TEST_A.to_string()],
            project: Some(ProjectRef {
                id: project.as_uuid(),
                name: "Exports".to_owned(),
            }),
        })
    );
}

#[tokio::test]
async fn delegated_bot_keeps_its_identity_and_acting_user_for_project_access() {
    let project = InitiativeId::generate();
    let mut access = MockProjectAssignmentAccess::new();
    access
        .expect_receipts()
        .once()
        .withf(|actor, _, _| {
            actor.actor.as_bot().map(|id| id.bot_id()) == Some(BotId::TEST_A)
                && actor.on_behalf_of.as_ref() == Some(&user())
        })
        .returning(allowed);
    let result = ProjectTaskAssignmentContext::new(
        tasks(Some(brief())),
        membership(Some(project)),
        access,
        named(project, "Exports"),
    )
    .task_brief(bot_access(BotReceiptScope::User {
        acting_user: user(),
    }))
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        result.project,
        Some(ProjectRef {
            id: project.as_uuid(),
            name: "Exports".to_owned(),
        })
    );
}

#[tokio::test]
async fn no_project_or_revoked_access_removes_stale_project_context() {
    for project in [None, Some(InitiativeId::generate())] {
        let mut access = MockProjectAssignmentAccess::new();
        if project.is_some() {
            access
                .expect_receipts()
                .once()
                .returning(|_, _, _| Box::pin(async { Ok(None) }));
        }
        let result = ProjectTaskAssignmentContext::new(
            tasks(Some(brief())),
            membership(project),
            access,
            MockProjects::new(),
        )
        .task_brief(task_access())
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.project, None);
    }
}

#[tokio::test]
async fn missing_tasks_do_not_read_project_membership() {
    let result = ProjectTaskAssignmentContext::new(
        tasks(None),
        MockProjectMemberships::new(),
        MockProjectAssignmentAccess::new(),
        MockProjects::new(),
    )
    .task_brief(task_access())
    .await
    .unwrap();
    assert!(result.is_none());
}

#[tokio::test]
async fn receipts_without_an_acting_user_do_not_expose_project_context() {
    let internal =
        EntityAccessReceipt::dangerously_assert_internal_user("task", EntityType::Document);
    let team_bot = bot_access(BotReceiptScope::Team {
        team_id: macro_uuid::Uuid::now_v7(),
    });
    for receipt in [internal, team_bot] {
        let result = ProjectTaskAssignmentContext::new(
            tasks(Some(brief())),
            MockProjectMemberships::new(),
            MockProjectAssignmentAccess::new(),
            MockProjects::new(),
        )
        .task_brief(receipt)
        .await
        .unwrap()
        .unwrap();
        assert_eq!(result.project, None);
    }
}

#[tokio::test]
async fn project_membership_and_access_failures_are_retried() {
    let mut memberships = MockProjectMemberships::new();
    memberships.expect_memberships().once().returning(|_| {
        Box::pin(async {
            Err(InitiativeError::Internal(
                std::io::Error::other("database unavailable").into(),
            ))
        })
    });
    let result = ProjectTaskAssignmentContext::new(
        tasks(Some(brief())),
        memberships,
        MockProjectAssignmentAccess::new(),
        MockProjects::new(),
    )
    .task_brief(task_access())
    .await;
    assert!(matches!(result, Err(AgentSessionError::Unknown(_))));

    let mut access = MockProjectAssignmentAccess::new();
    access.expect_receipts().once().returning(|_, _, _| {
        Box::pin(async {
            Err(AccessError::Unavailable(
                std::io::Error::other("access unavailable").into(),
            ))
        })
    });
    let result = ProjectTaskAssignmentContext::new(
        tasks(Some(brief())),
        membership(Some(InitiativeId::generate())),
        access,
        MockProjects::new(),
    )
    .task_brief(task_access())
    .await;
    assert!(matches!(result, Err(AgentSessionError::Unknown(_))));

    let project = InitiativeId::generate();
    let mut access = MockProjectAssignmentAccess::new();
    access.expect_receipts().once().returning(allowed);
    let mut projects = MockProjects::new();
    projects.expect_read_basic().once().return_once(|_| {
        Box::pin(async {
            Err(InitiativeError::Internal(
                std::io::Error::other("database unavailable").into(),
            ))
        })
    });
    let result = ProjectTaskAssignmentContext::new(
        tasks(Some(brief())),
        membership(Some(project)),
        access,
        projects,
    )
    .task_brief(task_access())
    .await;
    assert!(matches!(result, Err(AgentSessionError::Unknown(_))));
}

#[tokio::test]
async fn a_deleted_project_is_not_named() {
    let project = InitiativeId::generate();
    let mut access = MockProjectAssignmentAccess::new();
    access.expect_receipts().once().returning(allowed);
    let mut projects = MockProjects::new();
    projects
        .expect_read_basic()
        .once()
        .withf(move |id| *id == project)
        .return_once(|_| Box::pin(async { Ok(None) }));
    let result = ProjectTaskAssignmentContext::new(
        tasks(Some(brief())),
        membership(Some(project)),
        access,
        projects,
    )
    .task_brief(task_access())
    .await
    .unwrap()
    .unwrap();
    assert_eq!(result.project, None);
}
