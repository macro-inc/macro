//! Unit conversions. Layout works in points (1/72 inch).

/// Twentieths of a point (twips) → points.
pub fn twips(v: i64) -> f32 {
    v as f32 / 20.0
}

/// Half-points (font sizes) → points.
pub fn half_points(v: i64) -> f32 {
    v as f32 / 2.0
}

/// Eighths of a point (border widths) → points.
pub fn eighth_points(v: i64) -> f32 {
    v as f32 / 8.0
}

/// EMU → points.
pub fn emu(v: i64) -> f32 {
    (v as f64 / 12_700.0) as f32
}

/// Points → twips (rounded).
pub fn to_twips(pt: f32) -> i64 {
    (f64::from(pt) * 20.0).round() as i64
}

/// Points → EMU (rounded).
pub fn to_emu(pt: f32) -> i64 {
    (f64::from(pt) * 12_700.0).round() as i64
}

/// Points per CSS pixel (96 DPI).
pub const PT_PER_PX: f32 = 0.75;
