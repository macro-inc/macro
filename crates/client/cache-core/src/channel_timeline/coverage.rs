//! Pure interval math over fetched timeline stretches.

use super::TimelineSpan;

/// Merges spans of one scope into sorted, disjoint spans. Bounds are
/// inclusive, so spans that share an endpoint join.
pub fn merge_spans(spans: impl IntoIterator<Item = TimelineSpan>) -> Vec<TimelineSpan> {
    let mut spans = spans
        .into_iter()
        .filter(|span| span.start <= span.end)
        .collect::<Vec<_>>();
    spans.sort();
    let mut merged: Vec<TimelineSpan> = Vec::with_capacity(spans.len());
    for span in spans {
        match merged.last_mut() {
            Some(last) if span.start <= last.end => {
                if span.end > last.end {
                    last.end = span.end;
                }
            }
            _ => merged.push(span),
        }
    }
    merged
}

/// The fetched stretch that holds `position`, if any.
pub fn covering_span<'a>(spans: &'a [TimelineSpan], position: &str) -> Option<&'a TimelineSpan> {
    spans
        .iter()
        .find(|span| span.start.as_str() <= position && position <= span.end.as_str())
}
