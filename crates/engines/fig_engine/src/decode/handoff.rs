//! Export presets, layout grids, and guides from their kiwi messages.

use super::{color, guid};
use crate::kiwi::{MsgRef, Schema};
use crate::model::{
    Axis, ExportConstraint, ExportFormat, ExportSetting, GridAlign, GridPattern, Guide, LayoutGrid,
    Props,
};

/// Narrows the nested messages to the fields read here.
pub(super) fn restrict_schema(schema: &mut Schema) {
    schema.keep_only(
        "ExportSettings",
        &[
            "suffix",
            "imageType",
            "constraint",
            "svgIDMode",
            "svgOutlineText",
            "contentsOnly",
            "useAbsoluteBounds",
            "quality",
        ],
    );
    schema.keep_only(
        "LayoutGrid",
        &[
            "type",
            "axis",
            "visible",
            "numSections",
            "offset",
            "sectionSize",
            "gutterSize",
            "color",
            "pattern",
        ],
    );
    schema.keep_only("Guide", &["axis", "offset", "guid"]);
}

fn axis(m: &MsgRef) -> Axis {
    match m.enum_name("axis") {
        Some("Y") => Axis::Y,
        _ => Axis::X,
    }
}

fn export_setting(e: MsgRef) -> ExportSetting {
    let c = e.msg("constraint");
    let defaults = ExportSetting::default();
    ExportSetting {
        format: ExportFormat::parse(e.enum_name("imageType").unwrap_or("PNG")),
        suffix: e.str("suffix").unwrap_or("").to_owned(),
        constraint: ExportConstraint::parse(
            c.and_then(|c| c.enum_name("type"))
                .unwrap_or("CONTENT_SCALE"),
        ),
        value: c.and_then(|c| c.f32("value")).unwrap_or(1.0),
        svg_outline_text: e.bool("svgOutlineText").unwrap_or(true),
        svg_include_id: e.enum_name("svgIDMode") == Some("ALWAYS"),
        contents_only: e.bool("contentsOnly").unwrap_or(true),
        use_absolute_bounds: e.bool("useAbsoluteBounds").unwrap_or(false),
        quality: e
            .f32("quality")
            .map(|q| (q * 100.0).round().clamp(1.0, 100.0) as u8)
            .unwrap_or(defaults.quality),
    }
}

fn layout_grid(g: MsgRef) -> LayoutGrid {
    LayoutGrid {
        pattern: match g.enum_name("pattern") {
            Some("GRID") => GridPattern::Grid,
            _ => GridPattern::Stripes,
        },
        axis: axis(&g),
        align: GridAlign::parse(g.enum_name("type").unwrap_or("STRETCH")),
        visible: g.bool("visible").unwrap_or(true),
        count: g.i32("numSections").unwrap_or(1),
        offset: g.f32("offset").unwrap_or(0.0),
        section_size: g.f32("sectionSize").unwrap_or(10.0),
        gutter: g.f32("gutterSize").unwrap_or(0.0),
        color: g.msg("color").map(color).unwrap_or_default(),
    }
}

fn ruler_guide(g: MsgRef) -> Guide {
    Guide {
        axis: axis(&g),
        offset: g.f32("offset").unwrap_or(0.0),
        guid: g.msg("guid").and_then(guid),
    }
}

/// Reads a node change's export presets, layout grids, and guides.
pub(super) fn read(m: &MsgRef, p: &mut Props) {
    if m.has("exportSettings") {
        p.export_settings = Some(m.msgs("exportSettings").map(export_setting).collect());
    }
    if m.has("layoutGrids") {
        p.layout_grids = Some(m.msgs("layoutGrids").map(layout_grid).collect());
    }
    if m.has("guides") {
        p.guides = Some(m.msgs("guides").map(ruler_guide).collect());
    }
}
