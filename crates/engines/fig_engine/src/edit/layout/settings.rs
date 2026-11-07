//! Auto layout settings as the editor changes them: how layers size (fixed,
//! hug, fill), direction, gap, padding, and alignment, and "Add auto layout".

use super::super::{Patch, Txn, flags};
use crate::document::{Document, NodeIdx};
use crate::model::{AutoLayout, NodeType, Rect};
use std::sync::Arc;

/// How a layer's width (`x`) or height follows auto layout, as the design
/// panel shows it: `FILL` its auto layout parent, `HUG` its content, or
/// `FIXED`.
pub fn axis_sizing(doc: &Document, i: NodeIdx, x: bool) -> &'static str {
    let props = doc.props(i);
    let child = props.layout_child.clone().unwrap_or_default();
    if let Some(parent) = doc.node(i).parent
        && let Some(al) = doc.props(parent).auto_layout.as_deref()
        && (al.mode == "HORIZONTAL" || al.mode == "VERTICAL")
        && !child.is_absolute()
    {
        let fills = if al.horizontal() == x {
            child.fills_primary()
        } else {
            child.stretches()
        };
        if fills {
            return "FILL";
        }
    }
    if let Some(al) = props.auto_layout.as_deref()
        && (al.mode == "HORIZONTAL" || al.mode == "VERTICAL")
    {
        let hugs = if al.horizontal() == x {
            al.hugs_primary()
        } else {
            al.hugs_counter()
        };
        return if hugs { "HUG" } else { "FIXED" };
    }
    if props.node_type() == NodeType::Text {
        let auto = props
            .text_style
            .as_ref()
            .and_then(|s| s.auto_resize.as_deref());
        return match (auto, x) {
            (Some("WIDTH_AND_HEIGHT"), _) | (Some("HEIGHT"), false) => "HUG",
            _ => "FIXED",
        };
    }
    "FIXED"
}

impl Txn<'_> {
    /// Applies a patch's auto layout fields. Returns the text resizing a
    /// sizing change implies for a text layer.
    pub(in crate::edit) fn set_layout(
        &mut self,
        i: NodeIdx,
        patch: &Patch,
    ) -> Option<&'static str> {
        let node_type = self.doc.props(i).node_type();
        let frame_like = node_type.is_frame_like() && node_type != NodeType::Instance;
        if let Some(mode) = &patch.layout_mode {
            if mode == "NONE" {
                self.edit(i, flags::AUTO_LAYOUT).auto_layout = None;
            } else if frame_like {
                let mut al = self
                    .doc
                    .props(i)
                    .auto_layout
                    .as_deref()
                    .cloned()
                    .unwrap_or_else(|| AutoLayout {
                        counter_sizing: Some("RESIZE_TO_FIT_WITH_IMPLICIT_SIZE".into()),
                        ..AutoLayout::default()
                    });
                al.mode = mode.clone();
                al.wrap = false;
                self.edit(i, flags::AUTO_LAYOUT).auto_layout = Some(Arc::new(al));
            }
        }
        let settings = patch.item_spacing.is_some()
            || patch.padding_top.is_some()
            || patch.padding_right.is_some()
            || patch.padding_bottom.is_some()
            || patch.padding_left.is_some()
            || patch.primary_align.is_some()
            || patch.counter_align.is_some();
        if settings && let Some(old) = self.doc.props(i).auto_layout.as_deref() {
            let mut al = old.clone();
            let set = |slot: &mut f32, v: Option<f32>| {
                if let Some(v) = v {
                    *slot = v;
                }
            };
            set(&mut al.spacing, patch.item_spacing);
            set(&mut al.padding_top, patch.padding_top.map(|v| v.max(0.0)));
            set(
                &mut al.padding_right,
                patch.padding_right.map(|v| v.max(0.0)),
            );
            set(
                &mut al.padding_bottom,
                patch.padding_bottom.map(|v| v.max(0.0)),
            );
            set(&mut al.padding_left, patch.padding_left.map(|v| v.max(0.0)));
            if let Some(a) = &patch.primary_align {
                al.primary_align = Some(a.clone());
            }
            if let Some(a) = &patch.counter_align {
                al.counter_align = Some(a.clone());
            }
            self.edit(i, flags::AUTO_LAYOUT).auto_layout = Some(Arc::new(al));
        }
        if let Some(p) = &patch.layout_positioning {
            let mut child = self.doc.props(i).layout_child.clone().unwrap_or_default();
            child.absolute = Some(p == "ABSOLUTE");
            self.edit(i, flags::LAYOUT_CHILD).layout_child = Some(child);
        }
        let mut text = None;
        for (value, x) in [
            (&patch.sizing_horizontal, true),
            (&patch.sizing_vertical, false),
        ] {
            let Some(value) = value.as_deref() else {
                continue;
            };
            if let Some(t) = self.set_sizing(i, x, value) {
                text = Some(t);
            }
        }
        text
    }

    /// Makes an auto layout frame hug its content along an axis (`x` or
    /// not), or keep a fixed size. Returns whether `i` has auto layout.
    fn set_stack_sizing(&mut self, i: NodeIdx, x: bool, hug: bool) -> bool {
        let Some(old) = self.doc.props(i).auto_layout.as_deref() else {
            return false;
        };
        let mut al = old.clone();
        let size = if hug {
            "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE"
        } else {
            "FIXED"
        };
        if al.horizontal() == x {
            al.primary_sizing = Some(size.into());
        } else {
            al.counter_sizing = Some(size.into());
        }
        if &al != old {
            self.edit(i, flags::AUTO_LAYOUT).auto_layout = Some(Arc::new(al));
        }
        true
    }

    fn set_sizing(&mut self, i: NodeIdx, x: bool, value: &str) -> Option<&'static str> {
        let parent_stack = self
            .doc
            .node(i)
            .parent
            .and_then(|p| self.doc.props(p).auto_layout.clone())
            .filter(|al| al.mode == "HORIZONTAL" || al.mode == "VERTICAL");
        // Filling is a property of the child in its parent's flow.
        if let Some(pal) = &parent_stack {
            let along = pal.horizontal() == x;
            let mut child = self.doc.props(i).layout_child.clone().unwrap_or_default();
            let fill = value == "FILL";
            if along {
                child.grow = Some(if fill { 1.0 } else { 0.0 });
            } else if fill {
                child.align = Some("STRETCH".into());
            } else if child.stretches() {
                child.align = Some("AUTO".into());
            }
            if self.doc.props(i).layout_child.as_ref() != Some(&child) {
                self.edit(i, flags::LAYOUT_CHILD).layout_child = Some(child);
            }
            if fill {
                // A stack filling its parent no longer hugs that way: Figma
                // keeps the axis fixed.
                self.set_stack_sizing(i, x, false);
                return None;
            }
        }
        if value == "FILL" {
            return None;
        }
        let hug = value == "HUG";
        if self.set_stack_sizing(i, x, hug) {
            return None;
        }
        if self.doc.props(i).node_type() == NodeType::Text {
            let current = self
                .doc
                .props(i)
                .text_style
                .as_ref()
                .and_then(|s| s.auto_resize.clone());
            return Some(match (x, hug, current.as_deref()) {
                (true, true, _) => "WIDTH_AND_HEIGHT",
                (true, false, Some("WIDTH_AND_HEIGHT")) => "HEIGHT",
                (true, false, Some("HEIGHT")) => "HEIGHT",
                (false, true, Some("WIDTH_AND_HEIGHT")) => "WIDTH_AND_HEIGHT",
                (false, true, _) => "HEIGHT",
                _ => "NONE",
            });
        }
        None
    }

    /// Figma's rule for a size the person set: an axis that hugged or
    /// filled becomes fixed.
    pub(in crate::edit) fn user_resize(&self, i: NodeIdx, patch: &Patch) -> Patch {
        let mut patch = patch.clone();
        let rules = [
            (
                patch.width.is_some(),
                patch.sizing_horizontal.is_none(),
                true,
            ),
            (
                patch.height.is_some(),
                patch.sizing_vertical.is_none(),
                false,
            ),
        ];
        for (sized, unset, x) in rules {
            if !sized || !unset {
                continue;
            }
            let stackish =
                self.is_stack(i) || self.doc.node(i).parent.is_some_and(|p| self.is_stack(p));
            if stackish && axis_sizing(self.doc, i, x) != "FIXED" {
                let fixed = Some("FIXED".to_string());
                if x {
                    patch.sizing_horizontal = fixed;
                } else {
                    patch.sizing_vertical = fixed;
                }
            }
        }
        patch
    }

    /// "Add auto layout": `ids` that are one frame without auto layout get
    /// it; otherwise they are wrapped in a new auto layout frame. Direction,
    /// gap, and padding come from how the layers are arranged. Returns the
    /// frame.
    pub(in crate::edit) fn add_auto_layout(
        &mut self,
        ids: &[NodeIdx],
    ) -> crate::error::Result<Option<NodeIdx>> {
        let frame = match ids {
            [one]
                if {
                    let t = self.doc.props(*one).node_type();
                    matches!(t, NodeType::Frame | NodeType::Symbol)
                        && self.doc.props(*one).auto_layout.is_none()
                } =>
            {
                *one
            }
            _ => {
                let parent = ids.first().and_then(|&i| self.doc.node(i).parent);
                let same: Vec<NodeIdx> = ids
                    .iter()
                    .copied()
                    .filter(|&i| self.doc.node(i).parent == parent)
                    .collect();
                match self.group(&same, true)? {
                    Some(g) => {
                        self.edit(g, flags::NAME).name = Some("Frame".into());
                        // As in Figma, the new frame does not clip what it
                        // wraps (shadows and overhangs stay visible).
                        self.edit(g, flags::CLIP).clip_disabled = Some(true);
                        g
                    }
                    None => return Ok(None),
                }
            }
        };
        let kids: Vec<(NodeIdx, Rect)> = self
            .doc
            .node(frame)
            .children
            .iter()
            .copied()
            .filter(|&c| !self.doc.node(c).removed && self.doc.props(c).visible())
            .map(|c| (c, self.local_bounds(c)))
            .collect();
        let content = kids.iter().fold(Rect::EMPTY, |a, (_, r)| a.union(r));
        // Side by side when the layers spread wider than tall.
        let horizontal = kids.len() < 2 || content.w >= content.h;
        let mut ordered = kids.clone();
        ordered.sort_by(|a, b| {
            let (ka, kb) = if horizontal {
                (a.1.x, b.1.x)
            } else {
                (a.1.y, b.1.y)
            };
            ka.total_cmp(&kb)
        });
        let gaps: Vec<f64> = ordered
            .windows(2)
            .map(|w| {
                if horizontal {
                    w[1].1.x - (w[0].1.x + w[0].1.w)
                } else {
                    w[1].1.y - (w[0].1.y + w[0].1.h)
                }
            })
            .collect();
        let spacing = if gaps.is_empty() {
            0.0
        } else {
            (gaps.iter().sum::<f64>() / gaps.len() as f64)
                .max(0.0)
                .round()
        };
        // Padding from where the content sits, the same on opposite sides;
        // the frame then hugs it.
        let (top, left) = if content.is_empty() {
            (0.0, 0.0)
        } else {
            (content.y.max(0.0).round(), content.x.max(0.0).round())
        };
        let (bottom, right) = (top, left);
        // Flow order follows the arrangement.
        for (k, (c, _)) in ordered.iter().enumerate() {
            if self.doc.node(frame).children.get(k) != Some(c) {
                self.attach(*c, frame, k, false);
            }
        }
        let al = AutoLayout {
            mode: if horizontal { "HORIZONTAL" } else { "VERTICAL" }.into(),
            spacing: spacing as f32,
            padding_top: top as f32,
            padding_left: left as f32,
            padding_bottom: bottom as f32,
            padding_right: right as f32,
            counter_sizing: Some("RESIZE_TO_FIT_WITH_IMPLICIT_SIZE".into()),
            ..AutoLayout::default()
        };
        self.edit(frame, flags::AUTO_LAYOUT).auto_layout = Some(Arc::new(al));
        Ok(Some(frame))
    }
}
