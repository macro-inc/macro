//! A project read records what its cost depends on.

use super::*;
use crate::domain::{
    reads::InitiativePropertySnapshot,
    resources::{InitiativeResources, ResourceFuture},
};
use entity_access::domain::models::EntityAccessAuth;
use entity_access::domain::telemetry::record_source_ids;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Instrument, Subscriber};
use tracing_subscriber::layer::{Context as LayerContext, Layer, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

/// How many source ids the fake access check binds.
const SOURCE_IDS: usize = 12;

/// Tasks the viewer can see, then one they can't.
const TASKS: [&str; 4] = ["open", "done", "done-too", "hidden"];

/// Resources whose task checks refuse `hidden` and bind [`SOURCE_IDS`] source
/// ids each, in their own span as the access repository's checks do.
#[derive(Debug)]
struct CheckedTasks;

impl InitiativeResources for CheckedTasks {
    fn initialize(&self, _id: InitiativeId) -> ResourceFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn set_initial_properties(
        &self,
        _owner: MacroUserIdStr<'static>,
        _id: InitiativeId,
        _values: Vec<crate::domain::models::InitialPropertyValue>,
    ) -> ResourceFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn purge(&self, _receipt: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn project_tasks(&self, _id: InitiativeId) -> ResourceFuture<'_, Vec<String>> {
        Box::pin(async { Ok(TASKS.map(String::from).to_vec()) })
    }
    fn view(
        &self,
        auth: EntityAccessAuth,
        entity: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>> {
        let check = tracing::info_span!("check", source_id_count = tracing::field::Empty);
        Box::pin(
            async move {
                record_source_ids(SOURCE_IDS);
                if entity.entity_id == "hidden" {
                    return Ok(None);
                }
                Ok(Some(
                    EntityAccessReceipt::try_new(
                        auth,
                        entity,
                        EntityPermission::AccessLevel {
                            access_level: AccessLevel::View,
                        },
                    )
                    .unwrap(),
                ))
            }
            .instrument(check),
        )
    }
    fn properties(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>> {
        Box::pin(async { Ok(HashMap::new()) })
    }
}

/// Every field a span named [`READ_SPAN`] recorded, typed, in record order.
#[derive(Clone, Default)]
struct ReadFields(Arc<Mutex<Vec<(String, String)>>>);

/// The span a project read opens.
const READ_SPAN: &str = "initiative.read";

impl ReadFields {
    fn all(&self, name: &str) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(field, _)| field == name)
            .map(|(_, value)| value.clone())
            .collect()
    }
}

impl Visit for ReadFields {
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.push(field, format!("i64:{value}"));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.push(field, format!("u64:{value}"));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.push(field, format!("{value:?}"));
    }
}

impl ReadFields {
    fn push(&self, field: &Field, value: String) {
        self.0
            .lock()
            .unwrap()
            .push((field.name().to_string(), value));
    }
}

impl<S: Subscriber + for<'a> LookupSpan<'a>> Layer<S> for ReadFields {
    fn on_new_span(&self, attrs: &Attributes<'_>, _id: &Id, _ctx: LayerContext<'_, S>) {
        if attrs.metadata().name() == READ_SPAN {
            attrs.record(&mut self.clone());
        }
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: LayerContext<'_, S>) {
        if ctx.span(id).is_some_and(|span| span.name() == READ_SPAN) {
            values.record(&mut self.clone());
        }
    }
}

fn read_service() -> TestService {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail()
        .returning(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
    InitiativeServiceImpl::new(
        repo,
        MockInitiativeDescriptionSurfaces::new(),
        Arc::new(CheckedTasks),
    )
}

#[tokio::test]
async fn read_records_the_project_its_task_counts_and_the_viewers_source_ids() {
    let svc = read_service();
    let fields = ReadFields::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(fields.clone()));
    // Register the callsites, then recompute interest on this thread: a test on
    // another thread can have cached "never" for them meanwhile.
    svc.read(view_receipt()).await.unwrap();
    tracing::callsite::rebuild_interest_cache();
    fields.0.lock().unwrap().clear();

    let read = svc.read(view_receipt()).await.unwrap();

    assert_eq!(read.detail().task_ids, ["open", "done", "done-too"]);
    assert_eq!(fields.all("initiative_id"), [initiative_id().to_string()]);
    assert_eq!(
        fields.all("task_count"),
        ["i64:4"],
        "every associated task, once"
    );
    assert_eq!(fields.all("visible_task_count"), ["i64:3"]);
    assert_eq!(
        fields.all("source_id_count"),
        [format!("i64:{SOURCE_IDS}")],
        "the checks' source-id count, recorded once"
    );
}
