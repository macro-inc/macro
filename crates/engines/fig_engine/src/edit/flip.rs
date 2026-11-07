//! Flipping layers, as Figma's "Flip horizontal" and "Flip vertical" do: a
//! mirror about the layer's center, kept in its transform.

use super::{Txn, flags};
use crate::document::NodeIdx;
use crate::model::Affine;

impl Txn<'_> {
    /// Mirrors `i` about its center, across its own vertical axis
    /// (horizontally) or horizontal axis (`vertical`).
    pub(super) fn flip(&mut self, i: NodeIdx, vertical: bool) {
        let props = self.doc.props(i);
        let size = props.size();
        // x ↦ w − x (or y ↦ h − y) in the layer's own space.
        let mirror = if vertical {
            Affine {
                m11: -1.0,
                m12: size.y,
                ..Affine::IDENTITY
            }
        } else {
            Affine {
                m00: -1.0,
                m02: size.x,
                ..Affine::IDENTITY
            }
        };
        let next = props.transform().mul(&mirror);
        self.edit(i, flags::TRANSFORM).transform = Some(next);
    }
}

#[cfg(test)]
mod test;
