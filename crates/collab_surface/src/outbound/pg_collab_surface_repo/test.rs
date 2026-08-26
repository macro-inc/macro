use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use sqlx::PgPool;

use super::*;

const CHANNEL_1: &str = "11111111-1111-4111-8111-111111111111";
const CHANNEL_2: &str = "22222222-2222-4222-8222-222222222222";

fn new_surface(parent_type: EntityType, parent_id: &str) -> CollabSurface {
    let now = chrono::Utc::now();
    CollabSurface {
        id: macro_uuid::generate_uuid_v7(),
        parent: parent_type.with_entity_string(parent_id.to_string()),
        state: SurfaceState::Pending,
        created_at: now,
        updated_at: now,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn surface_round_trips(pool: PgPool) {
    let repo = PgCollabSurfaceRepo::new(pool);
    let surface = new_surface(EntityType::Channel, CHANNEL_1);
    assert!(repo.insert(&surface).await.unwrap());

    let read = repo.get(surface.id).await.unwrap().unwrap();
    assert_eq!(read.id, surface.id);
    assert_eq!(read.parent.entity_type, EntityType::Channel);
    assert_eq!(read.parent.entity_id.as_ref(), CHANNEL_1);
    assert_eq!(read.state, SurfaceState::Pending);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_ready_flips_state(pool: PgPool) {
    let repo = PgCollabSurfaceRepo::new(pool);
    let surface = new_surface(EntityType::Document, CHANNEL_1);
    repo.insert(&surface).await.unwrap();
    repo.mark_ready(surface.id).await.unwrap();

    let read = repo.get(surface.id).await.unwrap().unwrap();
    assert_eq!(read.state, SurfaceState::Ready);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soft_deleted_surfaces_read_as_absent(pool: PgPool) {
    let repo = PgCollabSurfaceRepo::new(pool);
    let surface = new_surface(EntityType::Channel, CHANNEL_1);
    repo.insert(&surface).await.unwrap();
    repo.soft_delete(surface.id).await.unwrap();

    assert!(repo.get(surface.id).await.unwrap().is_none());
    // Idempotent: deleting again is a no-op, not an error.
    repo.soft_delete(surface.id).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_conflicts_read_as_not_inserted(pool: PgPool) {
    let repo = PgCollabSurfaceRepo::new(pool);
    let surface = new_surface(EntityType::Channel, CHANNEL_1);
    assert!(repo.insert(&surface).await.unwrap());

    // Same id again (a racing ensure): no error, no insert, row unchanged.
    let racer = CollabSurface {
        parent: EntityType::Channel.with_entity_string(CHANNEL_2.to_string()),
        ..surface.clone()
    };
    assert!(!repo.insert(&racer).await.unwrap());
    let read = repo.get(surface.id).await.unwrap().unwrap();
    assert_eq!(read.parent.entity_id.as_ref(), CHANNEL_1);

    // A soft-deleted id also conflicts (and stays invisible to `get`),
    // which is what makes deleted ids unreusable.
    repo.soft_delete(surface.id).await.unwrap();
    assert!(!repo.insert(&surface).await.unwrap());
    assert!(repo.get(surface.id).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_by_parent_scopes_to_the_parent_and_skips_deleted(pool: PgPool) {
    let repo = PgCollabSurfaceRepo::new(pool);
    let a = new_surface(EntityType::Channel, CHANNEL_1);
    let b = new_surface(EntityType::Channel, CHANNEL_1);
    let other = new_surface(EntityType::Channel, CHANNEL_2);
    let deleted = new_surface(EntityType::Channel, CHANNEL_1);
    for s in [&a, &b, &other, &deleted] {
        repo.insert(s).await.unwrap();
    }
    repo.soft_delete(deleted.id).await.unwrap();

    let listed = repo
        .list_by_parent(&EntityType::Channel.with_entity_string(CHANNEL_1.to_string()))
        .await
        .unwrap();
    let ids: Vec<Uuid> = listed.iter().map(|s| s.id).collect();
    assert_eq!(ids, vec![a.id, b.id]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_by_parent_with_non_uuid_parent_reads_empty(pool: PgPool) {
    let repo = PgCollabSurfaceRepo::new(pool);
    let listed = repo
        .list_by_parent(&EntityType::Channel.with_entity_string("not-a-uuid".to_string()))
        .await
        .unwrap();
    assert!(listed.is_empty());
}
