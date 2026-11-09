//! Exact capture leases survive graph retirement and prune only touched indexes.
use super::*;

impl Host {
    pub(super) fn pin_batch_inputs(
        &mut self,
        owner: capture_leases::NativeOwner,
        operations: &[compat::CompatBatchOperation],
    ) -> Result<(), BoundaryError> {
        let mut input_captures = Vec::new();
        for operation in operations {
            if let compat::CompatNodeOperand::CompatCapturedNode { record } = &operation.receiver {
                input_captures.push(record.capture_id);
            }
            for argument in &operation.args {
                match argument {
                    compat::CompatBatchArgument::CompatNodeArgument {
                        value: compat::CompatNodeOperand::CompatCapturedNode { record },
                    } => input_captures.push(record.capture_id),
                    compat::CompatBatchArgument::CompatNodeArrayArgument { values } => {
                        for value in values {
                            if let compat::CompatNodeOperand::CompatCapturedNode { record } = value
                            {
                                input_captures.push(record.capture_id);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        self.capture_leases.hold(owner, &input_captures)?;
        Ok(())
    }
    pub(super) fn remove_captures(&mut self, ids: Vec<u64>) {
        for id in ids {
            let capture = self
                .captures
                .remove(&id)
                .expect("capture ledger/map invariant");
            self.capture_index.remove(&capture);
        }
    }
    pub(super) fn apply_capture_leases(
        &mut self,
        request: &compat::CompatCaptureLeases,
    ) -> Result<(), BoundaryError> {
        let next = self
            .retirement_epoch
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("capture retirement epoch exhausted"))?;
        let removed = self.capture_leases.apply(request)?;
        self.remove_captures(removed);
        self.preserve_capture_emissions = true;
        // This is a completed explicit metadata/prune acknowledgement, including
        // valid empty requests. It neither collects JS nor publishes a graph.
        self.retirement_epoch = next;
        Ok(())
    }
    pub(super) fn abandon_capture_graph(&mut self, version: u64) {
        let removed = if self.preserve_capture_emissions {
            self.capture_leases.abandon_graph(version)
        } else {
            // Legacy diagnostic calls do not emit the compact receipt protocol.
            self.capture_leases.retire_graph(version)
        };
        self.remove_captures(removed);
    }
}
impl EditorSession {
    pub(super) fn compat_capture_leases_inner(
        &mut self,
        input: &[u8],
    ) -> Result<(), BoundaryError> {
        let request = compat::CompatCaptureLeases::deserialize(input)?;
        let (host, _) = self.compat_parts()?;
        host.apply_capture_leases(&request)
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Drain exact retain/release metadata without opening an editor update.
    #[wasm_bindgen(js_name=compatCaptureLeases)]
    pub fn compat_capture_leases(&mut self, input: &[u8]) -> Result<(), JsError> {
        self.compat_capture_leases_inner(input).map_err(js)
    }
}

#[cfg(test)]
mod test;
