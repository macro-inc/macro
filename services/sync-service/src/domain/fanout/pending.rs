//! Pending-operation causality and durable notification intent.
use super::{Failure, FanoutDebt};
use loro::VersionVector;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct PendingOperations {
    unresolved: BTreeMap<String, VersionVector>,
    applied: BTreeSet<String>,
    pub(super) debt: Option<FanoutDebt>,
}
impl PendingOperations {
    fn contains(&self, key: &str) -> bool {
        self.applied.contains(key) || self.unresolved.contains_key(key)
    }
    fn resolving_debt(
        &self,
        before: &VersionVector,
        known: &VersionVector,
    ) -> Result<Option<FanoutDebt>, Failure> {
        if !self
            .unresolved
            .values()
            .any(|required| known.includes_vv(required))
        {
            return Ok(None);
        }
        let mut required = known.clone();
        let base = if let Some(debt) = &self.debt {
            let (base, prior_required) = debt.vectors()?;
            required.merge(&prior_required);
            base
        } else {
            before.clone()
        };
        Ok(Some(FanoutDebt {
            base: base.encode(),
            required: required.encode(),
        }))
    }
    pub(crate) fn restore_debt(&mut self, debt: Option<FanoutDebt>) {
        self.debt = debt;
    }
    pub(crate) fn restore_pending(
        &mut self,
        rows: impl IntoIterator<Item = (String, VersionVector)>,
        known: &VersionVector,
    ) {
        self.unresolved.extend(rows);
        let resolved: Vec<_> = self
            .unresolved
            .iter()
            .filter(|(_, required)| known.includes_vv(required))
            .map(|(key, _)| key.clone())
            .collect();
        for key in resolved {
            self.unresolved.remove(&key);
            self.applied.insert(key);
        }
    }
    pub(crate) fn applied_keys(&self) -> impl Iterator<Item = &String> {
        self.applied.iter()
    }
    pub(crate) fn forget_applied(&mut self, key: &str) {
        self.applied.remove(key);
    }
}

/// Access only the room's in-memory causal facts; never perform storage I/O.
pub(crate) trait StatePort {
    fn with_pending<T>(&self, read: impl FnOnce(&mut PendingOperations) -> T) -> T;
}

/// Facts from the actual import, including the update's required operation span.
pub(crate) struct Imported<I> {
    pub before: VersionVector,
    pub known: VersionVector,
    pub required: VersionVector,
    pub value: I,
}

/// Physical log writes and import facts. Keys are opaque to the use case.
pub(crate) trait AppendPort: StatePort {
    type Error: From<Failure>;
    type Imported;
    fn next_key(&self) -> String;
    fn import(&self, update: &[u8]) -> Result<Imported<Self::Imported>, Self::Error>;
    async fn store_debt(&self, debt: &FanoutDebt) -> Result<(), Self::Error>;
    async fn store_pending(&self, key: &str, update: &[u8]) -> Result<(), Self::Error>;
    async fn store_archive(&self, key: &str, update: &[u8]) -> Result<(), Self::Error>;
}

pub(crate) async fn append<P: AppendPort>(
    port: &P,
    update: &[u8],
) -> Result<P::Imported, P::Error> {
    let key = loop {
        let key = port.next_key();
        if !port.with_pending(|state| state.contains(&key)) {
            break key;
        }
    };
    let imported = port.import(update)?;
    let debt =
        port.with_pending(|state| state.resolving_debt(&imported.before, &imported.known))?;
    if let Some(debt) = debt {
        // Intent must precede the parent's pending write, even if that write fails.
        port.store_debt(&debt).await?;
        port.with_pending(|state| state.debt = Some(debt));
    }
    port.store_pending(&key, update).await?;
    port.with_pending(|state| {
        state.restore_pending([(key.clone(), imported.required)], &imported.known)
    });
    port.store_archive(&key, update).await?;
    Ok(imported.value)
}
