//! Owned source reads available only while an infallible payload clone hook runs.
use crate::ForeignReadSnapshot;
use std::{cell::RefCell, marker::PhantomData, rc::Rc, sync::Arc};

thread_local! {
    static SOURCES: RefCell<Vec<(Arc<()>, Option<ForeignReadSnapshot>)>> = const { RefCell::new(Vec::new()) };
}

/// An owned clone input, never a reference to the invoking transaction.
///
/// Hosts must validate this snapshot through their normal read-scope capability.
/// Cloned records are initialized separately and cannot be edited through it.
pub struct ForeignCloneContext;
impl ForeignCloneContext {
    /// Capture the source of the innermost currently executing clone hook.
    pub fn capture() -> Option<ForeignReadSnapshot> {
        SOURCES.with(|sources| {
            sources
                .borrow()
                .last()
                .and_then(|(_, source)| source.clone())
        })
    }
}

pub(super) struct Scope {
    token: Arc<()>,
    _thread: PhantomData<Rc<()>>,
}
impl Scope {
    pub(super) fn enter(source: Option<ForeignReadSnapshot>) -> Self {
        let token = Arc::new(());
        SOURCES.with(|sources| sources.borrow_mut().push((token.clone(), source)));
        Self {
            token,
            _thread: PhantomData,
        }
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        let removed = SOURCES.with(|sources| {
            let mut sources = sources.borrow_mut();
            sources
                .iter()
                .rposition(|(token, _)| Arc::ptr_eq(token, &self.token))
                .map(|index| sources.remove(index))
        });
        drop(removed);
    }
}

#[cfg(test)]
mod test;
