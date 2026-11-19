//! A subscriber for tests that read the spans a flow opened: each span's
//! name, its parent's name, and every `outcome` it recorded.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tracing::span::{Attributes, Id, Record};

#[derive(Default)]
pub(crate) struct Spans {
    next: AtomicU64,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    names: HashMap<u64, &'static str>,
    parents: HashMap<u64, u64>,
    entered: Vec<u64>,
    outcomes: Vec<(&'static str, String)>,
}

impl Spans {
    /// Collects the spans this thread opens until the guard drops.
    pub(crate) fn capture() -> (Arc<Self>, tracing::dispatcher::DefaultGuard) {
        let spans = Arc::new(Self::default());
        let guard = tracing::dispatcher::set_default(&tracing::Dispatch::new(Arc::clone(&spans)));
        // A callsite another test thread reached first, with no subscriber,
        // cached that nothing wants it. Rebuilding fixes the ones registered
        // by now; one that thread was still registering misses the first
        // rebuild, so rebuild again once it has finished.
        tracing::callsite::rebuild_interest_cache();
        std::thread::sleep(std::time::Duration::from_millis(20));
        tracing::callsite::rebuild_interest_cache();
        (spans, guard)
    }

    /// The outcomes spans named `name` recorded, in order.
    pub(crate) fn outcomes(&self, name: &str) -> Vec<String> {
        let state = self.state.lock().unwrap();
        state
            .outcomes
            .iter()
            .filter(|(span, _)| *span == name)
            .map(|(_, outcome)| outcome.clone())
            .collect()
    }

    /// The name of the parent of each span named `name`, in the order they
    /// were opened; `None` for a root.
    pub(crate) fn parents(&self, name: &str) -> Vec<Option<&'static str>> {
        let state = self.state.lock().unwrap();
        let mut ids: Vec<_> = state
            .names
            .iter()
            .filter(|(_, span)| **span == name)
            .map(|(id, _)| *id)
            .collect();
        ids.sort_unstable();
        ids.iter()
            .map(|id| state.parents.get(id).map(|parent| state.names[parent]))
            .collect()
    }
}

struct Outcome<'a>(&'a mut Option<String>);

impl tracing::field::Visit for Outcome<'_> {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "outcome" {
            *self.0 = Some(value.to_owned());
        }
    }

    fn record_debug(&mut self, _: &tracing::field::Field, _: &dyn std::fmt::Debug) {}
}

impl tracing::Subscriber for Spans {
    fn enabled(&self, _: &tracing::Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, attributes: &Attributes<'_>) -> Id {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let mut state = self.state.lock().unwrap();
        let parent = match attributes.parent() {
            Some(parent) => Some(parent.into_u64()),
            None if attributes.is_contextual() => state.entered.last().copied(),
            None => None,
        };
        state.names.insert(id, attributes.metadata().name());
        if let Some(parent) = parent {
            state.parents.insert(id, parent);
        }
        Id::from_u64(id)
    }

    fn record(&self, span: &Id, values: &Record<'_>) {
        let mut outcome = None;
        values.record(&mut Outcome(&mut outcome));
        if let Some(outcome) = outcome {
            let mut state = self.state.lock().unwrap();
            let name = state.names[&span.into_u64()];
            state.outcomes.push((name, outcome));
        }
    }

    fn record_follows_from(&self, _: &Id, _: &Id) {}

    fn event(&self, _: &tracing::Event<'_>) {}

    fn enter(&self, span: &Id) {
        self.state.lock().unwrap().entered.push(span.into_u64());
    }

    fn exit(&self, span: &Id) {
        let mut state = self.state.lock().unwrap();
        if let Some(at) = state.entered.iter().rposition(|id| *id == span.into_u64()) {
            state.entered.remove(at);
        }
    }
}
