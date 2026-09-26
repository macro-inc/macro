use super::*;
mod reads;
use crate::domain::{
    events::{InitiativeEventPublisher, InitiativeMacroEvent, InitiativeTopicEvent},
    history::InitiativeHistory,
    ports::MockInitiativeDescriptionDocuments,
    reads::InitiativePropertySnapshot,
    resources::{InitiativeResources, ResourceFuture},
    service::InitiativeServiceImpl,
};
use crate::inbound::toolset::{InitiativeToolContext, SetTaskInitiative, UpdateInitiativeSharing};
use activity::outbound::pg_activity_repo::PgActivityRepo;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use entity_access::{
    domain::{
        models::{EditAccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, ViewAccessLevel},
        ports::EntityAccessService,
        service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use macro_event_broker::MacroEvent;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[derive(Debug)]
struct UnusedProperties;

impl InitiativeResources for UnusedProperties {
    fn initialize(&self, _: InitiativeId) -> ResourceFuture<'_, ()> {
        panic!("unexpected property initialization")
    }
    fn purge(&self, _: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()> {
        panic!("unexpected property deletion")
    }
    fn view(
        &self,
        _: EntityAccessAuth,
        _: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>> {
        panic!("unexpected child lookup")
    }
    fn properties(
        &self,
        _: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>> {
        panic!("unexpected property read")
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<InitiativeTopicEvent>>);

impl InitiativeEventPublisher for Events {
    fn publish(&self, event: InitiativeMacroEvent) -> ResourceFuture<'_, ()> {
        Box::pin(async move {
            self.0.lock().unwrap().push(event.event().event.clone());
            Ok(())
        })
    }
}

type Context = InitiativeToolContext<
    InitiativeServiceImpl<PgInitiativeRepo, MockInitiativeDescriptionDocuments>,
    EntityAccessServiceImpl<PgAccessRepository>,
    PgActivityRepo,
>;

fn context(pool: PgPool, events: Arc<Events>) -> Context {
    context_with_resources(pool, events, Arc::new(UnusedProperties))
}

fn context_with_resources(
    pool: PgPool,
    events: Arc<Events>,
    resources: Arc<dyn InitiativeResources>,
) -> Context {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    Context {
        service: Arc::new(
            InitiativeServiceImpl::new(
                repo(pool.clone()),
                MockInitiativeDescriptionDocuments::new(),
                resources.clone(),
            )
            .with_event_publisher(events),
        ),
        history: Arc::new(InitiativeHistory::new(
            PgActivityRepo::new(pool),
            access.clone(),
        )),
        access,
        resources,
        actor: bot_id::MACRO_AI_BOT_ID,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tool_moves_from_inaccessible_source_and_clears_after_project_access_is_revoked(
    pool: PgPool,
) -> anyhow::Result<()> {
    for id in [OWNER, MEMBER, OTHER_OWNER] {
        insert_user(&pool, id).await?;
    }
    let task_id = Uuid::now_v7().to_string();
    insert_document(&pool, &task_id, MEMBER, true).await?;
    entity_access_db_utils::upsert_user_entity_access_bulk(
        &pool,
        &[user(MEMBER)],
        &Uuid::parse_str(&task_id)?,
        model_entity::EntityType::Document,
        AccessLevel::Owner,
    )
    .await?;
    let repo = repo(pool.clone());
    let source = repo
        .create(
            create_args(&pool, OTHER_OWNER, "Hidden source", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let destination = repo
        .create(
            create_args(&pool, OWNER, "Destination", &[MEMBER]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    repo.assign_tasks(source.id, vec![task_id.clone()]).await?;
    let events = Arc::new(Events::default());
    let context = context(pool, events.clone());
    assert!(
        context
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user(MEMBER),
                None,
                &source.id.to_string(),
                model_entity::EntityType::Initiative
            )
            .await
            .is_err()
    );

    let moved = SetTaskInitiative {
        task_ids: vec![task_id.clone(), task_id.clone()],
        initiative_id: Some(destination.id.as_uuid()),
    }
    .call(
        ServiceContext(context.clone()),
        RequestContext::new(user(MEMBER)),
    )
    .await
    .map_err(|error| error.internal_error)?;
    assert_eq!(moved.results.len(), 1);
    assert_eq!(moved.results[0].status, "moved");
    let recorded = events.0.lock().unwrap().clone();
    let [InitiativeTopicEvent::TasksChanged(change)] = recorded.as_slice() else {
        panic!("one committed membership change")
    };
    let attribution = change.attribution.as_ref().unwrap();
    assert_eq!(
        attribution.actor.as_ref(),
        bot_id::MACRO_AI_BOT_ID.into_storage_id().as_ref()
    );
    assert_eq!(attribution.on_behalf_of.as_ref(), Some(&user(MEMBER)));
    assert_eq!(change.changes[0].from, Some(source.id));
    assert_eq!(change.changes[0].to, Some(destination.id));

    // The same decorated ActivityReads backs personal GraphQL pages/overview and
    // the ReadActivity MCP tool. Persist both sides of the move to exercise it.
    use activity::domain::ports::{ActivityReads, ActivityRepo};
    use activity::{ActivitySource, Ingest};
    let Ingest::Insert(rows) = recorded[0].ingest(Uuid::now_v7()) else {
        panic!("move activities")
    };
    let activity_repo = PgActivityRepo::new(repo.pool.clone());
    activity_repo.insert_activities(&rows).await?;
    let reads = crate::domain::personal_activity::ProjectVisibleActivityReads::new(
        activity_repo,
        context.access.clone(),
    );
    let feed = reads
        .subject_feed(MEMBER, None, std::num::NonZeroU32::new(10).unwrap())
        .await?;
    assert_eq!(feed.records.len(), 1);
    assert_eq!(feed.records[0].entity_id, destination.id.to_string());
    let range = reads
        .subject_activity_range(
            MEMBER,
            chrono::Utc::now() - chrono::Duration::days(1),
            chrono::Utc::now() + chrono::Duration::days(1),
            std::num::NonZeroU32::new(10).unwrap(),
        )
        .await?;
    assert_eq!(range.records.len(), 1);
    assert_eq!(range.records[0].entity_id, destination.id.to_string());
    let window = activity::trailing_year(chrono::Utc::now(), "UTC".parse().unwrap());
    let overview = reads.subject_overview(MEMBER, window.clone()).await?;
    assert_eq!(overview.top_entities.len(), 1);
    assert_eq!(
        overview.top_entities[0].entity_id,
        destination.id.to_string()
    );

    let mut remove_access = update_args(destination.id);
    remove_access.member_ids_removed = vec![user(MEMBER)];
    repo.update(remove_access).await?;
    assert!(
        reads
            .subject_feed(MEMBER, None, std::num::NonZeroU32::new(10).unwrap())
            .await?
            .records
            .is_empty()
    );
    assert!(
        reads
            .subject_overview(MEMBER, window)
            .await?
            .top_entities
            .is_empty()
    );
    assert!(
        context
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &user(MEMBER),
                None,
                &destination.id.to_string(),
                model_entity::EntityType::Initiative
            )
            .await
            .is_err()
    );
    let cleared = SetTaskInitiative {
        task_ids: vec![task_id.clone()],
        initiative_id: None,
    }
    .call(ServiceContext(context), RequestContext::new(user(MEMBER)))
    .await
    .map_err(|error| error.internal_error)?;
    assert_eq!(cleared.results[0].status, "cleared");
    assert!(repo.task_memberships(vec![task_id]).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sharing_tool_checks_actual_ownership_under_delegated_bot_receipt(
    pool: PgPool,
) -> anyhow::Result<()> {
    for id in [OWNER, MEMBER] {
        insert_user(&pool, id).await?;
    }
    let repo = repo(pool.clone());
    let project = repo
        .create(
            create_args(&pool, OWNER, "Launch", &[MEMBER]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let context = context(pool, Arc::new(Events::default()));
    let tool: UpdateInitiativeSharing = serde_json::from_value(
        serde_json::json!({"initiativeId": project.id.as_uuid(), "linkScope": "public", "linkAccess": "view"}),
    )?;
    let denied = tool
        .call(
            ServiceContext(context.clone()),
            RequestContext::new(user(MEMBER)),
        )
        .await;
    assert!(denied.is_err());
    assert!(
        repo.get_detail(project.id)
            .await?
            .unwrap()
            .share_permission
            .link_share
            .is_none()
    );
    let shared = tool
        .call(ServiceContext(context), RequestContext::new(user(OWNER)))
        .await
        .map_err(|error| error.internal_error)?;
    assert_eq!(shared.link_scope.as_deref(), Some("PUBLIC"));
    assert_eq!(shared.access, "owner");
    Ok(())
}

#[tokio::test]
async fn oversized_tool_batch_fails_before_any_database_access() -> anyhow::Result<()> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")?;
    let context = context(pool, Arc::new(Events::default()));
    let result = SetTaskInitiative {
        task_ids: (0..101).map(|id| id.to_string()).collect(),
        initiative_id: Some(Uuid::now_v7()),
    }
    .call(ServiceContext(context), RequestContext::new(user(OWNER)))
    .await;
    assert!(result.unwrap_err().description.contains("100"));
    Ok(())
}
