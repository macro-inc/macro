//! A bound on nested Markdown imports. Nested details sections and HTML blockquotes each
//! import their content with a further Markdown conversion, and each adds a tree level, so
//! more than MAX_NODE_DEPTH of them can never commit. Failing as the next one starts keeps
//! arbitrarily nested input from recursing until the stack overflows.
use lexical_markdown::{Error, Result};
use lexical_model::MAX_NODE_DEPTH;
use std::cell::Cell;

std::thread_local! {
    /// Nested imports in progress on this thread.
    static NESTING: Cell<usize> = const { Cell::new(0) };
}
/// One nested import in progress; dropping it leaves that level.
pub(super) struct NestingGuard;
impl NestingGuard {
    pub(super) fn enter() -> Result<Self> {
        NESTING.with(|nesting| {
            let next = nesting.get() + 1;
            if next > MAX_NODE_DEPTH {
                return Err(Error::Model(lexical_model::Error::NestingTooDeep {
                    limit: MAX_NODE_DEPTH,
                }));
            }
            nesting.set(next);
            Ok(Self)
        })
    }
}
impl Drop for NestingGuard {
    fn drop(&mut self) {
        NESTING.with(|nesting| nesting.set(nesting.get().saturating_sub(1)));
    }
}
