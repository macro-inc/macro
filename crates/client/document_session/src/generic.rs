//! Typed generic collaborative document operations.
use std::collections::BTreeMap;

/// An attached root and its ordered traversal steps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContainerPath {
    /// Loro root name.
    pub root: String,
    /// Traversal from that root.
    pub steps: Vec<PathStep>,
}

/// One container traversal operation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PathStep {
    /// A native map entry.
    Key(String),
    /// A native list position.
    Index(u32),
    /// A child container's stable identity within the current sequence.
    Id(loro::ContainerID),
}

/// Container kinds manipulated by the generic document operation set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContainerKind {
    /// Native map.
    Map,
    /// Native list.
    List,
    /// Native movable list.
    MovableList,
    /// Native text, addressed in UTF-16.
    Text,
}

/// A JSON-shaped scalar/composite or a direct container creation marker.
#[derive(Clone, Debug, PartialEq)]
pub enum DocValue {
    /// Null.
    Null,
    /// Boolean.
    Bool(bool),
    /// Finite floating point value.
    Number(f64),
    /// Native signed integer.
    Int(i64),
    /// UTF-8 string.
    String(String),
    /// Opaque bytes.
    Bytes(Vec<u8>),
    /// Plain scalar list, not a native Loro list.
    List(Vec<DocValue>),
    /// Plain scalar map, not a native Loro map.
    Map(BTreeMap<String, DocValue>),
    /// Create one attached native container at the direct insertion position.
    NewContainer(ContainerKind),
}

/// One operation in an atomic generic batch.
#[derive(Clone, Debug, PartialEq)]
pub enum DocOp {
    /// Insert or replace a map entry.
    MapSet {
        /// Target map.
        map: ContainerPath,
        /// Entry name.
        key: String,
        /// New value.
        value: DocValue,
    },
    /// Remove a map entry, idempotently.
    MapDelete {
        /// Target map.
        map: ContainerPath,
        /// Entry name.
        key: String,
    },
    /// Insert into a native list or movable list.
    ListInsert {
        /// Target sequence.
        list: ContainerPath,
        /// Insertion position.
        index: u32,
        /// Inserted value.
        value: DocValue,
    },
    /// Delete a range from a native list or movable list.
    ListDelete {
        /// Target sequence.
        list: ContainerPath,
        /// First deleted position.
        index: u32,
        /// Number of values.
        len: u32,
    },
    /// Move a native movable-list value.
    MovableListMove {
        /// Target sequence.
        list: ContainerPath,
        /// Current position.
        from: u32,
        /// Destination in the final sequence.
        to: u32,
    },
    /// Replace one movable-list value.
    MovableListSet {
        /// Target sequence.
        list: ContainerPath,
        /// Position to replace.
        index: u32,
        /// New value.
        value: DocValue,
    },
    /// Replace a UTF-16-addressed text region.
    TextSplice {
        /// Target text.
        text: ContainerPath,
        /// First code unit.
        index: lexical_model::Utf16Offset,
        /// Number of deleted code units.
        delete: u32,
        /// Inserted string.
        insert: String,
    },
}

mod validate;
use crate::{DocError, SessionError};
use loro::{Container, ContainerTrait, ContainerType, LoroDoc, LoroValue, ValueOrContainer};

/// Generic roots to observe. Paths are resolved after each committed change.
#[derive(Clone, Debug, Default)]
pub struct GenericConfig {
    /// Containers whose descendant changes are forwarded to the host.
    pub roots: Vec<ContainerPath>,
}

pub(super) fn target(op: &DocOp) -> (&ContainerPath, ContainerKind) {
    match op {
        DocOp::MapSet { map, .. } | DocOp::MapDelete { map, .. } => (map, ContainerKind::Map),
        DocOp::ListInsert { list, .. } | DocOp::ListDelete { list, .. } => {
            (list, ContainerKind::List)
        }
        DocOp::MovableListMove { list, .. } | DocOp::MovableListSet { list, .. } => {
            (list, ContainerKind::MovableList)
        }
        DocOp::TextSplice { text, .. } => (text, ContainerKind::Text),
    }
}
fn native_kind(kind: ContainerKind) -> ContainerType {
    match kind {
        ContainerKind::Map => ContainerType::Map,
        ContainerKind::List => ContainerType::List,
        ContainerKind::MovableList => ContainerType::MovableList,
        ContainerKind::Text => ContainerType::Text,
    }
}
pub(super) fn root(doc: &LoroDoc, name: &str) -> Option<Container> {
    let LoroValue::Map(roots) = doc.get_value() else {
        return None;
    };
    let LoroValue::Container(id) = roots.get(name)? else {
        return None;
    };
    doc.get_container(id.clone())
}
pub(super) fn resolve(doc: &LoroDoc, path: &ContainerPath) -> Result<Container, DocError> {
    let mut current = root(doc, &path.root).ok_or(DocError::MissingPath)?;
    for step in &path.steps {
        let value = match (&current, step) {
            (Container::Map(map), PathStep::Key(key)) => map.get(key),
            (Container::List(list), PathStep::Index(i)) => list.get(*i as usize),
            (Container::MovableList(list), PathStep::Index(i)) => list.get(*i as usize),
            (Container::List(list), PathStep::Id(id)) => (0..list.len())
                .filter_map(|i| list.get(i))
                .find(|v| matches!(v, ValueOrContainer::Container(c) if c.id() == *id)),
            (Container::MovableList(list), PathStep::Id(id)) => (0..list.len())
                .filter_map(|i| list.get(i))
                .find(|v| matches!(v, ValueOrContainer::Container(c) if c.id() == *id)),
            _ => return Err(DocError::WrongKind),
        }
        .ok_or(DocError::MissingPath)?;
        let ValueOrContainer::Container(next) = value else {
            return Err(DocError::WrongKind);
        };
        current = next;
    }
    Ok(current)
}
pub(super) fn scalar(value: &DocValue) -> Result<LoroValue, DocError> {
    Ok(match value {
        DocValue::Null => LoroValue::Null,
        DocValue::Bool(value) => (*value).into(),
        DocValue::Int(value) => (*value).into(),
        DocValue::Number(value) if value.is_finite() => (*value).into(),
        DocValue::Number(_) => return Err(DocError::NonFinite),
        DocValue::String(value) => value.clone().into(),
        DocValue::Bytes(value) => LoroValue::Binary(value.clone().into()),
        DocValue::List(values) => LoroValue::List(
            values
                .iter()
                .map(scalar)
                .collect::<Result<Vec<_>, _>>()?
                .into(),
        ),
        DocValue::Map(values) => LoroValue::Map(
            values
                .iter()
                .map(|(k, v)| scalar(v).map(|v| (k.clone(), v)))
                .collect::<Result<Vec<_>, _>>()?
                .into(),
        ),
        DocValue::NewContainer(_) => return Err(DocError::NestedContainer),
    })
}
pub(super) fn apply(doc: &LoroDoc, ops: &[DocOp], timestamp: i64) -> Result<bool, SessionError> {
    validate::validate(doc, ops)?;
    let before = doc.oplog_vv();
    for op in ops {
        let (path, kind) = target(op);
        if root(doc, &path.root).is_none() {
            match kind {
                ContainerKind::Map => {
                    doc.get_map(path.root.as_str());
                }
                ContainerKind::List => {
                    doc.get_list(path.root.as_str());
                }
                ContainerKind::MovableList => {
                    doc.get_movable_list(path.root.as_str());
                }
                ContainerKind::Text => {
                    doc.get_text(path.root.as_str());
                }
            }
        }
        let container = resolve(doc, path)?;
        match (container, op) {
            (Container::Map(map), DocOp::MapSet { key, value, .. }) => {
                if let DocValue::NewContainer(kind) = value {
                    map.insert_container(key, Container::new(native_kind(*kind)))?;
                } else {
                    map.insert(key, scalar(value)?)?;
                }
            }
            (Container::Map(map), DocOp::MapDelete { key, .. }) => map.delete(key)?,
            (Container::List(list), DocOp::ListInsert { index, value, .. }) => {
                if let DocValue::NewContainer(kind) = value {
                    list.insert_container(*index as usize, Container::new(native_kind(*kind)))?;
                } else {
                    list.insert(*index as usize, scalar(value)?)?;
                }
            }
            (Container::MovableList(list), DocOp::ListInsert { index, value, .. }) => {
                if let DocValue::NewContainer(kind) = value {
                    list.insert_container(*index as usize, Container::new(native_kind(*kind)))?;
                } else {
                    list.insert(*index as usize, scalar(value)?)?;
                }
            }
            (Container::List(list), DocOp::ListDelete { index, len, .. }) => {
                list.delete(*index as usize, *len as usize)?
            }
            (Container::MovableList(list), DocOp::ListDelete { index, len, .. }) => {
                list.delete(*index as usize, *len as usize)?
            }
            (Container::MovableList(list), DocOp::MovableListMove { from, to, .. }) => {
                list.mov(*from as usize, *to as usize)?
            }
            (Container::MovableList(list), DocOp::MovableListSet { index, value, .. }) => {
                if let DocValue::NewContainer(kind) = value {
                    list.set_container(*index as usize, Container::new(native_kind(*kind)))?;
                } else {
                    list.set(*index as usize, scalar(value)?)?;
                }
            }
            (
                Container::Text(text),
                DocOp::TextSplice {
                    index,
                    delete,
                    insert,
                    ..
                },
            ) => {
                text.delete_utf16(index.0 as usize, *delete as usize)?;
                text.insert_utf16(index.0 as usize, insert)?;
            }
            _ => return Err(DocError::WrongKind.into()),
        }
    }
    doc.commit_with(
        loro::CommitOptions::new()
            .origin("to-loro")
            .timestamp(timestamp),
    );
    Ok(before != doc.oplog_vv())
}

mod surface;
pub use surface::{DocEvent, GenericSurface, ListDelta};
