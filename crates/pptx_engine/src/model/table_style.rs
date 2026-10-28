//! Built-in PowerPoint table styles.
//!
//! PowerPoint references its 74 built-in table styles by GUID and only writes
//! their definitions into `tableStyles.xml` when it saves the file itself.
//! Files from other producers often omit them, so the engine generates the
//! definitions here, as DrawingML, and parses them like any other style.

/// Style families of the built-in table styles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Family {
    Themed1,
    Themed2,
    Light1,
    Light2,
    Light3,
    Medium1,
    Medium2,
    Medium3,
    Medium4,
    Dark1,
    Dark2,
}

/// GUID → (family, accent index 1-6 or 0 for the plain variant).
const STYLES: &[(&str, Family, u8)] = &[
    ("{2D5ABB26-0587-4C30-8999-92F81FD0307C}", Family::Themed1, 0),
    ("{3C2FFA5D-87B4-456A-9821-1D502468CF0F}", Family::Themed1, 1),
    ("{284E427A-3D55-4303-BF80-6455036E1DE7}", Family::Themed1, 2),
    ("{69C7853C-536D-4A76-A0AE-DD22124D55A5}", Family::Themed1, 3),
    ("{775DCB02-9BB8-47FD-8907-85C794F793BA}", Family::Themed1, 4),
    ("{35758FB7-9AC5-4552-8A53-C91805E547FA}", Family::Themed1, 5),
    ("{08FB837D-C827-4EFA-A057-4D05807E0F7C}", Family::Themed1, 6),
    ("{5940675A-B579-460E-94D1-54222C63F5DA}", Family::Themed2, 0),
    ("{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}", Family::Themed2, 1),
    ("{18603FDC-E32A-4AB5-989C-0864C3EAD2B8}", Family::Themed2, 2),
    ("{306799F8-075E-4A3A-A7F6-7FBC6576F1A4}", Family::Themed2, 3),
    ("{E269D01E-BC32-4049-B463-5C60D7B0CCD2}", Family::Themed2, 4),
    ("{327F97BB-C833-4FB7-BDE5-3F7075034690}", Family::Themed2, 5),
    ("{638B1855-1B75-4FBE-930C-398BA8C253C6}", Family::Themed2, 6),
    ("{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}", Family::Light1, 0),
    ("{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}", Family::Light1, 1),
    ("{0E3FDE45-AF77-4B5C-9715-49D594BDF05E}", Family::Light1, 2),
    ("{C083E6E3-FA7D-4D7B-A595-EF9225AFEA82}", Family::Light1, 3),
    ("{D27102A9-8310-4765-A935-A1911B00CA55}", Family::Light1, 4),
    ("{5FD0F851-EC5A-4D38-B0AD-8093EC10F338}", Family::Light1, 5),
    ("{68D230F3-CF80-4859-8CE7-A43EE81993B5}", Family::Light1, 6),
    ("{7E9639D4-E3E2-4D34-9284-5A2195B3D0D7}", Family::Light2, 0),
    ("{69012ECD-51FC-41F1-AA8D-1B2483CD663E}", Family::Light2, 1),
    ("{72833802-FEF1-4C79-8D5D-14CF1EAF98D9}", Family::Light2, 2),
    ("{F2DE63D5-997A-4646-A377-4702673A728D}", Family::Light2, 3),
    ("{17292A2E-F333-43FB-9621-5CBBE7FDCDCB}", Family::Light2, 4),
    ("{5A111915-BE36-4E01-A7E5-04B1672EAD32}", Family::Light2, 5),
    ("{912C8C85-51F0-491E-9774-3900AFEF0FD7}", Family::Light2, 6),
    ("{616DA210-FB5B-4158-B5E0-FEB733F419BA}", Family::Light3, 0),
    ("{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}", Family::Light3, 1),
    ("{5DA37D80-6434-44D0-A028-1B22A696006F}", Family::Light3, 2),
    ("{8799B23B-EC83-4686-B30A-512413B5E67A}", Family::Light3, 3),
    ("{ED083AE6-46FA-4A59-8FB0-9F97EB10719F}", Family::Light3, 4),
    ("{BDBED569-4797-4DF1-A0F4-6AAB3CD982D8}", Family::Light3, 5),
    ("{E8B1032C-EA38-4F05-BA0D-38AFFFC7BED3}", Family::Light3, 6),
    ("{793D81CF-94F2-401A-BA57-92F5A7B2D0C5}", Family::Medium1, 0),
    ("{B301B821-A1FF-4177-AEE7-76D212191A09}", Family::Medium1, 1),
    ("{9DCAF9ED-07DC-4A11-8D7F-57B35C25682E}", Family::Medium1, 2),
    ("{1FECB4D8-DB02-4DC6-A0A2-4F2EBAE1DC90}", Family::Medium1, 3),
    ("{1E171933-4619-4E11-9A3F-F7608DF75F80}", Family::Medium1, 4),
    ("{FABFCF23-3B69-468F-B69F-88F6DE6A72F2}", Family::Medium1, 5),
    ("{10A1B5D5-9B99-4C35-A422-299274C87663}", Family::Medium1, 6),
    ("{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}", Family::Medium2, 0),
    ("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}", Family::Medium2, 1),
    ("{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}", Family::Medium2, 2),
    ("{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}", Family::Medium2, 3),
    ("{00A15C55-8517-42AA-B614-E9B94910E393}", Family::Medium2, 4),
    ("{7DF18680-E054-41AD-8BC1-D1AEF772440D}", Family::Medium2, 5),
    ("{93296810-A885-4BE3-A3E7-6D5BEEA58F35}", Family::Medium2, 6),
    ("{8EC20E35-A176-4012-BC5E-935CFFF8708E}", Family::Medium3, 0),
    ("{6E25E649-3F16-4E02-A733-19D2CDBF48F0}", Family::Medium3, 1),
    ("{85BE263C-DBD7-4A20-BB59-AAB30ACAA65A}", Family::Medium3, 2),
    ("{EB344D84-9AFB-497E-A393-DC336BA19D2E}", Family::Medium3, 3),
    ("{EB9631B5-78F2-41C9-869B-9F39066F8104}", Family::Medium3, 4),
    ("{74C1A8A3-306A-4EB7-A6B1-4F7E0EB9C5D6}", Family::Medium3, 5),
    ("{2A488322-F2BA-4B5B-9748-0D474271808F}", Family::Medium3, 6),
    ("{D7AC3CCA-C797-4891-BE02-D94E43425B78}", Family::Medium4, 0),
    ("{69CF1AB2-1976-4502-BF36-3FF5EA218861}", Family::Medium4, 1),
    ("{8A107856-5554-42FB-B03E-39F5DBC370BA}", Family::Medium4, 2),
    ("{0505E3EF-67EA-436B-97B2-0124C06EBD24}", Family::Medium4, 3),
    ("{C4B1156A-380E-4F78-BDF5-A606A8083BF9}", Family::Medium4, 4),
    ("{22838BEF-8BB2-4498-84A7-C5851F593DF1}", Family::Medium4, 5),
    ("{16D9F66E-5EB9-4882-86FB-DCBF35E3C3E4}", Family::Medium4, 6),
    ("{E8034E78-7F5D-4C2E-B375-FC64B27BC917}", Family::Dark1, 0),
    ("{125E5076-3810-47DD-B79F-674D7AD40C01}", Family::Dark1, 1),
    ("{37CE84F3-28C3-443E-9E96-99CF82512B78}", Family::Dark1, 2),
    ("{D03447BB-5D67-496B-8E87-E561075AD55C}", Family::Dark1, 3),
    ("{E929F9F4-4A8F-4326-A1B4-22849713DDAB}", Family::Dark1, 4),
    ("{8FD4443E-F989-4FC4-A0C8-D5A2AF1F390B}", Family::Dark1, 5),
    ("{AF606853-7671-496A-8E4F-DF71F8EC918B}", Family::Dark1, 6),
    ("{5202B0CA-FC54-4496-8BCA-5EF66A818D29}", Family::Dark2, 0),
    ("{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}", Family::Dark2, 1),
    ("{91EBBBCC-DAD2-459C-BE2E-F6DE35CF9A28}", Family::Dark2, 3),
    ("{46F890A9-2807-4EBB-B81D-B2AA78EC7F39}", Family::Dark2, 5),
];

#[cfg(test)]
pub(crate) const STYLES_FOR_TEST: &[(&str, Family, u8)] = STYLES;

impl Family {
    /// PowerPoint's name for the family's plain variant.
    fn name(self) -> &'static str {
        match self {
            Family::Themed1 => "Themed Style 1",
            Family::Themed2 => "Themed Style 2",
            Family::Light1 => "Light Style 1",
            Family::Light2 => "Light Style 2",
            Family::Light3 => "Light Style 3",
            Family::Medium1 => "Medium Style 1",
            Family::Medium2 => "Medium Style 2",
            Family::Medium3 => "Medium Style 3",
            Family::Medium4 => "Medium Style 4",
            Family::Dark1 => "Dark Style 1",
            Family::Dark2 => "Dark Style 2",
        }
    }

    /// The group PowerPoint's table style gallery lists the family under.
    fn category(self) -> &'static str {
        match self {
            Family::Themed1
            | Family::Themed2
            | Family::Light1
            | Family::Light2
            | Family::Light3 => "light",
            Family::Medium1 | Family::Medium2 | Family::Medium3 | Family::Medium4 => "medium",
            Family::Dark1 | Family::Dark2 => "dark",
        }
    }
}

/// PowerPoint's display name of a built-in style variant.
fn display_name(family: Family, accent: u8) -> String {
    match (family, accent) {
        (Family::Themed1, 0) => "No Style, No Grid".to_owned(),
        (Family::Themed2, 0) => "No Style, Table Grid".to_owned(),
        (_, 0) => family.name().to_owned(),
        // Dark Style 2 pairs each accent with the next one for its header row.
        (Family::Dark2, a) => format!("{} - Accent {a}/Accent {}", family.name(), a + 1),
        (_, a) => format!("{} - Accent {a}", family.name()),
    }
}

/// A built-in table style as PowerPoint's gallery offers it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuiltinStyle {
    /// The style GUID (`a:tableStyleId`).
    pub id: &'static str,
    /// PowerPoint's display name ("Medium Style 2 - Accent 1").
    pub name: String,
    /// Gallery group: `light`, `medium`, or `dark`.
    pub category: &'static str,
}

fn builtin(&(id, family, accent): &(&'static str, Family, u8)) -> BuiltinStyle {
    BuiltinStyle {
        id,
        name: display_name(family, accent),
        category: family.category(),
    }
}

/// Every built-in style, in the order of PowerPoint's gallery.
pub fn builtin_styles() -> Vec<BuiltinStyle> {
    STYLES.iter().map(builtin).collect()
}

/// The built-in style with GUID `id` (case-insensitive).
pub fn builtin_style(id: &str) -> Option<BuiltinStyle> {
    STYLES
        .iter()
        .find(|(g, _, _)| g.eq_ignore_ascii_case(id))
        .map(builtin)
}

/// The table style PowerPoint applies to new tables.
pub const DEFAULT_TABLE_STYLE: &str = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";

fn clr(scheme: &str, transform: Option<(&str, u32)>) -> String {
    match transform {
        Some((t, v)) => format!("<a:schemeClr val=\"{scheme}\"><a:{t} val=\"{v}\"/></a:schemeClr>"),
        None => format!("<a:schemeClr val=\"{scheme}\"/>"),
    }
}

fn solid(color: &str) -> String {
    format!("<a:solidFill>{color}</a:solidFill>")
}

fn ln(width: u32, color: &str) -> String {
    format!("<a:ln w=\"{width}\" cmpd=\"sng\">{}</a:ln>", solid(color))
}

/// Builder for one part (`wholeTbl`, `firstRow`...).
#[derive(Default)]
struct Part {
    bold: bool,
    text: Option<String>,
    borders: Vec<(&'static str, String)>,
    fill: Option<String>,
}

impl Part {
    fn xml(&self, name: &str) -> String {
        let mut s = format!("<a:{name}>");
        if self.bold || self.text.is_some() {
            s.push_str(&format!(
                "<a:tcTxStyle{}><a:fontRef idx=\"minor\"><a:prstClr val=\"black\"/></a:fontRef>{}</a:tcTxStyle>",
                if self.bold { " b=\"on\"" } else { "" },
                self.text.clone().unwrap_or_default()
            ));
        }
        s.push_str("<a:tcStyle><a:tcBdr>");
        for (edge, l) in &self.borders {
            s.push_str(&format!("<a:{edge}>{l}</a:{edge}>"));
        }
        s.push_str("</a:tcBdr>");
        if let Some(f) = &self.fill {
            s.push_str(&format!("<a:fill>{}</a:fill>", solid(f)));
        }
        s.push_str(&format!("</a:tcStyle></a:{name}>"));
        s
    }
}

/// Generates the `a:tblStyle` XML of a built-in style, if `id` is one, under
/// PowerPoint's name for it: the definition PowerPoint writes into
/// `tableStyles.xml` for the styles a deck uses.
pub fn builtin_style_xml(id: &str) -> Option<String> {
    let &(id, family, accent) = STYLES.iter().find(|(g, _, _)| g.eq_ignore_ascii_case(id))?;
    let name = display_name(family, accent);
    let a = if accent == 0 {
        None
    } else {
        Some(format!("accent{accent}"))
    };
    let (mut whole, mut first_row, mut last_row, mut first_col, mut last_col) = (
        Part::default(),
        Part::default(),
        Part::default(),
        Part::default(),
        Part::default(),
    );
    let (mut band1h, mut band1v) = (Part::default(), Part::default());
    let mut tbl_bg: Option<String> = None;
    for p in [&mut first_row, &mut last_row, &mut first_col, &mut last_col] {
        p.bold = true;
    }
    const THIN: u32 = 12700;
    const THICK: u32 = 38100;
    match family {
        Family::Themed1 => match &a {
            Some(acc) => {
                whole.text = Some(clr("dk1", None));
                for e in ["left", "right", "top", "bottom", "insideH", "insideV"] {
                    whole.borders.push((e, ln(THIN, &clr(acc, None))));
                }
                first_row.text = Some(clr("lt1", None));
                first_row.fill = Some(clr(acc, None));
                first_row
                    .borders
                    .push(("bottom", ln(THIN, &clr("lt1", None))));
                band1h.fill = Some(clr(acc, Some(("alpha", 40000))));
                band1v.fill = Some(clr(acc, Some(("alpha", 40000))));
            }
            None => whole.text = Some(clr("tx1", None)),
        },
        Family::Themed2 => match &a {
            Some(acc) => {
                tbl_bg = Some(clr(acc, None));
                whole.text = Some(clr("lt1", None));
                for e in ["left", "right", "top", "bottom"] {
                    whole
                        .borders
                        .push((e, ln(THIN, &clr(acc, Some(("tint", 50000))))));
                }
                first_row.text = Some(clr("lt1", None));
                first_row
                    .borders
                    .push(("bottom", ln(THICK, &clr("lt1", None))));
                last_row.borders.push(("top", ln(THICK, &clr("lt1", None))));
                first_col
                    .borders
                    .push(("right", ln(THIN, &clr("lt1", None))));
                last_col.borders.push(("left", ln(THIN, &clr("lt1", None))));
                band1h.fill = Some(clr("lt1", Some(("alpha", 20000))));
                band1v.fill = Some(clr("lt1", Some(("alpha", 20000))));
            }
            None => {
                whole.text = Some(clr("tx1", None));
                for e in ["left", "right", "top", "bottom", "insideH", "insideV"] {
                    whole.borders.push((e, ln(THIN, &clr("tx1", None))));
                }
            }
        },
        Family::Light1 => {
            let acc = a.clone().unwrap_or_else(|| "tx1".into());
            whole.text = Some(clr("tx1", None));
            whole.borders.push(("top", ln(THIN, &clr(&acc, None))));
            whole.borders.push(("bottom", ln(THIN, &clr(&acc, None))));
            first_row
                .borders
                .push(("bottom", ln(THIN, &clr(&acc, None))));
            last_row.borders.push(("top", ln(THIN, &clr(&acc, None))));
            band1h.fill = Some(clr(&acc, Some(("alpha", 20000))));
            band1v.fill = Some(clr(&acc, Some(("alpha", 20000))));
        }
        Family::Light2 => {
            let acc = a.clone().unwrap_or_else(|| "tx1".into());
            whole.text = Some(clr("tx1", None));
            for e in ["left", "right", "top", "bottom"] {
                whole.borders.push((e, ln(THIN, &clr(&acc, None))));
            }
            first_row.text = Some(clr("bg1", None));
            first_row.fill = Some(clr(&acc, None));
            last_row.borders.push(("top", ln(THICK, &clr(&acc, None))));
            band1h.borders.push(("top", ln(THIN, &clr(&acc, None))));
            band1h.borders.push(("bottom", ln(THIN, &clr(&acc, None))));
            band1v.borders.push(("left", ln(THIN, &clr(&acc, None))));
            band1v.borders.push(("right", ln(THIN, &clr(&acc, None))));
        }
        Family::Light3 => {
            let acc = a.clone().unwrap_or_else(|| "tx1".into());
            whole.text = Some(clr("tx1", None));
            for e in ["left", "right", "top", "bottom", "insideH", "insideV"] {
                whole.borders.push((e, ln(THIN, &clr(&acc, None))));
            }
            first_row.text = Some(clr(&acc, None));
            first_row
                .borders
                .push(("bottom", ln(25400, &clr(&acc, None))));
            last_row.borders.push(("top", ln(25400, &clr(&acc, None))));
            band1h.fill = Some(clr(&acc, Some(("alpha", 20000))));
            band1v.fill = Some(clr(&acc, Some(("alpha", 20000))));
        }
        Family::Medium1 => {
            let acc = a.clone().unwrap_or_else(|| "dk1".into());
            whole.text = Some(clr("dk1", None));
            whole.fill = Some(clr("lt1", None));
            for e in ["left", "right", "top", "bottom", "insideH"] {
                whole.borders.push((e, ln(THIN, &clr(&acc, None))));
            }
            first_row.text = Some(clr("lt1", None));
            first_row.fill = Some(clr(&acc, None));
            last_row.fill = Some(clr("lt1", None));
            last_row.borders.push(("top", ln(THICK, &clr(&acc, None))));
            band1h.fill = Some(clr(&acc, Some(("tint", 20000))));
            band1v.fill = Some(clr(&acc, Some(("tint", 20000))));
        }
        Family::Medium2 => {
            let acc = a.clone().unwrap_or_else(|| "dk1".into());
            whole.text = Some(clr("dk1", None));
            whole.fill = Some(clr(&acc, Some(("tint", 20000))));
            for e in ["left", "right", "top", "bottom", "insideH", "insideV"] {
                whole.borders.push((e, ln(THIN, &clr("lt1", None))));
            }
            for p in [&mut first_row, &mut last_row, &mut first_col, &mut last_col] {
                p.text = Some(clr("lt1", None));
                p.fill = Some(clr(&acc, None));
            }
            first_row
                .borders
                .push(("bottom", ln(THICK, &clr("lt1", None))));
            last_row.borders.push(("top", ln(THICK, &clr("lt1", None))));
            band1h.fill = Some(clr(&acc, Some(("tint", 40000))));
            band1v.fill = Some(clr(&acc, Some(("tint", 40000))));
        }
        Family::Medium3 => {
            let acc = a.clone().unwrap_or_else(|| "dk1".into());
            whole.text = Some(clr("dk1", None));
            whole.fill = Some(clr("lt1", None));
            whole.borders.push(("top", ln(25400, &clr("dk1", None))));
            whole.borders.push(("bottom", ln(25400, &clr("dk1", None))));
            first_row.text = Some(clr("lt1", None));
            first_row.fill = Some(clr(&acc, None));
            first_row
                .borders
                .push(("bottom", ln(THICK, &clr("dk1", None))));
            last_row.fill = Some(clr("lt1", None));
            last_row.borders.push(("top", ln(THICK, &clr("dk1", None))));
            for p in [&mut first_col, &mut last_col] {
                p.text = Some(clr("lt1", None));
                p.fill = Some(clr(&acc, None));
            }
            band1h.fill = Some(clr("dk1", Some(("tint", 20000))));
            band1v.fill = Some(clr("dk1", Some(("tint", 20000))));
        }
        Family::Medium4 => {
            let acc = a.clone().unwrap_or_else(|| "dk1".into());
            whole.text = Some(clr("dk1", None));
            whole.fill = Some(clr(&acc, Some(("tint", 20000))));
            for e in ["left", "right", "top", "bottom", "insideH", "insideV"] {
                whole.borders.push((e, ln(THIN, &clr(&acc, None))));
            }
            first_row.text = Some(clr(&acc, None));
            first_row.fill = Some(clr(&acc, Some(("tint", 20000))));
            last_row.fill = Some(clr("dk1", Some(("tint", 20000))));
            last_row.borders.push(("top", ln(25400, &clr("dk1", None))));
            band1h.fill = Some(clr(&acc, Some(("tint", 40000))));
            band1v.fill = Some(clr(&acc, Some(("tint", 40000))));
        }
        Family::Dark1 => {
            let (acc, t) = match &a {
                Some(acc) => (acc.clone(), "shade"),
                None => ("dk1".into(), "tint"),
            };
            whole.text = Some(clr("lt1", None));
            whole.fill = Some(clr(&acc, Some((t, 20000))));
            first_row.text = Some(clr("lt1", None));
            first_row.fill = Some(clr("dk1", None));
            first_row
                .borders
                .push(("bottom", ln(THICK, &clr("lt1", None))));
            last_row.fill = Some(clr(&acc, Some((t, 20000))));
            last_row.borders.push(("top", ln(THICK, &clr("lt1", None))));
            first_col.fill = Some(clr(&acc, Some((t, 60000))));
            first_col
                .borders
                .push(("right", ln(THICK, &clr("lt1", None))));
            last_col.fill = Some(clr(&acc, Some((t, 60000))));
            last_col
                .borders
                .push(("left", ln(THICK, &clr("lt1", None))));
            band1h.fill = Some(clr(&acc, Some((t, 40000))));
            band1v.fill = Some(clr(&acc, Some((t, 40000))));
        }
        Family::Dark2 => {
            let acc = a.clone().unwrap_or_else(|| "dk1".into());
            let head = match accent {
                1 => "accent2",
                3 => "accent4",
                5 => "accent6",
                _ => "dk1",
            };
            whole.text = Some(clr("dk1", None));
            whole.fill = Some(clr(&acc, Some(("tint", 20000))));
            first_row.text = Some(clr("lt1", None));
            first_row.fill = Some(clr(head, None));
            last_row.fill = Some(clr(&acc, Some(("tint", 20000))));
            last_row.borders.push(("top", ln(THICK, &clr("dk1", None))));
            band1h.fill = Some(clr(&acc, Some(("tint", 40000))));
            band1v.fill = Some(clr(&acc, Some(("tint", 40000))));
        }
    }
    let mut s = format!(
        "<a:tblStyle xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" styleId=\"{id}\" styleName=\"{name}\">"
    );
    if let Some(bg) = tbl_bg {
        s.push_str(&format!("<a:tblBg>{}</a:tblBg>", solid(&bg)));
    }
    s.push_str(&whole.xml("wholeTbl"));
    s.push_str(&band1h.xml("band1H"));
    s.push_str(&Part::default().xml("band2H"));
    s.push_str(&band1v.xml("band1V"));
    s.push_str(&Part::default().xml("band2V"));
    s.push_str(&last_col.xml("lastCol"));
    s.push_str(&first_col.xml("firstCol"));
    s.push_str(&last_row.xml("lastRow"));
    s.push_str(&first_row.xml("firstRow"));
    s.push_str("</a:tblStyle>");
    Some(s)
}
