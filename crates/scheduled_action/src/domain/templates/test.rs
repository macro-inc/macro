use super::*;
use crate::domain::service::test::{
    TestService, USER, configuration, service, stored_actions, user,
};
use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};
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

type Templates = RoutineTemplateServiceImpl<TestService, FakeTemplates, FakeFeatureFlags>;

fn templates(actions: &Arc<TestService>) -> Templates {
    let mut flags = FakeFeatureFlags::default();
    for viewer in [user(), other_user()] {
        flags.set(
            viewer,
            Ok(FlagSnapshot::new([(
                ROUTINE_SHARING_FLAG.to_owned(),
                FlagValue::Boolean(true),
            )])),
        );
    }
    RoutineTemplateServiceImpl::new(
        Arc::clone(actions),
        Arc::new(FakeTemplates::default()),
        Some(flags),
    )
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
    assert_eq!(
        templates.get_template(&other_user(), id).await.unwrap().id,
        id
    );

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
    assert!(templates.get_template(&user(), id).await.is_ok());
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
    assert!(templates.get_template(&user(), id).await.is_err());
}

#[tokio::test]
async fn disabled_missing_or_failed_flags_block_templates_but_preserve_routines_and_unsharing() {
    for evaluation in [
        None,
        Some(Ok(FlagSnapshot::default())),
        Some(Ok(FlagSnapshot::new([(
            ROUTINE_SHARING_FLAG.to_owned(),
            FlagValue::Boolean(false),
        )]))),
        Some(Err("PostHog unavailable".to_owned())),
    ] {
        let actions = service(false);
        let mut templates = templates(&actions);
        let id = create_routine(&actions).await;
        let shared = templates
            .share_template(owner_receipt(user(), id), share_input())
            .await
            .unwrap();
        let activated = templates
            .activate_template(
                &CreationPrincipal::User(other_user()),
                id,
                CreateScheduledAction::Canonical(configuration(false)),
            )
            .await
            .unwrap();

        templates.flags = evaluation.map(|result| {
            let mut flags = FakeFeatureFlags::default();
            flags.set(user(), result.clone());
            flags.set(other_user(), result);
            flags
        });
        let mut replacement = share_input();
        replacement.description = "Must not publish".to_owned();
        let errors = [
            templates
                .share_template(owner_receipt(user(), id), replacement)
                .await
                .unwrap_err(),
            templates.get_template(&other_user(), id).await.unwrap_err(),
            templates
                .activate_template(
                    &CreationPrincipal::User(other_user()),
                    id,
                    CreateScheduledAction::Canonical(configuration(false)),
                )
                .await
                .unwrap_err(),
        ];
        for error in errors {
            assert!(matches!(
                error.downcast_ref::<ActionPolicyError>(),
                Some(ActionPolicyError::NotFound)
            ));
        }
        assert_eq!(
            templates
                .templates
                .get_template(&id)
                .await
                .unwrap()
                .unwrap()
                .description,
            shared.description
        );
        let copies: Vec<_> = stored_actions(&actions)
            .into_iter()
            .filter(|action| action.owner.is_user(&other_user()))
            .collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(copies[0].id, activated.id);
        assert_eq!(copies[0].enabled, activated.enabled);
        assert!(actions.get_action(id).await.is_ok());

        templates
            .unshare_template(owner_receipt(user(), id))
            .await
            .unwrap();
        assert!(
            templates
                .templates
                .get_template(&id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(actions.get_action(activated.id.unwrap()).await.is_ok());
    }
}

#[tokio::test]
async fn templates_use_the_viewer_and_activating_users_rollout() {
    let actions = service(false);
    let mut templates = templates(&actions);
    let id = create_routine(&actions).await;
    templates
        .share_template(owner_receipt(user(), id), share_input())
        .await
        .unwrap();
    templates
        .flags
        .as_mut()
        .unwrap()
        .set(other_user(), Ok(FlagSnapshot::default()));

    assert!(templates.get_template(&user(), id).await.is_ok());
    assert!(templates.get_template(&other_user(), id).await.is_err());
    assert!(
        templates
            .activate_template(
                &CreationPrincipal::BotForUser {
                    bot: bot_id::BotId::TEST_A,
                    user: other_user()
                },
                id,
                CreateScheduledAction::Canonical(configuration(false)),
            )
            .await
            .is_err()
    );
    let stored = stored_actions(&actions);
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].id, Some(id));
}
