use super::*;
use crate::domain::{
    models::{ActionTag, Activity, Actor, CommonAction, EntityType},
    ports::ActivityRepo,
    timeline::{ActivityTimeline, TimelineSelection},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn timeline_ids_enforce_entity_and_selection_and_preserve_requested_order(pool: PgPool) {
    let repo = PgActivityRepo::new(pool);
    let rows: Vec<_> = [
        (1, EntityType::Document, "selected", CommonAction::Created),
        (2, EntityType::Document, "selected", CommonAction::Deleted),
        (3, EntityType::Document, "selected", CommonAction::Opened),
        (4, EntityType::Document, "other", CommonAction::Created),
        (5, EntityType::Channel, "selected", CommonAction::Created),
    ]
    .into_iter()
    .map(|(id, kind, entity, action)| {
        Activity::common(
            Uuid::from_u128(id),
            0,
            Actor::new_from_user("macro|test@example.com".to_owned().try_into().unwrap()),
            None,
            kind,
            entity,
            action,
            chrono::Utc::now(),
        )
    })
    .collect();
    repo.insert_activities(&rows).await.unwrap();
    let ids: Vec<_> = rows.iter().rev().map(|row| row.id).collect();
    let read = repo
        .read_ids(ActivityTimelineIdsQuery {
            entity_type: EntityType::Document,
            entity_id: "selected".to_owned(),
            selection: TimelineSelection::new(&[ActionTag::Created, ActionTag::Deleted], &[]),
            ids,
        })
        .await
        .unwrap();
    assert_eq!(
        read.iter().map(|row| row.id).collect::<Vec<_>>(),
        vec![rows[1].id, rows[0].id]
    );
    assert!(
        repo.read_ids(ActivityTimelineIdsQuery {
            entity_type: EntityType::Document,
            entity_id: "selected".to_owned(),
            selection: TimelineSelection::new(&[ActionTag::Created], &[]),
            ids: vec![Uuid::from_u128(1); 201],
        })
        .await
        .is_err()
    );
}
