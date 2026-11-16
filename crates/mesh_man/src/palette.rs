//! The figure's colours. A dashboard passes its theme as a [`Palette`] of
//! roles with [`crate::Body::set_palette`]; [`Palette::DEFAULT`] is amber
//! skin, grey bones and cyan nerves on black. Each figure's [`Look`] maps its
//! parts onto those roles ([`Look::paint`]), so switching the palette
//! recolours every figure, and the classic look paints exactly the palette's
//! own colours.

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

/// A figure's colour scheme: which of the palette's roles each of its parts
/// is painted in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Look {
    /// The palette as it is: skin in the skin roles, bones in the bone
    /// roles, nerves in the nerve roles. The mesh man's own.
    #[default]
    Classic,
    /// A radiograph: bones near white in contour slices of the nerve
    /// colour, nerve trees in the skin colour.
    Xray,
    /// Half flesh, half machine: skin, steel plates tinted toward the nerve
    /// colour, and circuit traces in the ok colour around a reactor.
    Cyborg,
    /// The nervous system lit up over a faint skeleton and skin.
    Neural,
}

/// A look's colours in one palette: what the widget paints each layer in.
/// `_busy` colours are what the `_idle` ones move toward at full load.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Paint {
    pub skin_idle: Rgb,
    pub skin_busy: Rgb,
    /// How far toward `skin_busy` full load moves the skin.
    pub skin_load: f32,
    pub skin_far: Rgb,
    pub bone_idle: Rgb,
    pub bone_busy: Rgb,
    pub bone_far: Rgb,
    pub bone_far_busy: Rgb,
    pub extra: Rgb,
    pub extra_far: Rgb,
    pub nerve_dark: Rgb,
    pub nerve: Rgb,
    pub nerve_dim: Rgb,
    pub nerve_hot: Rgb,
    /// Twigs of nerve trees: drawn-only nerve lines, near and far.
    pub twig: Rgb,
    pub twig_far: Rgb,
    pub scan_near: Rgb,
    pub scan_far: Rgb,
    /// The dashed scan line across the canvas.
    pub scan_line: Rgb,
    /// Light up the skin lines lying in the scan plane, like the slice a CT
    /// scanner is taking (for figures whose skin is horizontal slices).
    pub scan_slices: bool,
    /// Draw resting nerves over the bones rather than under them, for a
    /// figure whose nerves are the point.
    pub nerves_on_top: bool,
    /// Keep even glowing nerves under the bones (pulses still draw on
    /// top), so the skeleton stays the brightest thing.
    pub bones_on_top: bool,
    pub floor_bright: Rgb,
    pub floor: Rgb,
    pub floor_dark: Rgb,
    /// The heart at the peak of a beat, and between beats.
    pub heart: Rgb,
    pub heart_dark: Rgb,
    /// Pulse heads: outgoing, a tool's success, an error.
    pub pulse_out: Rgb,
    pub pulse_ok: Rgb,
    pub pulse_error: Rgb,
    /// A flash's white core, the glow a non-error flash passes through, and
    /// where every flash fades to.
    pub flash_core: Rgb,
    pub flash_glow: Rgb,
    pub flash_fade: Rgb,
    /// A reactor core from dim ring to white-hot centre.
    pub reactor_dim: Rgb,
    pub reactor: Rgb,
    pub reactor_hot: Rgb,
    pub reactor_white: Rgb,
}

/// `a` moved toward `b` by `t` (clamped to 0..=1).
pub(crate) fn mix(a: Rgb, b: Rgb, t: f32) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    let channel = |x: u8, y: u8| {
        let value = f32::from(x) + (f32::from(y) - f32::from(x)) * t;
        value.round().clamp(0.0, 255.0) as u8
    };
    (channel(a.0, b.0), channel(a.1, b.1), channel(a.2, b.2))
}

/// `c` at `factor` of its brightness: a darker shade of the same hue.
fn shade(c: Rgb, factor: f32) -> Rgb {
    let channel = |x: u8| (f32::from(x) * factor).round().clamp(0.0, 255.0) as u8;
    (channel(c.0), channel(c.1), channel(c.2))
}

impl Look {
    /// This look's colours in `p`. The classic look is `p` itself, so the
    /// mesh man matches the dashboard's theme exactly; the others reassign
    /// the same roles.
    pub(crate) fn paint(self, p: &Palette) -> Paint {
        let classic = Paint {
            skin_idle: p.skin_dim,
            skin_busy: p.skin,
            skin_load: 0.35,
            skin_far: p.skin_faint,
            bone_idle: p.bone,
            bone_busy: p.bone_hot,
            bone_far: p.bone_far,
            bone_far_busy: p.bone_far_busy,
            extra: mix(p.alert, p.bone, 0.35),
            extra_far: p.alert_dark,
            nerve_dark: p.nerve_dark,
            nerve: p.nerve,
            nerve_dim: p.nerve_dim,
            nerve_hot: p.nerve_hot,
            twig: mix(p.nerve_dim, p.nerve, 0.4),
            twig_far: p.nerve_dark,
            scan_near: p.spark,
            scan_far: p.skin_dim,
            scan_line: p.nerve_dark,
            scan_slices: false,
            nerves_on_top: false,
            bones_on_top: false,
            floor_bright: p.skin,
            floor: p.skin_faint,
            floor_dark: p.skin_dark,
            heart: p.alert,
            heart_dark: p.alert_dark,
            pulse_out: p.spark,
            pulse_ok: p.ok,
            pulse_error: p.alert,
            flash_core: p.bone_hot,
            flash_glow: p.skin,
            flash_fade: p.skin_dark,
            reactor_dim: p.nerve_dim,
            reactor: p.nerve,
            reactor_hot: p.nerve_hot,
            reactor_white: p.bone_hot,
        };
        match self {
            Look::Classic => classic,
            // Skin slices and the floor in the nerve colour, bones toward
            // white, nerves in the skin colour.
            Look::Xray => Paint {
                skin_idle: mix(p.nerve_dim, p.nerve, 0.4),
                skin_busy: mix(p.nerve_dim, p.nerve, 0.7),
                skin_load: 0.5,
                skin_far: p.nerve_dark,
                bone_idle: mix(p.nerve_hot, p.bone_hot, 0.3),
                bone_busy: p.bone_hot,
                bone_far: mix(p.nerve_dim, p.bone, 0.45),
                bone_far_busy: mix(p.nerve_dim, p.bone, 0.75),
                extra: mix(p.nerve, p.bone, 0.45),
                extra_far: mix(p.nerve_dark, p.nerve_dim, 0.5),
                nerve_dark: p.skin_dark,
                nerve: p.skin,
                nerve_dim: mix(p.skin_dim, p.skin_faint, 0.5),
                nerve_hot: mix(p.skin, p.bone_hot, 0.6),
                twig: mix(p.skin_dim, p.skin_faint, 0.5),
                twig_far: p.skin_dark,
                scan_near: p.nerve_hot,
                scan_far: mix(p.nerve_dim, p.nerve, 0.4),
                scan_line: p.nerve_dark,
                scan_slices: true,
                bones_on_top: true,
                floor_bright: mix(p.nerve_dim, p.nerve, 0.6),
                floor: mix(p.nerve_dark, p.nerve_dim, 0.6),
                floor_dark: p.nerve_dark,
                reactor_dim: p.skin_dim,
                reactor: p.skin,
                reactor_hot: mix(p.skin, p.bone_hot, 0.6),
                ..classic
            },
            // Classic skin and floor, steel bones, plates tinted toward the
            // nerve colour, circuit traces in the ok colour.
            Look::Cyborg => Paint {
                bone_idle: shade(p.bone, 0.87),
                bone_busy: mix(p.bone, p.bone_hot, 0.6),
                extra: mix(p.nerve, p.bone, 0.5),
                extra_far: mix(p.nerve_dim, p.bone_far, 0.5),
                nerve_dark: shade(p.ok, 0.28),
                nerve: p.ok,
                nerve_dim: shade(p.ok, 0.55),
                nerve_hot: mix(p.ok, p.bone_hot, 0.75),
                twig: shade(p.ok, 0.8),
                twig_far: shade(p.ok, 0.33),
                ..classic
            },
            // Faint skin and bones in shades of the nerve colour, bright
            // nerves drawn on top of everything.
            Look::Neural => Paint {
                skin_idle: shade(p.nerve_dim, 0.7),
                skin_busy: p.nerve_dim,
                skin_load: 0.5,
                skin_far: shade(p.nerve_dark, 0.8),
                bone_idle: shade(p.bone, 0.45),
                bone_busy: shade(p.bone, 0.65),
                bone_far: shade(p.bone_far, 0.5),
                bone_far_busy: shade(p.bone_far, 0.7),
                extra: mix(p.nerve_dim, p.alert, 0.35),
                extra_far: mix(p.nerve_dark, p.alert_dark, 0.35),
                nerve_dark: shade(p.nerve_dim, 0.6),
                nerve: mix(p.nerve, p.nerve_hot, 0.2),
                nerve_dim: mix(p.nerve_dim, p.nerve, 0.5),
                nerve_hot: mix(p.nerve_hot, p.spark, 0.5),
                twig: mix(p.nerve_dim, p.nerve, 0.75),
                twig_far: mix(p.nerve_dark, p.nerve_dim, 0.6),
                scan_near: p.nerve_hot,
                scan_far: p.nerve_dim,
                nerves_on_top: true,
                floor_bright: p.nerve,
                floor: p.nerve_dim,
                floor_dark: p.nerve_dark,
                ..classic
            },
        }
    }
}
