use super::testing::{Recorded, context_of};
use super::{adopt, current};

#[test]
fn a_span_joins_the_trace_a_row_kept() {
    let recorded = Recorded::start();
    let admission = tracing::info_span!(parent: None, "admission");
    let kept = admission.in_scope(current);
    assert!(kept.is_some());
    let admitted_in = context_of(&admission);
    drop(admission);

    let run = tracing::info_span!(parent: None, "run");
    adopt(&run, kept.as_deref());
    drop(run);

    let run = recorded.finished("run");
    assert_eq!(run.span_context.trace_id(), admitted_in.trace_id());
    assert_eq!(run.parent_span_id, admitted_in.span_id());
}

#[test]
fn a_row_without_context_starts_its_own_trace() {
    let recorded = Recorded::start();
    for kept in [None, Some("not-a-traceparent")] {
        let run = tracing::info_span!(parent: None, "run");
        adopt(&run, kept);
        drop(run);
        assert_eq!(
            recorded.finished("run").parent_span_id,
            opentelemetry::trace::SpanId::INVALID
        );
    }
    assert_eq!(tracing::Span::none().in_scope(current), None);
}
