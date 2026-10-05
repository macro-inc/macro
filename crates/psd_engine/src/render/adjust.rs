//! Adjustments applied to pixels: what adjustment layers do to everything
//! below them, also used to apply an adjustment to a layer's pixels.

use crate::model::Adjustment;

/// Applies an adjustment to straight RGBA8 pixels in place (alpha is
/// unchanged).
pub fn apply(adjustment: &Adjustment, rgba: &mut [u8]) {
    let _ = (adjustment, rgba);
    todo!("adjust::apply")
}
