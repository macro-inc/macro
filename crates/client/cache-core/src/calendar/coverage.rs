//! Pure interval math over fetched-range coverage.

use super::CalendarSpan;

/// Merges spans per kind into sorted, disjoint, non-adjacent spans. Empty
/// spans are dropped.
pub fn merge_spans(spans: impl IntoIterator<Item = CalendarSpan>) -> Vec<CalendarSpan> {
    let mut spans = spans
        .into_iter()
        .filter(|span| span.end > span.start)
        .collect::<Vec<_>>();
    spans.sort();
    let mut merged: Vec<CalendarSpan> = Vec::with_capacity(spans.len());
    for span in spans {
        match merged.last_mut() {
            Some(last) if last.kind == span.kind && span.start <= last.end => {
                last.end = last.end.max(span.end);
            }
            _ => merged.push(span),
        }
    }
    merged
}

/// Returns the parts of `request` that no coverage span of the same kind covers.
pub fn coverage_gaps(coverage: &[CalendarSpan], request: CalendarSpan) -> Vec<CalendarSpan> {
    if request.end <= request.start {
        return Vec::new();
    }
    let mut gaps = Vec::new();
    let mut cursor = request.start;
    for span in merge_spans(
        coverage
            .iter()
            .copied()
            .filter(|span| span.kind == request.kind),
    ) {
        if span.end <= cursor {
            continue;
        }
        if span.start >= request.end {
            break;
        }
        if span.start > cursor {
            gaps.push(CalendarSpan {
                kind: request.kind,
                start: cursor,
                end: span.start,
            });
        }
        cursor = span.end;
        if cursor >= request.end {
            break;
        }
    }
    if cursor < request.end {
        gaps.push(CalendarSpan {
            kind: request.kind,
            start: cursor,
            end: request.end,
        });
    }
    gaps
}
