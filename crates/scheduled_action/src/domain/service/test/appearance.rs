use super::*;
use activity::Action;
use model_entity::{AppearanceColor, AppearanceIcon, macro_icon_names};

#[tokio::test]
async fn appearance_records_only_real_changes_without_dispatching() {
    let service = service(false);
    let created = service
        .create_action(&user_principal(), configuration(false))
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
        .create_action(&user_principal(), configuration(false))
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
        .create_action(&user_principal(), configuration(false))
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

fn icon(name: &str) -> EntityAppearance {
    EntityAppearance {
        icon: Some(AppearanceIcon::Macro { name: name.into() }),
        color: Some(AppearanceColor::Teal),
    }
}

fn picking(appearance: EntityAppearance) -> ActionConfiguration {
    ActionConfiguration {
        appearance: Some(appearance),
        ..configuration(false)
    }
}

#[tokio::test]
async fn an_agent_picks_a_new_routines_look() {
    let service = service(false);
    let pick = icon(macro_icon_names()[0]);
    let created = service
        .create_action(&user_principal(), picking(pick.clone()))
        .await
        .unwrap();
    assert_eq!(created.appearance, pick);
    assert_eq!(stored_actions(&service)[0].appearance, pick);
}

#[tokio::test]
async fn an_unknown_icon_is_refused_with_the_names_to_use() {
    let service = service(false);
    let refused = service
        .create_action(&user_principal(), picking(icon("not-an-icon")))
        .await
        .unwrap_err()
        .to_string();
    assert!(refused.contains("not-an-icon"), "{refused}");
    assert!(refused.contains(macro_icon_names()[0]), "{refused}");
    assert!(stored_actions(&service).is_empty());

    let check = service
        .check_action(
            &user_principal(),
            picking(icon("not-an-icon")),
            Vec::new(),
            Vec::new(),
            None,
        )
        .await
        .unwrap();
    assert!(!check.ok);
    assert!(
        check
            .problems
            .iter()
            .any(|problem| problem.contains("not-an-icon")
                && problem.contains(macro_icon_names()[0])),
        "{:?}",
        check.problems
    );
}

#[tokio::test]
async fn an_agent_picks_again_on_change_but_never_over_the_owners_choice() {
    let service = service(false);
    let names = macro_icon_names();
    let created = service
        .create_action(&user_principal(), picking(icon(names[0])))
        .await
        .unwrap();
    let id = created.id.unwrap();

    let second = icon(names[1]);
    let updated = service
        .update_action(
            edit_receipt(id),
            update(picking(second.clone())),
            Requester::Person,
        )
        .await
        .unwrap();
    assert_eq!(updated.appearance, second);
    assert_eq!(stored_actions(&service)[0].appearance, second);

    let chosen = EntityAppearance {
        icon: None,
        color: Some(AppearanceColor::Red),
    };
    service
        .set_appearance(owner_receipt(id), chosen.clone())
        .await
        .unwrap();
    let renamed = service
        .update_action(
            edit_receipt(id),
            update(ActionConfiguration {
                name: "renamed".into(),
                ..picking(icon(names[2]))
            }),
            Requester::Person,
        )
        .await
        .unwrap();
    assert_eq!(renamed.name, "renamed");
    assert_eq!(renamed.appearance, chosen);
    assert_eq!(stored_actions(&service)[0].appearance, chosen);

    // An update without a pick leaves the look alone.
    let plain = service
        .update_action(
            edit_receipt(id),
            update(configuration(false)),
            Requester::Person,
        )
        .await
        .unwrap();
    assert_eq!(plain.appearance, chosen);
}

#[tokio::test]
async fn a_refused_pick_answers_with_the_owners_choice_that_won_the_row() {
    let service = service(false);
    let names = macro_icon_names();
    let created = service
        .create_action(&user_principal(), picking(icon(names[0])))
        .await
        .unwrap();
    let id = created.id.unwrap();
    // The owner chooses red after the update saved its configuration, while
    // the agent's pick waits for the routine's row.
    let chosen = EntityAppearance {
        icon: None,
        color: Some(AppearanceColor::Red),
    };
    *service.repo.owner_choice_before_the_pick.lock().unwrap() = Some(chosen.clone());
    let updated = service
        .update_action(
            edit_receipt(id),
            update(picking(icon(names[1]))),
            Requester::Person,
        )
        .await
        .unwrap();
    assert_eq!(
        updated.appearance, chosen,
        "the look the routine has, not the one the update read"
    );
    assert_eq!(stored_actions(&service)[0].appearance, chosen);
}
