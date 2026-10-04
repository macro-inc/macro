//! Groups: grouping and ungrouping shapes, and the coordinate spaces of
//! group members.
//!
//! A member's transform is stored in its group's child space (`chOff` and
//! `chExt`), which the group maps onto its own box. Editors and AI tools work
//! in slide space instead: a member's slide-space frame is the box, rotation,
//! and flips it would have if it sat directly on the slide, which is also
//! what ungrouping gives it. Member boxes scale with the group along the
//! group's axes; a member turned by 45-135° (or 225-315°) has its width scaled
//! by the group's vertical factor and its height by the horizontal one, so
//! scaling never shears a member, as in PowerPoint. Without shear (a uniform
//! scale, or members turned by multiples of 90°) this is exactly how the
//! renderer draws members.

use super::shapes::{TREE_ITEMS, TransformPatch, find, tree_item, xfrm_element};
use super::xmlutil::{FILL_NAMES, fresh_shape_id, import_fragment};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::{Xfrm, alternate_content_choice, c_nv_pr, placeholder_of};
use crate::path::Affine;
use crate::units::EMU_PER_PT;
use crate::xml::{NodeId, Ns, XmlDoc};

/// Child order of an `a:xfrm`.
const XFRM_ORDER: &[&str] = &["off", "ext", "chOff", "chExt"];
/// Differences below half an EMU (in points) are rounding noise.
const EPSILON_PT: f64 = 0.5 / EMU_PER_PT;

/// A box with rotation and flips, in points (f64 keeps EMU precision).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Frame {
    /// Left of the unrotated box.
    pub x: f64,
    /// Top of the unrotated box.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
    /// Clockwise rotation in degrees (0-360).
    pub rot: f64,
    /// Mirrored horizontally.
    pub flip_h: bool,
    /// Mirrored vertically.
    pub flip_v: bool,
}

impl Frame {
    /// The frame of a parsed transform.
    pub fn from_xfrm(x: &Xfrm) -> Self {
        Self {
            x: f64::from(x.x),
            y: f64::from(x.y),
            w: f64::from(x.w),
            h: f64::from(x.h),
            rot: f64::from(x.rot).rem_euclid(360.0),
            flip_h: x.flip_h,
            flip_v: x.flip_v,
        }
    }

    /// Reads an `a:xfrm` or `p:xfrm` element.
    pub fn read(doc: &XmlDoc, xfrm: NodeId) -> Self {
        let pt = |n: Option<NodeId>, a: &str| {
            n.and_then(|n| doc.attr_f64(n, a))
                .map_or(0.0, |v| v / EMU_PER_PT)
        };
        let off = doc.child(xfrm, Ns::A, "off");
        let ext = doc.child(xfrm, Ns::A, "ext");
        Self {
            x: pt(off, "x"),
            y: pt(off, "y"),
            w: pt(ext, "cx").max(0.0),
            h: pt(ext, "cy").max(0.0),
            rot: doc
                .attr_f64(xfrm, "rot")
                .map_or(0.0, |r| (r / 60_000.0).rem_euclid(360.0)),
            flip_h: doc.attr_bool(xfrm, "flipH").unwrap_or(false),
            flip_v: doc.attr_bool(xfrm, "flipV").unwrap_or(false),
        }
    }

    /// Center of the box.
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.w / 2.0, self.y + self.h / 2.0)
    }

    /// Axis-aligned bounds of the rotated box: `[left, top, right, bottom]`.
    pub fn bounds(&self) -> [f64; 4] {
        let (cx, cy) = self.center();
        let (s, c) = self.rot.to_radians().sin_cos();
        let hw = (self.w / 2.0 * c).abs() + (self.h / 2.0 * s).abs();
        let hh = (self.w / 2.0 * s).abs() + (self.h / 2.0 * c).abs();
        [cx - hw, cy - hh, cx + hw, cy + hh]
    }

    /// Box-local coordinates (`0..w`, `0..h`) → parent coordinates.
    fn local_to_parent(&self) -> Affine {
        let (cx, cy) = self.center();
        let flip = Affine::scale(
            if self.flip_h { -1.0 } else { 1.0 },
            if self.flip_v { -1.0 } else { 1.0 },
        );
        Affine::translate(cx, cy)
            .pre_concat(&Affine::rotate(self.rot))
            .pre_concat(&flip)
            .pre_concat(&Affine::translate(-self.w / 2.0, -self.h / 2.0))
    }

    /// Writes the box into an `xfrm` element, and the rotation and flips when `turn`.
    pub fn write(&self, doc: &mut XmlDoc, xfrm: NodeId, turn: bool) {
        let off = doc.ensure_child(xfrm, Ns::A, "off", XFRM_ORDER);
        doc.set_attr(off, "x", &emu(self.x).to_string());
        doc.set_attr(off, "y", &emu(self.y).to_string());
        let ext = doc.ensure_child(xfrm, Ns::A, "ext", XFRM_ORDER);
        doc.set_attr(ext, "cx", &emu(self.w.max(0.0)).to_string());
        doc.set_attr(ext, "cy", &emu(self.h.max(0.0)).to_string());
        if !turn {
            return;
        }
        let rot = (self.rot.rem_euclid(360.0) * 60_000.0).round() as i64 % 21_600_000;
        if rot == 0 {
            doc.remove_attr(xfrm, "rot");
        } else {
            doc.set_attr(xfrm, "rot", &rot.to_string());
        }
        for (name, on) in [("flipH", self.flip_h), ("flipV", self.flip_v)] {
            if on {
                doc.set_attr(xfrm, name, "1");
            } else {
                doc.remove_attr(xfrm, name);
            }
        }
    }
}

/// Points → EMU, rounded.
fn emu(pt: f64) -> i64 {
    (pt * EMU_PER_PT).round() as i64
}

/// Maps a point through an affine transform in f64.
fn apply(t: &Affine, (x, y): (f64, f64)) -> (f64, f64) {
    (t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f)
}

/// Whether a member at this rotation is turned sideways (45-135° or 225-315°).
fn turned(rot: f64) -> bool {
    // Rotations computed back from a bake land within rounding of the bounds.
    const SLACK: f64 = 1e-9;
    (45.0 - SLACK..135.0 - SLACK).contains(&rot.rem_euclid(180.0))
}

/// How a group maps its child coordinates onto its own box.
#[derive(Clone, Copy, Debug)]
pub(crate) struct GroupSpace {
    /// The group's own frame (in its parent's coordinates).
    frame: Frame,
    /// Child-space origin (`chOff`).
    ch_x: f64,
    ch_y: f64,
    /// Child-space → group scale.
    sx: f64,
    sy: f64,
}

impl GroupSpace {
    /// A group with frame `frame` and child rectangle `[x, y, w, h]`, mapped
    /// as the renderer does (a degenerate child extent does not scale).
    fn new(frame: Frame, child: Option<[f64; 4]>) -> Self {
        match child {
            Some([x, y, w, h]) if w > 0.0 && h > 0.0 => Self {
                frame,
                ch_x: x,
                ch_y: y,
                sx: frame.w / w,
                sy: frame.h / h,
            },
            Some([x, y, ..]) => Self {
                frame,
                ch_x: x,
                ch_y: y,
                sx: 1.0,
                sy: 1.0,
            },
            None => Self {
                frame,
                ch_x: frame.x,
                ch_y: frame.y,
                sx: 1.0,
                sy: 1.0,
            },
        }
    }

    /// The space of a parsed group transform.
    pub fn from_xfrm(x: &Xfrm) -> Self {
        let child = x.child.map(|r| {
            [
                f64::from(r.x),
                f64::from(r.y),
                f64::from(r.w),
                f64::from(r.h),
            ]
        });
        Self::new(Frame::from_xfrm(x), child)
    }

    /// The space of a group's `a:xfrm` element.
    fn read(doc: &XmlDoc, xfrm: NodeId) -> Self {
        Self::new(Frame::read(doc, xfrm), child_rect(doc, xfrm))
    }

    /// Child coordinates → the group's parent coordinates.
    fn child_to_parent(&self) -> Affine {
        self.frame.local_to_parent().pre_concat(
            &Affine::scale(self.sx, self.sy).pre_concat(&Affine::translate(-self.ch_x, -self.ch_y)),
        )
    }

    /// Scale factors for a member box at rotation `rot` (swapped when turned sideways).
    fn scales(&self, rot: f64) -> (f64, f64) {
        if turned(rot) {
            (self.sy, self.sx)
        } else {
            (self.sx, self.sy)
        }
    }

    /// Whether the group's flips reverse the sense of rotation.
    fn mirrors(&self) -> bool {
        self.frame.flip_h != self.frame.flip_v
    }

    /// A member's frame (child space) in the group's parent space.
    pub fn bake(&self, c: &Frame) -> Frame {
        let (sx, sy) = self.scales(c.rot);
        let (w, h) = (c.w * sx, c.h * sy);
        let (cx, cy) = apply(&self.child_to_parent(), c.center());
        let rot = if self.mirrors() {
            self.frame.rot - c.rot
        } else {
            self.frame.rot + c.rot
        };
        Frame {
            x: cx - w / 2.0,
            y: cy - h / 2.0,
            w,
            h,
            rot: rot.rem_euclid(360.0),
            flip_h: self.frame.flip_h != c.flip_h,
            flip_v: self.frame.flip_v != c.flip_v,
        }
    }

    /// The inverse of [`Self::bake`]: a parent-space frame as a member's child-space frame.
    pub fn unbake(&self, p: &Frame) -> Frame {
        let rot = if self.mirrors() {
            self.frame.rot - p.rot
        } else {
            p.rot - self.frame.rot
        }
        .rem_euclid(360.0);
        let (sx, sy) = self.scales(rot);
        let (w, h) = (p.w / nonzero(sx), p.h / nonzero(sy));
        let (cx, cy) = self
            .child_to_parent()
            .invert()
            .map_or(p.center(), |inv| apply(&inv, p.center()));
        Frame {
            x: cx - w / 2.0,
            y: cy - h / 2.0,
            w,
            h,
            rot,
            flip_h: self.frame.flip_h != p.flip_h,
            flip_v: self.frame.flip_v != p.flip_v,
        }
    }
}

fn nonzero(v: f64) -> f64 {
    if v.abs() < 1e-12 { 1.0 } else { v }
}

/// The child rectangle (`chOff`/`chExt`) of a group transform, in points.
fn child_rect(doc: &XmlDoc, xfrm: NodeId) -> Option<[f64; 4]> {
    let ch_off = doc.child(xfrm, Ns::A, "chOff");
    let ch_ext = doc.child(xfrm, Ns::A, "chExt");
    if ch_off.is_none() && ch_ext.is_none() {
        return None;
    }
    let pt = |n: Option<NodeId>, a: &str| {
        n.and_then(|n| doc.attr_f64(n, a))
            .map_or(0.0, |v| v / EMU_PER_PT)
    };
    Some([
        pt(ch_off, "x"),
        pt(ch_off, "y"),
        pt(ch_ext, "cx"),
        pt(ch_ext, "cy"),
    ])
}

/// The groups containing `node`, innermost first.
pub(crate) fn ancestors(doc: &XmlDoc, node: NodeId) -> Vec<NodeId> {
    let mut out = Vec::new();
    let mut at = doc.parent(node);
    while let Some(p) = at {
        match doc.local(p) {
            "grpSp" => out.push(p),
            "spTree" => break,
            _ => {}
        }
        at = doc.parent(p);
    }
    out
}

/// A group's coordinate space (the identity when it has no transform).
fn group_space(doc: &XmlDoc, group: NodeId) -> GroupSpace {
    match xfrm_element(doc, group) {
        Some(x) => GroupSpace::read(doc, x),
        None => GroupSpace::new(Frame::default(), None),
    }
}

/// A frame in the coordinates of `node`'s parent, mapped to slide space.
pub(crate) fn to_slide(doc: &XmlDoc, node: NodeId, frame: Frame) -> Frame {
    ancestors(doc, node)
        .into_iter()
        .fold(frame, |f, g| group_space(doc, g).bake(&f))
}

/// A slide-space frame, mapped to the coordinates of `node`'s parent.
pub(crate) fn to_local(doc: &XmlDoc, node: NodeId, frame: Frame) -> Frame {
    ancestors(doc, node)
        .into_iter()
        .rev()
        .fold(frame, |f, g| group_space(doc, g).unbake(&f))
}

/// The shape elements of a z-order slot: the slot itself, or every branch's
/// shapes of an `mc:AlternateContent`.
pub(crate) fn branch_shapes(doc: &XmlDoc, item: NodeId) -> Vec<NodeId> {
    if doc.local(item) == "AlternateContent" {
        doc.children(item)
            .flat_map(|branch| doc.children(branch).collect::<Vec<_>>())
            .collect()
    } else {
        vec![item]
    }
}

/// The shape of a z-order slot that the renderer shows.
fn shown_shape(doc: &XmlDoc, item: NodeId) -> Option<NodeId> {
    if doc.local(item) == "AlternateContent" {
        alternate_content_choice(doc, item).and_then(|b| doc.first_child(b))
    } else {
        Some(item)
    }
}

/// The `cNvPr` id of a z-order slot's shown shape.
fn item_id(doc: &XmlDoc, item: NodeId) -> Option<u32> {
    let shape = shown_shape(doc, item)?;
    c_nv_pr(doc, shape)
        .and_then(|c| doc.attr_i64(c, "id"))
        .and_then(|id| u32::try_from(id).ok())
}

/// The z-order slots of a group.
fn members(doc: &XmlDoc, group: NodeId) -> Vec<NodeId> {
    doc.children(group)
        .filter(|&c| TREE_ITEMS.contains(&doc.local(c)))
        .collect()
}

/// The number in a new shape's name ("Group 4"): PowerPoint uses id - 1;
/// with random ids, the count of shapes instead.
fn display_number(doc: &XmlDoc, id: u32, random: bool) -> u32 {
    if random {
        doc.descendants(doc.root())
            .into_iter()
            .filter(|&c| doc.local(c) == "cNvPr")
            .count() as u32
    } else {
        id.saturating_sub(1)
    }
}

/// Groups shapes sharing a parent; returns the group's id.
pub fn group_shapes(pres: &mut Presentation, part: &str, ids: &[u32]) -> Result<u32> {
    let mut unique: Vec<u32> = Vec::new();
    for &id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    let too_few = || Error::InvalidEdit("grouping needs at least two shapes".into());
    if unique.len() < 2 {
        return Err(too_few());
    }
    let random = pres.pkg.ids().cloned();
    let doc = pres.xml_mut(part)?;
    let mut items: Vec<(NodeId, NodeId)> = Vec::new();
    let mut parent: Option<NodeId> = None;
    for id in unique {
        let node = find(doc, id)?;
        if placeholder_of(doc, node).is_some() {
            return Err(Error::InvalidEdit(format!(
                "shape {id} is a placeholder; placeholders cannot be grouped"
            )));
        }
        let item = tree_item(doc, node);
        let p = doc
            .parent(item)
            .ok_or_else(|| Error::InvalidEdit(format!("shape {id} is not on the slide")))?;
        if parent.is_some_and(|q| q != p) {
            return Err(Error::InvalidEdit(
                "only shapes in the same group (or all on the slide itself) can be grouped together"
                    .into(),
            ));
        }
        parent = Some(p);
        if !items.iter().any(|(i, _)| *i == item) {
            items.push((item, node));
        }
    }
    if items.len() < 2 {
        return Err(too_few());
    }
    items.sort_by_key(|(i, _)| doc.index_in_parent(*i));
    let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for (_, node) in &items {
        let f = xfrm_element(doc, *node)
            .map(|x| Frame::read(doc, x))
            .unwrap_or_default();
        let [l, t, r, btm] = f.bounds();
        b = [b[0].min(l), b[1].min(t), b[2].max(r), b[3].max(btm)];
    }
    let (x, y) = (emu(b[0]), emu(b[1]));
    let (w, h) = (emu(b[2]) - x, emu(b[3]) - y);
    let id = fresh_shape_id(doc, random.as_deref());
    let n = display_number(doc, id, random.is_some());
    let xml = format!(
        "<p:grpSp><p:nvGrpSpPr><p:cNvPr id=\"{id}\" name=\"Group {n}\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{w}\" cy=\"{h}\"/><a:chOff x=\"{x}\" y=\"{y}\"/><a:chExt cx=\"{w}\" cy=\"{h}\"/></a:xfrm></p:grpSpPr></p:grpSp>"
    );
    let group = import_fragment(doc, &xml)?;
    let top = items[items.len() - 1].0;
    doc.insert_after(top, group);
    for (item, _) in items {
        doc.append_child(group, item);
    }
    Ok(id)
}

/// Ungroups a group in place; returns its members' ids, back to front.
pub fn ungroup(pres: &mut Presentation, part: &str, id: u32) -> Result<Vec<u32>> {
    let doc = pres.xml_mut(part)?;
    let group = find(doc, id)?;
    if doc.local(group) != "grpSp" {
        return Err(Error::InvalidEdit(format!("shape {id} is not a group")));
    }
    let space = group_space(doc, group);
    let fill = group_fill(doc, group);
    let item = tree_item(doc, group);
    let mut ids = Vec::new();
    for member in members(doc, group) {
        for shape in branch_shapes(doc, member) {
            if let Some(x) = xfrm_element(doc, shape) {
                if doc.local(shape) == "grpSp" {
                    pin_child_space(doc, x);
                }
                let baked = space.bake(&Frame::read(doc, x));
                baked.write(doc, x, true);
            }
            inherit_group_fill(doc, shape, fill);
        }
        ids.extend(item_id(doc, member));
        doc.insert_before(item, member);
    }
    doc.detach(item);
    Ok(ids)
}

/// The fill-choice element of a group's properties.
fn group_fill(doc: &XmlDoc, group: NodeId) -> Option<NodeId> {
    let pr = doc.children(group).find(|&c| doc.local(c) == "grpSpPr")?;
    doc.children(pr)
        .find(|&c| doc.ns(c) == Ns::A && FILL_NAMES.contains(&doc.local(c)))
}

/// The fill that `a:grpFill` resolves to for a member of the groups around
/// `item`: the nearest enclosing group fill that is not itself inherited.
pub(crate) fn inherited_group_fill(doc: &XmlDoc, item: NodeId) -> Option<NodeId> {
    for g in ancestors(doc, item) {
        match group_fill(doc, g) {
            Some(f) if doc.local(f) == "grpFill" => continue,
            other => return other,
        }
    }
    None
}

/// Replaces a former member's `a:grpFill` (fill or outline) with the group's
/// fill, so it keeps its look outside the group.
pub(crate) fn inherit_group_fill(doc: &mut XmlDoc, shape: NodeId, fill: Option<NodeId>) {
    if fill.is_some_and(|f| doc.local(f) == "grpFill") {
        // The group itself inherits; its members now inherit from its parent.
        return;
    }
    let Some(pr) = doc
        .children(shape)
        .find(|&c| matches!(doc.local(c), "spPr" | "grpSpPr"))
    else {
        return;
    };
    let mut holders = vec![pr];
    holders.extend(doc.child(pr, Ns::A, "ln"));
    for holder in holders {
        let Some(old) = doc.child(holder, Ns::A, "grpFill") else {
            continue;
        };
        let replacement = match fill {
            Some(f) => doc.deep_clone(f),
            None => doc.create_element(Ns::A, "noFill"),
        };
        doc.insert_before(old, replacement);
        doc.detach(old);
    }
}

/// Gives a group transform explicit `chOff`/`chExt` (equal to its box when
/// missing), so changing the box scales the members instead of moving them.
pub(crate) fn pin_child_space(doc: &mut XmlDoc, xfrm: NodeId) {
    if doc.child(xfrm, Ns::A, "chOff").is_some() && doc.child(xfrm, Ns::A, "chExt").is_some() {
        return;
    }
    let f = Frame::read(doc, xfrm);
    let ch_off = doc.ensure_child(xfrm, Ns::A, "chOff", XFRM_ORDER);
    doc.set_attr(ch_off, "x", &emu(f.x).to_string());
    doc.set_attr(ch_off, "y", &emu(f.y).to_string());
    let ch_ext = doc.ensure_child(xfrm, Ns::A, "chExt", XFRM_ORDER);
    doc.set_attr(ch_ext, "cx", &emu(f.w).to_string());
    doc.set_attr(ch_ext, "cy", &emu(f.h).to_string());
}

/// Applies a slide-space transform patch to a group member, storing the
/// result in its group's child space, and refits the groups around it.
pub(crate) fn set_member_transform(
    doc: &mut XmlDoc,
    node: NodeId,
    xfrm: NodeId,
    current: &Xfrm,
    patch: &TransformPatch,
) {
    let local = if doc.child(xfrm, Ns::A, "off").is_some() {
        Frame::read(doc, xfrm)
    } else {
        Frame::from_xfrm(current)
    };
    let slide = to_slide(doc, node, local);
    let pick = |v: Option<f32>, old: f64| v.map_or(old, f64::from);
    let target = Frame {
        x: pick(patch.x, slide.x),
        y: pick(patch.y, slide.y),
        w: pick(patch.w, slide.w),
        h: pick(patch.h, slide.h),
        rot: pick(patch.rotation, slide.rot).rem_euclid(360.0),
        flip_h: patch.flip_h.unwrap_or(slide.flip_h),
        flip_v: patch.flip_v.unwrap_or(slide.flip_v),
    };
    let mut next = to_local(doc, node, target);
    let turn = patch.rotation.is_some() || patch.flip_h.is_some() || patch.flip_v.is_some();
    if !turn {
        // Keep the stored rotation and flips exactly as they were.
        next.rot = local.rot;
        next.flip_h = local.flip_h;
        next.flip_v = local.flip_v;
    }
    next.write(doc, xfrm, turn);
    refit_ancestors(doc, node);
}

/// Moves a group member by `(dx, dy)` points in slide space.
pub(crate) fn shift_member(doc: &mut XmlDoc, node: NodeId, xfrm: NodeId, dx: f64, dy: f64) {
    let local = Frame::read(doc, xfrm);
    let mut slide = to_slide(doc, node, local);
    slide.x += dx;
    slide.y += dy;
    let next = to_local(doc, node, slide);
    Frame {
        rot: local.rot,
        flip_h: local.flip_h,
        flip_v: local.flip_v,
        ..next
    }
    .write(doc, xfrm, false);
}

/// Refits every group containing `node` to its members' bounds (innermost
/// first), as PowerPoint does after a member moves; members stay in place.
pub(crate) fn refit_ancestors(doc: &mut XmlDoc, node: NodeId) {
    for g in ancestors(doc, node) {
        refit_group(doc, g);
    }
}

/// Refits `group` and every group containing it.
pub(crate) fn refit_group_and_ancestors(doc: &mut XmlDoc, group: NodeId) {
    refit_group(doc, group);
    refit_ancestors(doc, group);
}

/// Makes a group's box the bounds of its members, keeping them in place.
fn refit_group(doc: &mut XmlDoc, group: NodeId) {
    let Some(xfrm) = xfrm_element(doc, group) else {
        return;
    };
    let space = GroupSpace::read(doc, xfrm);
    let mut bounds: Option<[f64; 4]> = None;
    for item in members(doc, group) {
        let Some(x) = shown_shape(doc, item).and_then(|s| xfrm_element(doc, s)) else {
            continue;
        };
        let [l, t, r, b] = Frame::read(doc, x).bounds();
        bounds = Some(match bounds {
            Some([l0, t0, r0, b0]) => [l0.min(l), t0.min(t), r0.max(r), b0.max(b)],
            None => [l, t, r, b],
        });
    }
    let Some([l, t, r, b]) = bounds else {
        return;
    };
    let (w, h) = (r - l, b - t);
    if w <= 0.0 || h <= 0.0 {
        return;
    }
    let current = child_rect(doc, xfrm).unwrap_or({
        let f = space.frame;
        [f.x, f.y, f.w, f.h]
    });
    if [l, t, w, h]
        .iter()
        .zip(current)
        .all(|(a, b)| (a - b).abs() < EPSILON_PT)
    {
        return;
    }
    let (nw, nh) = (w * space.sx, h * space.sy);
    let (cx, cy) = apply(&space.child_to_parent(), (l + w / 2.0, t + h / 2.0));
    Frame {
        x: cx - nw / 2.0,
        y: cy - nh / 2.0,
        w: nw,
        h: nh,
        ..space.frame
    }
    .write(doc, xfrm, false);
    let ch_off = doc.ensure_child(xfrm, Ns::A, "chOff", XFRM_ORDER);
    doc.set_attr(ch_off, "x", &emu(l).to_string());
    doc.set_attr(ch_off, "y", &emu(t).to_string());
    let ch_ext = doc.ensure_child(xfrm, Ns::A, "chExt", XFRM_ORDER);
    doc.set_attr(ch_ext, "cx", &emu(w).to_string());
    doc.set_attr(ch_ext, "cy", &emu(h).to_string());
}

#[cfg(test)]
mod test;
