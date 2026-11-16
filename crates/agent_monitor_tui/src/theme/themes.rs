//! The themes. Each keeps the amber ink and orange chips and differs in the
//! signal roles: what reads as ok, tools, needs-a-person and errors.

use ratatui::style::Color;

use super::Theme;

/// A theme by name, as `[monitor] theme`, `--theme` and the header spell it;
/// parsing ignores case.
#[derive(
    Clone,
    Copy,
    Debug,
    Default,
    PartialEq,
    Eq,
    Hash,
    strum::Display,
    strum::EnumString,
    strum::EnumIter,
    strum::IntoStaticStr,
)]
#[strum(serialize_all = "snake_case", ascii_case_insensitive)]
pub enum ThemeName {
    /// The original look: green ok, cyan tools, yellow highlights, red errors.
    #[default]
    Classic,
    /// Warm monochrome: everything routine is a shade of amber or sand, so
    /// only errors (vermilion) and waiting on a person (yellow) stand out.
    Ember,
    /// Old phosphor: desaturated teal tools, sage ok, coral errors.
    Phosphor,
    /// Evening: slate-blue tools, sage ok, brick-red errors.
    Dusk,
}

impl ThemeName {
    /// This theme's colours.
    pub fn theme(self) -> &'static Theme {
        match self {
            ThemeName::Classic => &CLASSIC,
            ThemeName::Ember => &EMBER,
            ThemeName::Phosphor => &PHOSPHOR,
            ThemeName::Dusk => &DUSK,
        }
    }

    /// The theme after this one, wrapping around.
    pub fn next(self) -> ThemeName {
        use strum::IntoEnumIterator as _;
        ThemeName::iter()
            .cycle()
            .skip_while(|name| *name != self)
            .nth(1)
            .unwrap_or_default()
    }
}

/// An sRGB colour.
type Rgb = (u8, u8, u8);

const fn rgb((r, g, b): Rgb) -> Color {
    Color::Rgb(r, g, b)
}

#[cfg(feature = "mesh-man")]
/// `a` moved toward `b` by `per_mille` thousandths.
const fn mix(a: Rgb, b: Rgb, per_mille: u16) -> Rgb {
    const fn channel(x: u8, y: u8, t: u16) -> u8 {
        let (x, y, t) = (x as u32, y as u32, t as u32);
        let value = if y >= x {
            x + ((y - x) * t + 500) / 1000
        } else {
            x - ((x - y) * t + 500) / 1000
        };
        value as u8
    }
    (
        channel(a.0, b.0, per_mille),
        channel(a.1, b.1, per_mille),
        channel(a.2, b.2, per_mille),
    )
}

#[cfg(feature = "mesh-man")]
const WHITE: Rgb = (255, 255, 255);

/// The colours a theme picks; the rest is derived.
struct Spec {
    bg: Rgb,
    ghost: Rgb,
    frame: Rgb,
    rule: Rgb,
    selection: Rgb,
    text_dim: Rgb,
    text: Rgb,
    accent: Rgb,
    highlight: Rgb,
    attention: Rgb,
    ok: Rgb,
    trace: Rgb,
    info: Rgb,
    info_dim: Rgb,
    info_faint: Rgb,
    alert: Rgb,
    /// The figure's near bones at rest.
    #[cfg_attr(
        not(feature = "mesh-man"),
        expect(dead_code, reason = "only the mesh man has bones")
    )]
    bone: Rgb,
}

/// The amber structure every theme shares: black, the ink, the rules and the
/// orange chips.
const AMBER: Spec = Spec {
    bg: (0, 0, 0),
    ghost: (58, 38, 10),
    frame: (92, 60, 16),
    rule: (122, 80, 22),
    selection: (70, 40, 0),
    text_dim: (194, 123, 28),
    text: (255, 165, 43),
    accent: (249, 115, 22),
    highlight: (255, 225, 77),
    attention: (255, 225, 77),
    ok: (34, 229, 92),
    trace: (34, 229, 92),
    info: (79, 211, 255),
    info_dim: (28, 98, 122),
    info_faint: (16, 56, 70),
    alert: (255, 59, 59),
    bone: (150, 150, 155),
};

const fn theme(name: ThemeName, spec: Spec) -> Theme {
    Theme {
        name,
        bg: rgb(spec.bg),
        ghost: rgb(spec.ghost),
        frame: rgb(spec.frame),
        rule: rgb(spec.rule),
        selection: rgb(spec.selection),
        text_dim: rgb(spec.text_dim),
        text: rgb(spec.text),
        accent: rgb(spec.accent),
        highlight: rgb(spec.highlight),
        attention: rgb(spec.attention),
        ok: rgb(spec.ok),
        trace: rgb(spec.trace),
        info: rgb(spec.info),
        info_dim: rgb(spec.info_dim),
        info_faint: rgb(spec.info_faint),
        alert: rgb(spec.alert),
        #[cfg(feature = "mesh-man")]
        figure: figure(&spec),
    }
}

/// The mesh man in a theme's colours: amber skin, bones in the theme's
/// grey, nerves in its info colour, pulses in its signal colours.
#[cfg(feature = "mesh-man")]
const fn figure(spec: &Spec) -> mesh_man::Palette {
    mesh_man::Palette {
        skin: spec.text,
        skin_dim: spec.text_dim,
        skin_faint: spec.rule,
        skin_dark: mix(spec.frame, spec.ghost, 500),
        spark: spec.highlight,
        ok: spec.ok,
        alert: spec.alert,
        alert_dark: mix(spec.alert, spec.bg, 570),
        nerve: spec.info,
        nerve_hot: mix(spec.info, WHITE, 750),
        nerve_dim: spec.info_dim,
        nerve_dark: spec.info_faint,
        bone: spec.bone,
        bone_hot: mix(spec.bone, WHITE, 850),
        bone_far: mix(spec.bone, spec.bg, 530),
        bone_far_busy: mix(spec.bone, spec.bg, 170),
    }
}

/// Black, amber ink, macrod's orange chips, yellow highlights, cyan tools,
/// green for ok and red for errors.
pub const CLASSIC: Theme = Theme {
    #[cfg(feature = "mesh-man")]
    figure: mesh_man::Palette::DEFAULT,
    ..theme(ThemeName::Classic, AMBER)
};

/// Warm monochrome.
pub const EMBER: Theme = theme(
    ThemeName::Ember,
    Spec {
        highlight: (255, 192, 120),
        attention: (255, 228, 32),
        ok: (168, 150, 92),
        trace: (118, 100, 58),
        info: (222, 196, 150),
        info_dim: (112, 94, 66),
        info_faint: (60, 48, 30),
        alert: (255, 82, 54),
        bone: (156, 146, 132),
        ..AMBER
    },
);

/// Old phosphor.
pub const PHOSPHOR: Theme = theme(
    ThemeName::Phosphor,
    Spec {
        highlight: (240, 198, 148),
        attention: (255, 232, 56),
        ok: (126, 170, 128),
        trace: (66, 112, 92),
        info: (112, 184, 176),
        info_dim: (50, 96, 92),
        info_faint: (26, 52, 50),
        alert: (255, 102, 112),
        bone: (140, 152, 150),
        ..AMBER
    },
);

/// Evening.
pub const DUSK: Theme = theme(
    ThemeName::Dusk,
    Spec {
        highlight: (236, 194, 154),
        attention: (255, 224, 64),
        ok: (140, 170, 116),
        trace: (82, 98, 136),
        info: (138, 156, 212),
        info_dim: (64, 76, 110),
        info_faint: (34, 40, 60),
        alert: (232, 76, 64),
        bone: (146, 146, 160),
        ..AMBER
    },
);
