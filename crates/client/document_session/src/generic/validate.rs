//! Owned semantic validation; rejected batches never touch the live Loro transaction.
use super::*;
use crate::{DocError, SessionError};
use loro::{Container, ContainerID, ContainerTrait, ValueOrContainer};

#[derive(Clone)]
enum Shadow {
    Scalar,
    Map(BTreeMap<String, Shadow>),
    List(Vec<Shadow>, bool),
    Text(String),
    Identified(ContainerID, Box<Shadow>),
}
impl Shadow {
    fn body(&mut self) -> &mut Self {
        if let Self::Identified(_, value) = self {
            value
        } else {
            self
        }
    }
    fn from_value(value: ValueOrContainer) -> Result<Self, DocError> {
        match value {
            ValueOrContainer::Value(_) => Ok(Self::Scalar),
            ValueOrContainer::Container(c) => Self::from_container(c),
        }
    }
    fn from_container(c: Container) -> Result<Self, DocError> {
        let value = match &c {
            Container::Map(map) => {
                let mut values = BTreeMap::new();
                let mut error = None;
                map.for_each(|key, value| match Self::from_value(value) {
                    Ok(value) => {
                        values.insert(key.to_owned(), value);
                    }
                    Err(e) => error = Some(e),
                });
                if let Some(error) = error {
                    return Err(error);
                }
                Self::Map(values)
            }
            Container::List(list) => Self::List(
                (0..list.len())
                    .map(|i| Self::from_value(list.get(i).ok_or(DocError::MissingPath)?))
                    .collect::<Result<_, _>>()?,
                false,
            ),
            Container::MovableList(list) => Self::List(
                (0..list.len())
                    .map(|i| Self::from_value(list.get(i).ok_or(DocError::MissingPath)?))
                    .collect::<Result<_, _>>()?,
                true,
            ),
            Container::Text(text) => Self::Text(text.to_string()),
            _ => return Err(DocError::UnsupportedContainer),
        };
        Ok(Self::Identified(c.id(), Box::new(value)))
    }
    fn empty(kind: ContainerKind) -> Self {
        match kind {
            ContainerKind::Map => Self::Map(BTreeMap::new()),
            ContainerKind::List => Self::List(vec![], false),
            ContainerKind::MovableList => Self::List(vec![], true),
            ContainerKind::Text => Self::Text(String::new()),
        }
    }
    fn inserted(value: &DocValue) -> Result<Self, DocError> {
        match value {
            DocValue::NewContainer(kind) => Ok(Self::empty(*kind)),
            other => {
                scalar(other)?;
                Ok(Self::Scalar)
            }
        }
    }
    fn resolve(&mut self, steps: &[PathStep]) -> Result<&mut Self, DocError> {
        let Some((first, rest)) = steps.split_first() else {
            return Ok(self.body());
        };
        let value = match (self.body(), first) {
            (Self::Map(values), PathStep::Key(key)) => values.get_mut(key),
            (Self::List(values, _), PathStep::Index(i)) => values.get_mut(*i as usize),
            (Self::List(values, _), PathStep::Id(id)) => values
                .iter_mut()
                .find(|v| matches!(v, Self::Identified(other, _) if other == id)),
            _ => return Err(DocError::WrongKind),
        }
        .ok_or(DocError::MissingPath)?;
        value.resolve(rest)
    }
}

pub(super) fn validate(doc: &loro::LoroDoc, ops: &[DocOp]) -> Result<(), SessionError> {
    let mut roots = BTreeMap::<String, Shadow>::new();
    for (index, op) in ops.iter().enumerate() {
        let result = (|| {
            let (path, kind) = target(op);
            if !roots.contains_key(&path.root) {
                let value = match root(doc, &path.root) {
                    Some(c) => Shadow::from_container(c)?,
                    None => Shadow::empty(kind),
                };
                roots.insert(path.root.clone(), value);
            }
            let root = roots.get_mut(&path.root).ok_or(DocError::MissingPath)?;
            let value = root.resolve(&path.steps)?;
            match (value, op) {
                (Shadow::Map(values), DocOp::MapSet { key, value, .. }) => {
                    values.insert(key.clone(), Shadow::inserted(value)?);
                }
                (Shadow::Map(values), DocOp::MapDelete { key, .. }) => {
                    values.remove(key);
                }
                (Shadow::List(values, _), DocOp::ListInsert { index, value, .. }) => {
                    let i = *index as usize;
                    if i > values.len() {
                        return Err(DocError::OutOfBounds);
                    }
                    values.insert(i, Shadow::inserted(value)?);
                }
                (Shadow::List(values, _), DocOp::ListDelete { index, len, .. }) => {
                    let end = (*index as usize)
                        .checked_add(*len as usize)
                        .ok_or(DocError::OutOfBounds)?;
                    if end > values.len() {
                        return Err(DocError::OutOfBounds);
                    }
                    values.drain(*index as usize..end);
                }
                (Shadow::List(values, true), DocOp::MovableListSet { index, value, .. }) => {
                    *values
                        .get_mut(*index as usize)
                        .ok_or(DocError::OutOfBounds)? = Shadow::inserted(value)?;
                }
                (Shadow::List(values, true), DocOp::MovableListMove { from, to, .. }) => {
                    if *from as usize >= values.len() || *to as usize >= values.len() {
                        return Err(DocError::OutOfBounds);
                    }
                    let value = values.remove(*from as usize);
                    values.insert(*to as usize, value);
                }
                (
                    Shadow::Text(text),
                    DocOp::TextSplice {
                        index,
                        delete,
                        insert,
                        ..
                    },
                ) => {
                    let start = byte_offset(text, index.0)?;
                    let end = byte_offset(
                        text,
                        index.0.checked_add(*delete).ok_or(DocError::OutOfBounds)?,
                    )?;
                    text.replace_range(start..end, insert);
                }
                _ => return Err(DocError::WrongKind),
            }
            Ok(())
        })();
        if let Err(error) = result {
            return Err(SessionError::InvalidOp { index, error });
        }
    }
    Ok(())
}

pub(super) fn byte_offset(text: &str, offset: u32) -> Result<usize, DocError> {
    let mut units = 0;
    for (index, c) in text.char_indices() {
        if units == offset {
            return Ok(index);
        }
        units += c.len_utf16() as u32;
        if units > offset {
            return Err(DocError::SurrogateBoundary);
        }
    }
    if units == offset {
        Ok(text.len())
    } else {
        Err(DocError::OutOfBounds)
    }
}
