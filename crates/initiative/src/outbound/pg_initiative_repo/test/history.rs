use super::*;
use crate::domain::{
    events::{
        InitiativeEventActor, InitiativeTasksChanged, InitiativeTopicEvent, TaskMembershipChange,
    },
    history::InitiativeHistory,
};
use activity::domain::ports::ActivityRepo;
use activity::outbound::pg_activity_repo::PgActivityRepo;
use activity::{ActivitySource, Actor, EntityType, Ingest};
use entity_access::{
    domain::{
        models::ViewAccessLevel, ports::EntityAccessService, service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use std::sync::Arc;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn project_history_filters_task_events_until_task_access_is_granted(
    pool: PgPool,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    insert_user(&pool, MEMBER).await?;
    let task_id = Uuid::now_v7().to_string();
    insert_document(&pool, &task_id, OWNER, true).await?;
    let repo = repo(pool.clone());
    let created = repo
        .create(
            create_args(&pool, OWNER, "Shared project", &[MEMBER]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let topic_event = InitiativeTopicEvent::TasksChanged(InitiativeTasksChanged {
        attribution: Some(InitiativeEventActor {
            actor: Actor::new_from_user(user(OWNER)),
            on_behalf_of: None,
        }),
        occurred_at: chrono::Utc::now(),
        changes: vec![TaskMembershipChange {
            task_id: task_id.clone(),
            from: None,
            to: Some(created.id),
        }],
    });
    let Ingest::Insert(rows) = topic_event.ingest(Uuid::now_v7()) else {
        panic!("membership activity");
    };
    let activity_repo = PgActivityRepo::new(pool.clone());
    activity_repo.insert_activities(&rows).await?;
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let receipt = access
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user(MEMBER),
            None,
            &created.id.to_string(),
            EntityType::Initiative,
        )
        .await?;
    let history = InitiativeHistory::new(activity_repo, access);
    let hidden = history.read(receipt.clone(), None, 50).await?;
    assert!(hidden.records.is_empty());

    entity_access_db_utils::upsert_user_entity_access_bulk(
        &pool,
        &[user(MEMBER)],
        &Uuid::parse_str(&task_id)?,
        EntityType::Document,
        AccessLevel::View,
    )
    .await?;
    let visible = history.read(receipt, None, 50).await?;
    assert_eq!(visible.records.len(), 1);
    assert_eq!(visible.records[0].action, "task_added");
    assert_eq!(
        visible.records[0].action_payload.as_ref().unwrap()["task_id"],
        task_id
    );
    Ok(())
}
