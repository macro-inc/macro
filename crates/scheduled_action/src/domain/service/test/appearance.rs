use super::*;
use activity::Action;
use model_entity::AppearanceColor;

#[tokio::test]
async fn appearance_records_only_real_changes_without_dispatching() {
    let service = service(false);
    let created = service
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    let stopped = with_stopped_dispatcher(&service);
    let appearance = EntityAppearance {
        icon: None,
        color: Some(AppearanceColor::Green),
    };
    stopped
        .set_appearance(owner_receipt(id), appearance.clone())
        .await
        .unwrap();
    stopped
        .set_appearance(owner_receipt(id), appearance.clone())
        .await
        .unwrap();
    let saved = stored_actions(&service).pop().unwrap();
    assert_eq!(saved.appearance, appearance);
    assert_eq!(saved.updated_at, created.updated_at);
    assert_eq!(saved.configuration_revision, created.configuration_revision);
    assert_eq!(saved.next_run_at, created.next_run_at);
    let history = service.repo.activities.lock().unwrap();
    assert_eq!(history.len(), 1);
    assert!(matches!(history[0].action, Action::AppearanceChanged(_)));
}

#[tokio::test]
async fn invalid_or_foreign_appearance_writes_do_not_mutate_the_routine() {
    let service = service(false);
    let created = service
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    let invalid = EntityAppearance {
        icon: Some(model_entity::AppearanceIcon::Emoji {
            value: "⌀".into()
        }),
        color: None,
    };
    assert!(
        service
            .set_appearance(owner_receipt(id), invalid)
            .await
            .is_err()
    );
    let foreign = EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str(FOREIGN_USER).unwrap(),
        &id.to_string(),
        EntityType::ScheduledAction,
    );
    assert!(
        service
            .set_appearance(
                foreign,
                EntityAppearance {
                    icon: None,
                    color: Some(AppearanceColor::Blue)
                }
            )
            .await
            .is_err()
    );
    assert!(stored_actions(&service)[0].appearance.is_default());
    assert!(service.repo.activities.lock().unwrap().is_empty());
}

#[tokio::test]
async fn bot_appearance_changes_retain_actor_and_require_the_owner_scope() {
    use entity_access::domain::models::BotReceiptScope;

    let service = service(false);
    let created = service
        .create_action(
            &user_principal(),
            CreateScheduledAction::Canonical(configuration(false)),
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    let bot = bot_id::BotId::new_from_uuid(Uuid::from_u128(77));
    let appearance = EntityAppearance {
        icon: None,
        color: Some(AppearanceColor::Green),
    };
    let receipt = EntityAccessReceipt::dangerously_assert_bot(
        bot.into_storage_id(),
        BotReceiptScope::User {
            acting_user: user(),
        },
        &id.to_string(),
        EntityType::ScheduledAction,
    );
    service
        .set_appearance(receipt, appearance.clone())
        .await
        .unwrap();

    for scope in [
        BotReceiptScope::User {
            acting_user: MacroUserIdStr::parse_from_str(FOREIGN_USER).unwrap(),
        },
        BotReceiptScope::Team {
            team_id: Uuid::from_u128(78),
        },
    ] {
        let receipt = EntityAccessReceipt::dangerously_assert_bot(
            bot.into_storage_id(),
            scope,
            &id.to_string(),
            EntityType::ScheduledAction,
        );
        assert!(
            service
                .set_appearance(receipt, EntityAppearance::default())
                .await
                .is_err()
        );
    }
    assert_eq!(stored_actions(&service)[0].appearance, appearance);
    let history = service.repo.activities.lock().unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].actor, activity::Actor::new_from_bot(bot));
    assert_eq!(history[0].subject_id, USER);
}
