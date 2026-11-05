//! Explicit async propagation, independent of trace sampling and subscribers.

use uuid::Uuid;

tokio::task_local! {
    static CORRELATION: Option<Uuid>;
}

/// The invocation accepted at the current request or message boundary.
pub fn current() -> Option<Uuid> {
    CORRELATION.try_with(|id| *id).ok().flatten()
}

/// Run work with the correlation accepted at its boundary. `None` clears any
/// surrounding context, preventing uncorrelated work from inheriting attribution.
pub async fn scope<F: Future>(id: Option<Uuid>, future: F) -> F::Output {
    CORRELATION.scope(id, future).await
}

/// Capture attribution before handing a future to another task.
pub fn capture<F: Future>(future: F) -> impl Future<Output = F::Output> {
    scope(current(), future)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn concurrent_scopes_and_captured_tasks_do_not_leak() {
        let first = Uuid::now_v7();
        let second = Uuid::now_v7();
        let (a, b) = tokio::join!(
            scope(Some(first), async {
                tokio::task::yield_now().await;
                let child = tokio::spawn(capture(async { current() }));
                scope(None, async { assert_eq!(current(), None) }).await;
                assert_eq!(current(), Some(first));
                child.await.unwrap()
            }),
            scope(Some(second), async {
                tokio::task::yield_now().await;
                current()
            }),
        );
        assert_eq!(a, Some(first));
        assert_eq!(b, Some(second));
        assert_eq!(current(), None);
    }
}
