//! A document check is traced, without the viewer's user id.

use super::*;
use std::fmt::Debug;
use std::sync::{Arc, Mutex};
use tracing::Subscriber;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing_subscriber::layer::{Context as LayerContext, Layer, SubscriberExt};
use tracing_subscriber::registry::LookupSpan;

/// Every span started, as its name, and every value a span recorded, as
/// `span.field=value` text.
#[derive(Clone, Default)]
struct SpanValues(Arc<Mutex<Vec<String>>>);

/// Formats one span's values into [`SpanValues`].
struct SpanVisitor<'a> {
    span: &'static str,
    values: &'a SpanValues,
}

impl Visit for SpanVisitor<'_> {
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.push(field, format!("i64:{value}"));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        self.push(field, format!("{value:?}"));
    }
}

impl SpanVisitor<'_> {
    fn push(&self, field: &Field, value: String) {
        self.values
            .0
            .lock()
            .unwrap()
            .push(format!("{}.{}={value}", self.span, field.name()));
    }
}

impl<S: Subscriber + for<'a> LookupSpan<'a>> Layer<S> for SpanValues {
    fn on_new_span(&self, attrs: &Attributes<'_>, _id: &Id, _ctx: LayerContext<'_, S>) {
        let span = attrs.metadata().name();
        self.0.lock().unwrap().push(span.to_owned());
        attrs.record(&mut SpanVisitor { span, values: self });
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: LayerContext<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        values.record(&mut SpanVisitor {
            span: span.name(),
            values: self,
        });
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_team"))
)]
async fn document_check_is_traced_without_the_user_id(pool: PgPool) -> anyhow::Result<()> {
    let viewer = user_id(TEAM_MEMBER);
    let repo = PgAccessRepository::new(pool);
    let document_id = Uuid::now_v7().to_string();

    let values = SpanValues::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(values.clone()));
    // Register the callsites, then recompute interest on this thread: a test on
    // another thread can have cached "never" for them meanwhile.
    repo.get_document_access(&document_id, Some(&viewer))
        .await?;
    tracing::callsite::rebuild_interest_cache();
    values.0.lock().unwrap().clear();

    repo.get_document_access(&document_id, Some(&viewer))
        .await?;

    let values = values.0.lock().unwrap().clone();
    assert!(
        values.iter().any(|value| value == "get_document_access"),
        "the check opens its span: {values:?}"
    );
    let leaked: Vec<_> = values
        .iter()
        .filter(|value| value.contains(viewer.email_str()))
        .collect();
    assert!(
        leaked.is_empty(),
        "spans recorded the viewer's email: {leaked:?}"
    );
    Ok(())
}
