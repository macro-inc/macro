//! Unit conversions used throughout DrawingML.

/// EMU (English Metric Units) per point.
pub const EMU_PER_PT: f64 = 12_700.0;
/// EMU per inch.
pub const EMU_PER_INCH: f64 = 914_400.0;
/// Points per inch.
pub const PT_PER_INCH: f64 = 72.0;

/// EMU → points.
pub fn emu_to_pt(emu: f64) -> f32 {
    (emu / EMU_PER_PT) as f32
}

/// Points → EMU (rounded to an integer as the file format requires).
pub fn pt_to_emu(pt: f64) -> i64 {
    (pt * EMU_PER_PT).round() as i64
}

/// DrawingML angle (60,000ths of a degree) → degrees.
pub fn angle_to_deg(v: f64) -> f64 {
    v / 60_000.0
}
