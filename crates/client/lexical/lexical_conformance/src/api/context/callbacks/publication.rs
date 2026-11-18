//! Exact-state read authority scoped to fallible commit preparation.
use super::*;
use lexical_model::{ForeignReadContext, ForeignReadLease};
use std::borrow::Cow;

pub(super) struct PreparedRead {
    pub(super) state: EditorState,
    pub(super) source: ForeignReadContext,
    pub(super) lease: ForeignReadLease,
}
struct Preparation<'scope> {
    frames: &'scope Frames,
    prepared: Arc<PreparedRead>,
}
impl Drop for Preparation<'_> {
    fn drop(&mut self) {
        let removed = {
            let Ok(mut slot) = self.frames.publication.lock() else {
                return;
            };
            if slot
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &self.prepared))
            {
                slot.take()
            } else {
                None
            }
        };
        drop(removed);
    }
}
impl Context {
    pub(crate) fn with_prepared_reads<T>(
        &self,
        source: ForeignReadContext,
        state: &EditorState,
        prepare: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        if self.scope != Scope::Publishing {
            return Err(fail("prepared reads require a finished API update"));
        }
        let active = self.frames.current()?;
        if !source.matches_origin(&active.owner, &active.update) || !source.matches_read_lease(None)
        {
            return Err(fail(
                "prepared read context belongs to another editor or update",
            ));
        }
        let prepared = Arc::new(PreparedRead {
            state: state.clone(),
            source,
            lease: ForeignReadLease::default(),
        });
        {
            let mut slot = self
                .frames
                .publication
                .lock()
                .map_err(|_| fail("prepared read store poisoned"))?;
            if slot.is_some() {
                return Err(fail("prepared reads are already active"));
            }
            *slot = Some(prepared.clone());
        }
        let _scope = Preparation {
            frames: &self.frames,
            prepared,
        };
        prepare()
    }
}
impl Frames {
    pub(super) fn read_capture<'capture>(
        &self,
        snapshot: &'capture ForeignReadSnapshot,
    ) -> Result<Cow<'capture, ForeignReadSnapshot>> {
        let active = self.current()?;
        if self.captured(snapshot).is_ok() {
            return Ok(Cow::Borrowed(snapshot));
        }
        let prepared = self
            .publication
            .lock()
            .map_err(|_| fail("prepared read store poisoned"))?
            .clone();
        if !active.mutable
            && let Some(prepared) = prepared
            && prepared
                .source
                .matches_origin(&active.owner, &active.update)
            && snapshot.is_originless_capture_of(&prepared.state)
        {
            return Ok(Cow::Owned(
                snapshot.with_read_context_from(&prepared.source, &prepared.lease)?,
            ));
        }
        Err(fail("callback capture belongs to another editor or update"))
    }
}

#[cfg(test)]
mod test;
