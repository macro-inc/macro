//! Release durable resolved history to every joined reader before retiring debt.
use super::{Failure, FanoutDebt, StatePort};
use loro::VersionVector;

pub(crate) trait DeliveryPort: StatePort {
    type Error: From<Failure>;
    fn known(&self) -> VersionVector;
    fn export_since(&self, base: &VersionVector) -> Result<Vec<u8>, Self::Error>;
    /// Attempt every joined receiver and return failure if any send failed.
    fn notify_all(&self, update: &[u8]) -> Result<(), Self::Error>;
    /// Delete the legacy key before the modern key, or store the advanced debt.
    async fn persist_debt(&self, next: Option<&FanoutDebt>) -> Result<(), Self::Error>;
}

fn resolved_update<P: DeliveryPort>(port: &P) -> Result<Option<Vec<u8>>, P::Error> {
    let Some(debt) = port.with_pending(|state| state.debt.clone()) else {
        return Ok(None);
    };
    let (base, _) = debt.vectors().map_err(Failure::from)?;
    let known = port.known();
    if known == base {
        return Ok(None);
    }
    if !known.includes_vv(&base) {
        return Err(Failure::MissingBase.into());
    }
    port.export_since(&base).map(Some)
}

/// No storage calls occur without debt. Notification success precedes retirement;
/// independently durable progress retains the missing required history.
pub(crate) async fn release<P: DeliveryPort>(port: &P) -> Result<(), P::Error> {
    let Some(update) = resolved_update(port)? else {
        return Ok(());
    };
    port.notify_all(&update)?;
    let Some(debt) = port.with_pending(|state| state.debt.clone()) else {
        return Ok(());
    };
    let (base, mut required) = debt.vectors().map_err(Failure::from)?;
    let known = port.known();
    if !known.includes_vv(&base) {
        return Err(Failure::MissingBase.into());
    }
    let next = if known.includes_vv(&required) {
        None
    } else {
        required.merge(&known);
        Some(FanoutDebt {
            base: known.encode(),
            required: required.encode(),
        })
    };
    port.persist_debt(next.as_ref()).await?;
    port.with_pending(|state| state.debt = next);
    Ok(())
}

/// Preserve the atomic update result's revision and original export order. The
/// preflight fork may omit earlier pending history, so return the actual revision
/// observed before delivery/storage awaits, not a later caller-supplied vector.
pub(crate) async fn release_with_revision<P: DeliveryPort>(
    port: &P,
) -> Result<Option<Vec<u8>>, P::Error> {
    let revision = if resolved_update(port)?.is_some() {
        Some(port.known().encode())
    } else {
        None
    };
    release(port).await?;
    Ok(revision)
}
