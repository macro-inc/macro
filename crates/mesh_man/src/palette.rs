//! Colour schemes: each figure picks a [`Look`], and the widget paints its
//! layers in that look's [`Palette`].

/// An RGB colour.
pub(crate) type Rgb = (u8, u8, u8);

/// A figure's colour scheme.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Look {
    /// Amber skin, grey bones, cyan nerves: the mesh man's own.
    #[default]
    Classic,
    /// A radiograph: ice-white bones in faint blue contour slices, amber
    /// nerve trees.
    Xray,
    /// Half flesh, half machine: amber skin, steel plates, green circuit
    /// traces.
    Cyborg,
    /// The nervous system lit up in violet and cyan over a faint skeleton.
    Neural,
}

/// The colours of one look. `_busy` colours are what the `_idle` ones move
/// toward at full load.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Palette {
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
}

const AMBER: Rgb = (255, 165, 43);
const AMBER_DIM: Rgb = (194, 123, 28);
const AMBER_FAINT: Rgb = (122, 80, 22);
const AMBER_DARK: Rgb = (74, 48, 14);
const YELLOW: Rgb = (255, 225, 77);
const CYAN: Rgb = (79, 211, 255);
const CYAN_HOT: Rgb = (205, 245, 255);
const CYAN_DIM: Rgb = (28, 98, 122);
const CYAN_DARK: Rgb = (16, 56, 70);
const WHITE: Rgb = (255, 255, 255);

const CLASSIC: Palette = Palette {
    skin_idle: AMBER_DIM,
    skin_busy: AMBER,
    skin_load: 0.35,
    skin_far: AMBER_FAINT,
    bone_idle: (150, 150, 155),
    bone_busy: WHITE,
    bone_far: (70, 70, 76),
    bone_far_busy: (125, 125, 130),
    extra: (196, 74, 60),
    extra_far: (92, 34, 28),
    nerve_dark: CYAN_DARK,
    nerve: CYAN,
    nerve_dim: CYAN_DIM,
    nerve_hot: CYAN_HOT,
    twig: (40, 140, 175),
    twig_far: CYAN_DARK,
    scan_near: YELLOW,
    scan_far: AMBER_DIM,
    scan_slices: false,
    nerves_on_top: false,
    bones_on_top: false,
    floor_bright: AMBER,
    floor: AMBER_FAINT,
    floor_dark: AMBER_DARK,
};

const XRAY: Palette = Palette {
    skin_idle: (54, 120, 190),
    skin_busy: (80, 150, 220),
    skin_load: 0.5,
    skin_far: (18, 42, 74),
    bone_idle: (205, 228, 255),
    bone_busy: WHITE,
    bone_far: (70, 92, 125),
    bone_far_busy: (110, 135, 170),
    extra: (120, 170, 220),
    extra_far: (40, 70, 110),
    nerve_dark: (90, 55, 12),
    nerve: (255, 176, 58),
    nerve_dim: (150, 96, 26),
    nerve_hot: (255, 238, 170),
    twig: (150, 96, 26),
    twig_far: (70, 45, 12),
    scan_near: (170, 235, 255),
    scan_far: (70, 140, 190),
    scan_slices: true,
    nerves_on_top: false,
    bones_on_top: true,
    floor_bright: (90, 170, 230),
    floor: (34, 78, 120),
    floor_dark: (16, 40, 66),
};

const CYBORG: Palette = Palette {
    skin_idle: AMBER_DIM,
    skin_busy: AMBER,
    skin_load: 0.35,
    skin_far: AMBER_FAINT,
    bone_idle: (130, 130, 136),
    bone_busy: (210, 210, 215),
    bone_far: (70, 70, 76),
    bone_far_busy: (125, 125, 130),
    extra: (110, 175, 225),
    extra_far: (38, 66, 92),
    nerve_dark: (10, 70, 36),
    nerve: (40, 255, 120),
    nerve_dim: (20, 130, 64),
    nerve_hot: (200, 255, 220),
    twig: (30, 190, 92),
    twig_far: (12, 80, 40),
    scan_near: YELLOW,
    scan_far: AMBER_DIM,
    scan_slices: false,
    nerves_on_top: false,
    bones_on_top: false,
    floor_bright: AMBER,
    floor: AMBER_FAINT,
    floor_dark: AMBER_DARK,
};

const NEURAL: Palette = Palette {
    skin_idle: (52, 30, 80),
    skin_busy: (80, 46, 120),
    skin_load: 0.5,
    skin_far: (30, 18, 48),
    bone_idle: (62, 62, 80),
    bone_busy: (92, 92, 115),
    bone_far: (34, 34, 46),
    bone_far_busy: (48, 48, 62),
    extra: (120, 60, 160),
    extra_far: (50, 26, 70),
    nerve_dark: (40, 20, 80),
    nerve: (190, 120, 255),
    nerve_dim: (100, 60, 170),
    nerve_hot: (150, 240, 255),
    twig: (160, 110, 255),
    twig_far: (70, 46, 140),
    scan_near: (210, 160, 255),
    scan_far: (110, 70, 170),
    scan_slices: false,
    nerves_on_top: true,
    bones_on_top: false,
    floor_bright: (170, 110, 255),
    floor: (70, 44, 120),
    floor_dark: (38, 24, 66),
};

impl Look {
    pub(crate) fn palette(self) -> &'static Palette {
        match self {
            Look::Classic => &CLASSIC,
            Look::Xray => &XRAY,
            Look::Cyborg => &CYBORG,
            Look::Neural => &NEURAL,
        }
    }
}
