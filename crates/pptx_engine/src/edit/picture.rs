//! Pictures: cropping (`a:srcRect`, keeping the image where it is on the
//! slide) and the adjustments PowerPoint's Picture Format tab writes into
//! `a:blip` (brightness and contrast, recolor, transparency), and the
//! outline of both.
//!
//! Adjustments are DrawingML blip effects, which PowerPoint, LibreOffice,
//! and the renderer all apply: brightness and contrast as `a:lum`, then the
//! recolor (`a:grayscl`, `a:duotone`, `a:biLevel`, or the washout `a:lum`),
//! then transparency as `a:alphaModFix`, after any effects the engine does
//! not manage (a "set transparent color" `a:clrChange` keeps matching the
//! original colors). PowerPoint 2010+ corrections (`a14:imgProps`) are
//! applied to the image it stores in `r:embed`, keeping the original in an
//! image layer; brightness and contrast edits flatten them: the stored image
//! becomes the picture and the new `a:lum` applies on top of it.

use super::group::{self, Frame};
use super::ops::CropMode;
use super::shapes::{effective_xfrm, ensure_xfrm, find, xfrm_element};
use super::xmlutil::color_element;
use crate::error::{Error, Result};
use crate::font::FontDb;
use crate::inspect::{CropOutline, PictureOutline};
use crate::model::color::{ColorContext, ColorMap, ColorScheme, is_color_element, parse_color};
use crate::model::presentation::Presentation;
use crate::render::image::{Format, sniff};
use crate::xml::{NodeId, Ns, XmlDoc};

/// Child order of `p:blipFill`.
const BLIP_FILL_ORDER: &[&str] = &["blip", "srcRect", "tile", "stretch"];
/// The thinnest part of an image a crop may leave visible (a fraction).
const MIN_VISIBLE: f64 = 0.001;
/// Padding beyond this many image widths (or heights) is rejected.
const MAX_PADDING: f64 = 10.0;
/// The `a:lum` PowerPoint writes for the Washout recolor.
const WASHOUT: (i64, i64) = (70_000, -70_000);
/// The light color of PowerPoint's Sepia recolor (a duotone from black).
const SEPIA: &str = "D9C3A5";
/// Header bytes read to find a picture's pixel size: a little first, then
/// enough for JPEGs whose size follows large metadata segments.
const HEADER_BYTES: [usize; 2] = [4 * 1024, 256 * 1024];

/// Crop edges `[left, top, right, bottom]` as fractions of the image.
type Edges = [f64; 4];

/// The requested changes of a `cropPicture` operation.
pub(super) struct CropPatch {
    /// `[left, top, right, bottom]`; `None` keeps an edge.
    pub edges: [Option<f32>; 4],
    pub mode: Option<CropMode>,
}

/// The requested changes of a `formatPicture` operation.
pub(super) struct PicturePatch<'a> {
    pub brightness: Option<f32>,
    pub contrast: Option<f32>,
    pub recolor: Option<&'a str>,
    pub transparency: Option<f32>,
    pub reset: bool,
}

/// A recolor `formatPicture` writes.
#[derive(Clone, Debug, PartialEq)]
enum Recolor {
    None,
    Grayscale,
    Sepia,
    Washout,
    /// Black and white at this threshold (1000ths of a percent).
    BlackWhite(i64),
    /// Dark shades of a color, on white.
    Duotone(String),
    /// Light shades of a color, on black.
    DuotoneLight(String),
    /// What black and what white become.
    DuotonePair(String, String),
}

fn parse_recolor(spec: &str) -> Result<Recolor> {
    let spec = spec.trim();
    let recolor = match spec {
        "none" => Recolor::None,
        "grayscale" => Recolor::Grayscale,
        "sepia" => Recolor::Sepia,
        "washout" => Recolor::Washout,
        "blackWhite" => Recolor::BlackWhite(50_000),
        "blackWhite25" => Recolor::BlackWhite(25_000),
        "blackWhite75" => Recolor::BlackWhite(75_000),
        _ => match spec.split_once(':') {
            Some(("duotone", colors)) => match colors.split_once(',') {
                Some((dark, light)) => {
                    Recolor::DuotonePair(dark.trim().to_owned(), light.trim().to_owned())
                }
                None => Recolor::Duotone(colors.trim().to_owned()),
            },
            Some(("duotoneLight", color)) => Recolor::DuotoneLight(color.trim().to_owned()),
            _ => {
                return Err(Error::InvalidEdit(format!(
                    "unknown recolor `{spec}` (use none, grayscale, sepia, washout, blackWhite, \
                     blackWhite25, blackWhite75, duotone:<color>, duotoneLight:<color>, or \
                     duotone:<dark>,<light>)"
                )));
            }
        },
    };
    Ok(recolor)
}

/// The `blipFill` and `a:blip` of a picture, or why the shape has none.
fn picture_parts(doc: &XmlDoc, node: NodeId, id: u32) -> Result<(NodeId, NodeId)> {
    if doc.local(node) != "pic" {
        return Err(Error::InvalidEdit(format!(
            "shape {id} is not a picture (only pictures can be cropped or adjusted)"
        )));
    }
    let blip_fill = doc
        .children(node)
        .find(|&c| doc.local(c) == "blipFill")
        .ok_or_else(|| Error::InvalidEdit(format!("picture {id} has no image")))?;
    let blip = doc
        .child(blip_fill, Ns::A, "blip")
        .ok_or_else(|| Error::InvalidEdit(format!("picture {id} has no image")))?;
    Ok((blip_fill, blip))
}

/// Reads a `RelativeRect` (`l`, `t`, `r`, `b`).
fn relative_rect(doc: &XmlDoc, node: Option<NodeId>) -> Edges {
    let Some(n) = node else {
        return [0.0; 4];
    };
    ["l", "t", "r", "b"].map(|a| doc.attr(n, a).map_or(0.0, crate::model::color::percent))
}

/// The crop of a picture, with a stretch fill rectangle (insets of the
/// frame the image is drawn into) folded in, so the whole image spans the
/// frame grown by the crop fractions.
fn read_crop(doc: &XmlDoc, blip_fill: NodeId) -> Edges {
    let src = relative_rect(doc, doc.child(blip_fill, Ns::A, "srcRect"));
    let fill = relative_rect(
        doc,
        doc.child(blip_fill, Ns::A, "stretch")
            .and_then(|s| doc.child(s, Ns::A, "fillRect")),
    );
    let fold = |lo: usize, hi: usize, out: &mut Edges| {
        let dest = 1.0 - fill[lo] - fill[hi];
        if dest <= 0.0 {
            return;
        }
        let visible = 1.0 - src[lo] - src[hi];
        out[lo] = src[lo] - fill[lo] * visible / dest;
        out[hi] = src[hi] - fill[hi] * visible / dest;
    };
    let mut crop = src;
    fold(0, 2, &mut crop);
    fold(1, 3, &mut crop);
    crop
}

/// The image part a picture shows.
fn image_part(pres: &mut Presentation, part: &str, blip_rid: &str) -> Result<String> {
    pres.part_rels(part)?
        .target_part(blip_rid)
        .ok_or_else(|| Error::InvalidEdit("the picture's image is linked, not embedded".into()))
}

/// The pixel size in an image header (PNG, JPEG, GIF, BMP).
fn pixel_size(head: &[u8]) -> Option<(u32, u32)> {
    if let Some(size) = super::parts::image_size(head) {
        return Some(size);
    }
    if head.starts_with(b"BM") && head.len() >= 26 {
        let le32 =
            |at: usize| i32::from_le_bytes([head[at], head[at + 1], head[at + 2], head[at + 3]]);
        let core = le32(14) == 12;
        let (w, h) = if core {
            let le16 = |at: usize| i32::from(u16::from_le_bytes([head[at], head[at + 1]]));
            (le16(18), le16(20))
        } else {
            (le32(18), le32(22))
        };
        return Some((w.unsigned_abs(), h.unsigned_abs()));
    }
    None
}

/// The pixel size of an image part, read from its header.
pub(crate) fn natural_size(pres: &Presentation, image: &str) -> Option<(u32, u32)> {
    for max in HEADER_BYTES {
        let head = pres.pkg.read_prefix(image, max).ok()?;
        if let Some(size) = pixel_size(&head) {
            return Some(size).filter(|&(w, h)| w > 0 && h > 0);
        }
        if head.len() < max {
            break;
        }
    }
    None
}

/// Width over height of an image part (metafiles by their frame).
fn image_aspect(pres: &Presentation, image: &str) -> Result<f64> {
    if let Some((w, h)) = natural_size(pres, image) {
        return Ok(f64::from(w) / f64::from(h));
    }
    let bytes = pres.read_bytes(image)?;
    let size = match sniff(&bytes) {
        Format::Emf | Format::Wmf => crate::render::metafile::parse(&bytes, &FontDb::new())
            .ok()
            .map(|m| (f64::from(m.width_pt), f64::from(m.height_pt))),
        _ => crate::render::image::decode_raster(&bytes)
            .ok()
            .map(|r| (f64::from(r.width), f64::from(r.height))),
    };
    match size {
        Some((w, h)) if w > 0.0 && h > 0.0 => Ok(w / h),
        _ => Err(Error::InvalidEdit(format!(
            "the size of the picture's image ({image}) is unknown"
        ))),
    }
}

/// The crop that fills (`fill`) or fits (`fit`) a frame of aspect
/// `frame` with an image of aspect `image`, centered.
fn fitted_crop(mode: CropMode, frame: f64, image: f64) -> Edges {
    // How much of the image's width and height the frame shows.
    let (vw, vh) = match (mode, image > frame) {
        (CropMode::Fill, true) => (frame / image, 1.0),
        (CropMode::Fill, false) => (1.0, image / frame),
        (CropMode::Fit, true) => (1.0, image / frame),
        (CropMode::Fit, false) => (frame / image, 1.0),
    };
    let (x, y) = ((1.0 - vw) / 2.0, (1.0 - vh) / 2.0);
    [x, y, x, y]
}

/// Crops a picture (see `EditOp::CropPicture`).
pub(super) fn crop_picture(
    pres: &mut Presentation,
    slide: u32,
    shape: u32,
    patch: &CropPatch,
) -> Result<()> {
    let has_edges = patch.edges.iter().any(Option::is_some);
    if patch.mode.is_some() && has_edges {
        return Err(Error::InvalidEdit(
            "cropPicture takes either crop edges or a mode, not both".into(),
        ));
    }
    if patch.edges.iter().flatten().any(|v| !v.is_finite()) {
        return Err(Error::InvalidEdit("crop edges must be finite".into()));
    }
    let part = pres.slide_part(slide)?;
    let (current, rid, frame) = {
        let doc = pres.xml(&part)?;
        let node = find(&doc, shape)?;
        let (blip_fill, blip) = picture_parts(&doc, node, shape)?;
        if doc.child(blip_fill, Ns::A, "tile").is_some() {
            return Err(Error::InvalidEdit(format!(
                "picture {shape} is tiled, and tiled pictures cannot be cropped"
            )));
        }
        let rid = doc.attr_ns(blip, Ns::R, "embed").map(str::to_owned);
        let slide_frame = xfrm_element(&doc, node).map(|x| {
            let local = Frame::read(&doc, x);
            group::to_slide(&doc, node, local)
        });
        (read_crop(&doc, blip_fill), rid, slide_frame)
    };
    let target = match patch.mode {
        Some(mode) => {
            let rid =
                rid.ok_or_else(|| Error::InvalidEdit(format!("picture {shape} has no image")))?;
            let image = image_part(pres, &part, &rid)?;
            let frame = match frame {
                Some(f) => f,
                None => Frame::from_xfrm(&effective_xfrm(pres, &part, shape)?),
            };
            if frame.w <= 0.0 || frame.h <= 0.0 {
                return Err(Error::InvalidEdit(format!("picture {shape} has no size")));
            }
            fitted_crop(mode, frame.w / frame.h, image_aspect(pres, &image)?)
        }
        None => {
            let mut edges = current;
            for (edge, value) in edges.iter_mut().zip(patch.edges) {
                if let Some(v) = value {
                    *edge = f64::from(v);
                }
            }
            edges
        }
    };
    apply_crop(pres, &part, shape, current, target, patch.mode.is_some())
}

/// Writes a crop. Unless `keep_frame`, the frame moves and resizes so the
/// image keeps its size and place.
fn apply_crop(
    pres: &mut Presentation,
    part: &str,
    shape: u32,
    current: Edges,
    target: Edges,
    keep_frame: bool,
) -> Result<()> {
    for (lo, hi) in [(0, 2), (1, 3)] {
        if 1.0 - target[lo] - target[hi] < MIN_VISIBLE {
            return Err(Error::InvalidEdit(
                "the crop leaves nothing of the picture visible".into(),
            ));
        }
        if target[lo] < -MAX_PADDING || target[hi] < -MAX_PADDING {
            return Err(Error::InvalidEdit(format!(
                "crop padding beyond {MAX_PADDING} times the image size is not supported"
            )));
        }
    }
    let own_xfrm = {
        let doc = pres.xml(part)?;
        xfrm_element(&doc, find(&doc, shape)?).is_some()
    };
    // A placeholder picture may take its box from the layout.
    let inherited = if keep_frame || own_xfrm {
        None
    } else {
        Some(Frame::from_xfrm(&effective_xfrm(pres, part, shape)?))
    };
    let doc = pres.xml_mut(part)?;
    let node = find(doc, shape)?;
    if !keep_frame {
        let (old, had_xfrm) = match (xfrm_element(doc, node), inherited) {
            (Some(x), _) => (Frame::read(doc, x), true),
            (None, frame) => (frame.unwrap_or_default(), false),
        };
        if old.w <= 0.0 || old.h <= 0.0 {
            return Err(Error::InvalidEdit(format!("picture {shape} has no size")));
        }
        // The whole image in the frame's own coordinates, then the frame
        // around the part of it the new crop leaves.
        let full_w = old.w / (1.0 - current[0] - current[2]).max(MIN_VISIBLE);
        let full_h = old.h / (1.0 - current[1] - current[3]).max(MIN_VISIBLE);
        let (x, y) = (
            (target[0] - current[0]) * full_w,
            (target[1] - current[1]) * full_h,
        );
        let (w, h) = (
            full_w * (1.0 - target[0] - target[2]),
            full_h * (1.0 - target[1] - target[3]),
        );
        let (cx, cy) = old.map_local(x + w / 2.0, y + h / 2.0);
        let next = Frame {
            x: cx - w / 2.0,
            y: cy - h / 2.0,
            w,
            h,
            ..old
        };
        let xfrm = ensure_xfrm(doc, node);
        next.write(doc, xfrm, !had_xfrm);
        group::refit_ancestors(doc, node);
    }
    let (blip_fill, _) = picture_parts(doc, node, shape)?;
    write_src_rect(doc, blip_fill, target);
    Ok(())
}

/// Writes `a:srcRect` and an empty stretch fill rectangle.
fn write_src_rect(doc: &mut XmlDoc, blip_fill: NodeId, crop: Edges) {
    doc.remove_children_named(blip_fill, Ns::A, "srcRect");
    let values = crop.map(|v| (v * 100_000.0).round() as i64);
    if values.iter().any(|&v| v != 0) {
        let rect = doc.create_element(Ns::A, "srcRect");
        for (name, v) in ["l", "t", "r", "b"].into_iter().zip(values) {
            if v != 0 {
                doc.set_attr(rect, name, &v.to_string());
            }
        }
        doc.insert_in_order(blip_fill, rect, BLIP_FILL_ORDER);
    }
    let stretch = doc.ensure_child(blip_fill, Ns::A, "stretch", BLIP_FILL_ORDER);
    doc.remove_children_named(stretch, Ns::A, "fillRect");
    let fill_rect = doc.create_element(Ns::A, "fillRect");
    doc.append_child(stretch, fill_rect);
}

/// Adjusts pictures (see `EditOp::FormatPicture`).
pub(super) fn format_picture(
    pres: &mut Presentation,
    slide: u32,
    shapes: &[u32],
    patch: &PicturePatch<'_>,
) -> Result<()> {
    if shapes.is_empty() {
        return Err(Error::InvalidEdit(
            "formatPicture needs at least one picture".into(),
        ));
    }
    for (name, value, range) in [
        ("brightness", patch.brightness, -1.0..=1.0),
        ("contrast", patch.contrast, -1.0..=1.0),
        ("transparency", patch.transparency, 0.0..=1.0),
    ] {
        if let Some(v) = value
            && !(v.is_finite() && range.contains(&v))
        {
            return Err(Error::InvalidEdit(format!(
                "{name} {v} is out of range ({} to {})",
                range.start(),
                range.end()
            )));
        }
    }
    let recolor = patch.recolor.map(parse_recolor).transpose()?;
    let part = pres.slide_part(slide)?;
    for &id in shapes {
        {
            let doc = pres.xml(&part)?;
            picture_parts(&doc, find(&doc, id)?, id)?;
        }
        if patch.reset {
            reset_picture(pres, &part, id)?;
        }
        let doc = pres.xml_mut(&part)?;
        let node = find(doc, id)?;
        let (_, blip) = picture_parts(doc, node, id)?;
        if patch.brightness.is_some() || patch.contrast.is_some() {
            remove_image_layer(doc, blip);
        }
        adjust(doc, blip, patch, recolor.as_ref())?;
    }
    Ok(())
}

/// The `a:ext` holding PowerPoint 2010+ picture corrections and artistic
/// effects (`a14:imgProps`), if any.
fn image_layer_ext(doc: &XmlDoc, blip: NodeId) -> Option<NodeId> {
    let ext_lst = doc.child(blip, Ns::A, "extLst")?;
    doc.children_named(ext_lst, Ns::A, "ext")
        .find(|&e| doc.child(e, Ns::A14, "imgProps").is_some())
}

/// The `a14:imgEffect` children of a picture's image layer.
fn image_layer_effects(doc: &XmlDoc, blip: NodeId) -> Vec<NodeId> {
    image_layer_ext(doc, blip)
        .and_then(|e| doc.path(e, Ns::A14, &["imgProps", "imgLayer"]))
        .map(|layer| {
            doc.children_named(layer, Ns::A14, "imgEffect")
                .flat_map(|e| doc.children(e).collect::<Vec<_>>())
                .collect()
        })
        .unwrap_or_default()
}

/// Drops PowerPoint 2010+ corrections and artistic effects; the image
/// `r:embed` names (which has them applied) becomes the picture.
fn remove_image_layer(doc: &mut XmlDoc, blip: NodeId) {
    let Some(ext) = image_layer_ext(doc, blip) else {
        return;
    };
    let ext_lst = doc.parent(ext);
    doc.detach(ext);
    if let Some(l) = ext_lst
        && doc.first_child(l).is_none()
    {
        doc.detach(l);
    }
}

/// Removes a picture's crop (keeping its scale) and every adjustment. A
/// PowerPoint 2010+ original image layer the renderer can decode becomes
/// the picture again.
fn reset_picture(pres: &mut Presentation, part: &str, id: u32) -> Result<()> {
    let (current, tiled, original) = {
        let doc = pres.xml(part)?;
        let (blip_fill, blip) = picture_parts(&doc, find(&doc, id)?, id)?;
        let original = image_layer_ext(&doc, blip)
            .and_then(|e| doc.path(e, Ns::A14, &["imgProps", "imgLayer"]))
            .and_then(|layer| doc.attr_ns(layer, Ns::R, "embed"))
            .map(str::to_owned);
        let tiled = doc.child(blip_fill, Ns::A, "tile").is_some();
        (read_crop(&doc, blip_fill), tiled, original)
    };
    if !tiled {
        apply_crop(pres, part, id, current, [0.0; 4], false)?;
    }
    let restore = match original {
        Some(rid) => {
            let target = pres.part_rels(part)?.target_part(&rid);
            let decodable = target
                .and_then(|t| pres.pkg.read_prefix(&t, 16).ok().map(|h| sniff(&h)))
                .is_some_and(|f| {
                    matches!(f, Format::Png | Format::Jpeg | Format::Gif | Format::Bmp)
                });
            decodable.then_some(rid)
        }
        None => None,
    };
    let doc = pres.xml_mut(part)?;
    let (blip_fill, blip) = picture_parts(doc, find(doc, id)?, id)?;
    // A tile's source rectangle is not a crop the frame was fitted to.
    doc.remove_children_named(blip_fill, Ns::A, "srcRect");
    if let Some(rid) = restore {
        doc.set_attr_ns(blip, Ns::R, "embed", &rid);
    }
    remove_image_layer(doc, blip);
    let effects: Vec<NodeId> = doc
        .children(blip)
        .filter(|&c| !doc.is(c, Ns::A, "extLst"))
        .collect();
    for e in effects {
        doc.detach(e);
    }
    Ok(())
}

/// What a blip effect is to `formatPicture`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    /// Brightness and contrast (`a:lum`).
    Correction,
    /// A recolor.
    Recolor,
    /// Transparency (`a:alphaModFix`).
    Transparency,
    /// Anything else (kept, ahead of the managed effects).
    Other,
}

fn lum_values(doc: &XmlDoc, lum: NodeId) -> (i64, i64) {
    (
        doc.attr_i64(lum, "bright").unwrap_or(0),
        doc.attr_i64(lum, "contrast").unwrap_or(0),
    )
}

fn role(doc: &XmlDoc, effect: NodeId) -> Role {
    if doc.ns(effect) != Ns::A {
        return Role::Other;
    }
    match doc.local(effect) {
        "lum" if lum_values(doc, effect) == WASHOUT => Role::Recolor,
        "lum" => Role::Correction,
        "grayscl" | "biLevel" | "duotone" => Role::Recolor,
        "alphaModFix" => Role::Transparency,
        _ => Role::Other,
    }
}

/// A fraction as a 1000ths-of-a-percent attribute value.
fn pct(v: f64) -> String {
    ((v * 100_000.0).round() as i64).to_string()
}

/// Applies brightness, contrast, recolor, and transparency to an `a:blip`.
fn adjust(
    doc: &mut XmlDoc,
    blip: NodeId,
    patch: &PicturePatch<'_>,
    recolor: Option<&Recolor>,
) -> Result<()> {
    let effects: Vec<(NodeId, Role)> = doc
        .children(blip)
        .filter(|&c| !doc.is(c, Ns::A, "extLst"))
        .map(|c| (c, role(doc, c)))
        .collect();
    let first = |r: Role| effects.iter().find(|(_, x)| *x == r).map(|(n, _)| *n);
    let (bright, contrast) = first(Role::Correction).map_or((0, 0), |l| lum_values(doc, l));
    let bright = patch
        .brightness
        .map_or(bright, |b| (f64::from(b) * 100_000.0).round() as i64);
    let contrast = patch
        .contrast
        .map_or(contrast, |c| (f64::from(c) * 100_000.0).round() as i64);
    let opacity = match patch.transparency {
        Some(t) => 1.0 - f64::from(t),
        None => first(Role::Transparency)
            .and_then(|a| doc.attr(a, "amt"))
            .map_or(1.0, crate::model::color::percent),
    };
    let mut recolors: Vec<NodeId> = effects
        .iter()
        .filter(|(_, r)| *r == Role::Recolor)
        .map(|(n, _)| *n)
        .collect();
    if let Some(r) = recolor {
        recolors = recolor_element(doc, r)?.into_iter().collect();
    }
    for (node, r) in &effects {
        if *r != Role::Other {
            doc.detach(*node);
        }
    }
    let mut managed = Vec::new();
    if (bright, contrast) != (0, 0) {
        let lum = doc.create_element(Ns::A, "lum");
        if bright != 0 {
            doc.set_attr(lum, "bright", &bright.to_string());
        }
        if contrast != 0 {
            doc.set_attr(lum, "contrast", &contrast.to_string());
        }
        managed.push(lum);
    }
    managed.extend(recolors);
    if opacity < 1.0 - 1e-6 {
        let alpha = doc.create_element(Ns::A, "alphaModFix");
        doc.set_attr(alpha, "amt", &pct(opacity));
        managed.push(alpha);
    }
    let ext_lst = doc.child(blip, Ns::A, "extLst");
    for node in managed {
        match ext_lst {
            Some(e) => doc.insert_before(e, node),
            None => doc.append_child(blip, node),
        }
    }
    Ok(())
}

/// A color element with modifiers (`(name, value)`).
fn modified_color(doc: &mut XmlDoc, color: &str, modifiers: &[(&str, &str)]) -> Result<NodeId> {
    let el = color_element(doc, color, None)?;
    for (name, val) in modifiers {
        let m = doc.create_element(Ns::A, name);
        doc.set_attr(m, "val", val);
        doc.append_child(el, m);
    }
    Ok(el)
}

fn preset_color(doc: &mut XmlDoc, name: &str) -> NodeId {
    let el = doc.create_element(Ns::A, "prstClr");
    doc.set_attr(el, "val", name);
    el
}

/// The blip effect of a recolor (none for `none`).
fn recolor_element(doc: &mut XmlDoc, r: &Recolor) -> Result<Option<NodeId>> {
    let duotone = |doc: &mut XmlDoc, dark: NodeId, light: NodeId| {
        let el = doc.create_element(Ns::A, "duotone");
        doc.append_child(el, dark);
        doc.append_child(el, light);
        el
    };
    let el = match r {
        Recolor::None => return Ok(None),
        Recolor::Grayscale => doc.create_element(Ns::A, "grayscl"),
        Recolor::Washout => {
            let el = doc.create_element(Ns::A, "lum");
            doc.set_attr(el, "bright", &WASHOUT.0.to_string());
            doc.set_attr(el, "contrast", &WASHOUT.1.to_string());
            el
        }
        Recolor::BlackWhite(threshold) => {
            let el = doc.create_element(Ns::A, "biLevel");
            doc.set_attr(el, "thresh", &threshold.to_string());
            el
        }
        // PowerPoint's Sepia, and its Dark and Light Variations.
        Recolor::Sepia => {
            let dark = preset_color(doc, "black");
            let light = modified_color(doc, SEPIA, &[("tint", "50000"), ("satMod", "180000")])?;
            duotone(doc, dark, light)
        }
        Recolor::Duotone(color) => {
            let dark = modified_color(doc, color, &[("shade", "45000"), ("satMod", "135000")])?;
            let light = preset_color(doc, "white");
            duotone(doc, dark, light)
        }
        Recolor::DuotoneLight(color) => {
            let dark = preset_color(doc, "black");
            let light = modified_color(doc, color, &[("tint", "45000"), ("satMod", "400000")])?;
            duotone(doc, dark, light)
        }
        Recolor::DuotonePair(dark, light) => {
            let dark = color_element(doc, dark, None)?;
            let light = color_element(doc, light, None)?;
            duotone(doc, dark, light)
        }
    };
    Ok(Some(el))
}

// ---- reading -------------------------------------------------------------

/// A color element's name for a recolor: the theme color or `RRGGBB`.
fn color_name(doc: &XmlDoc, color: NodeId) -> String {
    match doc.local(color) {
        "schemeClr" => doc.attr(color, "val").unwrap_or("").to_owned(),
        "srgbClr" => doc.attr(color, "val").unwrap_or("").to_ascii_uppercase(),
        _ => base_color(doc, color).map_or_else(String::new, |c| c.to_hex()),
    }
}

/// A color without a theme (preset, system, and literal colors).
fn base_color(doc: &XmlDoc, color: NodeId) -> Option<crate::model::color::Rgba> {
    let (scheme, map) = (ColorScheme::default(), ColorMap::default());
    let ctx = ColorContext {
        scheme: &scheme,
        map: &map,
        ph_clr: None,
    };
    parse_color(doc, color, &ctx)
}

fn recolor_name(doc: &XmlDoc, effect: NodeId) -> Option<String> {
    let name = match doc.local(effect) {
        "grayscl" => "grayscale".to_owned(),
        "lum" => "washout".to_owned(),
        "biLevel" => match doc.attr_i64(effect, "thresh") {
            Some(25_000) => "blackWhite25".to_owned(),
            Some(75_000) => "blackWhite75".to_owned(),
            _ => "blackWhite".to_owned(),
        },
        "duotone" => {
            let colors: Vec<NodeId> = doc
                .children(effect)
                .filter(|&c| is_color_element(doc, c))
                .collect();
            let [dark, light] = colors.as_slice() else {
                return None;
            };
            let level = |c: NodeId| base_color(doc, c).map(|c| (c.r + c.g + c.b) / 3.0);
            let black = level(*dark).is_some_and(|l| l < 0.01);
            let white = level(*light).is_some_and(|l| l > 0.99);
            let sepia = doc.local(*light) == "srgbClr"
                && doc
                    .attr(*light, "val")
                    .is_some_and(|v| v.eq_ignore_ascii_case(SEPIA));
            match (black, white) {
                (true, _) if sepia => "sepia".to_owned(),
                (_, true) => format!("duotone:{}", color_name(doc, *dark)),
                (true, false) => format!("duotoneLight:{}", color_name(doc, *light)),
                (false, false) => format!(
                    "duotone:{},{}",
                    color_name(doc, *dark),
                    color_name(doc, *light)
                ),
            }
        }
        _ => return None,
    };
    Some(name)
}

/// The crop and adjustments of a picture element (`None` for other shapes).
pub(crate) fn outline(
    doc: &XmlDoc,
    node: NodeId,
    natural: Option<(u32, u32)>,
) -> Option<PictureOutline> {
    if doc.local(node) != "pic" {
        return None;
    }
    let blip_fill = doc.children(node).find(|&c| doc.local(c) == "blipFill")?;
    let crop = read_crop(doc, blip_fill);
    let mut outline = PictureOutline {
        crop: CropOutline {
            left: round(crop[0]),
            top: round(crop[1]),
            right: round(crop[2]),
            bottom: round(crop[3]),
        },
        brightness: 0.0,
        contrast: 0.0,
        recolor: "none".to_owned(),
        transparency: 0.0,
        natural_width: natural.map(|(w, _)| w),
        natural_height: natural.map(|(_, h)| h),
    };
    let Some(blip) = doc.child(blip_fill, Ns::A, "blip") else {
        return Some(outline);
    };
    let mut corrected = false;
    let mut recolored = false;
    let mut transparent = false;
    for e in doc.children(blip) {
        match role(doc, e) {
            Role::Correction if !corrected => {
                corrected = true;
                let (b, c) = lum_values(doc, e);
                outline.brightness = round(b as f64 / 100_000.0);
                outline.contrast = round(c as f64 / 100_000.0);
            }
            Role::Recolor if !recolored => {
                if let Some(name) = recolor_name(doc, e) {
                    recolored = true;
                    outline.recolor = name;
                }
            }
            Role::Transparency if !transparent => {
                transparent = true;
                let amt = doc.attr(e, "amt").map_or(1.0, crate::model::color::percent);
                outline.transparency = round(1.0 - amt);
            }
            _ => {}
        }
    }
    if !corrected
        && let Some(bc) = image_layer_effects(doc, blip)
            .into_iter()
            .find(|&e| doc.is(e, Ns::A14, "brightnessContrast"))
    {
        let v = |a: &str| round(doc.attr_i64(bc, a).unwrap_or(0) as f64 / 100_000.0);
        outline.brightness = v("bright");
        outline.contrast = v("contrast");
    }
    Some(outline)
}

/// Rounds a reported fraction to 1/100000 (the XML's precision).
fn round(v: f64) -> f32 {
    ((v * 100_000.0).round() / 100_000.0) as f32
}

#[cfg(test)]
mod test;
