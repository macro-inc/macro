//! Text direction (PowerPoint's Home ▸ Text Direction): `a:bodyPr/@vert`
//! on shapes and `a:tcPr/@vert` on table cells.
//!
//! The direction is written explicitly, `horz` included, so it overrides a
//! direction the shape inherits from its layout placeholder. A text box that
//! resizes to fit its text turns with its text, as in PowerPoint: switching
//! between horizontal and vertical swaps its width and height (keeping its
//! top-left corner) before the usual refit sizes it to the text.

use super::ops::TextDirection;
use super::shapes::ensure_xfrm;
use super::xmlutil::{find_shape, set_off_ext};
use crate::error::Result;
use crate::model::presentation::Presentation;
use crate::model::shape::{Inherit, WalkCtx, resolve_shape};
use crate::model::text::{Autofit, Vert};
use crate::xml::{NodeId, XmlDoc};

/// The model direction of an operation's direction.
pub(super) fn vert_of(direction: TextDirection) -> Vert {
    match direction {
        TextDirection::Horz => Vert::Horz,
        TextDirection::Vert => Vert::Vert,
        TextDirection::Vert270 => Vert::Vert270,
        TextDirection::WordArtVert => Vert::WordArtVert,
        TextDirection::EaVert => Vert::EaVert,
        TextDirection::MongolianVert => Vert::MongolianVert,
        TextDirection::WordArtVertRtl => Vert::WordArtVertRtl,
    }
}

/// Writes `vert` on a `a:bodyPr` or `a:tcPr`.
pub(super) fn write(doc: &mut XmlDoc, props: NodeId, direction: TextDirection) {
    doc.set_attr(props, "vert", vert_of(direction).as_str());
}

/// Before shape `id` of `part` takes `direction`: a text box that resizes
/// to fit its text and changes between horizontal and vertical lines swaps
/// its width and height.
pub(super) fn turn_autofit_box(
    pres: &mut Presentation,
    part: &str,
    id: u32,
    direction: TextDirection,
) -> Result<()> {
    let slide = pres.part(part)?;
    let Some(node) = find_shape(&slide.doc, id) else {
        return Ok(());
    };
    if slide.doc.local(node) != "sp" {
        return Ok(());
    }
    let ctx = pres.context_for(slide.clone(), 1)?;
    let walk = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Slide,
    };
    let Some(shape) = resolve_shape(&walk, &slide, node) else {
        return Ok(());
    };
    let Some(text) = shape.text.as_ref() else {
        return Ok(());
    };
    let turned = text.body.vert.is_vertical() != vert_of(direction).is_vertical();
    if !turned || text.body.autofit != Autofit::Shape || shape.xfrm.rot != 0.0 {
        return Ok(());
    }
    let x = shape.xfrm;
    let doc = pres.xml_mut(part)?;
    let Some(node) = find_shape(doc, id) else {
        return Ok(());
    };
    let xfrm = ensure_xfrm(doc, node);
    set_off_ext(doc, xfrm, x.x, x.y, x.h, x.w);
    Ok(())
}

#[cfg(test)]
mod test;
