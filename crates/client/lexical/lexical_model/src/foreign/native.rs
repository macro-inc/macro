//! One-shot native-super dispatch for the development foreign-node host.
use crate::*;
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub(crate) struct NativeCalls(Mutex<Vec<Call>>);
struct Call {
    token: Arc<()>,
    key: NodeKey,
    hook: ForeignHook,
    consumed: bool,
    thread: std::thread::ThreadId,
}
struct Scope {
    calls: Arc<NativeCalls>,
    token: Arc<()>,
}
impl Drop for Scope {
    fn drop(&mut self) {
        self.calls
            .0
            .lock()
            .expect("native hook scopes")
            .retain(|call| !Arc::ptr_eq(&call.token, &self.token));
    }
}
impl NativeCalls {
    fn enter(self: &Arc<Self>, key: NodeKey, hook: ForeignHook) -> Scope {
        let token = Arc::new(());
        self.0.lock().expect("native hook scopes").push(Call {
            token: token.clone(),
            key,
            hook,
            consumed: false,
            thread: std::thread::current().id(),
        });
        Scope {
            calls: self.clone(),
            token,
        }
    }
    pub(crate) fn consume(&self, key: NodeKey, hook: ForeignHook) -> bool {
        let mut calls = self.0.lock().expect("native hook scopes");
        let thread = std::thread::current().id();
        let Some(call) = calls.iter_mut().rev().find(|call| call.thread == thread) else {
            return false;
        };
        if call.consumed || call.key != key || call.hook != hook {
            return false;
        }
        call.consumed = true;
        true
    }
}
impl Transaction<'_> {
    /// Invoke one operation on a foreign node's nearest registered native ancestor.
    /// Selecting an older native prototype is not supported by this scope.
    ///
    /// Only the first matching vtable dispatch bypasses its foreign ancestor
    /// chain. The native implementation's nested virtual calls dispatch normally.
    /// Scopes belong to this update and executing thread, survive an owned read
    /// capture, and restore
    /// on return or unwinding without holding a lock or transaction borrow.
    /// Import and clone lifecycle hooks have separate construction paths.
    pub fn with_foreign_native<T, E: From<Error>>(
        &mut self,
        key: NodeKey,
        hook: ForeignHook,
        invoke: impl FnOnce(&mut Self) -> Result<T, E>,
    ) -> Result<T, E> {
        if matches!(hook, ForeignHook::Import | ForeignHook::AfterClone) {
            return Err(
                Error::Invariant("native lifecycle hook needs a construction scope").into(),
            );
        }
        self.node_or_err(key)?;
        let _scope = self.foreign_native_calls.enter(key, hook);
        invoke(self)
    }
}

#[cfg(test)]
mod test;
