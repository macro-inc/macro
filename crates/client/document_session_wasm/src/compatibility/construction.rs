//! Reserved operands keep real ticket authority before and after graph installation.
use super::*;
use lexical_model::*;

pub(super) fn creates(operation: compat::CompatOperation) -> bool {
    use compat::CompatOperation as Op;
    matches!(
        operation,
        Op::CreateText
            | Op::CreateParagraph
            | Op::CreateLineBreak
            | Op::CreateTab
            | Op::CreateHeading
            | Op::CreateRegisteredNode
    )
}
pub(super) fn reserved(
    operand: &compat::CompatNodeOperand,
) -> Result<(u64, NodeKey), BoundaryError> {
    let compat::CompatNodeOperand::CompatReservedNode {
        reservation_id,
        key,
    } = operand
    else {
        return Err(BoundaryError::Invalid(
            "reserved constructor receiver required",
        ));
    };
    Ok((
        *reservation_id,
        NodeKey::from_parts(KeyParts {
            index: key.index,
            generation: key.generation,
        }),
    ))
}
impl Host {
    pub(super) fn validate_batch_operation(
        &self,
        operation: &compat::CompatBatchOperation,
    ) -> Result<(), BoundaryError> {
        self.validate_batch_operand(&operation.receiver)?;
        if creates(operation.operation) {
            let (reservation, key) = reserved(&operation.receiver)?;
            let (_, tickets) = self
                .reservations
                .get(&reservation)
                .ok_or(BoundaryError::Invalid("unissued key reservation"))?;
            if !tickets.contains_key(&key) {
                return Err(BoundaryError::Invalid(
                    "constructor ticket was already consumed",
                ));
            }
            self.instance_runtime
                .as_ref()
                .ok_or(BoundaryError::Invalid(
                    "hosted constructor runtime required",
                ))?
                .prepare_construction(operation.operation, &operation.initial_instance)?;
        } else if !matches!(
            operation.initial_instance,
            compat::CompatInstanceSeed::CompatNoInstanceSeed {}
        ) {
            return Err(BoundaryError::Invalid("unexpected constructor seed"));
        }
        for argument in &operation.args {
            match argument {
                compat::CompatBatchArgument::CompatValueArgument { value } => {
                    if matches!(
                        value,
                        compat::ForeignCallbackValue::ForeignRecordArgument { .. }
                            | compat::ForeignCallbackValue::ForeignNodeArgument { .. }
                            | compat::ForeignCallbackValue::ForeignNodeArrayArgument { .. }
                    ) {
                        return Err(BoundaryError::Invalid(
                            "compact nodes require typed operands",
                        ));
                    }
                    if let compat::ForeignCallbackValue::ForeignSelectionArgument { value } = value
                    {
                        self.selection_values.get(*value)?;
                    }
                }
                compat::CompatBatchArgument::CompatNodeArgument { value } => {
                    self.validate_batch_operand(value)?
                }
                compat::CompatBatchArgument::CompatNodeArrayArgument { values } => {
                    for value in values {
                        self.validate_batch_operand(value)?;
                    }
                }
                compat::CompatBatchArgument::CompatSelectionIntentArgument { .. } => {
                    return Err(BoundaryError::Invalid(
                        "uninstalled selection intent adapter",
                    ));
                }
                _ => return Err(BoundaryError::Invalid("unknown batch argument")),
            }
        }
        Ok(())
    }
    fn validate_batch_operand(
        &self,
        operand: &compat::CompatNodeOperand,
    ) -> Result<(), BoundaryError> {
        match operand {
            compat::CompatNodeOperand::CompatNoNode {} => Ok(()),
            compat::CompatNodeOperand::CompatCapturedNode { record } => {
                self.validate_record(*record)?;
                Ok(())
            }
            compat::CompatNodeOperand::CompatReservedNode { .. } => {
                let (id, key) = reserved(operand)?;
                let (update, tickets) = self
                    .reservations
                    .get(&id)
                    .ok_or(BoundaryError::Invalid("unissued key reservation"))?;
                if *update != self.update
                    || (!tickets.contains_key(&key) && !self.constructed.contains_key(&(id, key)))
                {
                    return Err(BoundaryError::Invalid("key reservation authority"));
                }
                Ok(())
            }
            _ => Err(BoundaryError::Invalid("unknown node operand")),
        }
    }
    pub(super) fn prepare_reserved_creation(
        &mut self,
        operation: &compat::CompatBatchOperation,
    ) -> Result<(instance_runtime::creation::Construction, ForeignReservedKey), BoundaryError> {
        let (id, key) = reserved(&operation.receiver)?;
        let construction = self
            .instance_runtime
            .as_ref()
            .ok_or(BoundaryError::Invalid(
                "hosted constructor runtime required",
            ))?
            .prepare_construction(operation.operation, &operation.initial_instance)?;
        let (update, tickets) = self
            .reservations
            .get_mut(&id)
            .ok_or(BoundaryError::Invalid("unissued key reservation"))?;
        if *update != self.update {
            return Err(BoundaryError::Invalid("constructor update mismatch"));
        }
        let ticket = tickets.remove(&key).ok_or(BoundaryError::Invalid(
            "constructor ticket was already consumed",
        ))?;
        Ok((construction, ticket))
    }
}

#[cfg(test)]
mod test;
