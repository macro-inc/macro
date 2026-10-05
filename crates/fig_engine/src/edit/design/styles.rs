//! Shared styles: applying, detaching, creating, editing, and deleting
//! them.
//!
//! As in Figma, a layer using a style keeps both the reference and the
//! style's values (so files render without resolving styles); editing a
//! style updates every layer using it. Local styles live on the file's
//! internal canvas, which is made when a file has none.

use super::Target;
use crate::document::NodeIdx;
use crate::edit::{Measure, NewNode, Patch, Txn, flags};
use crate::error::{FigError, Result};
use crate::model::{Guid, NodeType, Props, StyleType, TextStyle};
use std::sync::Arc;

/// An override's reference to "no style" (it detaches the component's).
const NO_STYLE: Guid = Guid {
    session: u32::MAX,
    local: u32::MAX,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Fill,
    Stroke,
    Text,
    Effect,
}

fn kind(name: &str) -> Result<Kind> {
    Ok(match name {
        "FILL" => Kind::Fill,
        "STROKE" => Kind::Stroke,
        "TEXT" => Kind::Text,
        "EFFECT" => Kind::Effect,
        _ => return Err(FigError::Unsupported(format!("no style kind {name}"))),
    })
}

impl Kind {
    /// The kind of style node used: fills and strokes share color styles.
    fn style_type(self) -> StyleType {
        match self {
            Kind::Fill | Kind::Stroke => StyleType::Fill,
            Kind::Text => StyleType::Text,
            Kind::Effect => StyleType::Effect,
        }
    }
}

/// The patch that gives a text layer a text style's type.
pub(crate) fn text_patch(style: &TextStyle) -> Patch {
    let measure = |m: &Option<(f32, String)>, line: bool| {
        m.as_ref().map(|(v, unit)| match unit.as_str() {
            "PIXELS" => Measure {
                value: *v,
                unit: "PIXELS".into(),
            },
            // Figma stores "auto" line height as 100%.
            "PERCENT" if line && (*v - 100.0).abs() < 1e-3 => Measure {
                value: 0.0,
                unit: "AUTO".into(),
            },
            "RAW" => Measure {
                value: v * 100.0,
                unit: "PERCENT".into(),
            },
            _ => Measure {
                value: *v,
                unit: "PERCENT".into(),
            },
        })
    };
    Patch {
        font_family: style.font_family.clone(),
        font_style: style.font_style.clone(),
        font_size: style.font_size,
        line_height: measure(&style.line_height, true),
        letter_spacing: measure(&style.letter_spacing, false),
        paragraph_spacing: style.paragraph_spacing,
        text_decoration: style.decoration.clone(),
        text_case: style.case.clone(),
        ..Patch::default()
    }
}

/// Whether a patch changes what a text style sets (alignment and sizing
/// are not part of one).
pub(crate) fn touches_text_style(patch: &Patch) -> bool {
    patch.font_family.is_some()
        || patch.font_style.is_some()
        || patch.font_size.is_some()
        || patch.line_height.is_some()
        || patch.letter_spacing.is_some()
        || patch.paragraph_spacing.is_some()
        || patch.text_decoration.is_some()
        || patch.text_case.is_some()
}

impl Txn<'_> {
    /// A style node, checked to style `kind`.
    fn style_node(&self, style: NodeIdx, kind: Kind) -> Result<Props> {
        let p = self.doc.props(style);
        if p.style_type != Some(kind.style_type()) {
            return Err(FigError::Unsupported(
                "that style does not style this".into(),
            ));
        }
        Ok(p.clone())
    }

    pub(super) fn apply_style(
        &mut self,
        id: &str,
        kind_name: &str,
        style: Option<NodeIdx>,
    ) -> Result<()> {
        let kind = kind(kind_name)?;
        let style = match style {
            Some(s) => Some((
                self.style_node(s, kind)?,
                self.doc.props(s).guid.unwrap_or_default(),
            )),
            None => None,
        };
        match self.target(id)? {
            Target::Doc(i) => self.apply_doc_style(i, kind, style.as_ref()),
            Target::Nested { root, path, id } => {
                if kind == Kind::Text {
                    if let Some((s, g)) = &style {
                        let patch =
                            text_patch(&s.text_style.as_deref().cloned().unwrap_or_default());
                        self.set_override(&id, &patch)?;
                        let g = *g;
                        self.edit_override(root, &path, |e| e.text_style_id = Some(g));
                    } else {
                        self.edit_override(root, &path, |e| e.text_style_id = Some(NO_STYLE));
                    }
                    return Ok(());
                }
                self.edit_override(root, &path, |e| match (&style, kind) {
                    (Some((s, g)), Kind::Fill) => {
                        e.fills = s.fills.clone();
                        e.fill_style = Some(*g);
                    }
                    (Some((s, g)), Kind::Stroke) => {
                        e.strokes = s.fills.clone();
                        e.stroke_style = Some(*g);
                    }
                    (Some((s, g)), Kind::Effect) => {
                        e.effects = s.effects.clone();
                        e.effect_style = Some(*g);
                    }
                    (None, Kind::Fill) => e.fill_style = Some(NO_STYLE),
                    (None, Kind::Stroke) => e.stroke_style = Some(NO_STYLE),
                    (None, Kind::Effect) => e.effect_style = Some(NO_STYLE),
                    _ => {}
                });
                Ok(())
            }
        }
    }

    fn apply_doc_style(
        &mut self,
        i: NodeIdx,
        kind: Kind,
        style: Option<&(Props, Guid)>,
    ) -> Result<()> {
        let Some((s, g)) = style else {
            let p = self.edit(i, flags::STYLES);
            match kind {
                Kind::Fill => p.fill_style = None,
                Kind::Stroke => p.stroke_style = None,
                Kind::Text => p.text_style_id = None,
                Kind::Effect => p.effect_style = None,
            }
            return Ok(());
        };
        let g = *g;
        match kind {
            Kind::Fill => {
                let p = self.edit(i, flags::FILLS | flags::STYLES);
                p.fills = Some(s.fills.clone().unwrap_or_else(|| Arc::from([])));
                p.fill_style = Some(g);
            }
            Kind::Stroke => {
                let p = self.edit(i, flags::STROKES | flags::STYLES);
                p.strokes = Some(s.fills.clone().unwrap_or_else(|| Arc::from([])));
                p.stroke_style = Some(g);
            }
            Kind::Effect => {
                let p = self.edit(i, flags::EFFECTS | flags::STYLES);
                p.effects = Some(s.effects.clone().unwrap_or_else(|| Arc::from([])));
                p.effect_style = Some(g);
            }
            Kind::Text => {
                if self.doc.props(i).node_type() != NodeType::Text {
                    return Ok(());
                }
                let patch = text_patch(&s.text_style.as_deref().cloned().unwrap_or_default());
                self.set(i, &patch)?;
                self.edit(i, flags::STYLES).text_style_id = Some(g);
            }
        }
        Ok(())
    }

    /// Typing a new font, size, or spacing into a text layer detaches its
    /// text style, as in Figma.
    pub(crate) fn detach_text_style(&mut self, i: NodeIdx, patch: &Patch) {
        if self.doc.props(i).text_style_id.is_some() && touches_text_style(patch) {
            self.edit(i, flags::STYLES).text_style_id = None;
        }
    }

    /// The file's internal canvas (where styles live), made when missing.
    fn internal_canvas(&mut self) -> NodeIdx {
        let root = self.doc.root;
        if let Some(&c) = self.doc.node(root).children.iter().find(|&&c| {
            let p = self.doc.props(c);
            p.node_type() == NodeType::Canvas && p.internal_only == Some(true)
        }) {
            return c;
        }
        let props = Props {
            guid: Some(self.doc.new_guid()),
            node_type: Some(NodeType::Canvas),
            name: Some("Internal Only Canvas".into()),
            visible: Some(false),
            opacity: Some(1.0),
            internal_only: Some(true),
            ..Props::default()
        };
        let c = self.new_node(props);
        let at = self.doc.node(root).children.len();
        self.attach(c, root, at, false);
        c
    }

    pub(super) fn create_style(&mut self, kind_name: &str, name: &str, from: &str) -> Result<()> {
        let kind = kind(kind_name)?;
        let target = self.target(from)?;
        let shown = self.shown(&target)?;
        let name = name.trim();
        if name.is_empty() {
            return Err(FigError::Unsupported("a style needs a name".into()));
        }
        if kind == Kind::Text && shown.node_type() != NodeType::Text {
            return Err(FigError::Unsupported("text styles come from text".into()));
        }
        let canvas = self.internal_canvas();
        let last = self
            .doc
            .nodes
            .iter()
            .filter(|n| !n.removed && n.props.style_type.is_some())
            .filter_map(|n| n.props.sort_position.as_deref())
            .max()
            .unwrap_or("")
            .to_owned();
        let sort = crate::edit::between(&last, None).unwrap_or_else(|| format!("{last}O"));
        let node_type = if kind == Kind::Text {
            "TEXT"
        } else {
            "RECTANGLE"
        };
        let patch = if kind == Kind::Text {
            Patch {
                characters: Some("Ag".into()),
                ..text_patch(&shown.text_style.as_deref().cloned().unwrap_or_default())
            }
        } else {
            Patch::default()
        };
        let spec = NewNode {
            node_type: node_type.into(),
            name: Some(name.into()),
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            props: patch,
        };
        let index = self.doc.node(canvas).children.len();
        let style = self.create(canvas, Some(index), &spec)?;
        let p = self.edit(style, flags::STYLES | flags::FILLS | flags::EFFECTS);
        p.style_type = Some(kind.style_type());
        p.sort_position = Some(sort.into());
        match kind {
            Kind::Fill => p.fills = Some(shown.fills.clone().unwrap_or_else(|| Arc::from([]))),
            Kind::Stroke => p.fills = Some(shown.strokes.clone().unwrap_or_else(|| Arc::from([]))),
            Kind::Effect => {
                p.fills = Some(Arc::from([]));
                p.effects = Some(shown.effects.clone().unwrap_or_else(|| Arc::from([])));
            }
            Kind::Text => {}
        }
        // The new style is not a layer to select.
        let guid = self.doc.props(style).guid.unwrap_or_default().to_string();
        self.created.retain(|c| *c != guid);
        self.apply_style(from, kind_name, Some(style))
    }

    pub(super) fn edit_style(
        &mut self,
        style: NodeIdx,
        name: Option<&str>,
        patch: &Patch,
    ) -> Result<()> {
        if self.doc.props(style).style_type.is_none() {
            return Err(FigError::Unsupported("not a style".into()));
        }
        if let Some(name) = name.map(str::trim).filter(|n| !n.is_empty()) {
            self.edit(style, flags::NAME).name = Some(name.into());
        }
        let values = Patch {
            name: None,
            ..patch.clone()
        };
        self.set(style, &values)?;
        self.propagate_style(style)
    }

    /// Gives every layer using `style` its current values.
    fn propagate_style(&mut self, style: NodeIdx) -> Result<()> {
        let s = self.doc.props(style).clone();
        let Some(g) = s.guid else { return Ok(()) };
        let text = s
            .text_style
            .as_deref()
            .map(text_patch)
            .filter(|_| s.style_type == Some(StyleType::Text));
        for i in 0..self.doc.nodes.len() as NodeIdx {
            if i == style || self.doc.node(i).removed {
                continue;
            }
            let p = self.doc.props(i);
            let refs = [p.fill_style, p.stroke_style, p.effect_style, p.text_style_id];
            let in_overrides = p.symbol.as_ref().is_some_and(|sym| {
                sym.overrides.iter().any(|o| {
                    [o.fill_style, o.stroke_style, o.effect_style].contains(&Some(g))
                })
            });
            if !refs.contains(&Some(g)) && !in_overrides {
                continue;
            }
            let p = p.clone();
            if p.fill_style == Some(g) {
                self.edit(i, flags::FILLS).fills = s.fills.clone();
            }
            if p.stroke_style == Some(g) {
                self.edit(i, flags::STROKES).strokes = s.fills.clone();
            }
            if p.effect_style == Some(g) {
                self.edit(i, flags::EFFECTS).effects = s.effects.clone();
            }
            if p.text_style_id == Some(g)
                && p.node_type() == NodeType::Text
                && let Some(patch) = &text
            {
                self.set(i, patch)?;
                self.edit(i, flags::STYLES).text_style_id = Some(g);
            }
            // Instances' layers using it through overrides.
            let uses = |o: &Props| {
                o.fill_style == Some(g) || o.stroke_style == Some(g) || o.effect_style == Some(g)
            };
            if p.symbol
                .as_ref()
                .is_some_and(|sym| sym.overrides.iter().any(uses))
            {
                self.edit_overrides(i, |_, list| {
                    for o in list.iter_mut().filter(|o| uses(o)) {
                        if o.fill_style == Some(g) {
                            o.fills = s.fills.clone();
                        }
                        if o.stroke_style == Some(g) {
                            o.strokes = s.fills.clone();
                        }
                        if o.effect_style == Some(g) {
                            o.effects = s.effects.clone();
                        }
                        o.recomputed = true;
                    }
                });
            }
        }
        Ok(())
    }

    /// Deletes a local style as Figma does: it is kept, marked deleted, so
    /// layers using it keep their values.
    pub(super) fn delete_style(&mut self, style: NodeIdx) {
        if self.doc.props(style).style_type.is_some() {
            self.edit(style, flags::STYLES).soft_deleted = Some(true);
        }
    }
}
