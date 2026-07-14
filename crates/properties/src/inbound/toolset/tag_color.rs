//! The fixed tag color palette the AI may choose from.
//!
//! Mirrors the frontend-owned palette in
//! `apps/web/src/features/property/tags/tagColors.ts` — keep the hex values in
//! sync. Exposing the colors as an enum keeps the AI from inventing colors the
//! tag picker can't render.

use schemars::JsonSchema;
use serde::Deserialize;

/// A tag color from the fixed palette.
#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TagColor {
    /// Red (`#E5484D`).
    Red,
    /// Tomato (`#E54D2E`).
    Tomato,
    /// Orange (`#F76B15`).
    Orange,
    /// Amber (`#FFB224`).
    Amber,
    /// Yellow (`#F5D90A`).
    Yellow,
    /// Green (`#46A758`).
    Green,
    /// Teal (`#12A594`).
    Teal,
    /// Blue (`#0091FF`).
    Blue,
    /// Indigo (`#3E63DD`).
    Indigo,
    /// Purple (`#8E4EC6`).
    Purple,
    /// Pink (`#E93D82`).
    Pink,
    /// Gray (`#889096`).
    Gray,
}

impl TagColor {
    /// The palette hex value stored on the tag option.
    pub fn hex(self) -> &'static str {
        match self {
            TagColor::Red => "#E5484D",
            TagColor::Tomato => "#E54D2E",
            TagColor::Orange => "#F76B15",
            TagColor::Amber => "#FFB224",
            TagColor::Yellow => "#F5D90A",
            TagColor::Green => "#46A758",
            TagColor::Teal => "#12A594",
            TagColor::Blue => "#0091FF",
            TagColor::Indigo => "#3E63DD",
            TagColor::Purple => "#8E4EC6",
            TagColor::Pink => "#E93D82",
            TagColor::Gray => "#889096",
        }
    }
}
