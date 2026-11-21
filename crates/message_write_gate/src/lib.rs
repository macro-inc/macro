//! Process-wide admission for writes belonging to the same message parent.
//!
//! Acquire before borrowing a database connection and retain the permit until
//! the transaction commits or rolls back. All callers in one process share the
//! same registry; separate processes retain their own admission limits.

#![deny(missing_docs)]

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[cfg(test)]
mod test;

const MAX_IN_FLIGHT: usize = 4;
const MAX_WAIT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct Parent {
    kind: Box<str>,
    id: Box<str>,
}

#[derive(Debug)]
struct Entry {
    semaphore: Arc<Semaphore>,
    // Count both pending acquisitions and returned permits. Arc strong counts
    // are unsuitable: a concurrent final drop could race with registration.
    leases: usize,
}

#[derive(Debug, Default)]
struct Registry {
    entries: Mutex<HashMap<Parent, Entry>>,
}

impl Registry {
    fn register(self: &Arc<Self>, parent_type: &str, parent_id: &str) -> Lease {
        let parent = Parent {
            kind: parent_type.into(),
            id: parent_id.into(),
        };
        let mut entries = self
            .entries
            .lock()
            .expect("write admission registry poisoned");
        let entry = entries.entry(parent.clone()).or_insert_with(|| Entry {
            semaphore: Arc::new(Semaphore::new(MAX_IN_FLIGHT)),
            leases: 0,
        });
        entry.leases += 1;
        Lease {
            registry: self.clone(),
            parent,
            semaphore: entry.semaphore.clone(),
        }
    }

    async fn acquire(
        self: &Arc<Self>,
        parent_type: &str,
        parent_id: &str,
    ) -> Result<WritePermit, AdmissionTimeout> {
        let lease = self.register(parent_type, parent_id);
        let permit = tokio::time::timeout(MAX_WAIT, lease.semaphore.clone().acquire_owned())
            .await
            .map_err(|_| AdmissionTimeout)?
            .expect("write admission semaphores are never closed");
        Ok(WritePermit {
            _permit: permit,
            _lease: PermitLease::Parent(lease),
        })
    }
}

#[derive(Debug)]
struct Lease {
    registry: Arc<Registry>,
    parent: Parent,
    semaphore: Arc<Semaphore>,
}

impl Drop for Lease {
    fn drop(&mut self) {
        let mut entries = self
            .registry
            .entries
            .lock()
            .expect("write admission registry poisoned");
        let entry = entries
            .get_mut(&self.parent)
            .expect("a live admission lease retains its registry entry");
        entry.leases -= 1;
        if entry.leases == 0 {
            entries.remove(&self.parent);
        }
    }
}

/// Admission to one of four concurrent writes for a typed message parent.
///
/// Hold this value through transaction commit or rollback. Dropping it releases
/// admission; it must not be dropped as soon as a database connection is acquired.
#[derive(Debug)]
#[must_use = "hold the admission permit until the write transaction completes"]
pub struct WritePermit {
    // Rust drops fields in declaration order. Return the semaphore slot before
    // the final lease can remove this parent's entry from the registry.
    _permit: OwnedSemaphorePermit,
    _lease: PermitLease,
}

#[derive(Debug)]
enum PermitLease {
    Parent(Lease),
    Scoped(Arc<AdmissionScope>),
}

#[derive(Debug)]
struct AdmissionScope {
    parent: Parent,
    serial: Arc<Semaphore>,
    _outer: WritePermit,
}

tokio::task_local! {
    static ADMISSION: Arc<AdmissionScope>;
}

impl WritePermit {
    fn parent(&self) -> &Parent {
        match &self._lease {
            PermitLease::Parent(lease) => &lease.parent,
            PermitLease::Scoped(scope) => &scope.parent,
        }
    }

    /// Run an operation under admission acquired before a caller-owned lease.
    ///
    /// Nested acquisitions for the same parent reuse this admission, with one
    /// nested writer at a time. Different parents still acquire independently.
    /// The scope belongs to this future, so spawned tasks acquire independently;
    /// do not spawn and await same-parent writes while retaining all four slots.
    /// Cancellation releases admission after all nested permits have dropped.
    pub async fn scope<F: Future>(self, operation: F) -> F::Output {
        let scope = Arc::new(AdmissionScope {
            parent: self.parent().clone(),
            serial: Arc::new(Semaphore::new(1)),
            _outer: self,
        });
        ADMISSION.scope(scope, operation).await
    }
}

impl AdmissionScope {
    async fn acquire(self: Arc<Self>) -> Result<WritePermit, AdmissionTimeout> {
        let permit = tokio::time::timeout(MAX_WAIT, self.serial.clone().acquire_owned())
            .await
            .map_err(|_| AdmissionTimeout)?
            .expect("scoped admission semaphores are never closed");
        Ok(WritePermit {
            _permit: permit,
            _lease: PermitLease::Scoped(self),
        })
    }
}

/// No write slot became available within two seconds.
///
/// No database connection has been acquired by this gate. Callers may expose
/// this as a retryable busy response while preserving this typed cause.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AdmissionTimeout;

impl fmt::Display for AdmissionTimeout {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("message write admission timed out; retry the request")
    }
}

impl std::error::Error for AdmissionTimeout {}

fn registry() -> &'static Arc<Registry> {
    static REGISTRY: OnceLock<Arc<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Arc::new(Registry::default()))
}

/// Wait at most two seconds for one of four write slots for this parent.
///
/// The key includes both parent type and ID. Every caller in this process uses
/// the same registry, independent of repository instance or database pool.
/// Acquire before borrowing a connection and hold the result through commit or
/// rollback. Cancelling this future removes its wait without leaking admission;
/// the final permit or waiter removes an idle parent from the registry.
///
/// `parent_id` must be an opaque identifier: it is recorded on the wait span.
#[tracing::instrument(
    name = "message.write_admission",
    skip_all,
    fields(parent_type = %parent_type, parent_id = %parent_id, outcome = "cancelled"),
    err
)]
pub async fn acquire(parent_type: &str, parent_id: &str) -> Result<WritePermit, AdmissionTimeout> {
    let scope = ADMISSION
        .try_with(|scope| {
            (scope.parent.kind.as_ref() == parent_type && scope.parent.id.as_ref() == parent_id)
                .then(|| scope.clone())
        })
        .ok()
        .flatten();
    let result = match scope {
        Some(scope) => scope.acquire().await,
        None => registry().acquire(parent_type, parent_id).await,
    };
    tracing::Span::current().record(
        "outcome",
        if result.is_ok() {
            "admitted"
        } else {
            "timeout"
        },
    );
    result
}
