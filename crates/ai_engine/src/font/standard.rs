//! The standard 14 fonts: their widths (when files omit them), and reading
//! `BaseFont` names (`ABCDEF+TimesNewRomanPS-BoldItalicMT`, `Arial,Bold`,
//! `MyriadPro-SemiboldIt`) into a family and style, with the families that
//! stand in for fonts a file does not embed.

mod metrics;

use super::encoding::BaseEncoding;
use fig_engine::text::{parse_style, style_name};

/// The name without a subset prefix (six capitals and `+`).
pub fn strip_subset(name: &str) -> &str {
    let bytes = name.as_bytes();
    if bytes.len() > 7 && bytes[6] == b'+' && bytes[..6].iter().all(u8::is_ascii_uppercase) {
        &name[7..]
    } else {
        name
    }
}

/// Lower case without spaces, hyphens, underscores, or commas, for
/// comparing family names.
pub(super) fn squash(s: &str) -> String {
    s.chars()
        .filter(|c| !matches!(c, ' ' | '-' | '_' | ','))
        .flat_map(char::to_lowercase)
        .collect()
}

/// Splits CamelCase and spaced names into words: `TimesNewRoman` →
/// `Times`, `New`, `Roman`; digits start a word after letters.
fn words(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut prev: Option<char> = None;
    for c in s.chars() {
        if matches!(c, ' ' | '_' | '-') {
            prev = None;
            continue;
        }
        let boundary = match prev {
            None => true,
            Some(p) => {
                (c.is_uppercase() && (p.is_lowercase() || p.is_ascii_digit()))
                    || (c.is_ascii_digit() && p.is_alphabetic())
            }
        };
        if boundary || out.is_empty() {
            out.push(String::new());
        }
        if let Some(w) = out.last_mut() {
            w.push(c);
        }
        prev = Some(c);
    }
    out
}

/// What a style word means.
#[derive(Clone, Copy, PartialEq)]
enum StyleWord {
    /// A word of the style (`Bold`, `Italic`, `Semi`).
    Style(&'static str),
    /// A regular-style word (`Regular`, `Roman`, `Book`).
    Regular,
    /// A vendor suffix (`MT`, `PS`).
    Suffix,
}

fn style_word(word: &str) -> Option<StyleWord> {
    use StyleWord::{Regular, Style, Suffix};
    Some(match word.to_ascii_lowercase().as_str() {
        "it" | "ita" | "ital" | "italic" | "oblique" | "obl" | "slanted" | "inclined"
        | "kursiv" => Style("Italic"),
        "bd" | "bold" | "medi" => Style("Bold"),
        "semibold" | "sb" | "smbd" | "demibold" | "demi" => Style("SemiBold"),
        "semi" => Style("Semi"),
        "extra" => Style("Extra"),
        "ultra" => Style("Ultra"),
        "extrabold" | "ultrabold" | "xbold" | "xbd" => Style("ExtraBold"),
        "black" | "blk" | "heavy" | "hv" | "fat" => Style("Black"),
        "medium" | "md" | "med" => Style("Medium"),
        "light" | "lt" | "lite" => Style("Light"),
        "extralight" | "ultralight" | "xlight" => Style("ExtraLight"),
        "thin" | "th" | "hairline" => Style("Thin"),
        "condensed" | "cond" | "cn" | "narrow" => Style("Condensed"),
        "regular" | "reg" | "regu" | "rg" | "roman" | "book" | "normal" | "plain" => Regular,
        "mt" | "ps" | "psmt" => Suffix,
        _ => return None,
    })
}

/// A `BaseFont` read as a family and style.
#[derive(Clone, Debug, PartialEq)]
pub struct FontName {
    /// The family as written, without the style (`TimesNewRoman` for
    /// `TimesNewRomanPS-BoldMT`).
    pub family: String,
    /// CSS weight (400 regular, 700 bold).
    pub weight: f32,
    /// Italic or oblique.
    pub italic: bool,
    /// Whether the name said anything about the style.
    pub styled: bool,
}

impl FontName {
    /// Reads `Family-Style`, `Family,Style`, and `FamilyStyle` names.
    pub fn parse(base_font: &str) -> FontName {
        let name = strip_subset(base_font).trim();
        let (family, style) = match name.find([',', '-']) {
            Some(at) => (&name[..at], &name[at + 1..]),
            None => (name, ""),
        };
        let mut family_words = words(family);
        let mut style_words: Vec<String> = Vec::new();
        // Style words and vendor suffixes fused to the family (`ArialMT`,
        // `ArialBold`), but not `Roman` (`TimesNewRoman`).
        while family_words.len() > 1
            && let Some(last) = family_words.last()
            && matches!(
                style_word(last),
                Some(StyleWord::Style(_) | StyleWord::Suffix)
            )
        {
            style_words.insert(0, family_words.pop().unwrap_or_default());
        }
        // A spaced regular word (`Loma Regular`).
        if family.contains(' ')
            && family_words.len() > 1
            && family_words
                .last()
                .is_some_and(|w| w != "Roman" && style_word(w) == Some(StyleWord::Regular))
        {
            family_words.pop();
        }
        style_words.extend(words(style));
        let mut canonical = Vec::new();
        let mut styled = !style.is_empty();
        for w in &style_words {
            if let Some(StyleWord::Style(s)) = style_word(w) {
                canonical.push(s);
                styled = true;
            }
        }
        let request = parse_style(&canonical.join(" "));
        FontName {
            family: family_words.concat(),
            weight: request.weight,
            italic: request.italic,
            styled,
        }
    }

    /// The family with its words apart (`Times New Roman`).
    pub fn spaced_family(&self) -> String {
        words(&self.family).join(" ")
    }

    /// The registry's name for the style (`Bold Italic`).
    pub fn style(&self) -> String {
        style_name(self.weight, self.italic)
    }
}

/// The groups the standard fonts and their look-alikes fall in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Family {
    Helvetica,
    Times,
    Courier,
    Symbol,
    ZapfDingbats,
}

/// Families (squashed) that are a standard font or share its metrics.
const FAMILIES: &[(&str, Family)] = &[
    ("helvetica", Family::Helvetica),
    ("arial", Family::Helvetica),
    ("arialnarrow", Family::Helvetica),
    ("arialunicodems", Family::Helvetica),
    ("liberationsans", Family::Helvetica),
    ("nimbussans", Family::Helvetica),
    ("nimbussanl", Family::Helvetica),
    ("arimo", Family::Helvetica),
    ("times", Family::Times),
    ("timesroman", Family::Times),
    ("timesnewroman", Family::Times),
    ("liberationserif", Family::Times),
    ("nimbusroman", Family::Times),
    ("nimbusromno9l", Family::Times),
    ("tinos", Family::Times),
    ("courier", Family::Courier),
    ("couriernew", Family::Courier),
    ("liberationmono", Family::Courier),
    ("nimbusmono", Family::Courier),
    ("nimbusmonl", Family::Courier),
    ("nimbusmonops", Family::Courier),
    ("cousine", Family::Courier),
    ("symbol", Family::Symbol),
    ("zapfdingbats", Family::ZapfDingbats),
    ("dingbats", Family::ZapfDingbats),
    ("itczapfdingbats", Family::ZapfDingbats),
];

fn family_of(family: &str) -> Option<Family> {
    let key = squash(family);
    FAMILIES.iter().find(|(name, _)| *name == key).map(|f| f.1)
}

/// Families on Google Fonts with the metrics of common fonts, so a file's
/// widths fit them (keys squashed).
const METRIC_TWINS: &[(&str, &str)] = &[
    ("calibri", "Carlito"),
    ("cambria", "Caladea"),
    ("georgia", "Gelasio"),
];

/// One of the standard 14 fonts (or a font with its metrics, such as Arial
/// for Helvetica).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Standard {
    family: Family,
    bold: bool,
    italic: bool,
}

impl Standard {
    /// The standard font a `BaseFont` names: the 14 names, their aliases
    /// (`Arial,Bold`, `TimesNewRomanPS-BoldItalicMT`, `CourierNew`), and
    /// metric-compatible families, in regular and bold.
    pub fn from_name(base_font: &str) -> Option<Standard> {
        let name = FontName::parse(base_font);
        let family = family_of(&name.family)?;
        if name.weight != 400.0 && name.weight != 700.0 {
            return None;
        }
        Some(Standard {
            family,
            bold: name.weight == 700.0,
            italic: name.italic,
        })
    }

    /// The standard 14 name (`Helvetica-BoldOblique`).
    pub fn name(self) -> &'static str {
        let (b, i) = (self.bold, self.italic);
        match self.family {
            Family::Helvetica => match (b, i) {
                (false, false) => "Helvetica",
                (true, false) => "Helvetica-Bold",
                (false, true) => "Helvetica-Oblique",
                (true, true) => "Helvetica-BoldOblique",
            },
            Family::Times => match (b, i) {
                (false, false) => "Times-Roman",
                (true, false) => "Times-Bold",
                (false, true) => "Times-Italic",
                (true, true) => "Times-BoldItalic",
            },
            Family::Courier => match (b, i) {
                (false, false) => "Courier",
                (true, false) => "Courier-Bold",
                (false, true) => "Courier-Oblique",
                (true, true) => "Courier-BoldOblique",
            },
            Family::Symbol => "Symbol",
            Family::ZapfDingbats => "ZapfDingbats",
        }
    }

    /// The advance of a glyph by name, in thousandths of an em.
    pub fn width(self, glyph: &str) -> Option<f32> {
        let latin = |widths: &[u16; 315]| {
            let at = metrics::LATIN_NAMES.binary_search(&glyph).ok()?;
            Some(f32::from(widths[at]))
        };
        let pairs = |table: &[(&str, u16)]| {
            let at = table.binary_search_by(|e| e.0.cmp(glyph)).ok()?;
            Some(f32::from(table[at].1))
        };
        match (self.family, self.bold, self.italic) {
            (Family::Courier, ..) => {
                // The Latin set, every glyph 600 units wide.
                metrics::LATIN_NAMES.binary_search(&glyph).ok()?;
                Some(600.0)
            }
            (Family::Helvetica, false, _) => latin(&metrics::HELVETICA),
            (Family::Helvetica, true, _) => latin(&metrics::HELVETICA_BOLD),
            (Family::Times, false, false) => latin(&metrics::TIMES_ROMAN),
            (Family::Times, true, false) => latin(&metrics::TIMES_BOLD),
            (Family::Times, false, true) => latin(&metrics::TIMES_ITALIC),
            (Family::Times, true, true) => latin(&metrics::TIMES_BOLD_ITALIC),
            (Family::Symbol, ..) => pairs(&metrics::SYMBOL),
            (Family::ZapfDingbats, ..) => pairs(&metrics::ZAPF_DINGBATS),
        }
    }

    /// The font's built-in encoding.
    pub fn encoding(self) -> BaseEncoding {
        match self.family {
            Family::Symbol => BaseEncoding::Symbol,
            Family::ZapfDingbats => BaseEncoding::ZapfDingbats,
            _ => BaseEncoding::Standard,
        }
    }

    /// Symbol and ZapfDingbats, whose glyphs are not Latin text.
    pub fn symbolic(self) -> bool {
        matches!(self.family, Family::Symbol | Family::ZapfDingbats)
    }

    /// ZapfDingbats, whose glyph names follow their own list.
    pub fn dingbats(self) -> bool {
        self.family == Family::ZapfDingbats
    }
}

/// Font descriptor flags.
const FIXED_PITCH: u32 = 1;
const SERIF: u32 = 1 << 1;
const ITALIC: u32 = 1 << 6;
const FORCE_BOLD: u32 = 1 << 18;

/// What to ask the font registry for in place of a font that is not
/// embedded: families best first (the font's own as written and with its
/// words apart; a Google Fonts family with its metrics, or Noto symbol
/// fonts for Symbol and ZapfDingbats; a generic one by the descriptor
/// flags), and a style.
pub fn stand_ins(base_font: &str, flags: u32, italic_angle: f32) -> (Vec<String>, String) {
    let mut name = FontName::parse(base_font);
    if !name.styled && flags & FORCE_BOLD != 0 {
        name.weight = 700.0;
    }
    if !name.italic && (flags & ITALIC != 0 || italic_angle != 0.0) {
        name.italic = true;
    }
    let mut families = vec![name.family.clone(), name.spaced_family()];
    match family_of(&name.family) {
        Some(Family::Helvetica) => families.push("Arimo".into()),
        Some(Family::Times) => families.push("Tinos".into()),
        Some(Family::Courier) => families.push("Cousine".into()),
        Some(Family::Symbol) => {
            families.extend(["Noto Sans Math".into(), "Noto Sans Symbols".into()]);
        }
        Some(Family::ZapfDingbats) => families.push("Noto Sans Symbols 2".into()),
        None => {}
    }
    let key = squash(&name.family);
    if let Some((_, twin)) = METRIC_TWINS.iter().find(|(k, _)| *k == key) {
        families.push((*twin).into());
    }
    if flags & FIXED_PITCH != 0 {
        families.push("Cousine".into());
    } else if flags & SERIF != 0 {
        families.push("Tinos".into());
    }
    families.retain(|f| !f.is_empty());
    families.dedup();
    (families, name.style())
}

#[cfg(test)]
mod test;
