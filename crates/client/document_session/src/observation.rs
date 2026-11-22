//! Read-only identities around the real collaborative history operation.
use crate::SessionError;
use loro::{Container, ContainerID, ID, LoroDoc, LoroValue, ValueOrContainer};
use std::collections::BTreeSet;

/// Actual removal observed immediately around Loro undo/redo, before projection repair.
#[derive(Clone, Debug)]
pub struct UndoObservation {
    /// Whether the real operation was redo.
    pub redo: bool,
    /// Visible text/node identities that disappeared, or an inspection failure.
    /// A failed inspection invalidates conformance; it never blocks the real undo.
    pub removed: Result<Vec<ID>, String>,
}

pub(crate) fn visible_ids(doc: &LoroDoc) -> Result<BTreeSet<ID>, SessionError> {
    let mut ids = BTreeSet::new();
    let mut visited = BTreeSet::new();
    visit(doc, &doc.get_value(), &mut visited, &mut ids)?;
    Ok(ids)
}
fn visit(
    doc: &LoroDoc,
    value: &LoroValue,
    visited: &mut BTreeSet<String>,
    ids: &mut BTreeSet<ID>,
) -> Result<(), SessionError> {
    match value {
        LoroValue::Map(map) => {
            for (_, value) in map.iter() {
                visit(doc, value, visited, ids)?;
            }
        }
        LoroValue::List(list) => {
            for value in list.iter() {
                visit(doc, value, visited, ids)?;
            }
        }
        LoroValue::Container(cid) if visited.insert(cid.to_string()) => {
            match doc.get_container(cid.clone()) {
                Some(Container::Map(map)) => {
                    if matches!(
                        map.get("type"),
                        Some(ValueOrContainer::Value(LoroValue::String(_)))
                    ) && let ContainerID::Normal { peer, counter, .. } = cid
                    {
                        ids.insert(ID {
                            peer: *peer,
                            counter: *counter,
                        });
                    }
                    visit(doc, &map.get_value(), visited, ids)?;
                }
                Some(Container::Text(text)) => {
                    for index in 0..text.len_unicode() {
                        let id = text
                            .get_cursor(index, loro::cursor::Side::Middle)
                            .and_then(|cursor| cursor.id)
                            .ok_or(SessionError::Configuration(
                                "visible text character has no Loro identity",
                            ))?;
                        ids.insert(id);
                    }
                }
                Some(Container::List(list)) => visit(doc, &list.get_value(), visited, ids)?,
                Some(Container::MovableList(list)) => visit(doc, &list.get_value(), visited, ids)?,
                Some(Container::Tree(tree)) => visit(doc, &tree.get_value(), visited, ids)?,
                Some(Container::Unknown(_)) | None => {
                    return Err(SessionError::Configuration(
                        "cannot inspect visible Loro container",
                    ));
                }
                _ => {}
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod test;
