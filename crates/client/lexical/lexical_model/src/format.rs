//! Lexical formatting bits and direction detection.
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter, EnumString, IntoStaticStr};
bitflags::bitflags! {
    /// Upstream text formatting bits.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    /// s2: FMT-01
    pub struct TextFormat: u32 {
        /// Bold formatting.
        const BOLD = 1 << 0;
        /// Italic formatting.
        const ITALIC = 1 << 1;
        /// Strikethrough formatting.
        const STRIKETHROUGH = 1 << 2;
        /// Underline formatting.
        const UNDERLINE = 1 << 3;
        /// Code formatting.
        const CODE = 1 << 4;
        /// Subscript formatting.
        const SUBSCRIPT = 1 << 5;
        /// Superscript formatting.
        const SUPERSCRIPT = 1 << 6;
        /// Highlight formatting.
        const HIGHLIGHT = 1 << 7;
        /// Lowercase formatting.
        const LOWERCASE = 1 << 8;
        /// Uppercase formatting.
        const UPPERCASE = 1 << 9;
        /// Capitalize formatting.
        const CAPITALIZE = 1 << 10;
    }
    /// Upstream text behavior details.
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    /// s2: TX-02
    pub struct TextDetail: u32 {
        /// Ignore direction detection.
        const DIRECTIONLESS = 1;
        /// Do not normalize by merging with neighbors.
        const UNMERGEABLE = 2;
    }
}
impl TextFormat {
    /// Every defined formatting bit.
    pub const ALL: Self = Self::all();
    /// Whether this format bit is set.
    pub fn has(self, kind: TextFormatType) -> bool {
        self.contains(kind.flag())
    }
    /// Toggle one bit, respecting alignment and mutually exclusive formats.
    /// s2: FMT-02, FMT-03, FMT-04
    pub fn toggled(self, kind: TextFormatType, align_with: Option<Self>) -> Self {
        let flag = kind.flag();
        if align_with.is_some_and(|other| self.intersection(flag) == other.intersection(flag)) {
            return self;
        }
        let mut result = self ^ flag;
        let excluded = match kind {
            TextFormatType::Subscript => Self::SUPERSCRIPT,
            TextFormatType::Superscript => Self::SUBSCRIPT,
            TextFormatType::Lowercase => Self::UPPERCASE | Self::CAPITALIZE,
            TextFormatType::Uppercase => Self::LOWERCASE | Self::CAPITALIZE,
            TextFormatType::Capitalize => Self::LOWERCASE | Self::UPPERCASE,
            _ => Self::empty(),
        };
        result.remove(excluded);
        result
    }
}
/// Named text format.
#[derive(
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Debug,
    Serialize,
    Deserialize,
    EnumString,
    Display,
    EnumIter,
    IntoStaticStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
/// s2: FMT-05
pub enum TextFormatType {
    /// Bold formatting.
    Bold,
    /// Italic formatting.
    Italic,
    /// Strikethrough formatting.
    Strikethrough,
    /// Underline formatting.
    Underline,
    /// Code formatting.
    Code,
    /// Subscript formatting.
    Subscript,
    /// Superscript formatting.
    Superscript,
    /// Highlight formatting.
    Highlight,
    /// Lowercase formatting.
    Lowercase,
    /// Uppercase formatting.
    Uppercase,
    /// Capitalize formatting.
    Capitalize,
}
impl TextFormatType {
    /// Numeric upstream bit.
    pub fn flag(self) -> TextFormat {
        match self {
            Self::Bold => TextFormat::BOLD,
            Self::Italic => TextFormat::ITALIC,
            Self::Strikethrough => TextFormat::STRIKETHROUGH,
            Self::Underline => TextFormat::UNDERLINE,
            Self::Code => TextFormat::CODE,
            Self::Subscript => TextFormat::SUBSCRIPT,
            Self::Superscript => TextFormat::SUPERSCRIPT,
            Self::Highlight => TextFormat::HIGHLIGHT,
            Self::Lowercase => TextFormat::LOWERCASE,
            Self::Uppercase => TextFormat::UPPERCASE,
            Self::Capitalize => TextFormat::CAPITALIZE,
        }
    }
}
/// Upstream TextMode values.
#[derive(
    Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, EnumString, Display, Default,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
/// s2: TX-01
pub enum TextMode {
    /// Normal.
    #[default]
    Normal,
    /// Token.
    Token,
    /// Segmented.
    Segmented,
}
/// Upstream TextDetailType values.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, EnumString, Display)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum TextDetailType {
    /// Directionless.
    Directionless,
    /// Unmergeable.
    Unmergeable,
}
/// Upstream ElementFormat values.
#[derive(
    Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, EnumString, Display, Default,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
/// s2: EL-02
pub enum ElementFormat {
    /// Unset.
    #[default]
    #[serde(rename = "")]
    #[strum(serialize = "")]
    Unset,
    /// Left.
    Left,
    /// Start.
    Start,
    /// Center.
    Center,
    /// Right.
    Right,
    /// End.
    End,
    /// Justify.
    Justify,
}
/// Upstream TextDirection values.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize, Deserialize, EnumString, Display)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum TextDirection {
    /// Ltr.
    Ltr,
    /// Rtl.
    Rtl,
}
impl ElementFormat {
    /// The upstream numeric alignment, which is not a bit flag.
    pub fn bits(self) -> u32 {
        match self {
            Self::Unset => 0,
            Self::Left => 1,
            Self::Center => 2,
            Self::Right => 3,
            Self::Justify => 4,
            Self::Start => 5,
            Self::End => 6,
        }
    }
    /// Preserve upstream's bitwise comparison of alignment values.
    pub fn has_format(self, other: Self) -> bool {
        self.bits() & other.bits() != 0
    }
}
/// Destination used by copy hooks.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CopyDestination {
    /// Internal clone.
    Clone,
    /// HTML export.
    Html,
}
/// Direction of a text edit.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EditDirection {
    /// Toward the start.
    Backward,
    /// Toward the end.
    Forward,
}
/// Detect the first strong direction using upstream's UTF-16 ranges.
pub fn text_direction(text: &str) -> Option<TextDirection> {
    for unit in text.encode_utf16() {
        if matches!(unit, 0x0591..=0x07ff | 0xfb1d..=0xfdfd | 0xfe70..=0xfefc) {
            return Some(TextDirection::Rtl);
        }
        if matches!(unit, 0x0041..=0x005a | 0x0061..=0x007a | 0x00c0..=0x00d6 | 0x00d8..=0x00f6 | 0x00f8..=0x02b8 | 0x0300..=0x0590 | 0x0800..=0x1fff | 0x200e | 0x2c00..=0xfb1c | 0xfe00..=0xfe6f | 0xfefd..=0xffff)
        {
            return Some(TextDirection::Ltr);
        }
    }
    None
}
#[cfg(test)]
mod test;

impl Serialize for TextFormat {
    fn serialize<Serializer: serde::Serializer>(
        &self,
        serializer: Serializer,
    ) -> Result<Serializer::Ok, Serializer::Error> {
        serializer.serialize_u32(self.bits())
    }
}
impl<'de> Deserialize<'de> for TextFormat {
    fn deserialize<Deserializer: serde::Deserializer<'de>>(
        deserializer: Deserializer,
    ) -> Result<Self, Deserializer::Error> {
        Ok(Self::from_bits_retain(u32::deserialize(deserializer)?))
    }
}
impl Serialize for TextDetail {
    fn serialize<Serializer: serde::Serializer>(
        &self,
        serializer: Serializer,
    ) -> Result<Serializer::Ok, Serializer::Error> {
        serializer.serialize_u32(self.bits())
    }
}
impl<'de> Deserialize<'de> for TextDetail {
    fn deserialize<Deserializer: serde::Deserializer<'de>>(
        deserializer: Deserializer,
    ) -> Result<Self, Deserializer::Error> {
        Ok(Self::from_bits_retain(u32::deserialize(deserializer)?))
    }
}
