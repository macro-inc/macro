use super::*;
use tracing_subscriber::layer::SubscriberExt as _;

/// Every event's fields, as text.
#[derive(Clone, Default)]
struct Events(std::sync::Arc<std::sync::Mutex<Vec<String>>>);

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Events {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        struct Text<'a>(&'a mut String);
        impl tracing::field::Visit for Text<'_> {
            fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                use std::fmt::Write as _;
                let _ = write!(self.0, "{}={value:?} ", field.name());
            }
        }
        let mut text = String::new();
        event.record(&mut Text(&mut text));
        self.0.lock().expect("events lock").push(text);
    }
}

/// A failed tool's error quotes what the call held (an MCP tool's error is
/// its result), so inside `withhold_content` the event says only that the
/// tool failed.
#[tokio::test]
async fn a_withheld_tools_error_is_logged_without_its_text() {
    let events = Events::default();
    let _guard =
        tracing::subscriber::set_default(tracing_subscriber::registry().with(events.clone()));
    let error = anyhow::anyhow!("the private supplier list is locked");
    // Register the callsites, then recompute their interest on this thread:
    // another test's thread can cache them as never wanted.
    log_tool_error("tool error", &error);
    genai_telemetry::withhold_content(async { log_tool_error("tool error", &error) }).await;
    tracing::callsite::rebuild_interest_cache();
    let take = || std::mem::take(&mut *events.0.lock().expect("events lock"));
    take();

    log_tool_error("tool error", &error);
    let shown = take();
    genai_telemetry::withhold_content(async { log_tool_error("tool error", &error) }).await;
    let withheld = take();
    let ([shown], [withheld]) = (shown.as_slice(), withheld.as_slice()) else {
        panic!("one event a failure: {shown:?} {withheld:?}");
    };
    assert!(shown.contains("private supplier"), "{shown}");
    assert!(!withheld.contains("private"), "{withheld}");
    assert!(withheld.contains("tool error"), "{withheld}");
}
