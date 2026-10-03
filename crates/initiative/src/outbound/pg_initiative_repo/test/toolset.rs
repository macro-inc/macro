use super::*;
mod reads;
use crate::domain::{
    events::{InitiativeEventPublisher, InitiativeMacroEvent, InitiativeTopicEvent},
    history::InitiativeHistory,
    ports::MockInitiativeDescriptionSurfaces,
    reads::InitiativePropertySnapshot,
    resources::{InitiativeResources, ResourceFuture},
    service::InitiativeServiceImpl,
};
use crate::inbound::toolset::{InitiativeToolContext, UpdateInitiativeSharing};
use activity::outbound::pg_activity_repo::PgActivityRepo;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use entity_access::{
    domain::{
        models::{EditAccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, ViewAccessLevel},
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
    fn set_initial_properties(
        &self,
        _: MacroUserIdStr<'static>,
        _: InitiativeId,
        _: Vec<crate::domain::models::InitialPropertyValue>,
    ) -> ResourceFuture<'_, ()> {
        panic!("unexpected initial properties")
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
    InitiativeServiceImpl<PgInitiativeRepo, MockInitiativeDescriptionSurfaces>,
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
    // ReadInitiative reads the description; these projects have none.
    let mut surfaces = MockInitiativeDescriptionSurfaces::new();
    surfaces
        .expect_read()
        .returning(|_| Box::pin(async { Ok(String::new()) }));
    Context {
        service: Arc::new(
            InitiativeServiceImpl::new(repo(pool.clone()), surfaces, resources.clone())
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
async fn sharing_tool_checks_actual_ownership_under_delegated_bot_receipt(
    pool: PgPool,
) -> anyhow::Result<()> {
    for id in [OWNER, MEMBER] {
        insert_user(&pool, id).await?;
    }
    let repo = repo(pool.clone());
    let project = repo
        .create(
            create_args(OWNER, "Launch", &[MEMBER]),
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
