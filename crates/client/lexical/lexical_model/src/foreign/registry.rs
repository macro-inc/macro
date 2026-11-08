//! Runtime ancestry validation before constructing the editor.
use crate::*;
use std::any::TypeId;

pub(crate) fn resolve_parents(registry: &mut Registry) -> Result<(), BuildError> {
    for index in 0..registry.nodes.len() {
        let node = &registry.nodes[index];
        let Some(definition) = node.foreign.clone() else {
            continue;
        };
        let type_name = node.type_name;
        let kind = node.kind;
        let mut language = false;
        let mut ancestors = Vec::new();
        let mut state = definition.required_state.clone();
        let mut parent = definition.extends;
        let mut visited = vec![type_name];
        while let Some(name) = parent {
            let invalid = || BuildError::UnknownForeignParent {
                type_name,
                parent: name,
            };
            let entry = registry.get(name).ok_or_else(invalid)?;
            if entry.kind != kind || visited.contains(&name) {
                return Err(invalid());
            }
            visited.push(name);
            if let Some(foreign) = &entry.foreign {
                state.extend_from_slice(&foreign.required_state);
                parent = foreign.extends;
            } else {
                language |= entry.has_language_field;
                ancestors.extend_from_slice(&entry.ancestry);
                state.extend_from_slice(&entry.state_layout.entries);
                break;
            }
        }
        for required in &state {
            if state.iter().any(|other| {
                other.key.name() == required.key.name()
                    && (other.key.identity() != required.key.identity()
                        || other.flat != required.flat)
            }) {
                return Err(BuildError::StateKeyCollision {
                    key: required.key.name(),
                });
            }
        }
        // This marker is private: typed APIs never register or return ForeignData.
        ancestors.insert(0, TypeId::of::<ForeignData>());
        registry.nodes[index].has_language_field = language;
        registry.vtables[index].language = language;
        registry.nodes[index].ancestry = ancestors;
        registry.nodes[index].state_layout.entries = state;
    }
    Ok(())
}

#[cfg(test)]
mod test;
