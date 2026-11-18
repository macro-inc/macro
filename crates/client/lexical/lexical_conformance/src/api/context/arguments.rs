//! Original indexed-call arguments for the first exact runtime hook dispatch.
use super::*;
use lexical_model::ForeignHook;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub(super) struct HookArguments(Arc<Mutex<Vec<Call>>>);
struct Call {
    token: Arc<()>,
    thread: std::thread::ThreadId,
    key: NodeKey,
    hook: ForeignHook,
    args: Option<Vec<Value>>,
}
pub(super) struct Scope(HookArguments, Arc<()>);
impl Drop for Scope {
    fn drop(&mut self) {
        self.0
            .0
            .lock()
            .expect("hook argument scopes")
            .retain(|call| !Arc::ptr_eq(&call.token, &self.1));
    }
}
impl HookArguments {
    pub fn enter(&self, key: NodeKey, hook: ForeignHook, args: Vec<Value>) -> Scope {
        let token = Arc::new(());
        self.0.lock().expect("hook argument scopes").push(Call {
            token: token.clone(),
            thread: std::thread::current().id(),
            key,
            hook,
            args: Some(args),
        });
        Scope(self.clone(), token)
    }
    pub fn take(&self, key: NodeKey, hook: ForeignHook) -> Option<Vec<Value>> {
        let thread = std::thread::current().id();
        let mut calls = self.0.lock().expect("hook argument scopes");
        let call = calls.iter_mut().rev().find(|call| call.thread == thread)?;
        if call.key != key || call.hook != hook {
            return None;
        }
        call.args.take()
    }
}
