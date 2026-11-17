//! Explicit async propagation, independent of trace sampling and subscribers.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::AgentVerb;
use uuid::Uuid;

use crate::scope::SessionScope;

/// What the current work is attributed to, accepted at its boundary.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Attribution {
    /// Code-mode invocation, validated against its agent session.
    pub correlation_id: Option<Uuid>,
    /// Routine whose run the work acts for, from a signed token claim.
    pub routine_id: Option<Uuid>,
    /// The validated invocation's agent session.
    pub session_id: Option<Uuid>,
    /// The scope stored with the validated invocation, else the one the
    /// credential signs. Set without a session when the credential signs a
    /// scope but carries no correlation.
    pub scope: Option<SessionScope>,
    /// Display verb the SDK sent with a validated correlation. Display only;
    /// it is dropped whenever there is no correlation.
    pub verb: Option<AgentVerb>,
}

tokio::task_local! {
    static ATTRIBUTION: Attribution;
    /// Set once the request being handled refused a sharing change.
    static SHARING_REFUSED: Arc<AtomicBool>;
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

/// The agent session behind the current request's validated invocation.
pub fn current_session() -> Option<Uuid> {
    attribution().session_id
}

/// The scope the current request is held to: the one stored with its
/// invocation, else the one its credential signs. It may be set when
/// `current_session` is not.
pub fn current_scope() -> Option<SessionScope> {
    attribution().scope
}

/// A request that changes who an item is shared with, refused to the scope
/// it was made under.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{}", Self::MESSAGE)]
pub struct SharingRefused;

impl SharingRefused {
    /// The refusal's message, for error types that hold a static one.
    pub const MESSAGE: &str = "this session can't change who an item is shared with";
}

/// Whether the current request may change who can see an item: false under
/// a scope that may not share.
pub fn may_share() -> bool {
    current_scope().is_none_or(SessionScope::allows_sharing)
}

/// Refuses a change to who can see an item (`changes_sharing`) when the
/// current request's scope may not share, and records the refusal for the
/// request's boundary (see [`recording_sharing_refusals`]). The writes that
/// grant access call this wherever they are reached from; a route whose
/// sharing fields those writes can't see calls it from its handler.
pub fn refuse_sharing(changes_sharing: bool) -> Result<(), SharingRefused> {
    if !changes_sharing || may_share() {
        return Ok(());
    }
    // Outside a recording request there is nothing to tell.
    let _ = SHARING_REFUSED.try_with(|refused| refused.store(true, Ordering::Relaxed));
    tracing::warn!(
        scope = current_scope().map(SessionScope::as_str),
        agent_session_id = ?current_session(),
        "refused a change to who can see an item"
    );
    Err(SharingRefused)
}

/// Run a request's handling and say whether it refused a sharing change,
/// whatever error the code between the refusal and the boundary made of it.
pub async fn recording_sharing_refusals<F: Future>(future: F) -> (F::Output, bool) {
    let refused = Arc::new(AtomicBool::new(false));
    let output = SHARING_REFUSED.scope(Arc::clone(&refused), future).await;
    (output, refused.load(Ordering::Relaxed))
}

/// Display verb accepted with the current correlation, if any.
pub fn current_verb() -> Option<AgentVerb> {
    attribution().verb
}

/// The routine whose run the current request acts for, if any.
pub fn current_routine() -> Option<Uuid> {
    attribution().routine_id
}

/// Run work with the correlation accepted at its boundary. `None` clears any
/// surrounding context, preventing uncorrelated work from inheriting attribution.
/// Any surrounding routine is cleared too; use [`scope_attribution`] to keep one.
/// A nested scope for the same correlation keeps its verb.
pub async fn scope<F: Future>(id: Option<Uuid>, future: F) -> F::Output {
    let verb = if id.is_some() && id == current() {
        current_verb()
    } else {
        None
    };
    scope_with_verb(id, verb, future).await
}

/// Run work with a correlation and the display verb accepted with it,
/// clearing any surrounding routine.
pub async fn scope_with_verb<F: Future>(
    id: Option<Uuid>,
    verb: Option<AgentVerb>,
    future: F,
) -> F::Output {
    let attribution = Attribution {
        correlation_id: id,
        verb,
        ..Attribution::default()
    };
    scope_attribution(attribution, future).await
}

/// Run work with everything accepted at its boundary, replacing the surrounding
/// context.
pub async fn scope_attribution<F: Future>(attribution: Attribution, future: F) -> F::Output {
    let attribution = Attribution {
        verb: attribution.correlation_id.and(attribution.verb),
        ..attribution
    };
    ATTRIBUTION.scope(attribution, future).await
}

/// Capture attribution before handing a future to another task. The task
/// records its sharing refusals with the request that started it.
pub fn capture<F: Future>(future: F) -> impl Future<Output = F::Output> {
    let attributed = scope_attribution(attribution(), future);
    let refusals = SHARING_REFUSED.try_with(Arc::clone).ok();
    async move {
        match refusals {
            Some(refusals) => SHARING_REFUSED.scope(refusals, attributed).await,
            None => attributed.await,
        }
    }
}

#[cfg(test)]
mod test;
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
            ..Attribution::default()
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
