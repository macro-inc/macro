//! Capture-only typed facts from one successfully published main transaction.
use crate::{Commit, Handled, MainCommitOutcome, Transaction};
use std::{any::Any, fmt, marker::PhantomData, sync::Arc};

/// Static identity for a capture-only transaction fact.
///
/// Keys compare by address, not their diagnostic names. Receipts are not plugin
/// events, graph state, history effects or host output.
pub struct ReceiptKey<Value: Clone + fmt::Debug + Send + Sync + 'static> {
    name: &'static str,
    value: PhantomData<fn() -> Value>,
}
impl<Value: Clone + fmt::Debug + Send + Sync + 'static> ReceiptKey<Value> {
    /// Define one static receipt identity.
    pub const fn new(name: &'static str) -> Self {
        Self {
            name,
            value: PhantomData,
        }
    }
}
impl<Value: Clone + fmt::Debug + Send + Sync + 'static> fmt::Debug for ReceiptKey<Value> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("ReceiptKey").field(&self.name).finish()
    }
}

// No public enumeration, raw payload access, Debug or serialization. In
// particular, Commit's manual Clone and Debug never include this storage.
pub(crate) struct Receipt {
    identity: usize,
    value: Arc<dyn Any + Send + Sync>,
}

/// A synchronous, typed reader supplied only at the own-main capture boundary.
///
/// A public Commit does not expose this reader or its private storage; plugin
/// callbacks cannot construct one from their Commit reference.
///
/// ```compile_fail
/// fn inspect(commit: &lexical_model::Commit) {
///     let _ = &commit.receipts;
/// }
/// ```
/// ```compile_fail
/// fn inspect(commit: &lexical_model::Commit) {
///     let _ = commit.receipt_view();
/// }
/// ```
pub struct MainCommitReceiptView<'commit> {
    receipts: &'commit [Receipt],
}
impl<'commit> MainCommitReceiptView<'commit> {
    /// Read only facts under this exact static key, in emission order.
    pub fn values<Value: Clone + fmt::Debug + Send + Sync + 'static>(
        &self,
        key: &'static ReceiptKey<Value>,
    ) -> impl Iterator<Item = &'commit Value> {
        let receipts: &'commit [Receipt] = self.receipts;
        let identity = std::ptr::from_ref(key) as usize;
        receipts.iter().filter_map(move |receipt| {
            if receipt.identity == identity {
                receipt.value.downcast_ref::<Value>()
            } else {
                None
            }
        })
    }
}

/// Native-only observer of the designated main transaction, before follow-ups.
///
/// The supplied borrow grants no editor, node-write, publication or host-callout
/// capability. Implementations copy only their declared typed facts.
pub trait MainCommitReceiptCapture {
    /// Begin one attempt, clearing any result retained from an earlier attempt.
    fn begin(&mut self);
    /// Copy facts from this commit alone; never infer publication from outputs.
    fn capture(&mut self, commit: &Commit, receipts: MainCommitReceiptView<'_>, handled: Handled);
}

/// Borrowed destination for one observed main transaction and its optional facts.
/// No graph or receipt storage is retained by this routing value.
pub struct MainCommitObservation<'observer> {
    outcome: &'observer mut MainCommitOutcome,
    capture: Option<&'observer mut dyn MainCommitReceiptCapture>,
}
impl<'observer> MainCommitObservation<'observer> {
    /// Observe the existing id-only main publication outcome.
    pub fn new(outcome: &'observer mut MainCommitOutcome) -> Self {
        Self {
            outcome,
            capture: None,
        }
    }
    /// Opt into the synchronous own-main typed receipt reader.
    pub fn with_receipts(
        outcome: &'observer mut MainCommitOutcome,
        capture: &'observer mut dyn MainCommitReceiptCapture,
    ) -> Self {
        Self {
            outcome,
            capture: Some(capture),
        }
    }
    pub(crate) fn reset(&mut self) {
        *self.outcome = MainCommitOutcome::NotPublished;
        if let Some(capture) = self.capture.as_deref_mut() {
            capture.begin();
        }
    }
    pub(crate) fn published(&mut self, commit: &Commit, handled: Handled) {
        *self.outcome = MainCommitOutcome::Published {
            commit_id: commit.id,
            handled,
        };
        if let Some(capture) = self.capture.as_deref_mut() {
            capture.capture(commit, commit.receipt_view(), handled);
        }
    }
}

impl Transaction<'_> {
    /// Stage a typed capture-only fact, publishing it with this transaction only.
    ///
    /// This does not dirty the model, emit an event or activate follow-up hooks.
    pub fn emit_receipt<Value: Clone + fmt::Debug + Send + Sync + 'static>(
        &mut self,
        key: &'static ReceiptKey<Value>,
        value: Value,
    ) {
        self.receipts.push(Receipt {
            identity: std::ptr::from_ref(key) as usize,
            value: Arc::new(value),
        });
    }
}
impl Commit {
    pub(crate) fn receipt_view(&self) -> MainCommitReceiptView<'_> {
        MainCommitReceiptView {
            receipts: &self.receipts,
        }
    }
}

#[cfg(test)]
mod test;
