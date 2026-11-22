use super::*;
use crate::{InitialView, SessionInput, ViewEffect};
use doc_sync_core::{Access, Now};
use std::sync::{Arc, Mutex};

/// Owned native sequence delta, preserving movable-list moves.
#[derive(Clone, Debug)]
pub enum ListDelta {
    /// Retain values.
    Retain(usize),
    /// Delete values.
    Delete(usize),
    /// Insert values (deep values for child containers).
    Insert {
        /// Inserted values.
        values: Vec<DocValue>,
        /// Insertion moves an existing value.
        is_move: bool,
    },
}
/// Owned native change at a generic container path.
#[derive(Clone, Debug)]
pub enum DocEvent {
    /// Changed map entries; None deletes an entry.
    Map {
        /// Target container.
        path: ContainerPath,
        /// Changed entries.
        updated: BTreeMap<String, Option<DocValue>>,
    },
    /// Sequence delta.
    List {
        /// Target container.
        path: ContainerPath,
        /// Ordered native delta.
        delta: Vec<ListDelta>,
    },
    /// Text delta; native lengths are Unicode scalar counts.
    Text {
        /// Target container.
        path: ContainerPath,
        /// Ordered native delta, including text attributes.
        delta: Vec<loro::TextDelta>,
    },
}
struct Pending {
    target: loro::ContainerID,
    ancestors: Vec<loro::ContainerID>,
    event: Result<DocEvent, DocError>,
}
/// Generic observed Loro containers with atomic operation batches.
pub struct GenericSurface {
    config: GenericConfig,
    events: Arc<Mutex<Vec<Pending>>>,
    subscription: Option<loro::Subscription>,
}
fn from_native(value: LoroValue) -> Result<DocValue, DocError> {
    Ok(match value {
        LoroValue::Null => DocValue::Null,
        LoroValue::Bool(value) => DocValue::Bool(value),
        LoroValue::I64(value) => DocValue::Int(value),
        LoroValue::Double(value) if value.is_finite() => DocValue::Number(value),
        LoroValue::Double(_) => return Err(DocError::NonFinite),
        LoroValue::String(value) => DocValue::String(value.to_string()),
        LoroValue::Binary(value) => DocValue::Bytes(value.to_vec()),
        LoroValue::List(values) => DocValue::List(
            values
                .iter()
                .cloned()
                .map(from_native)
                .collect::<Result<_, _>>()?,
        ),
        LoroValue::Map(values) => DocValue::Map(
            values
                .iter()
                .map(|(k, v)| from_native(v.clone()).map(|v| (k.clone(), v)))
                .collect::<Result<_, _>>()?,
        ),
        LoroValue::Container(_) => return Err(DocError::UnsupportedContainer),
    })
}
fn from_value(value: ValueOrContainer) -> Result<DocValue, DocError> {
    from_native(match value {
        ValueOrContainer::Value(value) => value,
        ValueOrContainer::Container(container) => {
            ValueOrContainer::Container(container).get_deep_value()
        }
    })
}
fn event_path(event: &loro::event::ContainerDiff<'_>) -> Result<ContainerPath, DocError> {
    let root = event.path.first().map(|(id, _)| id).unwrap_or(event.target);
    let loro::ContainerID::Root { name, .. } = root else {
        return Err(DocError::MissingPath);
    };
    let mut steps = Vec::new();
    for (_, index) in event.path.iter().skip(1) {
        match index {
            loro::Index::Key(key) => steps.push(PathStep::Key(key.to_string())),
            loro::Index::Seq(index) => steps.push(PathStep::Index(
                u32::try_from(*index).map_err(|_| DocError::OutOfBounds)?,
            )),
            _ => return Err(DocError::UnsupportedContainer),
        }
    }
    Ok(ContainerPath {
        root: name.to_string(),
        steps,
    })
}
impl GenericSurface {
    pub(crate) fn new(config: GenericConfig) -> Self {
        Self {
            config,
            events: Arc::new(Mutex::new(vec![])),
            subscription: None,
        }
    }
    /// Deep value of an attached path, without I/O or mutations.
    pub(crate) fn read(
        &self,
        doc: &LoroDoc,
        path: &ContainerPath,
    ) -> Result<DocValue, SessionError> {
        Ok(from_native(
            ValueOrContainer::Container(resolve(doc, path)?).get_deep_value(),
        )?)
    }
    pub(crate) fn init(
        &mut self,
        doc: &LoroDoc,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        self.subscription = None;
        self.events = Arc::new(Mutex::new(vec![]));
        let events = Arc::clone(&self.events);
        self.subscription = Some(doc.subscribe_root(Arc::new(move |batch| {
            let pending = batch
                .events
                .iter()
                .map(|event| {
                    let parsed = (|| {
                        let path = event_path(event)?;
                        Ok(match &event.diff {
                            loro::event::Diff::Map(delta) => DocEvent::Map {
                                path,
                                updated: delta
                                    .updated
                                    .iter()
                                    .map(|(k, v)| {
                                        v.clone()
                                            .map(from_value)
                                            .transpose()
                                            .map(|v| (k.to_string(), v))
                                    })
                                    .collect::<Result<_, _>>()?,
                            },
                            loro::event::Diff::List(delta) => DocEvent::List {
                                path,
                                delta: delta
                                    .iter()
                                    .map(|item| {
                                        Ok(match item {
                                            loro::event::ListDiffItem::Retain { retain } => {
                                                ListDelta::Retain(*retain)
                                            }
                                            loro::event::ListDiffItem::Delete { delete } => {
                                                ListDelta::Delete(*delete)
                                            }
                                            loro::event::ListDiffItem::Insert {
                                                insert,
                                                is_move,
                                            } => ListDelta::Insert {
                                                values: insert
                                                    .iter()
                                                    .cloned()
                                                    .map(from_value)
                                                    .collect::<Result<_, _>>()?,
                                                is_move: *is_move,
                                            },
                                        })
                                    })
                                    .collect::<Result<_, DocError>>()?,
                            },
                            loro::event::Diff::Text(delta) => DocEvent::Text {
                                path,
                                delta: delta.clone(),
                            },
                            _ => return Err(DocError::UnsupportedContainer),
                        })
                    })();
                    Pending {
                        target: event.target.clone(),
                        ancestors: event.path.iter().map(|(id, _)| id.clone()).collect(),
                        event: parsed,
                    }
                })
                .collect::<Vec<_>>();
            // A poisoned buffer is reported by drain; callbacks never panic across Loro.
            if let Ok(mut queue) = events.lock() {
                queue.extend(pending);
            }
        })));
        let mut initial = Vec::new();
        for path in &self.config.roots {
            match self.read(doc, path) {
                Ok(value) => initial.push((path.clone(), value)),
                Err(SessionError::Document(DocError::MissingPath)) => {}
                Err(error) => return Err(error),
            }
        }
        view.push(ViewEffect::Initialize(InitialView::Generic(initial)));
        Ok(())
    }
    pub(crate) fn drain(
        &mut self,
        doc: &LoroDoc,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        let observed = self
            .config
            .roots
            .iter()
            .filter_map(|path| resolve(doc, path).ok().map(|container| container.id()))
            .collect::<Vec<_>>();
        let mut queue = self
            .events
            .lock()
            .map_err(|_| SessionError::Configuration("generic event buffer poisoned"))?;
        let mut events = Vec::new();
        for pending in std::mem::take(&mut *queue) {
            let ancestor_change = pending.event.as_ref().is_ok_and(|event| {
                let path = match event {
                    DocEvent::Map { path, .. }
                    | DocEvent::List { path, .. }
                    | DocEvent::Text { path, .. } => path,
                };
                self.config.roots.iter().any(|observed| {
                    if path.root != observed.root || path.steps.len() > observed.steps.len() {
                        return false;
                    }
                    if !path.steps.iter().zip(&observed.steps).enumerate().all(
                        |(i, (actual, wanted))| match wanted {
                            PathStep::Id(id) => pending.ancestors.get(i + 1) == Some(id),
                            _ => actual == wanted,
                        },
                    ) {
                        return false;
                    }
                    match (event, observed.steps.get(path.steps.len())) {
                        (DocEvent::Map { updated, .. }, Some(PathStep::Key(key))) => {
                            updated.contains_key(key)
                        }
                        _ => true,
                    }
                })
            });
            if ancestor_change
                || observed
                    .iter()
                    .any(|id| *id == pending.target || pending.ancestors.contains(id))
            {
                events.push(pending.event?);
            }
        }
        if !events.is_empty() {
            view.push(ViewEffect::DocChanged(events));
        }
        Ok(())
    }
    pub(crate) fn local(
        &mut self,
        doc: &LoroDoc,
        input: SessionInput,
        now: Now,
        access: Access,
        ready: bool,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        let SessionInput::Doc(ops) = input else {
            return Err(SessionError::WrongSurface);
        };
        if !ready {
            return Err(SessionError::NotReady);
        }
        if access != Access::Edit {
            return Err(SessionError::ReadOnly);
        }
        let changed = apply(doc, &ops, now.wall.0 / 1000)?;
        self.drain(doc, view)?;
        Ok(changed)
    }
    pub(crate) fn drop_binding(&mut self) {
        self.subscription = None;
    }
}
