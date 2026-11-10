//! The mounted synchronous WASM view's pending pure observation.
use crate::BoundaryError;
use lexical_model::{DecoratorObservation, DecoratorRenderObserver, Diff};
#[derive(Default)]
pub(crate) struct DecoratorObserver {
    view: DecoratorRenderObserver,
    pending: Option<PreparedObservation>,
    retired: bool,
    initializing: bool,
}
pub(crate) struct PreparedObservation {
    observation: DecoratorObservation,
    reactivate: bool,
}
impl DecoratorObserver {
    pub(crate) fn prepare(
        &self,
        diff: &mut Diff,
        remount: bool,
    ) -> Result<Option<PreparedObservation>, BoundaryError> {
        if self.retired && !(remount && self.initializing) {
            return Ok(None);
        }
        Ok(Some(PreparedObservation {
            observation: self.view.prepare(diff, remount)?,
            reactivate: remount && self.initializing,
        }))
    }
    pub(crate) fn stage(&mut self, observation: Option<PreparedObservation>) {
        self.pending = observation;
    }
    pub(crate) fn with_initialization<T>(
        &mut self,
        body: impl FnOnce(&mut Self) -> Result<T, BoundaryError>,
    ) -> Result<T, BoundaryError> {
        self.initializing = true;
        let result = body(self);
        self.initializing = false;
        result
    }
    pub(crate) fn expose(&mut self) -> Result<(), BoundaryError> {
        if let Some(observation) = &self.pending {
            self.view.validate(&observation.observation)?;
        }
        if let Some(observation) = self.pending.take() {
            self.view.expose(observation.observation)?;
            if observation.reactivate {
                self.retired = false;
            }
        }
        Ok(())
    }
    pub(crate) fn retire(&mut self) {
        self.pending = None;
        self.view.retire();
        self.retired = true;
    }
}
#[cfg(test)]
mod test;
