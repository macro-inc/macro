//! Simple-font encodings: the base encodings (Standard, WinAnsi, MacRoman,
//! MacExpert) and the built-in encodings of Symbol and ZapfDingbats, by
//! code and by glyph name, and the code-to-name table a font's `Encoding`
//! entry builds from them; and glyph names to text ([`glyph_text`],
//! [`glyph_char`]: the Adobe Glyph List, `uniXXXX`, `uXXXX[XX]`).

mod tables;

use super::EncodingSpec;
pub use super::glyphlist::{glyph_char, glyph_text};

/// A predefined simple-font encoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BaseEncoding {
    /// `StandardEncoding`, Type 1 fonts' usual built-in encoding.
    Standard,
    /// `WinAnsiEncoding` (Windows code page 1252).
    WinAnsi,
    /// `MacRomanEncoding`.
    MacRoman,
    /// `MacExpertEncoding` (expert fonts' small capitals and figures).
    MacExpert,
    /// The Symbol font's built-in encoding.
    Symbol,
    /// The ZapfDingbats font's built-in encoding.
    ZapfDingbats,
}

impl BaseEncoding {
    /// The encoding a PDF name gives (`WinAnsiEncoding`, …).
    pub fn from_name(name: &str) -> Option<BaseEncoding> {
        Some(match name {
            "StandardEncoding" => BaseEncoding::Standard,
            "WinAnsiEncoding" => BaseEncoding::WinAnsi,
            "MacRomanEncoding" => BaseEncoding::MacRoman,
            "MacExpertEncoding" => BaseEncoding::MacExpert,
            "SymbolSetEncoding" | "SymbolEncoding" => BaseEncoding::Symbol,
            "ZapfDingbatsEncoding" => BaseEncoding::ZapfDingbats,
            _ => return None,
        })
    }

    fn table(self) -> &'static [&'static str; 256] {
        match self {
            BaseEncoding::Standard => &tables::STANDARD,
            BaseEncoding::WinAnsi => &tables::WIN_ANSI,
            BaseEncoding::MacRoman => &tables::MAC_ROMAN,
            BaseEncoding::MacExpert => &tables::MAC_EXPERT,
            BaseEncoding::Symbol => &tables::SYMBOL,
            BaseEncoding::ZapfDingbats => &tables::ZAPF_DINGBATS,
        }
    }

    /// The glyph name of a code; `None` for unused codes.
    pub fn name(self, code: u8) -> Option<&'static str> {
        let name = self.table()[usize::from(code)];
        (!name.is_empty()).then_some(name)
    }

    /// The first code that names a glyph.
    pub fn code(self, name: &str) -> Option<u8> {
        let at = self.table().iter().position(|n| *n == name)?;
        u8::try_from(at).ok()
    }
}

/// Glyph names by code (256 of them), as a simple font's encoding gives
/// them.
#[derive(Clone, Debug, PartialEq)]
pub struct Encoding {
    names: Vec<Option<String>>,
}

impl Default for Encoding {
    /// No names.
    fn default() -> Encoding {
        Encoding::from_names(std::iter::empty())
    }
}

impl Encoding {
    /// A table from a base encoding.
    pub fn base(base: BaseEncoding) -> Encoding {
        Encoding {
            names: (0..=255u8)
                .map(|code| base.name(code).map(str::to_string))
                .collect(),
        }
    }

    /// A table from names by code (codes past 255 are dropped).
    pub fn from_names(names: impl IntoIterator<Item = Option<String>>) -> Encoding {
        let mut names: Vec<Option<String>> = names.into_iter().take(256).collect();
        names.resize(256, None);
        Encoding { names }
    }

    /// Applies `Differences`.
    pub fn apply(&mut self, differences: &[(u32, String)]) {
        for (code, name) in differences {
            if let Some(slot) = self.names.get_mut(*code as usize) {
                *slot = Some(name.clone());
            }
        }
    }

    /// Fills codes without a name from another table.
    pub fn fill(&mut self, base: BaseEncoding) {
        self.fill_unless(base, |_| true);
    }

    /// Gives codes without a name, or with one `known` rejects, the name
    /// another table has.
    pub fn fill_unless(&mut self, base: BaseEncoding, known: impl Fn(&str) -> bool) {
        for (code, slot) in (0..=255u8).zip(self.names.iter_mut()) {
            if !slot.as_deref().is_some_and(&known) {
                *slot = base.name(code).map(str::to_string);
            }
        }
    }

    /// The glyph name of a code.
    pub fn name(&self, code: u32) -> Option<&str> {
        self.names.get(code as usize)?.as_deref()
    }

    /// Builds a font's table from its `Encoding` entry: the named base (or
    /// `implicit`, the font's own when there is no `BaseEncoding`), then
    /// `Differences`.
    pub fn build(spec: Option<&EncodingSpec>, implicit: Encoding) -> Encoding {
        let Some(spec) = spec else {
            return implicit;
        };
        let mut table = match spec.base.as_deref().and_then(BaseEncoding::from_name) {
            Some(base) => Encoding::base(base),
            None => implicit,
        };
        table.apply(&spec.differences);
        table
    }
}

#[cfg(test)]
mod test;
