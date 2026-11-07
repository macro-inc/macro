//! Trace facts about access checks, for callers to record on their own spans
//! without threading them through every port.

use std::cell::Cell;
use std::future::Future;

#[cfg(test)]
mod test;

/// The span field an access check records its source-id count on.
pub const SOURCE_ID_COUNT_FIELD: &str = "source_id_count";

tokio::task_local! {
    static SOURCE_IDS: Cell<Option<usize>>;
}

/// Run `operation`, returning its output and the most source ids (the
/// viewer's channels, teams and own id) any access check in it bound. Each
/// check binds the whole list, so it predicts what the checks cost. `None`
/// when no check ran; checks in tasks `operation` spawns are not seen.
pub async fn observe_source_ids<F: Future>(operation: F) -> (F::Output, Option<usize>) {
    SOURCE_IDS
        .scope(Cell::new(None), async {
            let output = operation.await;
            (output, SOURCE_IDS.with(Cell::get))
        })
        .await
}

/// Note that an access check bound `count` source ids: on the current span,
/// when it declares [`SOURCE_ID_COUNT_FIELD`], and for an enclosing
/// [`observe_source_ids`].
pub fn record_source_ids(count: usize) {
    tracing::Span::current().record(SOURCE_ID_COUNT_FIELD, span_count(count));
    let _ = SOURCE_IDS.try_with(|seen| {
        seen.set(Some(seen.get().map_or(count, |most| most.max(count))));
    });
}

/// A count as a span value. tracing-opentelemetry exports unsigned integers
/// as strings, so counts are recorded as `i64`.
pub fn span_count(count: usize) -> i64 {
    i64::try_from(count).unwrap_or(i64::MAX)
}
