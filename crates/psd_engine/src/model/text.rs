//! Text layers: characters, styles, and paragraphs.

use super::*;
use serde::{Deserialize, Serialize};

/// Text alignment.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAlign {
    /// Left.
    #[default]
    Left,
    /// Right.
    Right,
    /// Center.
    Center,
    /// Justified, last line left.
    JustifyLeft,
    /// Justified, last line right.
    JustifyRight,
    /// Justified, last line centered.
    JustifyCenter,
    /// Justified, every line.
    JustifyAll,
}

/// Letter case styles.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextCase {
    /// As typed.
    #[default]
    Normal,
    /// Small caps.
    SmallCaps,
    /// All caps.
    AllCaps,
}

/// The character style of a run of text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStyle {
    /// The font's PostScript name ("MyriadPro-Regular").
    pub font: String,
    /// Size in points (pixels at the text's own scale).
    pub size: f32,
    /// Fill color.
    pub color: Rgb,
    /// Tracking, in thousandths of an em.
    pub tracking: f32,
    /// Leading in points; `None` is auto (120% of the size).
    pub leading: Option<f32>,
    /// Synthesized bold.
    pub faux_bold: bool,
    /// Synthesized italic.
    pub faux_italic: bool,
    /// Underlined.
    pub underline: bool,
    /// Struck through.
    pub strikethrough: bool,
    /// Case.
    pub case: TextCase,
    /// Baseline shift, in points.
    pub baseline_shift: f32,
    /// Horizontal scale (`1.0` is 100%).
    pub horizontal_scale: f32,
    /// Vertical scale (`1.0` is 100%).
    pub vertical_scale: f32,
}

impl Default for TextStyle {
    fn default() -> Self {
        TextStyle {
            font: "Inter-Regular".into(),
            size: 24.0,
            color: Rgb::BLACK,
            tracking: 0.0,
            leading: None,
            faux_bold: false,
            faux_italic: false,
            underline: false,
            strikethrough: false,
            case: TextCase::Normal,
            baseline_shift: 0.0,
            horizontal_scale: 1.0,
            vertical_scale: 1.0,
        }
    }
}

/// A run of characters sharing a style.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextRun {
    /// Length in UTF-16 code units, as Photoshop counts.
    pub length: u32,
    /// The style.
    pub style: TextStyle,
}

/// A run of paragraphs sharing an alignment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParagraphRun {
    /// Length in UTF-16 code units.
    pub length: u32,
    /// Alignment.
    pub align: TextAlign,
}

/// Text direction.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextOrientation {
    /// Lines run left to right.
    #[default]
    Horizontal,
    /// Lines run top to bottom.
    Vertical,
}

/// Anti-aliasing methods.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AntiAlias {
    /// None.
    None,
    /// Sharp.
    Sharp,
    /// Crisp.
    Crisp,
    /// Strong.
    Strong,
    /// Smooth.
    #[default]
    Smooth,
}

/// A text layer's content and layout.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextLayer {
    /// The characters; paragraphs end with `\r`, as Photoshop stores them.
    pub text: String,
    /// Character style runs, covering the text in order.
    pub runs: Vec<TextRun>,
    /// Paragraph runs, covering the text in order.
    pub paragraphs: Vec<ParagraphRun>,
    /// Text space to canvas: `[xx, xy, yx, yy, tx, ty]`.
    pub transform: [f64; 6],
    /// Area text: the box the text wraps in, `[left, top, right, bottom]`
    /// in text space; point text has none.
    pub area: Option<[f64; 4]>,
    /// Direction.
    pub orientation: TextOrientation,
    /// Anti-aliasing.
    pub anti_alias: AntiAlias,
    /// The text is warped (kept, drawn from the stored pixels until edited).
    pub warped: bool,
}

impl TextLayer {
    /// The style at a UTF-16 offset.
    pub fn style_at(&self, offset: u32) -> Option<&TextStyle> {
        let mut start = 0;
        for run in &self.runs {
            if offset < start + run.length {
                return Some(&run.style);
            }
            start += run.length;
        }
        self.runs.last().map(|r| &r.style)
    }
}
