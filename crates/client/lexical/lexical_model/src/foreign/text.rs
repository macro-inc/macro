//! Mutable runtime text operations; native coercion remains in TextNode.
use crate::*;

/// Runtime text setters own the whole operation, rather than returning a value
/// that a second framework write would apply after JS native-super returns.
pub(crate) fn override_operation(
    tx: &mut Transaction<'_>,
    key: NodeKey,
    hook: ForeignHook,
    mut invoke: impl FnMut(&dyn ForeignHooks, &mut Transaction<'_>) -> Override<Result<(), Error>>,
) -> Option<Result<(), Error>> {
    if let Err(error) = ForeignReadOperation::check() {
        return Some(Err(error));
    }
    if tx.foreign_native_calls.consume(key, hook) {
        return None;
    }
    let registry = tx.pending.registry.clone();
    let mut entry = tx.type_index(key).and_then(|index| registry.node(index));
    while let Some(current) = entry {
        let definition = current.foreign.as_ref()?;
        match super::projection::foreign(tx, |tx| invoke(definition.hooks.as_ref(), tx)) {
            Ok(Override::Value(result)) => return Some(result),
            Err(error) => return Some(Err(error)),
            Ok(Override::Inherit) => {}
        }
        entry = definition.extends.and_then(|parent| registry.get(parent));
    }
    None
}

#[cfg(test)]
mod test;
