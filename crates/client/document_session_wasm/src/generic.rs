use crate::*;
use document_session::*;
pub(crate) fn path(p: wire::ContainerPathMsg) -> Result<ContainerPath, BoundaryError> {
    Ok(ContainerPath {
        root: p.root,
        steps: p
            .steps
            .into_iter()
            .map(|s| {
                Ok(match s.kind {
                    0 => PathStep::Key(s.key),
                    1 => PathStep::Index(s.index),
                    2 => PathStep::Id(
                        loro::ContainerID::try_from(s.key.as_str())
                            .map_err(|_| BoundaryError::Invalid("container id"))?,
                    ),
                    _ => return Err(BoundaryError::Invalid("path")),
                })
            })
            .collect::<Result<_, _>>()?,
    })
}
fn kind(k: u32) -> Result<ContainerKind, BoundaryError> {
    Ok(match k {
        0 => ContainerKind::Map,
        1 => ContainerKind::List,
        2 => ContainerKind::MovableList,
        3 => ContainerKind::Text,
        _ => return Err(BoundaryError::Invalid("container kind")),
    })
}
pub(crate) fn value(nodes: &[wire::DocValueNode]) -> Result<DocValue, BoundaryError> {
    fn read(
        nodes: &[wire::DocValueNode],
        at: &mut usize,
        depth: usize,
    ) -> Result<DocValue, BoundaryError> {
        if depth > 128 {
            return Err(BoundaryError::Invalid("value depth"));
        }
        let n = nodes
            .get(*at)
            .ok_or(BoundaryError::Invalid("value length"))?;
        *at += 1;
        Ok(match n.kind {
            0 => DocValue::Null,
            1 => DocValue::Bool(n.num != 0.0),
            2 => DocValue::Number(n.num),
            3 => DocValue::Int(n.int),
            4 => DocValue::String(n.str.clone()),
            5 => DocValue::Bytes(n.bytes.clone()),
            6 => DocValue::List(
                (0..n.children)
                    .map(|_| read(nodes, at, depth + 1))
                    .collect::<Result<_, _>>()?,
            ),
            7 => {
                let mut map = std::collections::BTreeMap::new();
                for _ in 0..n.children {
                    let key = nodes
                        .get(*at)
                        .ok_or(BoundaryError::Invalid("map"))?
                        .key
                        .clone();
                    if map.contains_key(&key) {
                        return Err(BoundaryError::Invalid("duplicate map key"));
                    }
                    map.insert(key, read(nodes, at, depth + 1)?);
                }
                DocValue::Map(map)
            }
            8 => DocValue::NewContainer(kind(n.children)?),
            _ => return Err(BoundaryError::Invalid("value kind")),
        })
    }
    let mut at = 0;
    let v = read(nodes, &mut at, 0)?;
    if at != nodes.len() {
        return Err(BoundaryError::Invalid("trailing value"));
    }
    Ok(v)
}
pub(crate) fn flatten(value: &DocValue, key: String, out: &mut Vec<wire::DocValueNode>) {
    let mut n = wire::DocValueNode {
        kind: 0,
        key,
        num: 0.0,
        int: 0,
        str: String::new(),
        bytes: vec![],
        children: 0,
    };
    match value {
        DocValue::Null => {}
        DocValue::Bool(v) => {
            n.kind = 1;
            n.num = if *v { 1.0 } else { 0.0 };
        }
        DocValue::Number(v) => {
            n.kind = 2;
            n.num = *v;
        }
        DocValue::Int(v) => {
            n.kind = 3;
            n.int = *v;
        }
        DocValue::String(v) => {
            n.kind = 4;
            n.str = v.clone();
        }
        DocValue::Bytes(v) => {
            n.kind = 5;
            n.bytes = v.clone();
        }
        DocValue::List(v) => {
            n.kind = 6;
            n.children = v.len() as u32;
        }
        DocValue::Map(v) => {
            n.kind = 7;
            n.children = v.len() as u32;
        }
        DocValue::NewContainer(v) => {
            n.kind = 8;
            n.children = match v {
                ContainerKind::Map => 0,
                ContainerKind::List => 1,
                ContainerKind::MovableList => 2,
                ContainerKind::Text => 3,
            };
        }
    }
    out.push(n);
    match value {
        DocValue::List(v) => {
            for v in v {
                flatten(v, String::new(), out)
            }
        }
        DocValue::Map(v) => {
            for (k, v) in v {
                flatten(v, k.clone(), out)
            }
        }
        _ => {}
    }
}
pub(crate) fn operation(op: wire::DocOpMsg) -> Result<DocOp, BoundaryError> {
    let path = path(op.path)?;
    Ok(match op.kind {
        0 => DocOp::MapSet {
            map: path,
            key: op.key,
            value: value(&op.value)?,
        },
        1 => DocOp::MapDelete {
            map: path,
            key: op.key,
        },
        2 => DocOp::ListInsert {
            list: path,
            index: op.index,
            value: value(&op.value)?,
        },
        3 => DocOp::ListDelete {
            list: path,
            index: op.index,
            len: op.len,
        },
        4 => DocOp::MovableListMove {
            list: path,
            from: op.index,
            to: op.len,
        },
        5 => DocOp::MovableListSet {
            list: path,
            index: op.index,
            value: value(&op.value)?,
        },
        6 => DocOp::TextSplice {
            text: path,
            index: lexical_model::Utf16Offset(op.index),
            delete: 0,
            insert: op.key,
        },
        7 => DocOp::TextSplice {
            text: path,
            index: lexical_model::Utf16Offset(op.index),
            delete: op.len,
            insert: String::new(),
        },
        _ => return Err(BoundaryError::Invalid("doc operation")),
    })
}
pub(crate) fn loro_value(v: loro::LoroValue) -> Result<DocValue, BoundaryError> {
    Ok(match v {
        loro::LoroValue::Null => DocValue::Null,
        loro::LoroValue::Bool(v) => DocValue::Bool(v),
        loro::LoroValue::I64(v) => DocValue::Int(v),
        loro::LoroValue::Double(v) => DocValue::Number(v),
        loro::LoroValue::String(v) => DocValue::String(v.to_string()),
        loro::LoroValue::Binary(v) => DocValue::Bytes(v.to_vec()),
        loro::LoroValue::List(v) => DocValue::List(
            v.iter()
                .cloned()
                .map(loro_value)
                .collect::<Result<_, _>>()?,
        ),
        loro::LoroValue::Map(v) => DocValue::Map(
            v.iter()
                .map(|(k, v)| Ok((k.clone(), loro_value(v.clone())?)))
                .collect::<Result<_, BoundaryError>>()?,
        ),
        loro::LoroValue::Container(v) => DocValue::String(v.to_string()),
    })
}
pub(crate) fn wire_path(p: &ContainerPath) -> wire::ContainerPathMsg {
    wire::ContainerPathMsg {
        root: p.root.clone(),
        steps: p
            .steps
            .iter()
            .map(|s| match s {
                PathStep::Key(key) => wire::PathStepMsg {
                    kind: 0,
                    key: key.clone(),
                    index: 0,
                },
                PathStep::Index(index) => wire::PathStepMsg {
                    kind: 1,
                    key: String::new(),
                    index: *index,
                },
                PathStep::Id(id) => wire::PathStepMsg {
                    kind: 2,
                    key: id.to_string(),
                    index: 0,
                },
            })
            .collect(),
    }
}
pub(crate) fn event(event: &DocEvent) -> Result<wire::DocEventMsg, BoundaryError> {
    let (kind, path) = match event {
        DocEvent::Map { path, .. } => (0, path),
        DocEvent::List { path, .. } => (1, path),
        DocEvent::Text { path, .. } => (2, path),
    };
    let mut changes = vec![];
    let make = |kind, index, len, key| wire::DocOpMsg {
        kind,
        path: wire_path(path),
        key,
        index,
        len,
        value: vec![],
    };
    match event {
        DocEvent::Map { updated, .. } => {
            for (key, value) in updated {
                let mut op = make(if value.is_some() { 0 } else { 1 }, 0, 0, key.clone());
                if let Some(v) = value {
                    flatten(v, String::new(), &mut op.value);
                }
                changes.push(op);
            }
        }
        DocEvent::List { delta, .. } => {
            for delta in delta {
                match delta {
                    ListDelta::Retain(count) => {
                        changes.push(make(8, *count as u32, 0, String::new()))
                    }
                    ListDelta::Delete(count) => {
                        changes.push(make(3, 0, *count as u32, String::new()))
                    }
                    ListDelta::Insert { values, is_move } => {
                        let mut op = make(2, 0, u32::from(*is_move), String::new());
                        flatten(
                            &DocValue::List(values.clone()),
                            String::new(),
                            &mut op.value,
                        );
                        changes.push(op);
                    }
                }
            }
        }
        DocEvent::Text { delta, .. } => {
            for delta in delta {
                let op = match delta {
                    loro::TextDelta::Retain { retain, attributes } => {
                        let mut op = make(8, *retain as u32, 0, String::new());
                        if let Some(attributes) = attributes {
                            flatten(
                                &DocValue::Map(
                                    attributes
                                        .iter()
                                        .map(|(k, v)| Ok((k.clone(), loro_value(v.clone())?)))
                                        .collect::<Result<_, BoundaryError>>()?,
                                ),
                                String::new(),
                                &mut op.value,
                            );
                        }
                        op
                    }
                    loro::TextDelta::Insert { insert, attributes } => {
                        let mut op = make(6, 0, 0, insert.clone());
                        if let Some(attributes) = attributes {
                            flatten(
                                &DocValue::Map(
                                    attributes
                                        .iter()
                                        .map(|(k, v)| Ok((k.clone(), loro_value(v.clone())?)))
                                        .collect::<Result<_, BoundaryError>>()?,
                                ),
                                String::new(),
                                &mut op.value,
                            );
                        }
                        op
                    }
                    loro::TextDelta::Delete { delete } => make(7, 0, *delete as u32, String::new()),
                };
                changes.push(op);
            }
        }
    }
    Ok(wire::DocEventMsg {
        kind,
        path: wire_path(path),
        changes,
    })
}
