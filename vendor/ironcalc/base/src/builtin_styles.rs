use crate::types::{
    Border, BorderItem, BorderStyle, Color, Fill, Font, FontScheme, Style, StyleIncludes,
};

// Which formatting categories each built-in style includes (the `apply*`
// flags of its cellStyleXfs record), as written by Excel. Alignment and
// protection are only included by "Normal".
const fn includes(number_format: bool, font: bool, fill: bool, border: bool) -> StyleIncludes {
    StyleIncludes {
        number_format,
        font,
        fill,
        border,
        alignment: false,
        protection: false,
    }
}

const FONT_ONLY: StyleIncludes = includes(false, true, false, false);
const FONT_FILL: StyleIncludes = includes(false, true, true, false);
const FONT_BORDER: StyleIncludes = includes(false, true, false, true);
const FONT_FILL_BORDER: StyleIncludes = includes(false, true, true, true);
const FILL_BORDER: StyleIncludes = includes(false, false, true, true);
const NUMBER_FORMAT_ONLY: StyleIncludes = includes(true, false, false, false);

fn solid_fill(color: Color) -> Fill {
    Fill { color }
}

fn thin_box_border(color: Color) -> Border {
    let item = Some(BorderItem {
        style: BorderStyle::Thin,
        color: color.clone(),
    });
    Border {
        left: item.clone(),
        right: item.clone(),
        top: item.clone(),
        bottom: item,
        ..Default::default()
    }
}

fn double_box_border(color: Color) -> Border {
    let item = Some(BorderItem {
        style: BorderStyle::Double,
        color: color.clone(),
    });
    Border {
        left: item.clone(),
        right: item.clone(),
        top: item.clone(),
        bottom: item,
        ..Default::default()
    }
}

fn thick_bottom_border(color: Color) -> Border {
    Border {
        bottom: Some(BorderItem {
            style: BorderStyle::Thick,
            color,
        }),
        ..Default::default()
    }
}

fn thin_top_double_bottom_border(color: Color) -> Border {
    Border {
        top: Some(BorderItem {
            style: BorderStyle::Thin,
            color: color.clone(),
        }),
        bottom: Some(BorderItem {
            style: BorderStyle::Double,
            color,
        }),
        ..Default::default()
    }
}

// IronCalc theme indices (after the dk/lt swap applied by Theme::resolve):
//   3 = dk2, 4 = accent1, 5 = accent2, 6 = accent3,
//   7 = accent4, 8 = accent5, 9 = accent6
const IDX_DK2: i32 = 3;
const IDX_ACCENT: [i32; 6] = [4, 5, 6, 7, 8, 9];

/// Returns the full list of Excel built-in named styles with their style
/// definitions and the formatting categories each one includes.
#[allow(clippy::vec_init_then_push)]
pub fn builtin_named_styles() -> Vec<(String, Style, StyleIncludes)> {
    let mut result = vec![];

    // Good, Bad, Neutral — fixed RGB colors, not theme-dependent
    result.push((
        "Good".to_string(),
        Style {
            font: Font {
                color: Color::Rgb("#006100".to_string()),
                ..Default::default()
            },
            fill: solid_fill(Color::Rgb("#C6EFCE".to_string())),
            ..Default::default()
        },
        FONT_FILL,
    ));
    result.push((
        "Bad".to_string(),
        Style {
            font: Font {
                color: Color::Rgb("#9C0006".to_string()),
                ..Default::default()
            },
            fill: solid_fill(Color::Rgb("#FFC7CE".to_string())),
            ..Default::default()
        },
        FONT_FILL,
    ));
    result.push((
        "Neutral".to_string(),
        Style {
            font: Font {
                color: Color::Rgb("#9C5700".to_string()),
                ..Default::default()
            },
            fill: solid_fill(Color::Rgb("#FFEB9C".to_string())),
            ..Default::default()
        },
        FONT_FILL,
    ));

    // Normal (always in every model, included here for the panel)
    result.push((
        "Normal".to_string(),
        Style::default(),
        StyleIncludes::default(),
    ));

    // Data and Model — fixed RGB colors
    result.push((
        "Calculation".to_string(),
        Style {
            font: Font {
                b: true,
                color: Color::Rgb("#FA7D00".to_string()),
                ..Default::default()
            },
            fill: solid_fill(Color::Rgb("#F2F2F2".to_string())),
            border: thin_box_border(Color::Rgb("#7F7F7F".to_string())),
            ..Default::default()
        },
        FONT_FILL_BORDER,
    ));
    result.push((
        "Check Cell".to_string(),
        Style {
            font: Font {
                b: true,
                color: Color::Rgb("#FFFFFF".to_string()),
                ..Default::default()
            },
            fill: solid_fill(Color::Rgb("#A5A5A5".to_string())),
            border: double_box_border(Color::Rgb("#3F3F3F".to_string())),
            ..Default::default()
        },
        FONT_FILL_BORDER,
    ));
    result.push((
        "Explanatory Text".to_string(),
        Style {
            font: Font {
                i: true,
                color: Color::Rgb("#7F7F7F".to_string()),
                ..Default::default()
            },
            ..Default::default()
        },
        FONT_ONLY,
    ));
    result.push((
        "Input".to_string(),
        Style {
            font: Font {
                color: Color::Rgb("#3F3F76".to_string()),
                ..Default::default()
            },
            fill: solid_fill(Color::Rgb("#FFCC99".to_string())),
            border: thin_box_border(Color::Rgb("#7F7F7F".to_string())),
            ..Default::default()
        },
        FONT_FILL_BORDER,
    ));
    result.push((
        "Linked Cell".to_string(),
        Style {
            font: Font {
                color: Color::Rgb("#FA7D00".to_string()),
                ..Default::default()
            },
            border: Border {
                bottom: Some(BorderItem {
                    style: BorderStyle::Double,
                    color: Color::Rgb("#FF8001".to_string()),
                }),
                ..Default::default()
            },
            ..Default::default()
        },
        FONT_BORDER,
    ));
    result.push((
        "Note".to_string(),
        Style {
            fill: solid_fill(Color::Rgb("#FFFFE1".to_string())),
            border: thin_box_border(Color::Rgb("#B2B2B2".to_string())),
            ..Default::default()
        },
        FILL_BORDER,
    ));
    result.push((
        "Output".to_string(),
        Style {
            font: Font {
                b: true,
                color: Color::Rgb("#3F3F3F".to_string()),
                ..Default::default()
            },
            fill: solid_fill(Color::Rgb("#F2F2F2".to_string())),
            border: thin_box_border(Color::Rgb("#3F3F3F".to_string())),
            ..Default::default()
        },
        FONT_FILL_BORDER,
    ));
    result.push((
        "Warning Text".to_string(),
        Style {
            font: Font {
                color: Color::Rgb("#FF0000".to_string()),
                ..Default::default()
            },
            ..Default::default()
        },
        FONT_ONLY,
    ));

    // Titles and Headings — font color uses dk2, borders use accent1, all theme-relative
    result.push((
        "Title".to_string(),
        Style {
            font: Font {
                sz: 18,
                color: Color::Theme(IDX_DK2, 0.0),
                scheme: FontScheme::Major,
                ..Default::default()
            },
            ..Default::default()
        },
        FONT_ONLY,
    ));
    result.push((
        "Heading 1".to_string(),
        Style {
            font: Font {
                b: true,
                sz: 15,
                color: Color::Theme(IDX_DK2, 0.0),
                ..Default::default()
            },
            border: thick_bottom_border(Color::Theme(IDX_ACCENT[0], 0.0)),
            ..Default::default()
        },
        FONT_BORDER,
    ));
    result.push((
        "Heading 2".to_string(),
        Style {
            font: Font {
                b: true,
                sz: 13,
                color: Color::Theme(IDX_DK2, 0.0),
                ..Default::default()
            },
            border: thick_bottom_border(Color::Theme(IDX_ACCENT[0], 0.5)),
            ..Default::default()
        },
        FONT_BORDER,
    ));
    result.push((
        "Heading 3".to_string(),
        Style {
            font: Font {
                b: true,
                color: Color::Theme(IDX_DK2, 0.0),
                ..Default::default()
            },
            border: Border {
                bottom: Some(BorderItem {
                    style: BorderStyle::Thin,
                    color: Color::Theme(IDX_ACCENT[0], 0.0),
                }),
                ..Default::default()
            },
            ..Default::default()
        },
        FONT_BORDER,
    ));
    result.push((
        "Heading 4".to_string(),
        Style {
            font: Font {
                b: true,
                i: true,
                color: Color::Theme(IDX_DK2, 0.0),
                ..Default::default()
            },
            ..Default::default()
        },
        FONT_ONLY,
    ));
    result.push((
        "Total".to_string(),
        Style {
            font: Font {
                b: true,
                ..Default::default()
            },
            border: thin_top_double_bottom_border(Color::Theme(IDX_ACCENT[0], 0.0)),
            ..Default::default()
        },
        FONT_BORDER,
    ));

    // Themed Cell Styles: 20% / 40% / 60% tints and solid for each accent.
    // Tint values match hex_with_tint_to_rgb semantics: 0.8 = very light (20%), 0.0 = solid.
    for (i, accent_name) in [
        "Accent1", "Accent2", "Accent3", "Accent4", "Accent5", "Accent6",
    ]
    .iter()
    .enumerate()
    {
        let idx = IDX_ACCENT[i];
        result.push((
            format!("20% - {accent_name}"),
            Style {
                fill: solid_fill(Color::Theme(idx, 0.8)),
                ..Default::default()
            },
            FONT_FILL,
        ));
        result.push((
            format!("40% - {accent_name}"),
            Style {
                fill: solid_fill(Color::Theme(idx, 0.6)),
                ..Default::default()
            },
            FONT_FILL,
        ));
        result.push((
            format!("60% - {accent_name}"),
            Style {
                fill: solid_fill(Color::Theme(idx, 0.4)),
                ..Default::default()
            },
            FONT_FILL,
        ));
        result.push((
            accent_name.to_string(),
            Style {
                fill: solid_fill(Color::Theme(idx, 0.0)),
                ..Default::default()
            },
            FONT_FILL,
        ));
    }

    // Number Format styles — no color dependency
    result.push((
        "Comma".to_string(),
        Style {
            num_fmt: "#,##0.00".to_string(),
            ..Default::default()
        },
        NUMBER_FORMAT_ONLY,
    ));
    result.push((
        "Comma [0]".to_string(),
        Style {
            num_fmt: "#,##0".to_string(),
            ..Default::default()
        },
        NUMBER_FORMAT_ONLY,
    ));
    result.push((
        "Currency".to_string(),
        Style {
            num_fmt: r#"_("$"* #,##0.00_);_("$"* \(#,##0.00\);_("$"* "-"??_);_(@_)"#.to_string(),
            ..Default::default()
        },
        NUMBER_FORMAT_ONLY,
    ));
    result.push((
        "Currency [0]".to_string(),
        Style {
            num_fmt: r#"_("$"* #,##0_);_("$"* \(#,##0\);_("$"* "-"_);_(@_)"#.to_string(),
            ..Default::default()
        },
        NUMBER_FORMAT_ONLY,
    ));
    result.push((
        "Percent".to_string(),
        Style {
            num_fmt: "0%".to_string(),
            ..Default::default()
        },
        NUMBER_FORMAT_ONLY,
    ));

    result
}

/// Looks up a built-in named style by name (case-sensitive), returning its
/// definition and the categories it includes. Returns `None` if not found.
pub fn get_builtin_style(name: &str) -> Option<(Style, StyleIncludes)> {
    builtin_named_styles()
        .into_iter()
        .find(|(n, _, _)| n == name)
        .map(|(_, s, i)| (s, i))
}
