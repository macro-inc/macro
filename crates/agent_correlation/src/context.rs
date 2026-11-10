//! Explicit async propagation, independent of trace sampling and subscribers.

use uuid::Uuid;

/// What the current work is attributed to, accepted at its boundary.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Attribution {
    /// Code-mode invocation, validated against its agent session.
    pub correlation_id: Option<Uuid>,
    /// Routine whose run the work acts for, from a signed token claim.
    pub routine_id: Option<Uuid>,
}

tokio::task_local! {
    static ATTRIBUTION: Attribution;
}

fn attribution() -> Attribution {
    ATTRIBUTION
        .try_with(|attribution| *attribution)
        .unwrap_or_default()
}

/// The invocation accepted at the current request or message boundary.
pub fn current() -> Option<Uuid> {
    attribution().correlation_id
}

/// The routine whose run the current request acts for, if any.
pub fn current_routine() -> Option<Uuid> {
    attribution().routine_id
}

/// Run work with the correlation accepted at its boundary. `None` clears any
/// surrounding context, preventing uncorrelated work from inheriting attribution.
/// Any surrounding routine is cleared too; use [`scope_attribution`] to keep one.
pub async fn scope<F: Future>(id: Option<Uuid>, future: F) -> F::Output {
    let attribution = Attribution {
        correlation_id: id,
        routine_id: None,
    };
    scope_attribution(attribution, future).await
}

/// Run work with everything accepted at its boundary, replacing the surrounding
/// context.
pub async fn scope_attribution<F: Future>(attribution: Attribution, future: F) -> F::Output {
    ATTRIBUTION.scope(attribution, future).await
}

/// Capture attribution before handing a future to another task.
pub fn capture<F: Future>(future: F) -> impl Future<Output = F::Output> {
    scope_attribution(attribution(), future)
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

    #[tokio::test]
    async fn routines_are_captured_with_correlation_and_never_leak() {
        let routine = Uuid::now_v7();
        let correlation = Uuid::now_v7();
        let routine_run = Attribution {
            correlation_id: Some(correlation),
            routine_id: Some(routine),
        };
        let (a, b) = tokio::join!(
            scope_attribution(routine_run, async {
                tokio::task::yield_now().await;
                let child = tokio::spawn(capture(async { (current(), current_routine()) }));
                scope(Some(correlation), async {
                    assert_eq!(current_routine(), None);
                })
                .await;
                assert_eq!(current_routine(), Some(routine));
                child.await.unwrap()
            }),
            scope(None, async {
                tokio::task::yield_now().await;
                current_routine()
            }),
        );
        assert_eq!(a, (Some(correlation), Some(routine)));
        assert_eq!(b, None);
        assert_eq!(current_routine(), None);
        let detached = tokio::spawn(async { current_routine() });
        assert_eq!(detached.await.unwrap(), None);
    }
}
