use super::*;
use crate::domain::service::test::{TestService, USER, configuration, service, user};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct FakeTemplates {
    templates: Mutex<HashMap<Uuid, RoutineTemplate>>,
}

impl RoutineTemplateRepo for FakeTemplates {
    async fn upsert_template(&self, snapshot: TemplateSnapshot) -> Result<RoutineTemplate> {
        let now = Utc::now();
        let template = RoutineTemplate {
            id: snapshot.action_id,
            author: Owner::User(user()),
            name: snapshot.name,
            description: snapshot.description,
            trigger: snapshot.trigger,
            task: snapshot.task,
            variables: snapshot.variables,
            active_count: 0,
            created_at: now,
            updated_at: now,
        };
        self.templates
            .lock()
            .unwrap()
            .insert(template.id, template.clone());
        Ok(template)
    }

    async fn delete_template(&self, id: &Uuid) -> Result<()> {
        self.templates.lock().unwrap().remove(id);
        Ok(())
    }

    async fn get_template(&self, id: &Uuid) -> Result<Option<RoutineTemplate>> {
        Ok(self.templates.lock().unwrap().get(id).cloned())
    }
}

type Templates = RoutineTemplateServiceImpl<TestService, FakeTemplates>;

fn templates(actions: &Arc<TestService>) -> Templates {
    RoutineTemplateServiceImpl::new(Arc::clone(actions), Arc::new(FakeTemplates::default()))
}

fn owner_receipt(user: MacroUserIdStr<'static>, id: Uuid) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user,
        &id.to_string(),
        EntityType::ScheduledAction,
    )
}

fn other_user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|activator@macro.com".to_owned()).unwrap()
}

async fn create_routine(actions: &TestService) -> Uuid {
    actions
        .create_action(
            &CreationPrincipal::User(user()),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap()
        .id
        .unwrap()
}

fn share_input() -> ShareRoutineTemplate {
    ShareRoutineTemplate {
        description: "  Summarizes the week  ".into(),
        variables: vec![TemplateVariable::User {
            id: USER.into(),
            label: "Eric".into(),
            fill: VariableFill::Activator,
        }],
    }
}

#[tokio::test]
async fn sharing_snapshots_the_routine_and_activation_points_back_at_it() {
    let actions = service(false);
    let templates = templates(&actions);
    let id = create_routine(&actions).await;

    let shared = templates
        .share_template(owner_receipt(user(), id), share_input())
        .await
        .unwrap();
    assert_eq!(shared.id, id);
    assert_eq!(shared.name, "routine");
    assert_eq!(shared.description, "Summarizes the week");
    assert_eq!(shared.task, configuration(false).task);

    let activated = templates
        .activate_template(
            &CreationPrincipal::User(other_user()),
            id,
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    assert_eq!(activated.template_id, Some(id));
    assert!(activated.owner.is_user(&other_user()));
}

#[tokio::test]
async fn only_the_owner_can_share_or_stop_sharing() {
    let actions = service(false);
    let templates = templates(&actions);
    let id = create_routine(&actions).await;

    let error = templates
        .share_template(owner_receipt(other_user(), id), share_input())
        .await
        .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<ActionPolicyError>(),
        Some(ActionPolicyError::NotFound)
    ));

    templates
        .share_template(owner_receipt(user(), id), share_input())
        .await
        .unwrap();
    let error = templates
        .unshare_template(owner_receipt(other_user(), id))
        .await
        .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<ActionPolicyError>(),
        Some(ActionPolicyError::NotFound)
    ));
    assert!(templates.get_template(id).await.is_ok());
}

#[tokio::test]
async fn activating_an_unshared_routine_creates_nothing() {
    let actions = service(false);
    let templates = templates(&actions);
    let id = create_routine(&actions).await;
    templates
        .share_template(owner_receipt(user(), id), share_input())
        .await
        .unwrap();
    templates
        .unshare_template(owner_receipt(user(), id))
        .await
        .unwrap();

    let error = templates
        .activate_template(
            &CreationPrincipal::User(other_user()),
            id,
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<ActionPolicyError>(),
        Some(ActionPolicyError::NotFound)
    ));
}

#[tokio::test]
async fn rejects_an_oversized_description() {
    let actions = service(false);
    let templates = templates(&actions);
    let id = create_routine(&actions).await;

    let error = templates
        .share_template(
            owner_receipt(user(), id),
            ShareRoutineTemplate {
                description: "a".repeat(MAX_DESCRIPTION_CHARS + 1),
                variables: vec![],
            },
        )
        .await
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<TemplateInputError>(),
        Some(&TemplateInputError::DescriptionTooLong)
    );
    assert!(templates.get_template(id).await.is_err());
}
