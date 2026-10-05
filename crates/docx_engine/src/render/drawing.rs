//! Drawings: pictures (DrawingML and VML), and the other graphics.

use super::Renderer;
use crate::layout::StoryRef;
use crate::layout::drawing::{Drawing, Graphic};
use crate::xml::{NodeId, Ns, XmlTree, parse_int};
use pptx_engine::path::{Affine, Path, Rect};
use pptx_engine::render::scene::{Node, Paint};
use std::sync::Arc;

/// The part whose relationships a story's drawings use.
pub(super) fn story_part(r: &Renderer<'_>, story: &StoryRef) -> String {
    match story {
        StoryRef::Body | StoryRef::TextBox(..) => r.doc.main_part().to_owned(),
        StoryRef::Part(p) => p.clone(),
        StoryRef::Footnote(_) => r
            .doc
            .footnotes()
            .part
            .clone()
            .unwrap_or_else(|| r.doc.main_part().to_owned()),
        StoryRef::Endnote(_) => r
            .doc
            .endnotes()
            .part
            .clone()
            .unwrap_or_else(|| r.doc.main_part().to_owned()),
    }
}

/// Resolves a relationship id of `part` to a target part.
pub(super) fn target(r: &Renderer<'_>, part: &str, rid: &str) -> Option<String> {
    r.doc.package().rels(part).ok()?.target_part(rid)
}

/// A picture's image relationship, crop (left, top, right, bottom
/// fractions), rotation (degrees) and flips.
pub(super) type Blip = (String, [f32; 4], f32, bool, bool);

/// The `a:blip` of the picture in `root`.
fn blip(t: &XmlTree, root: NodeId) -> Option<Blip> {
    pic_blip(t, t.find(root, Ns::PIC, "pic")?)
}

/// The `a:blip` of picture `pic` (`pic:pic`).
pub(super) fn pic_blip(t: &XmlTree, pic: NodeId) -> Option<Blip> {
    let fill = t.child(pic, Ns::PIC, "blipFill")?;
    let blip = t.child(fill, Ns::A, "blip")?;
    let rid = t
        .attr(blip, Ns::R, "embed")
        .or_else(|| t.attr(blip, Ns::R, "link"))?
        .to_owned();
    let crop = t.child(fill, Ns::A, "srcRect").map_or([0.0; 4], |s| {
        let v = |n: &str| {
            t.attr(s, Ns::NONE, n)
                .and_then(parse_int)
                .map_or(0.0, |v| v as f32 / 100_000.0)
        };
        [v("l"), v("t"), v("r"), v("b")]
    });
    let xfrm = t
        .child(pic, Ns::PIC, "spPr")
        .and_then(|sp| t.child(sp, Ns::A, "xfrm"));
    let rot = xfrm
        .and_then(|x| t.attr(x, Ns::NONE, "rot"))
        .and_then(parse_int)
        .map_or(0.0, |v| v as f32 / 60_000.0);
    let flip_h = xfrm
        .and_then(|x| t.attr(x, Ns::NONE, "flipH"))
        .is_some_and(|v| v == "1" || v == "true");
    let flip_v = xfrm
        .and_then(|x| t.attr(x, Ns::NONE, "flipV"))
        .is_some_and(|v| v == "1" || v == "true");
    Some((rid, crop, rot, flip_h, flip_v))
}

/// The VML image of a shape (`v:imagedata`).
fn vml_image(t: &XmlTree, shape: NodeId) -> Option<(String, [f32; 4])> {
    let data = t
        .descendants(shape)
        .into_iter()
        .find(|&d| t.is(d, Ns::V, "imagedata"))?;
    let rid = t
        .attr(data, Ns::R, "id")
        .or_else(|| t.attr(data, Ns::O, "relid"))?
        .to_owned();
    let frac = |n: &str| {
        t.attr(data, Ns::NONE, n).map_or(0.0, |v| {
            let v = v.trim();
            match v.strip_suffix('f') {
                Some(f) => f.parse::<f32>().unwrap_or(0.0) / 65_536.0,
                None => v.parse::<f32>().unwrap_or(0.0),
            }
        })
    };
    Some((
        rid,
        [
            frac("cropleft"),
            frac("croptop"),
            frac("cropright"),
            frac("cropbottom"),
        ],
    ))
}

/// Draws a picture part into `rect` with a crop.
pub(super) fn picture(
    r: &mut Renderer<'_>,
    part: &str,
    rect: Rect,
    crop: [f32; 4],
    rot: f32,
    flip: (bool, bool),
    out: &mut Vec<Node>,
) {
    let center = (rect.x + rect.w / 2.0, rect.y + rect.h / 2.0);
    let mut world = Affine::IDENTITY;
    if rot.abs() > 0.01 || flip.0 || flip.1 {
        world = Affine::translate(f64::from(center.0), f64::from(center.1))
            .pre_concat(&Affine::rotate(f64::from(rot)))
            .pre_concat(&Affine::scale(
                if flip.0 { -1.0 } else { 1.0 },
                if flip.1 { -1.0 } else { 1.0 },
            ))
            .pre_concat(&Affine::translate(
                -f64::from(center.0),
                -f64::from(center.1),
            ));
    }
    // Vector metafiles keep their sharpness.
    if let Some(m) = r.images.metafile(r.doc, part, r.fonts) {
        let (vw, vh) = (1.0 - crop[0] - crop[2], 1.0 - crop[1] - crop[3]);
        if vw > 0.01 && vh > 0.01 && m.width_pt > 0.0 && m.height_pt > 0.0 {
            let sx = rect.w / (m.width_pt * vw);
            let sy = rect.h / (m.height_pt * vh);
            let t = world
                .pre_concat(&Affine::translate(
                    f64::from(rect.x - crop[0] * m.width_pt * sx),
                    f64::from(rect.y - crop[1] * m.height_pt * sy),
                ))
                .pre_concat(&Affine::scale(f64::from(sx), f64::from(sy)));
            let nodes: Vec<Node> = m.nodes.iter().map(|n| n.transformed(&t)).collect();
            out.push(
                pptx_engine::render::scene::Group {
                    children: nodes,
                    opacity: 1.0,
                    clip: Some(Path::rect(rect).transform(&world)),
                    effects: Vec::new(),
                }
                .into_node(),
            );
            return;
        }
    }
    let Some(img) = r.images.raster(r.doc, part, r.fonts) else {
        return;
    };
    let (w, h) = (img.width as f32, img.height as f32);
    let (vw, vh) = ((1.0 - crop[0] - crop[2]) * w, (1.0 - crop[1] - crop[3]) * h);
    if vw <= 0.5 || vh <= 0.5 {
        return;
    }
    let sx = rect.w / vw;
    let sy = rect.h / vh;
    let transform = world
        .pre_concat(&Affine::translate(
            f64::from(rect.x - crop[0] * w * sx),
            f64::from(rect.y - crop[1] * h * sy),
        ))
        .pre_concat(&Affine::scale(f64::from(sx), f64::from(sy)));
    out.push(Node::Fill {
        path: Path::rect(rect).transform(&world),
        paint: Paint::Image {
            image: img,
            transform,
            repeat: false,
            opacity: 1.0,
        },
        even_odd: false,
    });
}

/// Draws a drawing in `rect`.
pub(super) fn drawing_nodes(
    r: &mut Renderer<'_>,
    d: &Drawing,
    rect: Rect,
    story: &StoryRef,
    out: &mut Vec<Node>,
) {
    let part = story_part(r, story);
    let t: &Arc<XmlTree> = &d.tree;
    if d.vml {
        if let Some((rid, crop)) = vml_image(t, d.node)
            && let Some(target) = target(r, &part, &rid)
        {
            picture(r, &target, rect, crop, 0.0, (false, false), out);
        } else if d.graphic == Graphic::Shape {
            super::shapes::graphic_nodes(r, d, rect, &part, out);
        }
        return;
    }
    match &d.graphic {
        Graphic::Picture => {
            if let Some((rid, crop, rot, fh, fv)) = blip(t, d.node)
                && let Some(target) = target(r, &part, &rid)
            {
                picture(r, &target, rect, crop, rot, (fh, fv), out);
            }
        }
        Graphic::Shape | Graphic::Group | Graphic::Chart(_) | Graphic::Other => {
            super::shapes::graphic_nodes(r, d, rect, &part, out);
        }
    }
}
