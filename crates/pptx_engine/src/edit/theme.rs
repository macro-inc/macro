//! Theme edits: the color scheme and the heading and body fonts of every
//! slide master's theme, as PowerPoint's Design ▸ Variants applies them.

use super::ops::ThemeColor;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::xml::Ns;

/// The color slots of `a:clrScheme`, in schema order.
const SLOTS: [&str; 12] = [
    "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
    "hlink", "folHlink",
];

/// The theme parts of the deck's slide masters (each once, in master order).
pub(crate) fn master_themes(pres: &mut Presentation) -> Result<Vec<String>> {
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main)?;
    let masters: Vec<String> = rels
        .iter()
        .filter(|r| r.rel_type == rel_type::SLIDE_MASTER)
        .map(|r| rels.resolve(r))
        .collect();
    let mut themes = Vec::new();
    for master in masters {
        let rels = pres.part_rels(&master)?;
        if let Some(theme) = rels.first_of_type(rel_type::THEME).map(|r| rels.resolve(r))
            && !themes.contains(&theme)
        {
            themes.push(theme);
        }
    }
    if themes.is_empty() {
        return Err(Error::InvalidEdit("the presentation has no theme".into()));
    }
    Ok(themes)
}

fn valid_hex(color: &str) -> Result<String> {
    let hex = color.trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(hex.to_ascii_uppercase())
    } else {
        Err(Error::InvalidEdit(format!(
            "theme colors must be RRGGBB hex, not {color:?}"
        )))
    }
}

/// Sets theme color slots (`dk1`, `lt1`, `dk2`, `lt2`, `accent1`-`accent6`,
/// `hlink`, `folHlink`) in every master's theme; `name` renames the scheme.
pub fn set_theme_colors(
    pres: &mut Presentation,
    colors: &[ThemeColor],
    name: Option<&str>,
) -> Result<()> {
    let mut values = Vec::with_capacity(colors.len());
    for c in colors {
        if !SLOTS.contains(&c.slot.as_str()) {
            return Err(Error::InvalidEdit(format!(
                "unknown theme color slot {:?}",
                c.slot
            )));
        }
        values.push((c.slot.as_str(), valid_hex(&c.color)?));
    }
    for part in master_themes(pres)? {
        let doc = pres.xml_mut(&part)?;
        let scheme = doc
            .path(doc.root(), Ns::A, &["themeElements", "clrScheme"])
            .ok_or_else(|| Error::InvalidEdit("the theme has no color scheme".into()))?;
        if let Some(name) = name {
            doc.set_attr(scheme, "name", name);
        }
        for (slot, hex) in &values {
            let el = doc.ensure_child(scheme, Ns::A, slot, &SLOTS);
            for child in doc.children(el).collect::<Vec<_>>() {
                doc.detach(child);
            }
            let color = doc.create_element(Ns::A, "srgbClr");
            doc.set_attr(color, "val", hex);
            doc.append_child(el, color);
        }
        pres.forget_theme(&part);
    }
    Ok(())
}

/// Sets the Latin heading (`major`) and body (`minor`) fonts of every
/// master's theme; `None` keeps one as it is.
pub fn set_theme_fonts(
    pres: &mut Presentation,
    major: Option<&str>,
    minor: Option<&str>,
    name: Option<&str>,
) -> Result<()> {
    for (font, which) in [(major, "majorFont"), (minor, "minorFont")] {
        if font.is_some_and(|f| f.trim().is_empty()) {
            return Err(Error::InvalidEdit(format!("the {which} name is empty")));
        }
    }
    for part in master_themes(pres)? {
        let doc = pres.xml_mut(&part)?;
        let scheme = doc
            .path(doc.root(), Ns::A, &["themeElements", "fontScheme"])
            .ok_or_else(|| Error::InvalidEdit("the theme has no font scheme".into()))?;
        if let Some(name) = name {
            doc.set_attr(scheme, "name", name);
        }
        for (font, which) in [(major, "majorFont"), (minor, "minorFont")] {
            let Some(font) = font else { continue };
            let collection = doc.ensure_child(scheme, Ns::A, which, &["majorFont", "minorFont"]);
            let latin = doc.ensure_child(collection, Ns::A, "latin", &["latin", "ea", "cs"]);
            doc.set_attr(latin, "typeface", font.trim());
            // Panose and pitch describe the old face; leave them out.
            doc.remove_attr(latin, "panose");
            doc.remove_attr(latin, "pitchFamily");
            doc.remove_attr(latin, "charset");
        }
        pres.forget_theme(&part);
    }
    Ok(())
}

#[cfg(test)]
mod test;
