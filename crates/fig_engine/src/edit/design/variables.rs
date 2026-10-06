//! Variables: binding a fill or stroke color to a color variable, and the
//! mode a frame picks for a variable collection.
//!
//! As in Figma's files, a bound paint keeps its resolved color beside the
//! variable (so files render without resolving variables); binding and
//! switching modes resolve it again for the layers they affect, instances'
//! layers included (as overrides).

use super::Target;
use crate::document::{Document, NodeIdx};
use crate::edit::{Txn, flags};
use crate::error::{FigError, Result};
use crate::model::{Color, Guid, NodeType, Paint, PaintKind, Props, VariableValue};
use crate::scene::Scene;
use std::sync::Arc;

/// An instance layer's new fills and strokes, by guid path.
type Recolored = (Vec<Guid>, Option<Arc<[Paint]>>, Option<Arc<[Paint]>>);

pub(super) use crate::variables::resolve;

/// The modes that apply to document node `i`: its own and its ancestors'.
fn doc_modes(doc: &Document, mut i: NodeIdx) -> Vec<Arc<[(Guid, Guid)]>> {
    let mut out = Vec::new();
    loop {
        if let Some(m) = &doc.props(i).mode_by_set {
            out.push(m.clone());
        }
        match doc.node(i).parent {
            Some(p) => i = p,
            None => return out,
        }
    }
}

/// `paints` with the colors of their bound variables resolved under
/// `modes`; `None` when none changes.
fn resolved(
    doc: &Document,
    paints: &[Paint],
    modes: &[Arc<[(Guid, Guid)]>],
) -> Option<Arc<[Paint]>> {
    let modes: Vec<&[(Guid, Guid)]> = modes.iter().map(|m| m.as_ref()).collect();
    let mut changed = false;
    let next: Vec<Paint> = paints
        .iter()
        .map(|p| {
            let mut p = p.clone();
            if let Some(var) = p.color_var
                && let Some(VariableValue::Color(c)) = resolve(doc, var, &modes)
                && p.kind != PaintKind::Solid(c)
            {
                p.kind = PaintKind::Solid(c);
                changed = true;
            }
            p
        })
        .collect();
    changed.then(|| next.into())
}

impl Txn<'_> {
    /// Binds paint `index` of layers' fills (`FILL`) or strokes (`STROKE`)
    /// to a color variable, or unbinds it (`var` absent, keeping the color).
    pub(super) fn bind_variable(
        &mut self,
        id: &str,
        field: &str,
        index: usize,
        var: Option<NodeIdx>,
    ) -> Result<()> {
        let strokes = match field {
            "FILL" => false,
            "STROKE" => true,
            _ => return Err(FigError::Unsupported(format!("no paint field {field}"))),
        };
        let var = match var {
            Some(v) => {
                let p = self.doc.props(v);
                if p.variable.as_ref().map(|x| x.resolved_type)
                    != Some(crate::model::VariableType::Color)
                {
                    return Err(FigError::Unsupported("not a color variable".into()));
                }
                p.guid
            }
            None => None,
        };
        let target = self.target(id)?;
        let shown = self.shown(&target)?;
        let mut paints: Vec<Paint> = if strokes {
            shown.strokes()
        } else {
            shown.fills()
        }
        .to_vec();
        if paints.is_empty() && var.is_some() {
            paints.push(Paint::solid(Color::BLACK));
        }
        let Some(paint) = paints.get_mut(index) else {
            return Err(FigError::Unsupported("no such paint".into()));
        };
        paint.color_var = var;
        if let Some(var) = var {
            let modes = match &target {
                Target::Doc(i) => doc_modes(self.doc, *i),
                Target::Nested { root, .. } => doc_modes(self.doc, *root),
            };
            let modes: Vec<&[(Guid, Guid)]> = modes.iter().map(|m| m.as_ref()).collect();
            if let Some(VariableValue::Color(c)) = resolve(self.doc, var, &modes) {
                paint.kind = PaintKind::Solid(c);
            }
        }
        let paints: Arc<[Paint]> = paints.into();
        match target {
            Target::Doc(i) => {
                let p = if strokes {
                    self.edit(i, flags::STROKES)
                } else {
                    self.edit(i, flags::FILLS)
                };
                if strokes {
                    p.strokes = Some(paints);
                    p.stroke_style = None;
                } else {
                    p.fills = Some(paints);
                    p.fill_style = None;
                }
            }
            Target::Nested { root, path, .. } => self.edit_override(root, &path, |e| {
                if strokes {
                    e.strokes = Some(paints);
                } else {
                    e.fills = Some(paints);
                }
            }),
        }
        Ok(())
    }

    /// Makes frame `i` use `mode` of variable collection `set` (or the
    /// mode it inherits, `mode` absent), and resolves its layers' bound
    /// colors again.
    pub(super) fn set_variable_mode(
        &mut self,
        i: NodeIdx,
        set: NodeIdx,
        mode: Option<Guid>,
    ) -> Result<()> {
        let collection = self.doc.props(set);
        let Some(modes) = collection.variable_modes.clone() else {
            return Err(FigError::Unsupported("not a variable collection".into()));
        };
        let set = collection.guid.unwrap_or_default();
        if let Some(m) = mode
            && !modes.iter().any(|x| x.id == m)
        {
            return Err(FigError::Unsupported("no such mode".into()));
        }
        let mut list: Vec<(Guid, Guid)> = self
            .doc
            .props(i)
            .mode_by_set
            .as_deref()
            .unwrap_or_default()
            .iter()
            .filter(|(c, _)| *c != set)
            .copied()
            .collect();
        if let Some(m) = mode {
            list.push((set, m));
        }
        self.edit(i, flags::STYLES).mode_by_set = Some(list.into());
        self.refresh_bound(i);
        Ok(())
    }

    /// Resolves the bound colors of `root` and every layer under it (in
    /// instances, as overrides) under the modes that now apply.
    pub(crate) fn refresh_bound(&mut self, root: NodeIdx) {
        let mut stack = vec![root];
        while let Some(i) = stack.pop() {
            if self.doc.node(i).removed {
                continue;
            }
            stack.extend(self.doc.node(i).children.iter().copied());
            let modes = doc_modes(self.doc, i);
            let p = self.doc.props(i);
            let fills = resolved(self.doc, p.fills(), &modes);
            let strokes = resolved(self.doc, p.strokes(), &modes);
            let instance = p.node_type() == NodeType::Instance;
            if let Some(f) = fills {
                self.edit(i, flags::FILLS).fills = Some(f);
            }
            if let Some(s) = strokes {
                self.edit(i, flags::STROKES).strokes = Some(s);
            }
            if instance {
                self.refresh_instance(i, &modes);
            }
        }
    }

    /// An instance's layers whose bound colors resolve differently under
    /// `outer` (the modes of the instance and its ancestors) get overrides.
    fn refresh_instance(&mut self, inst: NodeIdx, outer: &[Arc<[(Guid, Guid)]>]) {
        let Some(root_guid) = self.doc.props(inst).guid else {
            return;
        };
        let mut changes: Vec<Recolored> = Vec::new();
        {
            let scene = Scene::build_instance(self.doc, inst);
            for (k, n) in scene.nodes.iter().enumerate() {
                let Some((r, path)) = &n.path else { continue };
                if *r != root_guid {
                    continue;
                }
                let p: &Props = scene.props(self.doc, k as u32);
                if !p
                    .fills()
                    .iter()
                    .chain(p.strokes())
                    .any(|x| x.color_var.is_some())
                {
                    continue;
                }
                // The layer's own modes and its ancestors' in the instance,
                // then the instance's.
                let mut modes = Vec::new();
                let mut at = Some(k as u32);
                while let Some(a) = at {
                    let node = scene.node(a);
                    if node.path.is_none() {
                        break;
                    }
                    if let Some(m) = &scene.props(self.doc, a).mode_by_set {
                        modes.push(m.clone());
                    }
                    at = node.parent;
                }
                modes.extend(outer.iter().cloned());
                let fills = resolved(self.doc, p.fills(), &modes);
                let strokes = resolved(self.doc, p.strokes(), &modes);
                if fills.is_some() || strokes.is_some() {
                    changes.push((path.to_vec(), fills, strokes));
                }
            }
        }
        for (path, fills, strokes) in changes {
            self.edit_override(inst, &path, |e| {
                if let Some(f) = fills {
                    e.fills = Some(f);
                }
                if let Some(s) = strokes {
                    e.strokes = Some(s);
                }
            });
        }
    }
}
