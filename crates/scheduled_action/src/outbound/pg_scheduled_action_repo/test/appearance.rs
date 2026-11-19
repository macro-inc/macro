use super::*;
use crate::domain::appearance::{AppearanceChooser, ChangeAppearance};
use activity::domain::ports::{ActivityReads, EntityActivityReads};
use activity::{Action, Actor, Attribution, RecordedAction};
use model_entity::{AppearanceColor, EntityAppearance};
use std::num::NonZeroU32;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn appearance_and_history_commit_without_changing_scheduling(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = test_repo(pool.clone());
    let created = repo
        .create_action(sample_action(user_owner(USER_A), "routine"))
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
    assert!(repo.set_appearance(change).await.unwrap().is_some());
    assert!(
        repo.set_appearance(ChangeAppearance {
            id,
            appearance: appearance.clone(),
            chooser: AppearanceChooser::Owner,
            attribution: Attribution::direct(Actor::new_from_user(user(USER_A))),
            event_id: macro_uuid::generate_uuid_v7(),
            occurred_at: Utc::now(),
        })
        .await
        .unwrap()
        .is_none()
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
        .create_action(sample_action(user_owner(USER_A), "routine"))
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
        .create_action(sample_action(user_owner(USER_A), "routine"))
        .await
        .unwrap();
    let id = created.id.unwrap();

    let first = colored(AppearanceColor::Blue);
    assert!(
        repo.set_appearance(change(id, first.clone(), AppearanceChooser::Agent))
            .await
            .unwrap()
            .is_some()
    );
    let second = colored(AppearanceColor::Green);
    assert!(
        repo.set_appearance(change(id, second.clone(), AppearanceChooser::Agent))
            .await
            .unwrap()
            .is_some(),
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
            .is_some()
    );
    assert!(
        repo.set_appearance(change(id, first, AppearanceChooser::Agent))
            .await
            .unwrap()
            .is_none(),
        "an agent never replaces the owner's choice"
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
        .create_action(sample_action(user_owner(USER_A), "routine"))
        .await
        .unwrap();
    let id = created.id.unwrap();

    // The owner picks "no icon", which the routine already has: nothing to
    // record, but an agent may no longer give it one.
    assert!(
        repo.set_appearance(change(
            id,
            EntityAppearance::default(),
            AppearanceChooser::Owner
        ))
        .await
        .unwrap()
        .is_none()
    );
    assert!(
        repo.set_appearance(change(
            id,
            colored(AppearanceColor::Blue),
            AppearanceChooser::Agent
        ))
        .await
        .unwrap()
        .is_none()
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
        SET appearance_chosen_by_owner = NULL, appearance_picked_by_agent = NULL
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
        SET appearance = $2, appearance_chosen_by_owner = NULL, appearance_picked_by_agent = NULL
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
            .create_action(sample_action(user_owner(USER_A), name))
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
        assert!(
            repo.set_appearance(change(id, pick.clone(), AppearanceChooser::Agent))
                .await
                .unwrap()
                .is_none(),
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
                .is_some(),
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

/// Stores `look` on `id` as the appearance endpoint of a replica built
/// before `appearance_chosen_by_owner` does for the owner: the look alone
/// (and an activity, which this doesn't need).
async fn chosen_on_an_older_replica(pool: &PgPool, id: Uuid, look: &EntityAppearance) {
    sqlx::query!(
        "UPDATE scheduled_action SET appearance = $2 WHERE id = $1",
        id,
        serde_json::to_value(look).unwrap(),
    )
    .execute(pool)
    .await
    .unwrap();
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
        sample_action(user_owner(USER_A), "the owner's first look"),
        template,
    ] {
        routines.push(repo.create_action(action).await.unwrap().id.unwrap());
    }
    let [picked, reset, first, from_template] = routines[..] else {
        panic!("four routines were created");
    };
    for id in [picked, reset] {
        assert!(
            repo.set_appearance(change(
                id,
                colored(AppearanceColor::Blue),
                AppearanceChooser::Agent
            ))
            .await
            .unwrap()
            .is_some()
        );
    }
    chosen_on_an_older_replica(&pool, picked, &colored(AppearanceColor::Red)).await;
    chosen_on_an_older_replica(&pool, reset, &EntityAppearance::default()).await;
    chosen_on_an_older_replica(&pool, first, &colored(AppearanceColor::Red)).await;

    let pick = colored(AppearanceColor::Green);
    for (id, case) in [
        (picked, "a look after an agent's pick"),
        (reset, "none after an agent's pick"),
        (first, "a look on a new routine"),
    ] {
        let before = repo.get_action(&id).await.unwrap().unwrap().appearance;
        assert!(
            repo.set_appearance(change(id, pick.clone(), AppearanceChooser::Agent))
                .await
                .unwrap()
                .is_none(),
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
        .is_some(),
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
