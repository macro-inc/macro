//! The figure's colours, by part. A dashboard passes its own [`Palette`]
//! with [`crate::Body::set_palette`] to match its theme; [`Palette::DEFAULT`]
//! is amber skin, grey bones and cyan nerves on black.

/// An sRGB colour. The widget turns it into a terminal colour at the
/// body's [`crate::ColorDepth`], so a palette works on 256-colour terminals
/// too.
pub type Rgb = (u8, u8, u8);

/// The colours the figure is drawn in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Palette {
    /// Near skin at full load, the turntable's long near ticks, and the
    /// glow a non-error flash fades through.
    pub skin: Rgb,
    /// Near skin at rest, and scan ticks on the far side.
    pub skin_dim: Rgb,
    /// Far skin and near turntable marks.
    pub skin_faint: Rgb,
    /// Far turntable marks, and where a flash fades to.
    pub skin_dark: Rgb,
    /// Scan ticks on the near side, and outgoing pulses (a tool starting, a
    /// turn ending).
    pub spark: Rgb,
    /// Pulses running back from a tool that succeeded.
    pub ok: Rgb,
    /// Error pulses and flashes, and the heart at the peak of a beat.
    pub alert: Rgb,
    /// The heart between beats.
    pub alert_dark: Rgb,
    /// Nerves at full load.
    pub nerve: Rgb,
    /// A nerve that has just fired, and the brain when one has.
    pub nerve_hot: Rgb,
    /// Far nerves at full load and the brain at rest.
    pub nerve_dim: Rgb,
    /// Nerves at rest, pulse tails and the scan line.
    pub nerve_dark: Rgb,
    /// Near bones at rest.
    pub bone: Rgb,
    /// Near bones at full load, and the core of a flash.
    pub bone_hot: Rgb,
    /// Far bones at rest.
    pub bone_far: Rgb,
    /// Far bones at full load.
    pub bone_far_busy: Rgb,
}

impl Palette {
    /// Amber skin, grey bones, cyan nerves, yellow sparks, green results and
    /// red errors.
    pub const DEFAULT: Palette = Palette {
        skin: (255, 165, 43),
        skin_dim: (194, 123, 28),
        skin_faint: (122, 80, 22),
        skin_dark: (74, 48, 14),
        spark: (255, 225, 77),
        ok: (34, 229, 92),
        alert: (255, 59, 59),
        alert_dark: (110, 22, 22),
        nerve: (79, 211, 255),
        nerve_hot: (205, 245, 255),
        nerve_dim: (28, 98, 122),
        nerve_dark: (16, 56, 70),
        bone: (150, 150, 155),
        bone_hot: (255, 255, 255),
        bone_far: (70, 70, 76),
        bone_far_busy: (125, 125, 130),
    };
}

impl Default for Palette {
    fn default() -> Self {
        Self::DEFAULT
    }
}
