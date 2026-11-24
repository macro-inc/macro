use super::*;
use crate::domain::appearance::{AppearanceChooser, AppearanceSet, ChangeAppearance};
use activity::domain::ports::{ActivityReads, EntityActivityReads};
use activity::{Action, Actor, Attribution, RecordedAction};
use model_entity::{AppearanceColor, EntityAppearance};
use std::num::NonZeroU32;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn appearance_and_history_commit_without_changing_scheduling(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(
            sample_action(user_owner(USER_A), "routine"),
            crate::domain::models::RoutineLimits::STANDARD.active_sub_routines,
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    repo.claim_action(&id, created.configuration_revision, created.next_run_at)
        .await
        .unwrap();
    let before = repo.get_action(&id).await.unwrap().unwrap();
    let appearance = EntityAppearance {
        icon: None,
        color: Some(AppearanceColor::Blue),
    };
    let change = ChangeAppearance {
        id,
        appearance: appearance.clone(),
        chooser: AppearanceChooser::Owner,
        attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
        event_id: macro_uuid::generate_uuid_v7(),
        occurred_at: Utc::now(),
    };
    assert!(repo.set_appearance(change).await.unwrap().changed());
    assert_eq!(
        repo.set_appearance(ChangeAppearance {
            id,
            appearance: appearance.clone(),
            chooser: AppearanceChooser::Owner,
            attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
            event_id: macro_uuid::generate_uuid_v7(),
            occurred_at: Utc::now(),
        })
        .await
        .unwrap(),
        AppearanceSet::Kept {
            current: appearance.clone()
        }
    );

    let after = repo.get_action(&id).await.unwrap().unwrap();
    assert_eq!(after.appearance, appearance);
    assert_eq!(after.updated_at, before.updated_at);
    assert_eq!(after.created_at, before.created_at);
    assert_eq!(after.configuration_revision, before.configuration_revision);
    assert_eq!(after.next_run_at, before.next_run_at);
    assert_eq!(after.claimed, before.claimed);
    assert_eq!(after.event_activated_at, before.event_activated_at);
    assert_eq!(after.enabled, before.enabled);
    let history = activity::outbound::pg_activity_repo::PgActivityRepo::new(pool);
    let records = history
        .entity_feed(
            model_entity::EntityType::ScheduledAction,
            &id.to_string(),
            None,
            NonZeroU32::new(10).unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(records.records.len(), 1);
    assert!(matches!(
        records.records[0].action,
        RecordedAction::Known(Action::AppearanceChanged(_))
    ));
    assert!(
        history
            .subject_feed(USER_A, None, NonZeroU32::new(10).unwrap())
            .await
            .unwrap()
            .records
            .is_empty()
    );
    repo.delete_action(&id).await.unwrap();
    assert!(
        history
            .entity_feed(
                model_entity::EntityType::ScheduledAction,
                &id.to_string(),
                None,
                NonZeroU32::new(10).unwrap(),
            )
            .await
            .unwrap()
            .records
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_failure_rolls_back_the_appearance(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(
            sample_action(user_owner(USER_A), "routine"),
            crate::domain::models::RoutineLimits::STANDARD.active_sub_routines,
        )
        .await
        .unwrap();
    let id = created.id.unwrap();
    // Inject a history failure in this isolated test database to verify atomic rollback.
    sqlx::query!("ALTER TABLE activity_events ADD CONSTRAINT refuse_appearance_test CHECK (action <> 'appearance_changed')")
        .execute(&pool).await.unwrap();
    assert!(
        repo.set_appearance(ChangeAppearance {
            id,
            appearance: EntityAppearance {
                icon: None,
                color: Some(AppearanceColor::Blue)
            },
            chooser: AppearanceChooser::Owner,
            attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
            event_id: macro_uuid::generate_uuid_v7(),
            occurred_at: Utc::now(),
        })
        .await
        .is_err()
    );
    let stored = repo.get_action(&id).await.unwrap().unwrap();
    assert_eq!(stored.appearance, created.appearance);
    assert_eq!(stored.updated_at, created.updated_at);
}

fn change(id: Uuid, appearance: EntityAppearance, chooser: AppearanceChooser) -> ChangeAppearance {
    ChangeAppearance {
        id,
        appearance,
        chooser,
        attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
        event_id: macro_uuid::generate_uuid_v7(),
        occurred_at: Utc::now(),
    }
}

fn colored(color: AppearanceColor) -> EntityAppearance {
    EntityAppearance {
        icon: None,
        color: Some(color),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agent_picks_until_the_owner_chooses(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(
            sample_action(user_owner(USER_A), "routine"),
            crate::domain::models::RoutineLimits::STANDARD.active_sub_routines,
        )
        .await
        .unwrap();
    let id = created.id.unwrap();

    let first = colored(AppearanceColor::Blue);
    assert!(
        repo.set_appearance(change(id, first.clone(), AppearanceChooser::Agent))
            .await
            .unwrap()
            .changed()
    );
    let second = colored(AppearanceColor::Green);
    assert!(
        repo.set_appearance(change(id, second.clone(), AppearanceChooser::Agent))
            .await
            .unwrap()
            .changed(),
        "an agent may pick again while the owner has not chosen"
    );
    assert_eq!(
        repo.get_action(&id).await.unwrap().unwrap().appearance,
        second
    );

    let chosen = colored(AppearanceColor::Red);
    assert!(
        repo.set_appearance(change(id, chosen.clone(), AppearanceChooser::Owner))
            .await
            .unwrap()
            .changed()
    );
    assert_eq!(
        repo.set_appearance(change(id, first, AppearanceChooser::Agent))
            .await
            .unwrap(),
        AppearanceSet::Kept {
            current: chosen.clone()
        },
        "an agent never replaces the owner's choice, and the look it keeps is returned"
    );
    assert_eq!(
        repo.get_action(&id).await.unwrap().unwrap().appearance,
        chosen
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn choosing_the_current_look_still_keeps_it(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(
            sample_action(user_owner(USER_A), "routine"),
            crate::domain::models::RoutineLimits::STANDARD.active_sub_routines,
        )
        .await
        .unwrap();
    let id = created.id.unwrap();

    // The owner picks "no icon", which the routine already has: nothing to
    // record, but an agent may no longer give it one.
    assert_eq!(
        repo.set_appearance(change(
            id,
            EntityAppearance::default(),
            AppearanceChooser::Owner
        ))
        .await
        .unwrap(),
        AppearanceSet::Kept {
            current: EntityAppearance::default()
        }
    );
    assert_eq!(
        repo.set_appearance(change(
            id,
            colored(AppearanceColor::Blue),
            AppearanceChooser::Agent
        ))
        .await
        .unwrap(),
        AppearanceSet::Kept {
            current: EntityAppearance::default()
        }
    );
    assert_eq!(
        repo.get_action(&id).await.unwrap().unwrap().appearance,
        EntityAppearance::default()
    );
    let history = activity::outbound::pg_activity_repo::PgActivityRepo::new(pool);
    assert!(
        history
            .entity_feed(
                model_entity::EntityType::ScheduledAction,
                &id.to_string(),
                None,
                NonZeroU32::new(10).unwrap(),
            )
            .await
            .unwrap()
            .records
            .is_empty()
    );
}

/// Whether `id`'s row records that its owner chose its look: `None` for a
/// routine from before `appearance_chosen_by_owner`.
async fn chosen_by_owner(pool: &PgPool, id: Uuid) -> Option<bool> {
    sqlx::query_scalar!(
        "SELECT appearance_chosen_by_owner FROM scheduled_action WHERE id = $1",
        id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Forgets whose choice `id`'s look is, as a routine from before
/// `appearance_chosen_by_owner`, keeping the look as stored.
async fn as_before_the_column(pool: &PgPool, id: Uuid) {
    sqlx::query!(
        r#"UPDATE scheduled_action
        SET appearance_chosen_by_owner = NULL, appearance_changes_by_agent = NULL
        WHERE id = $1"#,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Stores `appearance` on `id` as a write before the column did.
async fn stored_before_the_column(pool: &PgPool, id: Uuid, appearance: Option<serde_json::Value>) {
    sqlx::query!(
        r#"UPDATE scheduled_action
        SET appearance = $2, appearance_chosen_by_owner = NULL, appearance_changes_by_agent = NULL
        WHERE id = $1"#,
        id,
        appearance,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_look_the_owner_set_before_the_column_stays_theirs(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let mut routines = Vec::new();
    for name in ["colored", "reset", "never", "blank"] {
        let created = repo
            .create_action(
                sample_action(user_owner(USER_A), name),
                crate::domain::models::RoutineLimits::STANDARD.active_sub_routines,
            )
            .await
            .unwrap();
        let id = created.id.unwrap();
        assert_eq!(
            chosen_by_owner(&pool, id).await,
            Some(false),
            "a new routine"
        );
        routines.push(id);
    }
    let [colored_one, reset, never, blank] = routines[..] else {
        panic!("four routines were created");
    };
    stored_before_the_column(&pool, colored_one, Some(json!({ "color": "blue" }))).await;
    // Reset to no icon through the endpoint, which recorded both changes and
    // stored the look it wrote for none.
    for look in [colored(AppearanceColor::Red), EntityAppearance::default()] {
        repo.set_appearance(change(reset, look, AppearanceChooser::Owner))
            .await
            .unwrap();
    }
    as_before_the_column(&pool, reset).await;
    assert_eq!(
        repo.get_action(&reset).await.unwrap().unwrap().appearance,
        EntityAppearance::default(),
        "only its activity says the owner chose"
    );
    stored_before_the_column(&pool, never, None).await;
    stored_before_the_column(&pool, blank, Some(json!({ "icon": null, "color": null }))).await;

    let pick = colored(AppearanceColor::Green);
    for (id, kept) in [
        (colored_one, "a look it has"),
        (reset, "a look reset to none"),
    ] {
        let before = repo.get_action(&id).await.unwrap().unwrap().appearance;
        assert_eq!(
            repo.set_appearance(change(id, pick.clone(), AppearanceChooser::Agent))
                .await
                .unwrap(),
            AppearanceSet::Kept {
                current: before.clone()
            },
            "{kept}: an agent's pick is refused"
        );
        assert_eq!(
            repo.get_action(&id).await.unwrap().unwrap().appearance,
            before,
            "{kept}"
        );
        assert_eq!(
            chosen_by_owner(&pool, id).await,
            None,
            "{kept}: left as it was"
        );
    }
    for (id, open) in [
        (never, "never given a look"),
        (blank, "a look with nothing in it"),
    ] {
        assert!(
            repo.set_appearance(change(id, pick.clone(), AppearanceChooser::Agent))
                .await
                .unwrap()
                .changed(),
            "{open}: an agent may pick"
        );
        assert_eq!(
            repo.get_action(&id).await.unwrap().unwrap().appearance,
            pick,
            "{open}"
        );
        assert_eq!(
            chosen_by_owner(&pool, id).await,
            Some(false),
            "{open}: the pick records that the owner hasn't chosen"
        );
    }
}

/// Stores `look` on `id` the way the appearance endpoint of a replica built
/// before these columns does for the owner (main's `set_appearance`): the
/// look and its activity, under the row's lock, leaving the columns alone.
async fn chosen_on_an_older_replica(pool: &PgPool, id: Uuid, look: &EntityAppearance) {
    let mut tx = pool.begin().await.unwrap();
    let previous = sqlx::query_scalar!(
        "SELECT appearance FROM scheduled_action WHERE id = $1 FOR UPDATE",
        id,
    )
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    let previous = stored_appearance(previous).unwrap();
    let Some(activity) = change(id, look.clone(), AppearanceChooser::Owner).activity(&previous)
    else {
        return;
    };
    sqlx::query!(
        "UPDATE scheduled_action SET appearance = $2 WHERE id = $1",
        id,
        serde_json::to_value(look).unwrap(),
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    activity::outbound::pg_activity_repo::insert_activities(&mut *tx, &[activity])
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_owners_choice_on_an_older_replica_stays_theirs(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let mut template = sample_action(user_owner(USER_A), "from a template");
    template.appearance = colored(AppearanceColor::Purple);
    let mut routines = Vec::new();
    for action in [
        sample_action(user_owner(USER_A), "agent's pick, then the owner's"),
        sample_action(user_owner(USER_A), "agent's pick, then none"),
        sample_action(
            user_owner(USER_A),
            "agent's pick, then the owner's and back",
        ),
        sample_action(user_owner(USER_A), "the owner's first look"),
        sample_action(user_owner(USER_A), "the owner's look, then none"),
        template,
    ] {
        routines.push(
            repo.create_action(
                action,
                crate::domain::models::RoutineLimits::STANDARD.active_sub_routines,
            )
            .await
            .unwrap()
            .id
            .unwrap(),
        );
    }
    let [picked, reset, back, first, none_again, from_template] = routines[..] else {
        panic!("six routines were created");
    };
    let blue = colored(AppearanceColor::Blue);
    let red = colored(AppearanceColor::Red);
    for id in [picked, reset, back] {
        assert!(
            repo.set_appearance(change(id, blue.clone(), AppearanceChooser::Agent))
                .await
                .unwrap()
                .changed()
        );
    }
    chosen_on_an_older_replica(&pool, picked, &red).await;
    chosen_on_an_older_replica(&pool, reset, &EntityAppearance::default()).await;
    // Back to the agent's pick: the look alone can't tell.
    chosen_on_an_older_replica(&pool, back, &red).await;
    chosen_on_an_older_replica(&pool, back, &blue).await;
    chosen_on_an_older_replica(&pool, first, &red).await;
    // Back to the look the routine was created with.
    chosen_on_an_older_replica(&pool, none_again, &blue).await;
    chosen_on_an_older_replica(&pool, none_again, &EntityAppearance::default()).await;

    let pick = colored(AppearanceColor::Green);
    for (id, case) in [
        (picked, "a look after an agent's pick"),
        (reset, "none after an agent's pick"),
        (back, "the agent's pick, chosen again by the owner"),
        (first, "a look on a new routine"),
        (
            none_again,
            "a new routine's look, chosen again by the owner",
        ),
    ] {
        let before = repo.get_action(&id).await.unwrap().unwrap().appearance;
        assert_eq!(
            repo.set_appearance(change(id, pick.clone(), AppearanceChooser::Agent))
                .await
                .unwrap(),
            AppearanceSet::Kept {
                current: before.clone()
            },
            "{case}: an agent's pick is refused"
        );
        assert_eq!(
            repo.get_action(&id).await.unwrap().unwrap().appearance,
            before,
            "{case}"
        );
    }
    assert!(
        repo.set_appearance(change(
            from_template,
            pick.clone(),
            AppearanceChooser::Agent
        ))
        .await
        .unwrap()
        .changed(),
        "a template's look is not the owner's choice"
    );
    assert_eq!(
        repo.get_action(&from_template)
            .await
            .unwrap()
            .unwrap()
            .appearance,
        pick
    );
}
