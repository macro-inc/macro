//! Access checks trace without the viewer's user id, which carries their email.

use super::*;
use std::fmt::Debug;
use std::sync::Mutex as StdMutex;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Subscriber};
use tracing_subscriber::layer::{Context as LayerContext, Layer, SubscriberExt};

/// Every field value a span or event recorded, as `name=value` text.
#[derive(Clone, Default)]
struct RecordedValues(Arc<StdMutex<Vec<String>>>);

impl RecordedValues {
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

impl Visit for RecordedValues {
    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.0
            .lock()
            .unwrap()
            .push(format!("{}={value:?}", field.name()));
    }
}

impl<S: Subscriber> Layer<S> for RecordedValues {
    fn on_new_span(&self, attrs: &Attributes<'_>, _id: &Id, _ctx: LayerContext<'_, S>) {
        attrs.record(&mut self.clone());
    }

    fn on_record(&self, _id: &Id, values: &Record<'_>, _ctx: LayerContext<'_, S>) {
        values.record(&mut self.clone());
    }

    fn on_event(&self, event: &Event<'_>, _ctx: LayerContext<'_, S>) {
        event.record(&mut self.clone());
    }
}

/// Run the checks a project read makes, and the other user-scoped service
/// entry points, including a refused agent session that logs a warning.
async fn check_everything(
    service: &EntityAccessServiceImpl<MockRepo>,
    user_id: &MacroUserIdStr<'_>,
) {
    let _ = service
        .generate_entity_access_receipt::<ViewAccessLevel>(
            user_id,
            None,
            "doc-1",
            EntityType::Document,
        )
        .await;
    let _ = service
        .get_access_level(Some(user_id), "doc-1", EntityType::Document)
        .await;
    let _ = service
        .check_access(
            Some(user_id),
            "doc-1",
            EntityType::Document,
            AccessLevel::View,
        )
        .await;
    let _ = service
        .get_entity_permission(Some(user_id), "doc-1", EntityType::Document, Some(7))
        .await;
    let _ = service
        .get_entity_permission(
            Some(user_id),
            "11111111-1111-1111-1111-111111111111",
            EntityType::AgentSession,
            None,
        )
        .await;
    let _ = service.accessible_databases(user_id).await;
    let _ = service.accessible_forms(user_id).await;
    let _ = service.get_user_team(user_id).await;
}

#[tokio::test]
async fn access_checks_record_no_user_id_on_spans_or_logs() {
    let service =
        EntityAccessServiceImpl::new(MockRepo::new().with_document_access(AccessLevel::Edit));
    let user_id = test_user_id();
    let recorded = RecordedValues::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(recorded.clone()));
    // Register every callsite, then recompute interest on this thread: a test
    // on another thread can have cached "never" for them while this
    // subscriber is installed.
    check_everything(&service, &user_id).await;
    tracing::callsite::rebuild_interest_cache();
    recorded.take();

    check_everything(&service, &user_id).await;

    let values = recorded.take();
    assert!(
        values.iter().any(|value| value.starts_with("entity_id=")),
        "the checks were traced: {values:?}"
    );
    let email = user_id.email_str();
    assert!(!email.is_empty());
    let leaked: Vec<_> = values
        .iter()
        .filter(|value| value.contains(email))
        .collect();
    assert!(leaked.is_empty(), "user ids were recorded: {leaked:?}");
    assert!(
        values.iter().any(|value| value == "signed_in=true"),
        "the refused session logged its viewer as signed in: {values:?}"
    );
}
