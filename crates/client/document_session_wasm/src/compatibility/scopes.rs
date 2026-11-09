//! Per-operation metadata is reborrowed only outside virtual model execution.
use super::*;
use calls::ResultValue;
use lexical_model::Transaction;
use std::cell::RefCell;

trait Metadata {
    fn selection(
        &self,
        tx: &mut Transaction<'_>,
        request: &compat::CompatRequest,
    ) -> Result<Option<ResultValue>, BoundaryError>;
    fn prepare(
        &self,
        request: &compat::CompatRequest,
    ) -> Result<native_calls::NativeCall, BoundaryError>;
}
struct Frame<'a> {
    host: RefCell<&'a mut Host>,
}
impl Metadata for Frame<'_> {
    fn selection(
        &self,
        tx: &mut Transaction<'_>,
        request: &compat::CompatRequest,
    ) -> Result<Option<ResultValue>, BoundaryError> {
        self.host
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("compatibility metadata is executing"))?
            .dispatch_selection(tx, request)
    }
    fn prepare(
        &self,
        request: &compat::CompatRequest,
    ) -> Result<native_calls::NativeCall, BoundaryError> {
        self.host
            .try_borrow_mut()
            .map_err(|_| BoundaryError::Invalid("compatibility metadata is executing"))?
            .prepare_node_call(request)
    }
}
scoped_tls_hkt::scoped_thread_local!(static CURRENT: for<'a> &'a (dyn Metadata + 'a));

pub(super) fn dispatch(
    host: &mut Host,
    tx: &mut Transaction<'_>,
    request: &compat::CompatRequest,
) -> Result<ResultValue, BoundaryError> {
    // Preserve envelope validation even when a selection operation has no node
    // receiver of its own. Selection value/model separation is wired separately.
    if request.has_receiver {
        host.receiver(request)?;
    }
    let frame = Frame {
        host: RefCell::new(host),
    };
    CURRENT.set(&frame, || {
        if let Some(result) = CURRENT.with(|scope| scope.selection(tx, request))? {
            return Ok(result);
        }
        let prepared = CURRENT.with(|scope| scope.prepare(request))?;
        // Both RefCell guards have been dropped before a model hook can run.
        prepared.execute(tx)
    })
}

#[cfg(test)]
mod test;
