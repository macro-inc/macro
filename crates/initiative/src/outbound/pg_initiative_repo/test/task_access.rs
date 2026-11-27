//! A project read checks its tasks' access together, through the real access
//! service: its statement count does not grow with the project's task count.

use super::initial_properties::{Harness, harness};
use super::*;
use crate::domain::{
    ports::{InitiativeService, MockInitiativeDescriptionSurfaces},
    service::InitiativeServiceImpl,
};
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use sqlx::{ConnectOptions, postgres::PgPoolOptions};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tracing::{
    Event, Metadata,
    span::{Attributes, Id, Record},
    subscriber::Interest,
};

/// The target sqlx logs every executed statement under.
const SQLX_STATEMENTS: &str = "sqlx::query";

/// Counts the statements sqlx executes on this thread.
#[derive(Clone, Default)]
struct Statements(Arc<AtomicUsize>);

impl Statements {
    fn take(&self) -> usize {
        self.0.swap(0, Ordering::Relaxed)
    }
}

impl tracing::Subscriber for Statements {
    fn register_callsite(&self, _: &'static Metadata<'static>) -> Interest {
        Interest::sometimes()
    }
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target() == SQLX_STATEMENTS
    }
    fn new_span(&self, _: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }
    fn record(&self, _: &Id, _: &Record<'_>) {}
    fn record_follows_from(&self, _: &Id, _: &Id) {}
    fn event(&self, _: &Event<'_>) {
        self.0.fetch_add(1, Ordering::Relaxed);
    }
    fn enter(&self, _: &Id) {}
    fn exit(&self, _: &Id) {}
}

/// A project owned by `owner` holding `tasks` tasks, each carrying the owner
/// grant task creation writes.
async fn project_with_tasks(
    pool: &PgPool,
    owner: &str,
    tasks: usize,
) -> anyhow::Result<(InitiativeId, Vec<String>)> {
    insert_user(pool, owner).await?;
    let project = repo(pool.clone())
        .create(
            create_args(owner, "Launch", &[]),
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let mut ids = Vec::with_capacity(tasks);
    for _ in 0..tasks {
        let id = Uuid::now_v7();
        insert_document(pool, &id.to_string(), owner, true).await?;
        entity_access_db_utils::upsert_user_entity_access_bulk(
            &mut *pool.acquire().await?,
            &[user(owner)],
            &id,
            entity_access_db_utils::EntityType::Document,
            AccessLevel::Owner,
        )
        .await?;
        set_project(pool, &id.to_string(), project.id).await?;
        ids.push(id.to_string());
    }
    ids.sort();
    Ok((project.id, ids))
}

/// Statements a project page's read and summary run, and the tasks it shows.
async fn read_and_summarize(
    harness: &Harness,
    service: &InitiativeServiceImpl<PgInitiativeRepo, MockInitiativeDescriptionSurfaces>,
    statements: &Statements,
    owner: &str,
    project: InitiativeId,
) -> anyhow::Result<(usize, Vec<String>)> {
    let receipt = harness
        .access
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user(owner),
            None,
            &project.to_string(),
            EntityType::Initiative,
        )
        .await?;
    statements.take();
    let read = service.read(receipt).await?;
    service.summarize(&read).await?;
    let count = statements.take();
    let mut shown = read.detail().task_ids.clone();
    shown.sort();
    Ok((count, shown))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reading_a_project_checks_its_tasks_together(pool: PgPool) -> anyhow::Result<()> {
    let statements = Statements::default();
    let _guard = tracing::subscriber::set_default(statements.clone());
    // Separate owners: the access service caches each user's sources briefly,
    // so neither read finds the other's lookup cached.
    let small_owner = "macro|task-access-small@corp.test";
    let large_owner = "macro|task-access-large@corp.test";
    let (small, small_tasks) = project_with_tasks(&pool, small_owner, 3).await?;
    let (large, large_tasks) = project_with_tasks(&pool, large_owner, 40).await?;
    // Statements ran above, so sqlx's callsites exist; recompute their interest
    // on this thread in case another test's thread registered them first.
    tracing::callsite::rebuild_interest_cache();

    // Read over one connection, warmed by a first read: sqlx looks up custom
    // types once per connection, and those lookups would land in whichever
    // measured read came first. No statement counts as slow, because sqlx logs
    // slow ones from other callsites, which another test's thread may have
    // registered with no subscriber.
    let options = (*pool.connect_options())
        .clone()
        .log_slow_statements(log::LevelFilter::Warn, Duration::MAX);
    let measured = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    let harness = harness(&measured);
    let service = InitiativeServiceImpl::new(
        repo(measured.clone()),
        MockInitiativeDescriptionSurfaces::new(),
        harness.resources.clone(),
    );
    read_and_summarize(&harness, &service, &statements, small_owner, small).await?;
    let (small_count, small_shown) =
        read_and_summarize(&harness, &service, &statements, small_owner, small).await?;
    let (large_count, large_shown) =
        read_and_summarize(&harness, &service, &statements, large_owner, large).await?;
    measured.close().await;

    assert_eq!(small_shown, small_tasks);
    assert_eq!(large_shown, large_tasks);
    assert!(small_count > 0, "no statements were counted");
    assert_eq!(
        large_count, small_count,
        "a 40-task project read ran {large_count} statements, a 3-task one {small_count}"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn project_progress_excludes_trashed_tasks_and_includes_restored_tasks(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::reads::InitiativePageRequest;
    use entity_access::domain::models::OwnerAccessLevel;
    use system_properties::{
        PgSystemPropertiesRepository, StatusOption, SystemPropertiesService,
        SystemPropertiesServiceImpl,
    };

    let (project, ids) = project_with_tasks(&pool, OWNER, 27).await?;
    let properties =
        SystemPropertiesServiceImpl::new(PgSystemPropertiesRepository::new(pool.clone()));
    properties.attach_task_properties(ids.clone()).await?;
    for id in &ids {
        set_project(&pool, id, project).await?;
    }
    for id in &ids[..9] {
        properties
            .update_task_status(id, StatusOption::Completed)
            .await?;
    }
    let harness = harness(&pool);
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    surfaces
        .expect_delete()
        .return_once(|_| Box::pin(async { Ok(()) }));
    let service =
        InitiativeServiceImpl::new(repo(pool.clone()), surfaces, harness.resources.clone());
    let receipt = harness
        .access
        .generate_entity_access_receipt::<ViewAccessLevel>(
            &user(OWNER),
            None,
            &project.to_string(),
            EntityType::Initiative,
        )
        .await?;

    for (changed, trashed, total, completed) in [
        (&ids[..0], false, 27, 9),
        (&ids[11..], true, 11, 9),
        (&ids[..1], true, 10, 8),
        (&ids[..1], false, 11, 9),
        (&ids[..], true, 0, 0),
    ] {
        sqlx::query!(
            r#"UPDATE "Document" SET "deletedAt" = CASE WHEN $2 THEN now() ELSE NULL END
               WHERE id = ANY($1)"#,
            changed,
            trashed,
        )
        .execute(&pool)
        .await?;

        let read = service.read(receipt.clone()).await?;
        let summary = service.summarize(&read).await?;
        assert_eq!(summary.task_count, total);
        assert_eq!(summary.completed_task_count, completed);
        assert_eq!(read.detail().task_ids.len(), total as usize);

        let page = service
            .page(&user(OWNER), InitiativePageRequest::default())
            .await?;
        assert_eq!(page.initiatives.len(), 1);
        assert_eq!(page.initiatives[0].task_count, total);
        assert_eq!(page.initiatives[0].completed_task_count, completed);
    }

    // Deleting the project still detaches its trashed tasks, so restoring one
    // cannot bring back a reference to a project that no longer exists.
    let owner = harness
        .access
        .generate_entity_access_receipt::<OwnerAccessLevel>(
            &user(OWNER),
            None,
            &project.to_string(),
            EntityType::Initiative,
        )
        .await?;
    service.delete(owner).await?;
    assert!(
        properties
            .project_task_ids(project.as_uuid(), None)
            .await?
            .is_empty()
    );
    Ok(())
}
