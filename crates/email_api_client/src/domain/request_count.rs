//! Counts the provider requests one unit of work sends, such as the Graph
//! calls that reconcile one message, without threading a counter through
//! every port.

use std::cell::Cell;
use std::future::Future;

#[cfg(test)]
mod test;

tokio::task_local! {
    static SENT: Cell<u32>;
}

/// Run `operation`, returning its output and how many provider requests it
/// sent. Requests from tasks it spawns are not counted.
pub async fn counted<F: Future>(operation: F) -> (F::Output, u32) {
    SENT.scope(Cell::new(0), async {
        let output = operation.await;
        (output, SENT.with(Cell::get))
    })
    .await
}

/// Count one request actually sent to the provider. Outside [`counted`] this
/// does nothing.
pub fn record_sent() {
    let _ = SENT.try_with(|sent| sent.set(sent.get().saturating_add(1)));
}
