//! The mounted synchronous WASM view's pending pure observation.
use crate::BoundaryError;
use lexical_model::{DecoratorObservation, DecoratorRenderObserver, Diff};
#[derive(Default)]
pub(crate) struct DecoratorObserver {
    view: DecoratorRenderObserver,
    pending: Option<DecoratorObservation>,
}
impl DecoratorObserver {
    pub(crate) fn prepare(
        &self,
        diff: &mut Diff,
        remount: bool,
    ) -> Result<DecoratorObservation, BoundaryError> {
        self.view.prepare(diff, remount).map_err(Into::into)
    }
    pub(crate) fn stage(&mut self, observation: Option<DecoratorObservation>) {
        self.pending = observation;
    }
    pub(crate) fn expose(&mut self) -> Result<(), BoundaryError> {
        if let Some(observation) = &self.pending {
            self.view.validate(observation)?;
        }
        if let Some(observation) = self.pending.take() {
            self.view.expose(observation)?;
        }
        Ok(())
    }
    pub(crate) fn retire(&mut self) {
        self.pending = None;
        self.view.retire();
    }
}
#[cfg(test)]
mod test;
