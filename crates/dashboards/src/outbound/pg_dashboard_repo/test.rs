use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;

use super::*;

const AGENT: &str = "macro|agent@example.com";
const ADMIN: &str = "macro|admin@example.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

async fn seed_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_user_id,
        id,
        macro_user_id.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id, "isAgent") VALUES ($1, $1, $2, $3)"#,
        id,
        macro_user_id,
        id == AGENT,
    )
    .execute(pool)
    .await
    .unwrap();
}

fn view(markdown: &str) -> View {
    dynamic_ui::decode_view(&json!({
        "title": " Ops ",
        "widgets": [{ "type": "md", "id": "intro", "markdown": markdown }]
    }))
    .unwrap()
}

async fn owner_grants(pool: &PgPool, id: DashboardId) -> Vec<(String, String)> {
    sqlx::query!(
        r#"SELECT source_id, access_level::text AS "level!" FROM entity_access
           WHERE entity_id = $1 AND entity_type = 'dashboard'"#,
        id.0,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.source_id, row.level))
    .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_created_dashboard_reads_back_with_its_owner_grant(pool: PgPool) {
    seed_user(&pool, AGENT).await;
    let repo = PgDashboardRepo::new(pool.clone());
    let id = DashboardId::generate();

    let created = repo
        .create(&NewDashboard {
            id,
            owner_id: user(AGENT),
            view: view("Hello"),
        })
        .await
        .unwrap();

    assert_eq!(created.title.as_deref(), Some("Ops"));
    let read = repo.get(id).await.unwrap().unwrap();
    assert_eq!(read.version, Version::FIRST);
    assert_eq!(read.view, view("Hello"));
    assert_eq!(read.owner_id.as_ref(), AGENT);
    assert_eq!(
        owner_grants(&pool, id).await,
        vec![(AGENT.to_owned(), "owner".to_owned())]
    );
    let listed = repo.list_owned(&user(AGENT), 10).await.unwrap();
    assert_eq!(
        listed.iter().map(|summary| summary.id).collect::<Vec<_>>(),
        vec![id]
    );
}

/// Two saves read version 1; the second finds it no longer current.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_save_moves_the_current_version_only_from_the_one_it_read(pool: PgPool) {
    seed_user(&pool, AGENT).await;
    seed_user(&pool, ADMIN).await;
    let repo = PgDashboardRepo::new(pool.clone());
    let id = DashboardId::generate();
    repo.create(&NewDashboard {
        id,
        owner_id: user(AGENT),
        view: view("One"),
    })
    .await
    .unwrap();

    let first = repo
        .save_version(&NewVersion {
            id,
            replaces: Version::FIRST,
            author_id: user(ADMIN),
            view: view("Two"),
        })
        .await
        .unwrap();
    let second = repo
        .save_version(&NewVersion {
            id,
            replaces: Version::FIRST,
            author_id: user(AGENT),
            view: view("Lost"),
        })
        .await
        .unwrap();

    assert_eq!(first.map(|saved| saved.version), Some(Version(2)));
    assert_eq!(second, None);
    assert_eq!(repo.get(id).await.unwrap().unwrap().view, view("Two"));

    let history = repo.versions(id, 10).await.unwrap();
    assert_eq!(
        history
            .iter()
            .map(|version| (version.version.0, version.author_id.as_ref().to_owned()))
            .collect::<Vec<_>>(),
        vec![(2, ADMIN.to_owned()), (1, AGENT.to_owned())]
    );
    let first_version = repo.version(id, Version::FIRST).await.unwrap().unwrap();
    assert_eq!(
        first_version.view,
        serde_json::to_value(view("One")).unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_dashboard_clears_its_grants_versions_and_home(pool: PgPool) {
    seed_user(&pool, AGENT).await;
    let repo = PgDashboardRepo::new(pool.clone());
    let id = DashboardId::generate();
    repo.create(&NewDashboard {
        id,
        owner_id: user(AGENT),
        view: view("Hi"),
    })
    .await
    .unwrap();
    repo.set_home(&user(AGENT), id).await.unwrap();
    assert_eq!(repo.home(&user(AGENT)).await.unwrap(), Some(id));

    assert!(repo.delete(id).await.unwrap());

    assert!(!repo.delete(id).await.unwrap());
    assert_eq!(repo.home(&user(AGENT)).await.unwrap(), None);
    assert!(owner_grants(&pool, id).await.is_empty());
    assert!(repo.versions(id, 10).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_home_points_at_the_latest_dashboard_set(pool: PgPool) {
    seed_user(&pool, AGENT).await;
    let repo = PgDashboardRepo::new(pool.clone());
    let first = DashboardId::generate();
    let second = DashboardId::generate();
    for id in [first, second] {
        repo.create(&NewDashboard {
            id,
            owner_id: user(AGENT),
            view: view("Hi"),
        })
        .await
        .unwrap();
    }

    repo.set_home(&user(AGENT), first).await.unwrap();
    repo.set_home(&user(AGENT), second).await.unwrap();
    assert_eq!(repo.home(&user(AGENT)).await.unwrap(), Some(second));

    repo.clear_home(&user(AGENT)).await.unwrap();
    assert_eq!(repo.home(&user(AGENT)).await.unwrap(), None);
}
