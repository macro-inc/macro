//! Apply inherited collection modes after instance overrides have been merged.

use super::{PropSource, Scene, SceneIdx};
use crate::document::Document;
use crate::model::{Guid, Paint, PaintKind, VariableValue};
use std::sync::Arc;

pub(super) fn resolve(doc: &Document, scene: &mut Scene) {
    for i in 0..scene.nodes.len() {
        let p = scene.props(doc, i as SceneIdx);
        let bound = p
            .fills()
            .iter()
            .chain(p.strokes())
            .any(|p| p.color_var.is_some())
            || p.text_content.as_ref().is_some_and(|t| {
                t.styles.iter().any(|s| {
                    s.fills
                        .as_ref()
                        .is_some_and(|f| f.iter().any(|p| p.color_var.is_some()))
                })
            })
            || p.vector_styles.as_ref().is_some_and(|s| {
                s.iter().any(|s| {
                    s.fills
                        .as_ref()
                        .is_some_and(|f| f.iter().any(|p| p.color_var.is_some()))
                })
            });
        if !bound {
            continue;
        }
        let mut modes: Vec<&[(Guid, Guid)]> = Vec::new();
        let mut at = Some(i as SceneIdx);
        while let Some(n) = at {
            if let Some(m) = &scene.props(doc, n).mode_by_set {
                modes.push(m);
            }
            at = scene.nodes[n as usize].parent;
        }
        // A standalone instance scene starts at its immediate parent; its
        // remaining document ancestors still contribute inherited modes.
        let mut at = doc.node(scene.nodes[0].src).parent;
        while let Some(n) = at {
            if let Some(m) = &doc.props(n).mode_by_set {
                modes.push(m);
            }
            at = doc.node(n).parent;
        }
        let mut next = p.clone();
        let mut changed = paints(doc, &mut next.fills, &modes);
        changed |= paints(doc, &mut next.strokes, &modes);
        if let Some(content) = &mut next.text_content {
            let content = Arc::make_mut(content);
            for style in Arc::make_mut(&mut content.styles) {
                changed |= paints(doc, &mut style.fills, &modes);
            }
        }
        if let Some(styles) = &mut next.vector_styles {
            for style in Arc::make_mut(styles) {
                changed |= paints(doc, &mut style.fills, &modes);
            }
        }
        if changed {
            scene.nodes[i].props = PropSource::Owned(Box::new(next));
        }
    }
}

fn paints(doc: &Document, paints: &mut Option<Arc<[Paint]>>, modes: &[&[(Guid, Guid)]]) -> bool {
    let Some(paints) = paints else {
        return false;
    };
    let mut changed = false;
    for i in 0..paints.len() {
        if let Some(var) = paints[i].color_var
            && let Some(VariableValue::Color(color)) = crate::variables::resolve(doc, var, modes)
            && paints[i].kind != PaintKind::Solid(color)
        {
            Arc::make_mut(paints)[i].kind = PaintKind::Solid(color);
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod test;
