//! Ordinary Enter listeners borrow the dispatching transaction, never the session.
use crate::*;
use lexical_model::*;
use std::cell::RefCell;
use std::num::NonZeroU64;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex, Weak,
};
mod exports;
mod failure;
pub use failure::ViewCommandFailure;
mod host;
mod registry;
mod scope;
use scope::*;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Id(NonZeroU64);
impl Id {
    fn issue() -> Result<Self, Error> {
        let id = NEXT_ID
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
            .map_err(|_| Error::Invariant("view command identity exhausted"))?;
        Ok(Self(
            NonZeroU64::new(id).ok_or(Error::Invariant("view command identity zero"))?,
        ))
    }
    fn raw(self) -> u64 {
        self.0.get()
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("ordinary view command callback failed")]
struct CallbackFailure {
    owner: Id,
    invocation: Id,
    scope: Id,
}
trait Host: Send + Sync {
    fn dispatch(&self, call: &Call) -> Result<bool, HostFailure>;
}
enum HostFailure {
    Thrown,
    Protocol,
}
struct Call {
    owner: Id,
    callback: NonZeroU64,
    invocation: Id,
    scope: Id,
    generation: u32,
    access: doc_sync_core::Access,
    programmatic: bool,
}
/// Session-owned logical listener registrations; callback payloads stay in JS.
pub(crate) struct Registry {
    owner: Id,
    state: Mutex<RegistryState>,
    host: Arc<dyn Host>,
}
struct RegistryState {
    entries: Vec<Entry>,
    epoch: u64,
    reports: Vec<failure::Report>,
    failures: std::collections::VecDeque<ViewCommandFailure>,
    retired: std::collections::VecDeque<ViewCommandFailure>,
    issued: Vec<Weak<std::sync::atomic::AtomicBool>>,
    fault: Option<&'static str>,
}
struct Entry {
    handle: Id,
    callback: NonZeroU64,
    priority: CommandPriority,
    listener: Arc<dyn CommandListener>,
    actual: CommandListenerId,
}
struct Listener {
    registry: Weak<Registry>,
    callback: NonZeroU64,
}
struct Invocation {
    allow_callbacks: bool,
    registry: Arc<Registry>,
    id: Id,
    epoch: u64,
    access: doc_sync_core::Access,
}
scoped_tls_hkt::scoped_thread_local!(static INVOCATION: for<'a> &'a Invocation);

impl CommandListener for Listener {
    fn handle(&self, tx: &mut Transaction<'_>, command: &Command) -> Result<Handled, Error> {
        let programmatic = match command {
            Command::Key {
                command: KeyCommand::Enter,
                event,
            } => event.is_none(),
            _ => {
                return Err(Error::Invariant(
                    "view Enter listener received another command",
                ))
            }
        };
        let registry = self
            .registry
            .upgrade()
            .ok_or(Error::Invariant("view listener session closed"))?;
        if !INVOCATION.is_set() {
            return Err(Error::Invariant("view listener lacks invocation"));
        }
        INVOCATION.with(|invocation| {
            if !invocation.allow_callbacks {
                return Err(Error::Invariant(
                    "view command failure acknowledgement required",
                ));
            }
            if !Arc::ptr_eq(&registry, &invocation.registry) {
                return Err(Error::Invariant("foreign view command invocation"));
            }
            let scope = Scope::new(tx, invocation, Id::issue()?);
            let call = Call {
                owner: registry.owner,
                callback: self.callback,
                invocation: invocation.id,
                scope: scope.id(),
                generation: scope.generation(),
                access: invocation.access,
                programmatic,
            };
            tracing::debug_span!("view.command.callback", callback = self.callback.get()).in_scope(
                || {
                    CURRENT.set(&scope, || match registry.host.dispatch(&call) {
                        Ok(handled) => Ok(if handled { Handled::Yes } else { Handled::No }),
                        Err(HostFailure::Thrown) => {
                            Err(Error::Extension(Box::new(CallbackFailure {
                                owner: call.owner,
                                invocation: call.invocation,
                                scope: call.scope,
                            })))
                        }
                        Err(HostFailure::Protocol) => {
                            Err(Error::Invariant("view command host must return boolean"))
                        }
                    })
                },
            )
        })
    }
}

#[cfg(test)]
mod test;
