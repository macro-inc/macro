//! Bullets: automatic numbering text and shaped bullet glyphs.

use super::{Item, ItemKind, LINE_HEIGHT_FACTOR, LayoutParams, Shaper, line_metrics};
use crate::model::fill::Fill;
use crate::model::text::{BulletKind, BulletSize, Paragraph, RunKind};

/// Number formatting for `buAutoNum` schemes.
pub fn autonum_text(scheme: &str, n: u32) -> String {
    let roman = |mut n: u32, upper: bool| {
        const TABLE: [(u32, &str); 13] = [
            (1000, "m"),
            (900, "cm"),
            (500, "d"),
            (400, "cd"),
            (100, "c"),
            (90, "xc"),
            (50, "l"),
            (40, "xl"),
            (10, "x"),
            (9, "ix"),
            (5, "v"),
            (4, "iv"),
            (1, "i"),
        ];
        let mut s = String::new();
        for (v, r) in TABLE {
            while n >= v {
                s.push_str(r);
                n -= v;
            }
        }
        if upper { s.to_uppercase() } else { s }
    };
    let alpha = |n: u32, upper: bool| {
        let n = n.max(1) - 1;
        let letter = (b'a' + (n % 26) as u8) as char;
        let s: String = std::iter::repeat_n(letter, (n / 26 + 1) as usize).collect();
        if upper { s.to_uppercase() } else { s }
    };
    let (body, style) = if let Some(rest) = scheme.strip_prefix("arabic") {
        (n.to_string(), rest)
    } else if let Some(rest) = scheme.strip_prefix("romanUc") {
        (roman(n, true), rest)
    } else if let Some(rest) = scheme.strip_prefix("romanLc") {
        (roman(n, false), rest)
    } else if let Some(rest) = scheme.strip_prefix("alphaUc") {
        (alpha(n, true), rest)
    } else if let Some(rest) = scheme.strip_prefix("alphaLc") {
        (alpha(n, false), rest)
    } else if scheme.starts_with("circleNumDb") || scheme.starts_with("circleNumWdWhite") {
        return char::from_u32(0x2460 + n.clamp(1, 20) - 1).map_or(n.to_string(), String::from);
    } else if scheme.starts_with("circleNumWdBlack") {
        return char::from_u32(0x2776 + n.clamp(1, 10) - 1).map_or(n.to_string(), String::from);
    } else {
        (n.to_string(), "Period")
    };
    match style {
        "Period" | "DbPeriod" => format!("{body}."),
        "ParenR" | "DbParenR" => format!("{body})"),
        "ParenBoth" => format!("({body})"),
        "Minus" => format!("- {body} -"),
        _ => body,
    }
}

/// A shaped bullet.
#[derive(Clone)]
pub(super) struct BulletInfo {
    pub(super) items: Vec<Item>,
    pub(super) fill: Fill,
    pub(super) width: f32,
}

/// Shapes a paragraph's bullet (character, number, or picture stand-in).
pub(super) fn make_bullet(
    shaper: &Shaper<'_>,
    para: &Paragraph,
    items: &[Item],
    number: Option<String>,
    params: LayoutParams,
) -> Option<BulletInfo> {
    let b = &para.props.bullet;
    let text = match (&b.kind, number) {
        (BulletKind::Char(c), _) => c.clone(),
        (BulletKind::AutoNum { .. }, Some(n)) => n,
        (BulletKind::Picture(_), _) => "\u{25aa}".to_owned(),
        _ => return None,
    };
    let first = para.runs.iter().find(|r| r.kind != RunKind::Break)?;
    let first_size = items
        .first()
        .map_or(first.props.size * params.font_scale, |i| i.size);
    let size = match b.size {
        BulletSize::FollowText => first_size,
        BulletSize::Percent(p) => first_size * p,
        BulletSize::Points(p) => p * params.font_scale,
    };
    let family = b.font.clone().unwrap_or_else(|| first.props.latin.clone());
    let fill = b
        .color
        .map_or_else(|| first.props.fill.clone(), Fill::Solid);
    let bold = first.props.bold && b.font.is_none();
    let fonts = shaper.fonts;
    let mut out = Vec::new();
    let mut width = 0.0;
    for c in text.chars() {
        let (shown, choice, glyph) = shaper.choose(&family, bold, false, c);
        let adv = match (choice, glyph) {
            (Some(ch), Some(g)) => fonts.advance(ch.face, g) * size,
            _ => size * 0.5,
        };
        let (ascent, descent) = choice.map_or((size, size * (LINE_HEIGHT_FACTOR - 1.0)), |ch| {
            line_metrics(fonts, ch.face, size)
        });
        out.push(Item {
            kind: ItemKind::Glyph,
            src: 0,
            run: 0,
            choice,
            glyph,
            size,
            adv,
            ascent,
            descent,
            shift: 0.0,
            break_after: false,
            ch: shown,
        });
        width += adv;
    }
    Some(BulletInfo {
        items: out,
        fill,
        width,
    })
}
