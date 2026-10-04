use super::*;
use channel_sender::ChannelSender;
use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, RequiredPermission,
};
use initiative::domain::events::InitiativeEventActor;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use models_properties::shared::EntityReference;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("assigner@example.com").unwrap()
}

fn project_value(project: Option<InitiativeId>) -> Option<PropertyValue> {
    project.map(|project| {
        PropertyValue::EntityRef(vec![EntityReference {
            entity_id: project.to_string(),
            entity_type: PropertyEntityType::Initiative,
            specific_message_id: None,
        }])
    })
}

fn update(
    previous: Option<InitiativeId>,
    project: Option<InitiativeId>,
) -> EntityPropertyUpdatedMetadata {
    EntityPropertyUpdatedMetadata {
        entity_property_id: Uuid::now_v7(),
        entity_id: "task".to_owned(),
        entity_type: PropertyEntityType::Task,
        property_definition_id: SystemPropertyKey::PROJECT_UUID,
        actor_user_id: Some(user()),
        actor: None,
        on_behalf_of: None,
        value: project_value(project),
        previous_value: project_value(previous),
        updated_at: Utc::now(),
    }
}

fn added(project: InitiativeId) -> ProjectTaskAdded {
    ProjectTaskAdded::from_update(&update(None, Some(project))).unwrap()
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

fn current_membership(project: Option<InitiativeId>) -> MockProjectMemberships {
    let mut memberships = MockProjectMemberships::new();
    memberships
        .expect_memberships()
        .once()
        .withf(|ids| ids == &["task"])
        .return_once(move |_| {
            Box::pin(async move {
                Ok(project
                    .map(|project| HashMap::from([("task".to_owned(), project)]))
                    .unwrap_or_default())
            })
        });
    memberships
}

#[test]
fn additions_and_moves_are_read_from_project_updates() {
    let project = InitiativeId::generate();
    let previous = InitiativeId::generate();

    let joined = ProjectTaskAdded::from_update(&update(None, Some(project))).unwrap();
    assert_eq!(joined.task_id, "task");
    assert_eq!(joined.project_id, project);
    assert_eq!(joined.actor.actor.as_user(), Some(&user()));
    assert_eq!(joined.actor.on_behalf_of, None);
    assert_eq!(
        ProjectTaskAdded::from_update(&update(Some(previous), Some(project)))
            .unwrap()
            .project_id,
        project
    );

    let mut delegated = update(None, Some(project));
    delegated.actor_user_id = None;
    delegated.actor = Some(ChannelSender::new_from_bot(bot_id::BotId::TEST_A));
    delegated.on_behalf_of = Some(user());
    let delegated = ProjectTaskAdded::from_update(&delegated).unwrap();
    assert!(delegated.actor.actor.as_bot().is_some());
    assert_eq!(delegated.actor.on_behalf_of, Some(user()));
}

#[test]
fn removals_unchanged_saves_other_properties_and_unattributed_writes_are_ignored() {
    let project = InitiativeId::generate();
    assert!(ProjectTaskAdded::from_update(&update(Some(project), None)).is_none());
    assert!(ProjectTaskAdded::from_update(&update(Some(project), Some(project))).is_none());

    let mut other_property = update(None, Some(project));
    other_property.property_definition_id = SystemPropertyKey::ASSIGNEES_UUID;
    assert!(ProjectTaskAdded::from_update(&other_property).is_none());

    let mut not_a_task = update(None, Some(project));
    not_a_task.entity_type = PropertyEntityType::Document;
    assert!(ProjectTaskAdded::from_update(&not_a_task).is_none());

    let mut unattributed = update(None, Some(project));
    unattributed.actor_user_id = None;
    assert!(ProjectTaskAdded::from_update(&unattributed).is_none());
}

#[tokio::test]
async fn an_addition_inherits_with_its_own_receipts() {
    let project = InitiativeId::generate();
    let mut access = MockProjectAssignmentAccess::new();
    access
        .expect_receipts()
        .once()
        .withf(move |actor, id, task| {
            actor.actor.as_user() == Some(&user()) && *id == project && task == "task"
        })
        .returning(allowed_receipts);
    let mut properties = MockProjectAgentInheritance::new();
    properties
        .expect_inherit()
        .once()
        .withf(move |source, target| {
            source.entity().entity_id == project.to_string() && target.entity().entity_id == "task"
        })
        .returning(|_, _| Box::pin(async { Ok(()) }));
    ProjectAssignmentService::new(properties, current_membership(Some(project)), access)
        .process(&added(project))
        .await
        .unwrap();
}

#[tokio::test]
async fn superseded_additions_are_skipped() {
    let project = InitiativeId::generate();
    for current in [Some(InitiativeId::generate()), None] {
        ProjectAssignmentService::new(
            MockProjectAgentInheritance::new(),
            current_membership(current),
            MockProjectAssignmentAccess::new(),
        )
        .process(&added(project))
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn revoked_access_skips_the_task() {
    let project = InitiativeId::generate();
    let mut access = MockProjectAssignmentAccess::new();
    access
        .expect_receipts()
        .once()
        .returning(|_, _, _| Box::pin(async { Ok(None) }));
    ProjectAssignmentService::new(
        MockProjectAgentInheritance::new(),
        current_membership(Some(project)),
        access,
    )
    .process(&added(project))
    .await
    .unwrap();
}

#[tokio::test]
async fn bots_without_a_delegating_user_do_nothing() {
    let project = InitiativeId::generate();
    let mut addition = added(project);
    addition.actor = InitiativeEventActor {
        actor: ChannelSender::new_from_bot(bot_id::BotId::TEST_A),
        on_behalf_of: None,
    };
    ProjectAssignmentService::new(
        MockProjectAgentInheritance::new(),
        MockProjectMemberships::new(),
        MockProjectAssignmentAccess::new(),
    )
    .process(&addition)
    .await
    .unwrap();
}

#[tokio::test]
async fn delegated_additions_recheck_the_delegating_users_access() {
    let project = InitiativeId::generate();
    let mut addition = added(project);
    addition.actor = InitiativeEventActor {
        actor: ChannelSender::new_from_bot(bot_id::BotId::TEST_A),
        on_behalf_of: Some(user()),
    };
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
    ProjectAssignmentService::new(properties, current_membership(Some(project)), access)
        .process(&addition)
        .await
        .unwrap();
}

#[tokio::test]
async fn inheritance_failure_is_propagated_for_retry() {
    let project = InitiativeId::generate();
    let mut access = MockProjectAssignmentAccess::new();
    access.expect_receipts().once().returning(allowed_receipts);
    let mut properties = MockProjectAgentInheritance::new();
    properties.expect_inherit().once().returning(|_, _| {
        Box::pin(async { Err(PropertiesErr::Repo(anyhow::anyhow!("database unavailable"))) })
    });
    assert!(matches!(
        ProjectAssignmentService::new(properties, current_membership(Some(project)), access)
            .process(&added(project))
            .await,
        Err(ProjectAssignmentError::Properties(_))
    ));
}

#[tokio::test]
async fn invalid_assignments_are_skipped_instead_of_retried() {
    for failure in [
        PropertiesErr::Validation("invalid stored assignees".into()),
        PropertiesErr::PermissionDenied,
        PropertiesErr::NotFound,
    ] {
        let project = InitiativeId::generate();
        let mut access = MockProjectAssignmentAccess::new();
        access.expect_receipts().once().returning(allowed_receipts);
        let mut properties = MockProjectAgentInheritance::new();
        properties
            .expect_inherit()
            .once()
            .return_once(move |_, _| Box::pin(async move { Err(failure) }));
        ProjectAssignmentService::new(properties, current_membership(Some(project)), access)
            .process(&added(project))
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
