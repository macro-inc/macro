use super::PgViewStorage;
use crate::domain::{Error, MembershipPort, SavedViewService};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::{Uuid, uuid};

const OWNER: &str = "macro|owner@example.com";
const VIEWER: &str = "macro|viewer@example.com";
const TEAM: Uuid = uuid!("11111111-1111-1111-1111-111111111111");

/// Both fixture users belong to the fixture team.
struct FixtureTeam;

impl MembershipPort for FixtureTeam {
    type Err = std::convert::Infallible;

    async fn viewer_teams(&self, _viewer: &str) -> Result<Vec<Uuid>, Self::Err> {
        Ok(vec![TEAM])
    }

    async fn team_members(&self, _team: Uuid) -> Result<HashSet<String>, Self::Err> {
        Ok(HashSet::from([OWNER.to_owned(), VIEWER.to_owned()]))
    }
}

fn service(pool: PgPool) -> SavedViewService<PgViewStorage, FixtureTeam> {
    SavedViewService::new(PgViewStorage::new(pool), FixtureTeam)
}

async fn names(
    service: &SavedViewService<PgViewStorage, FixtureTeam>,
    viewer: &str,
) -> Vec<String> {
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
            .create(OWNER, id, name.to_owned(), json!({ "kind": "email" }), None)
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
            .create(OWNER, id, name.to_owned(), json!({ "kind": "email" }), None)
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
