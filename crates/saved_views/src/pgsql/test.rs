use super::PgViewStorage;
use crate::domain::{
    ChangeNotifier, Error, MembershipPort, SavedViewService, ShareChange, Update, ViewsChanged,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};
use uuid::{Uuid, uuid};

const OWNER: &str = "macro|owner@example.com";
const VIEWER: &str = "macro|viewer@example.com";
const TEAM: Uuid = uuid!("11111111-1111-1111-1111-111111111111");

/// Both fixture users belong to the fixture team.
struct FixtureTeam;

impl MembershipPort for FixtureTeam {
    type Err = std::convert::Infallible;

    async fn denied_view_kinds(
        &self,
        _: &str,
        _: &HashSet<String>,
    ) -> Result<HashSet<String>, Self::Err> {
        Ok(HashSet::new())
    }

    async fn viewer_teams(&self, _viewer: &str) -> Result<Vec<Uuid>, Self::Err> {
        Ok(vec![TEAM])
    }

    async fn team_members(&self, _team: Uuid) -> Result<HashSet<String>, Self::Err> {
        Ok(HashSet::from([OWNER.to_owned(), VIEWER.to_owned()]))
    }
}

/// Keeps every change signal the service sends.
#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Vec<ViewsChanged>>>);

impl Recorder {
    fn take(&self) -> Vec<ViewsChanged> {
        std::mem::take(&mut self.0.lock().unwrap())
    }
}

impl ChangeNotifier for Recorder {
    async fn views_changed(&self, change: ViewsChanged) {
        self.0.lock().unwrap().push(change);
    }
}

type Service = SavedViewService<PgViewStorage, FixtureTeam, Recorder>;

fn service(pool: PgPool) -> Service {
    recorded(pool).0
}

fn recorded(pool: PgPool) -> (Service, Recorder) {
    let changes = Recorder::default();
    (
        SavedViewService::new(PgViewStorage::new(pool), FixtureTeam, changes.clone()),
        changes,
    )
}

fn changed(kind: &str, user: &str, teams: Vec<Uuid>) -> ViewsChanged {
    ViewsChanged {
        kind: Some(kind.to_owned()),
        user: user.to_owned(),
        teams,
    }
}

async fn names(service: &Service, viewer: &str) -> Vec<String> {
    service
        .list(viewer, Some("email"), None, 50)
        .await
        .unwrap()
        .views
        .into_iter()
        .map(|view| view.name)
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn reorder_sets_list_order_and_leaves_others_after(pool: PgPool) {
    let service = service(pool);
    let first = uuid!("00000000-0000-7000-8000-000000000001");
    let second = uuid!("00000000-0000-7000-8000-000000000002");
    let third = uuid!("00000000-0000-7000-8000-000000000003");
    for (id, name) in [(first, "First"), (second, "Second"), (third, "Third")] {
        service
            .create(
                OWNER,
                id,
                name.to_owned(),
                json!({ "kind": "email" }),
                None,
                None,
            )
            .await
            .unwrap();
    }

    let reordered = service
        .reorder(OWNER, "email", vec![third, first])
        .await
        .unwrap();

    assert_eq!(
        reordered.iter().map(|view| view.id).collect::<Vec<_>>(),
        vec![third, first]
    );
    assert_eq!(
        names(&service, OWNER).await,
        vec!["Third", "First", "Second"]
    );

    // Leaving a view out of a later order unplaces it.
    service.reorder(OWNER, "email", vec![second]).await.unwrap();
    assert_eq!(
        names(&service, OWNER).await,
        vec!["Second", "First", "Third"]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn pagination_keeps_order_across_placed_and_unplaced_views(pool: PgPool) {
    let service = service(pool);
    let first = uuid!("00000000-0000-7000-8000-000000000001");
    let second = uuid!("00000000-0000-7000-8000-000000000002");
    let third = uuid!("00000000-0000-7000-8000-000000000003");
    for (id, name) in [(first, "First"), (second, "Second"), (third, "Third")] {
        service
            .create(
                OWNER,
                id,
                name.to_owned(),
                json!({ "kind": "email" }),
                None,
                None,
            )
            .await
            .unwrap();
    }
    service
        .reorder(OWNER, "email", vec![second, first])
        .await
        .unwrap();

    let mut seen = Vec::new();
    let mut after = None;
    loop {
        let page = service.list(OWNER, Some("email"), after, 1).await.unwrap();
        seen.extend(page.views.into_iter().map(|view| view.name));
        match page.next {
            Some(cursor) => after = Some(cursor),
            None => break,
        }
    }

    assert_eq!(seen, vec!["Second", "First", "Third"]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn viewer_order_of_shared_views_is_personal(pool: PgPool) {
    let service = service(pool);
    let shared = uuid!("00000000-0000-7000-8000-000000000001");
    let own = uuid!("00000000-0000-7000-8000-000000000002");
    service
        .create(
            OWNER,
            shared,
            "Shared".to_owned(),
            json!({ "kind": "email" }),
            Some(TEAM),
            None,
        )
        .await
        .unwrap();
    service
        .create(
            VIEWER,
            own,
            "Own".to_owned(),
            json!({ "kind": "email" }),
            None,
            None,
        )
        .await
        .unwrap();

    service
        .reorder(VIEWER, "email", vec![own, shared])
        .await
        .unwrap();

    assert_eq!(names(&service, VIEWER).await, vec!["Own", "Shared"]);
    assert_eq!(names(&service, OWNER).await, vec!["Shared"]);
    let unchanged = service.get(OWNER, shared).await.unwrap();
    assert_eq!(unchanged.revision, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn reorder_rejects_views_the_viewer_cannot_place(pool: PgPool) {
    let service = service(pool);
    let private = uuid!("00000000-0000-7000-8000-000000000001");
    let tasks = uuid!("00000000-0000-7000-8000-000000000002");
    let own = uuid!("00000000-0000-7000-8000-000000000003");
    service
        .create(
            OWNER,
            private,
            "Private".to_owned(),
            json!({ "kind": "email" }),
            None,
            None,
        )
        .await
        .unwrap();
    service
        .create(
            VIEWER,
            tasks,
            "Tasks".to_owned(),
            json!({ "kind": "tasks" }),
            None,
            None,
        )
        .await
        .unwrap();
    service
        .create(
            VIEWER,
            own,
            "Own".to_owned(),
            json!({ "kind": "email" }),
            None,
            None,
        )
        .await
        .unwrap();

    let other_owner = service.reorder(VIEWER, "email", vec![own, private]).await;
    let other_kind = service.reorder(VIEWER, "email", vec![own, tasks]).await;
    let duplicate = service.reorder(VIEWER, "email", vec![own, own]).await;
    let empty = service.reorder(VIEWER, "email", vec![]).await;

    assert!(matches!(other_owner, Err(Error::NotFound)));
    assert!(matches!(other_kind, Err(Error::NotFound)));
    assert!(matches!(duplicate, Err(Error::Invalid)));
    assert!(matches!(empty, Err(Error::Invalid)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn deleting_a_placed_view_removes_its_position(pool: PgPool) {
    let service = service(pool.clone());
    let placed = uuid!("00000000-0000-7000-8000-000000000001");
    service
        .create(
            OWNER,
            placed,
            "Placed".to_owned(),
            json!({ "kind": "email" }),
            None,
            None,
        )
        .await
        .unwrap();
    service.reorder(OWNER, "email", vec![placed]).await.unwrap();

    service.delete(OWNER, placed, 1).await.unwrap();

    let positions = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM saved_view_position WHERE saved_view_id = $1"#,
        placed
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(positions, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn committed_writes_signal_their_kind_and_audience(pool: PgPool) {
    let (service, changes) = recorded(pool);
    let id = uuid!("00000000-0000-7000-8000-000000000031");

    let created = service
        .create(
            OWNER,
            id,
            "Mine".to_owned(),
            json!({ "kind": "email" }),
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(changes.take(), vec![changed("email", OWNER, vec![])]);

    let shared = service
        .update(
            OWNER,
            id,
            created.revision,
            Update {
                name: None,
                config: None,
                share: ShareChange::Team(TEAM),
            },
        )
        .await
        .unwrap();
    assert_eq!(changes.take(), vec![changed("email", OWNER, vec![TEAM])]);

    service.reorder(VIEWER, "email", vec![id]).await.unwrap();
    assert_eq!(changes.take(), vec![changed("email", VIEWER, vec![])]);

    service.delete(OWNER, id, shared.revision).await.unwrap();
    assert_eq!(changes.take(), vec![changed("email", OWNER, vec![TEAM])]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn writes_that_change_nothing_send_no_signal(pool: PgPool) {
    let (service, changes) = recorded(pool);
    let id = uuid!("00000000-0000-7000-8000-000000000032");
    let created = service
        .create(
            OWNER,
            id,
            "Mine".to_owned(),
            json!({ "kind": "email" }),
            None,
            None,
        )
        .await
        .unwrap();
    changes.take();

    // A retried create returns the existing view.
    service
        .create(
            OWNER,
            id,
            "Mine".to_owned(),
            json!({ "kind": "email" }),
            None,
            None,
        )
        .await
        .unwrap();
    let stale = service
        .update(
            OWNER,
            id,
            created.revision + 1,
            Update {
                name: Some("Renamed".to_owned()),
                config: None,
                share: ShareChange::Unchanged,
            },
        )
        .await;
    assert!(matches!(stale, Err(Error::Conflict)));
    assert!(matches!(
        service.delete(OWNER, id, created.revision + 1).await,
        Err(Error::Conflict)
    ));
    service.delete(OWNER, id, created.revision).await.unwrap();
    changes.take();
    // Deleting again is harmless and changes nothing.
    service.delete(OWNER, id, created.revision).await.unwrap();

    assert_eq!(changes.take(), vec![]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn crm_configuration_access_is_rechecked_for_legacy_and_definition_routes(pool: PgPool) {
    use std::sync::atomic::{AtomicBool, Ordering};
    struct FeatureAccess(Arc<AtomicBool>);
    impl MembershipPort for FeatureAccess {
        type Err = std::convert::Infallible;
        async fn viewer_teams(&self, viewer: &str) -> Result<Vec<Uuid>, Self::Err> {
            FixtureTeam.viewer_teams(viewer).await
        }
        async fn team_members(&self, team: Uuid) -> Result<HashSet<String>, Self::Err> {
            FixtureTeam.team_members(team).await
        }
        async fn denied_view_kinds(
            &self,
            _: &str,
            kinds: &HashSet<String>,
        ) -> Result<HashSet<String>, Self::Err> {
            Ok(kinds
                .iter()
                .filter(|kind| {
                    !self.0.load(Ordering::Relaxed) && matches!(kind.as_str(), "crm" | "crm-list")
                })
                .cloned()
                .collect())
        }
    }
    let allowed = Arc::new(AtomicBool::new(true));
    let service = SavedViewService::new(
        PgViewStorage::new(pool),
        FeatureAccess(allowed.clone()),
        Recorder::default(),
    );
    let list = service
        .legacy_create(
            OWNER,
            "Private collection".into(),
            json!({"kind":"crm-list","teamId":TEAM,"companyIds":[]}),
        )
        .await
        .unwrap();
    let view = service
        .create(
            OWNER,
            Uuid::now_v7(),
            "Records view".into(),
            json!({"kind":"crm"}),
            None,
            None,
        )
        .await
        .unwrap();
    service
        .legacy_create(OWNER, "Mail view".into(), json!({"kind":"email"}))
        .await
        .unwrap();
    for enabled in [true, false, true] {
        allowed.store(enabled, Ordering::Relaxed);
        assert_eq!(service.get(OWNER, list.id).await.is_ok(), enabled);
        assert_eq!(service.get(OWNER, view.id).await.is_ok(), enabled);
        assert_eq!(
            service
                .list(OWNER, Some("crm"), None, 50)
                .await
                .unwrap()
                .views
                .len(),
            usize::from(enabled)
        );
        assert_eq!(
            service.legacy_list(OWNER).await.unwrap().len(),
            if enabled { 3 } else { 1 }
        );
        assert_eq!(
            service
                .legacy_patch(OWNER, list.id, Some("Renamed collection"), None)
                .await
                .is_ok(),
            enabled
        );
        if !enabled {
            assert!(matches!(
                service.delete(OWNER, view.id, view.revision).await,
                Err(Error::NotFound)
            ));
            assert!(matches!(
                service
                    .legacy_create(OWNER, "Blocked".into(), json!({"kind":"crm-list"}))
                    .await,
                Err(Error::NotFound)
            ));
            assert!(matches!(
                service
                    .update(
                        OWNER,
                        view.id,
                        view.revision,
                        Update {
                            name: Some("Blocked".into()),
                            config: None,
                            share: ShareChange::Unchanged
                        }
                    )
                    .await,
                Err(Error::NotFound)
            ));
        }
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn appearance_is_owner_only_and_does_not_change_filter_revision(pool: PgPool) {
    let service = service(pool);
    let id = Uuid::now_v7();
    let created = service
        .create(
            OWNER,
            id,
            "Shared".into(),
            json!({"kind":"email"}),
            Some(TEAM),
            None,
        )
        .await
        .unwrap();
    let appearance = model_entity::EntityAppearance {
        icon: Some(model_entity::AppearanceIcon::Emoji {
            value: "📚".into()
        }),
        color: Some(model_entity::AppearanceColor::Blue),
    };
    assert!(matches!(
        service.set_appearance(VIEWER, id, appearance.clone()).await,
        Err(Error::NotFound)
    ));
    let saved = service
        .set_appearance(OWNER, id, appearance.clone())
        .await
        .unwrap();
    assert_eq!(saved.appearance.as_ref(), Some(&appearance));
    assert_eq!(saved.revision, created.revision);
    assert_eq!(saved.updated_at, created.updated_at);
    assert_eq!(
        service.get(VIEWER, id).await.unwrap().appearance.as_ref(),
        Some(&appearance)
    );
    let updated = service
        .update(
            OWNER,
            id,
            created.revision,
            Update {
                name: Some("Renamed".into()),
                config: None,
                share: ShareChange::Unchanged,
            },
        )
        .await
        .unwrap();
    assert_eq!(updated.appearance.as_ref(), Some(&appearance));
    assert_eq!(
        service
            .list(VIEWER, Some("email"), None, 50)
            .await
            .unwrap()
            .views[0]
            .appearance
            .as_ref(),
        Some(&appearance)
    );
    let invalid = model_entity::EntityAppearance {
        icon: Some(model_entity::AppearanceIcon::Macro {
            name: "not-a-macro-icon".into(),
        }),
        color: None,
    };
    assert!(matches!(
        service.set_appearance(OWNER, id, invalid).await,
        Err(Error::Invalid)
    ));
    assert_eq!(
        service.get(OWNER, id).await.unwrap().appearance.as_ref(),
        Some(&appearance)
    );
    let reset = service
        .set_appearance(OWNER, id, model_entity::EntityAppearance::default())
        .await
        .unwrap();
    assert_eq!(
        reset.appearance.as_ref(),
        Some(&model_entity::EntityAppearance::default())
    );
    assert_eq!(reset.revision, updated.revision);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("users"))
)]
async fn create_retry_preserves_first_appearance(pool: PgPool) {
    let service = service(pool);
    let id = Uuid::now_v7();
    let first = model_entity::EntityAppearance {
        icon: Some(model_entity::AppearanceIcon::Emoji {
            value: "📚".into()
        }),
        color: None,
    };
    let created = service
        .create(
            OWNER,
            id,
            "Original".into(),
            json!({"kind":"email"}),
            None,
            Some(first.clone()),
        )
        .await
        .unwrap();
    let replay = service
        .create(
            OWNER,
            id,
            "Changed".into(),
            json!({"kind":"tasks"}),
            None,
            Some(model_entity::EntityAppearance::default()),
        )
        .await
        .unwrap();
    assert_eq!(replay.name, created.name);
    assert_eq!(replay.appearance.as_ref(), Some(&first));
    assert!(matches!(
        service
            .create(
                VIEWER,
                id,
                "Other".into(),
                json!({"kind":"email"}),
                None,
                None
            )
            .await,
        Err(Error::NotFound)
    ));
    let invalid = model_entity::EntityAppearance {
        icon: Some(model_entity::AppearanceIcon::Macro {
            name: "invalid".into(),
        }),
        color: None,
    };
    assert!(matches!(
        service
            .create(
                OWNER,
                Uuid::now_v7(),
                "Invalid".into(),
                json!({"kind":"email"}),
                None,
                Some(invalid)
            )
            .await,
        Err(Error::Invalid)
    ));
}
