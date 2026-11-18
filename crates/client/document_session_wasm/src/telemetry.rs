//! Content-free native cold spans enter the existing host telemetry stream.
use crate::*;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) struct Capture;
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn begin() -> Capture {
    Capture
}
#[cfg(not(target_arch = "wasm32"))]
impl Capture {
    pub(crate) fn finish(self) -> Vec<wire::TelemetryMsg> {
        vec![]
    }
}
/// Messages captured for the current boundary entry.
#[cfg(any(target_arch = "wasm32", test))]
#[derive(Default)]
struct Captured {
    enabled: bool,
    messages: Vec<wire::TelemetryMsg>,
}
#[cfg(any(target_arch = "wasm32", test))]
impl Captured {
    /// Start capturing for an entry. A nested entry (a host callback driving
    /// another session) sets the outer capture aside; `finish` restores it.
    fn begin(&mut self) -> Captured {
        std::mem::replace(
            self,
            Captured {
                enabled: true,
                messages: Vec::new(),
            },
        )
    }
    /// End the entry's capture, restore the enclosing one and return its messages.
    fn finish(&mut self, outer: Captured) -> Vec<wire::TelemetryMsg> {
        std::mem::replace(self, outer).messages
    }
}
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::{cell::RefCell, collections::BTreeMap, sync::Once};
    use tracing::{
        field::{Field, Visit},
        span::{Attributes, Id, Record},
        subscriber::Interest,
        Metadata, Subscriber,
    };
    #[derive(Default)]
    struct State {
        captured: Captured,
        next: u64,
        stack: Vec<u64>,
        refs: BTreeMap<u64, u32>,
    }
    thread_local! {static STATE:RefCell<State>=RefCell::new(State{next:1u64<<63,..State::default()});}
    static INSTALL: Once = Once::new();
    struct HostSubscriber;
    fn message(
        span: u64,
        parent: u64,
        kind: u8,
        name: String,
        attrs: Vec<wire::AttrMsg>,
    ) -> wire::TelemetryMsg {
        wire::TelemetryMsg {
            span,
            parent,
            kind,
            name,
            outcome: String::new(),
            error: false,
            attrs,
        }
    }
    #[derive(Default)]
    struct Fields(Vec<wire::AttrMsg>);
    impl Fields {
        fn add(
            &mut self,
            field: &Field,
            kind: u8,
            text: String,
            unsigned: u64,
            signed: i64,
            flag: bool,
        ) {
            if matches!(
                field.name(),
                "bytes"
                    | "nodes"
                    | "ops"
                    | "outcome"
                    | "history.applied"
                    | "removed"
                    | "formatted"
                    | "restore"
                    | "elapsed_ms"
                    | "frames"
            ) {
                self.0.push(wire::AttrMsg {
                    key: field.name().into(),
                    kind,
                    text,
                    unsigned,
                    signed,
                    flag,
                });
            }
        }
    }
    impl Visit for Fields {
        fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
            self.add(field, 0, format!("{value:?}"), 0, 0, false);
        }
        fn record_str(&mut self, field: &Field, value: &str) {
            self.add(field, 0, value.into(), 0, 0, false);
        }
        fn record_u64(&mut self, field: &Field, value: u64) {
            self.add(field, 1, String::new(), value, 0, false);
        }
        fn record_i64(&mut self, field: &Field, value: i64) {
            self.add(field, 2, String::new(), 0, value, false);
        }
        fn record_bool(&mut self, field: &Field, value: bool) {
            self.add(field, 3, String::new(), 0, 0, value);
        }
    }
    impl Subscriber for HostSubscriber {
        fn enabled(&self, metadata: &Metadata<'_>) -> bool {
            metadata.level() <= &tracing::Level::INFO
                && (metadata.target().starts_with("document_session")
                    || metadata.target().starts_with("lexical_loro"))
                && STATE.with(|s| s.borrow().captured.enabled)
        }
        fn register_callsite(&self, _metadata: &'static Metadata<'static>) -> Interest {
            Interest::sometimes()
        }
        fn new_span(&self, attrs: &Attributes<'_>) -> Id {
            let mut fields = Fields::default();
            attrs.record(&mut fields);
            STATE.with(|state| {
                let mut s = state.borrow_mut();
                s.next += 1;
                let id = s.next;
                let parent = attrs
                    .parent()
                    .map(Id::into_u64)
                    .or_else(|| s.stack.last().copied())
                    .unwrap_or(0);
                s.refs.insert(id, 1);
                s.captured.messages.push(message(
                    id,
                    parent,
                    0,
                    attrs.metadata().name().into(),
                    fields.0,
                ));
                Id::from_u64(id)
            })
        }
        fn record(&self, id: &Id, values: &Record<'_>) {
            let mut fields = Fields::default();
            values.record(&mut fields);
            if !fields.0.is_empty() {
                STATE.with(|s| {
                    s.borrow_mut().captured.messages.push(message(
                        id.into_u64(),
                        0,
                        1,
                        String::new(),
                        fields.0,
                    ))
                });
            }
        }
        fn record_follows_from(&self, _span: &Id, _follows: &Id) {}
        fn event(&self, event: &tracing::Event<'_>) {
            STATE.with(|state| {
                let mut state = state.borrow_mut();
                if let Some(span) = state.stack.last().copied() {
                    state.captured.messages.push(message(
                        span,
                        0,
                        1,
                        event.metadata().name().into(),
                        vec![],
                    ));
                }
            });
        }
        fn enter(&self, id: &Id) {
            STATE.with(|s| s.borrow_mut().stack.push(id.into_u64()));
        }
        fn exit(&self, id: &Id) {
            STATE.with(|s| {
                let mut s = s.borrow_mut();
                if let Some(at) = s.stack.iter().rposition(|v| *v == id.into_u64()) {
                    s.stack.remove(at);
                }
            });
        }
        fn clone_span(&self, id: &Id) -> Id {
            STATE.with(|s| {
                if let Some(count) = s.borrow_mut().refs.get_mut(&id.into_u64()) {
                    *count += 1;
                }
            });
            id.clone()
        }
        fn try_close(&self, id: Id) -> bool {
            STATE.with(|s| {
                let mut s = s.borrow_mut();
                if let Some(count) = s.refs.get_mut(&id.into_u64()) {
                    *count -= 1;
                    if *count > 0 {
                        return false;
                    }
                }
                s.refs.remove(&id.into_u64());
                s.captured
                    .messages
                    .push(message(id.into_u64(), 0, 2, String::new(), vec![]));
                true
            })
        }
    }
    pub(crate) struct Capture {
        outer: Option<Captured>,
    }
    pub(crate) fn begin() -> Capture {
        INSTALL.call_once(|| {
            let _installed = tracing::subscriber::set_global_default(HostSubscriber);
        });
        let outer = STATE.with(|s| s.borrow_mut().captured.begin());
        Capture { outer: Some(outer) }
    }
    impl Capture {
        pub(crate) fn finish(mut self) -> Vec<wire::TelemetryMsg> {
            let outer = self.outer.take().unwrap_or_default();
            STATE.with(|s| s.borrow_mut().captured.finish(outer))
        }
    }
    impl Drop for Capture {
        fn drop(&mut self) {
            if let Some(outer) = self.outer.take() {
                STATE.with(|s| {
                    s.borrow_mut().captured.finish(outer);
                });
            }
        }
    }
}
#[cfg(target_arch = "wasm32")]
pub(crate) use wasm::begin;
#[cfg(test)]
thread_local! {
    static FAIL_APPEND: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
#[cfg(test)]
pub(crate) struct AppendFailure;
#[cfg(test)]
impl Drop for AppendFailure {
    fn drop(&mut self) {
        FAIL_APPEND.with(|flag| flag.set(false));
    }
}
#[cfg(test)]
pub(crate) fn fail_next_append() -> AppendFailure {
    FAIL_APPEND.with(|flag| flag.set(true));
    AppendFailure
}
pub(crate) fn append(
    messages: Vec<wire::TelemetryMsg>,
    buffer: &mut Vec<u8>,
) -> Result<u32, BoundaryError> {
    #[cfg(test)]
    if FAIL_APPEND.with(|flag| flag.replace(false)) {
        return Err(BoundaryError::Invalid("injected telemetry append"));
    }
    if messages.is_empty() {
        return Ok(0);
    }
    if buffer.is_empty() {
        for word in [
            0x4d534553,
            generated::ABI_MAJOR,
            generated::DIFF_FORMAT_VERSION,
            0,
            0,
            0,
        ] {
            buffer.extend(word.to_le_bytes());
        }
    }
    let count = u32::from_le_bytes(
        buffer[20..24]
            .try_into()
            .map_err(|_| BoundaryError::Invalid("telemetry envelope"))?,
    );
    let added = messages.len() as u32;
    for message in messages {
        output::entry(buffer, 8, 0, 0, &bytes(&message)?);
    }
    buffer[20..24].copy_from_slice(&(count + added).to_le_bytes());
    Ok(2)
}
#[cfg(test)]
#[test]
fn a_nested_capture_keeps_the_outer_entry_capturing_its_own_spans() {
    fn span(id: u64) -> wire::TelemetryMsg {
        wire::TelemetryMsg {
            span: id,
            parent: 0,
            kind: 0,
            name: format!("span-{id}"),
            outcome: String::new(),
            error: false,
            attrs: vec![],
        }
    }
    let mut captured = Captured::default();
    let outer = captured.begin();
    captured.messages.push(span(1));
    let inner = captured.begin();
    captured.messages.push(span(2));
    let nested = captured.finish(inner);
    assert_eq!(nested.iter().map(|m| m.span).collect::<Vec<_>>(), vec![2]);
    assert!(captured.enabled, "the outer entry is still capturing");
    captured.messages.push(span(3));
    let all = captured.finish(outer);
    assert_eq!(all.iter().map(|m| m.span).collect::<Vec<_>>(), vec![1, 3]);
    assert!(!captured.enabled);
}
