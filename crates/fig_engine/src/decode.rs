//! Kiwi `NodeChange` messages to [`Props`].
//!
//! Field names are Figma's. Older files name a few things differently
//! (`maskIsOutline`, glyphs inside `textData`, `filterColorAdjust`); both
//! spellings are read.

use crate::kiwi::{MsgRef, Schema, ValRef};
use crate::model::text::{StyleRun, TextContent};
use crate::model::*;
use std::sync::Arc;

/// The `NodeChange` fields the engine reads. Everything else is skipped while
/// decoding, which keeps memory proportional to what is drawn.
const NODE_FIELDS: &[&str] = &[
    "guid",
    "phase",
    "parentIndex",
    "type",
    "name",
    "visible",
    "locked",
    "opacity",
    "blendMode",
    "size",
    "transform",
    "mask",
    "maskType",
    "maskIsOutline",
    "fillPaints",
    "strokePaints",
    "strokeWeight",
    "strokeAlign",
    "strokeCap",
    "strokeJoin",
    "dashPattern",
    "fillGeometry",
    "strokeGeometry",
    "effects",
    "cornerRadius",
    "rectangleTopLeftCornerRadius",
    "rectangleTopRightCornerRadius",
    "rectangleBottomLeftCornerRadius",
    "rectangleBottomRightCornerRadius",
    "rectangleCornerRadiiIndependent",
    "cornerSmoothing",
    "frameMaskDisabled",
    "backgroundColor",
    "internalOnly",
    "textData",
    "derivedTextData",
    "fontSize",
    "fontName",
    "lineHeight",
    "letterSpacing",
    "paragraphSpacing",
    "textAlignHorizontal",
    "textAlignVertical",
    "textDecoration",
    "textCase",
    "textAutoResize",
    "symbolData",
    "derivedSymbolData",
    "overriddenSymbolID",
    "componentPropAssignments",
    "componentPropRefs",
    "componentPropDefs",
    "guidPath",
    "overrideKey",
    "stackMode",
    "stackSpacing",
    "stackPadding",
    "stackHorizontalPadding",
    "stackVerticalPadding",
    "stackPaddingRight",
    "stackPaddingBottom",
    "stackPrimaryAlignItems",
    "stackCounterAlignItems",
    "stackWrap",
    "stackPrimarySizing",
    "stackCounterSizing",
    "stackCounterSpacing",
    "stackReverseZIndex",
    "stackChildPrimaryGrow",
    "stackChildAlignSelf",
    "stackPositioning",
    "minSize",
    "maxSize",
    "exportSettings",
    "booleanOperation",
    "horizontalConstraint",
    "verticalConstraint",
    "description",
    "symbolDescription",
    "isStateGroup",
    "styleID",
    "styleIdForFill",
    "styleIdForStrokeFill",
    "styleIdForEffect",
    "inheritFillStyleID",
    "inheritFillStyleIDForStroke",
    "inheritEffectStyleID",
    "backgroundPaints",
    "backgroundEnabled",
    "derivedImmutableFrameData",
    "nodeGenerationData",
];

const PAINT_FIELDS: &[&str] = &[
    "type",
    "color",
    "opacity",
    "visible",
    "blendMode",
    "stops",
    "transform",
    "image",
    "imageScaleMode",
    "rotation",
    "scale",
    "filterColorAdjust",
    "paintFilter",
    "originalImageWidth",
    "originalImageHeight",
];

const EFFECT_FIELDS: &[&str] = &[
    "type",
    "color",
    "offset",
    "radius",
    "visible",
    "blendMode",
    "spread",
    "showShadowBehindNode",
];

const TEXT_FIELDS: &[&str] = &[
    "characters",
    "characterStyleIDs",
    "styleOverrideTable",
    "layoutSize",
    "baselines",
    "glyphs",
    "decorations",
    "truncationStartIndex",
];

const DERIVED_TEXT_FIELDS: &[&str] = &[
    "layoutSize",
    "baselines",
    "glyphs",
    "decorations",
    "truncationStartIndex",
];

/// Narrows the schema to the fields read here.
pub fn restrict_schema(schema: &mut Schema) {
    schema.keep_only("NodeChange", NODE_FIELDS);
    schema.keep_only("Paint", PAINT_FIELDS);
    schema.keep_only("Effect", EFFECT_FIELDS);
    schema.keep_only("TextData", TEXT_FIELDS);
    schema.keep_only("DerivedTextData", DERIVED_TEXT_FIELDS);
    schema.keep_only(
        "Glyph",
        &[
            "commandsBlob",
            "position",
            "styleID",
            "fontSize",
            "firstCharacter",
            "advance",
            "emojiCodePoints",
            "rotation",
        ],
    );
    schema.keep_only("Baseline", &["firstCharacter"]);
    schema.keep_only("Image", &["hash", "dataBlob"]);
    schema.keep_only(
        "SymbolData",
        &["symbolID", "symbolOverrides", "uniformScaleFactor"],
    );
    schema.keep_only("ComponentPropAssignment", &["defID", "value"]);
    schema.keep_only(
        "ComponentPropValue",
        &["boolValue", "textValue", "guidValue"],
    );
    schema.keep_only(
        "ComponentPropRef",
        &["defID", "componentPropNodeField", "isDeleted"],
    );
    schema.keep_only("ComponentPropDef", &["id", "name", "type", "isDeleted"]);
    schema.keep_only("ExportSettings", &["suffix", "imageType", "constraint"]);
    schema.keep_only("NodeGenerationData", &["overrides"]);
    schema.keep_only("DerivedImmutableFrameData", &["overrides"]);
}

pub fn guid(m: MsgRef) -> Option<Guid> {
    // Message-typed GUIDs omit zero fields.
    Some(Guid {
        session: m.u32("sessionID").unwrap_or(0),
        local: m.u32("localID").unwrap_or(0),
    })
}

fn f(m: &MsgRef, name: &'static str) -> f64 {
    f64::from(m.f32(name).unwrap_or(0.0))
}

pub fn affine(m: MsgRef) -> Affine {
    Affine {
        m00: f(&m, "m00"),
        m01: f(&m, "m01"),
        m02: f(&m, "m02"),
        m10: f(&m, "m10"),
        m11: f(&m, "m11"),
        m12: f(&m, "m12"),
    }
}

pub fn vec2(m: MsgRef) -> Vec2 {
    Vec2::new(f(&m, "x"), f(&m, "y"))
}

pub fn color(m: MsgRef) -> Color {
    Color {
        r: m.f32("r").unwrap_or(0.0),
        g: m.f32("g").unwrap_or(0.0),
        b: m.f32("b").unwrap_or(0.0),
        a: m.f32("a").unwrap_or(1.0),
    }
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(40), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

pub fn paint(m: MsgRef) -> Paint {
    let kind_name = m.enum_name("type").unwrap_or("SOLID");
    let gradient = |kind| PaintKind::Gradient {
        kind,
        stops: m
            .msgs("stops")
            .map(|s| ColorStop {
                color: s.msg("color").map(color).unwrap_or(Color::BLACK),
                position: s.f32("position").unwrap_or(0.0),
            })
            .collect(),
        transform: m.msg("transform").map(affine).unwrap_or_default(),
    };
    let kind = match kind_name {
        "SOLID" => PaintKind::Solid(m.msg("color").map(color).unwrap_or(Color::BLACK)),
        "GRADIENT_LINEAR" => gradient(GradientKind::Linear),
        "GRADIENT_RADIAL" => gradient(GradientKind::Radial),
        "GRADIENT_ANGULAR" => gradient(GradientKind::Angular),
        "GRADIENT_DIAMOND" => gradient(GradientKind::Diamond),
        "IMAGE" => {
            let filters = m
                .msg("paintFilter")
                .or_else(|| m.msg("filterColorAdjust"))
                .map(|p| ImageFilters {
                    exposure: p.f32("exposure").unwrap_or(0.0),
                    contrast: p.f32("contrast").unwrap_or(0.0),
                    saturation: p.f32("vibrance").unwrap_or(0.0),
                    temperature: p.f32("temperature").unwrap_or(0.0),
                    tint: p.f32("tint").unwrap_or(0.0),
                    highlights: p.f32("highlights").unwrap_or(0.0),
                    shadows: p.f32("shadows").unwrap_or(0.0),
                })
                .unwrap_or_default();
            let original_size = match (m.u32("originalImageWidth"), m.u32("originalImageHeight")) {
                (Some(w), Some(h)) if w > 0 && h > 0 => Some(Vec2::new(f64::from(w), f64::from(h))),
                _ => None,
            };
            PaintKind::Image(ImagePaint {
                hash: m
                    .msg("image")
                    .and_then(|i| i.bytes("hash"))
                    .filter(|h| !h.is_empty())
                    .map(|h| hex(h).into()),
                scale_mode: match m.enum_name("imageScaleMode") {
                    Some("STRETCH") => ImageScaleMode::Stretch,
                    Some("FIT") => ImageScaleMode::Fit,
                    Some("TILE") => ImageScaleMode::Tile,
                    _ => ImageScaleMode::Fill,
                },
                transform: m.msg("transform").map(affine).unwrap_or_default(),
                scale: m.f32("scale").unwrap_or(1.0),
                rotation: m.f32("rotation").unwrap_or(0.0),
                filters,
                original_size,
            })
        }
        "EMOJI" => PaintKind::Unsupported("emoji"),
        "VIDEO" => PaintKind::Unsupported("video"),
        "PATTERN" => PaintKind::Unsupported("pattern"),
        "NOISE" => PaintKind::Unsupported("noise"),
        _ => PaintKind::Unsupported("paint"),
    };
    Paint {
        kind,
        opacity: m.f32("opacity").unwrap_or(1.0).clamp(0.0, 1.0),
        visible: m.bool("visible").unwrap_or(true),
        blend_mode: m
            .enum_name("blendMode")
            .map(BlendMode::parse)
            .unwrap_or(BlendMode::Normal),
    }
}

pub fn effect(m: MsgRef) -> Effect {
    Effect {
        kind: match m.enum_name("type") {
            Some("DROP_SHADOW") => EffectKind::DropShadow,
            Some("INNER_SHADOW") => EffectKind::InnerShadow,
            Some("FOREGROUND_BLUR") => EffectKind::LayerBlur,
            Some("BACKGROUND_BLUR") => EffectKind::BackgroundBlur,
            _ => EffectKind::Other,
        },
        visible: m.bool("visible").unwrap_or(true),
        color: m
            .msg("color")
            .map(color)
            .unwrap_or(Color::BLACK.with_alpha(0.25)),
        offset: m.msg("offset").map(vec2).unwrap_or_default(),
        radius: m.f32("radius").unwrap_or(0.0).max(0.0),
        spread: m.f32("spread").unwrap_or(0.0),
        blend_mode: m
            .enum_name("blendMode")
            .map(BlendMode::parse)
            .unwrap_or(BlendMode::Normal),
        show_behind_node: m.bool("showShadowBehindNode").unwrap_or(false),
    }
}

fn path_refs<'a>(items: impl Iterator<Item = MsgRef<'a>>) -> Arc<[PathRef]> {
    items
        .filter_map(|p| {
            Some(PathRef {
                winding: match p.enum_name("windingRule") {
                    Some("ODD") => WindingRule::EvenOdd,
                    _ => WindingRule::NonZero,
                },
                blob: p.u32("commandsBlob")?,
            })
        })
        .collect()
}

fn text_content(m: MsgRef) -> TextContent {
    let styles = m
        .msgs("styleOverrideTable")
        .filter_map(|s| {
            let id = s.u32("styleID")?;
            let font = s.msg("fontName");
            Some(StyleRun {
                id,
                fills: s
                    .has("fillPaints")
                    .then(|| s.collect_msgs("fillPaints", paint)),
                font_family: font.and_then(|f| f.str("family")).map(Into::into),
                font_style: font.and_then(|f| f.str("style")).map(Into::into),
                font_size: s.f32("fontSize"),
                decoration: s.enum_name("textDecoration").map(Into::into),
            })
        })
        .collect();
    TextContent {
        characters: m.str("characters").unwrap_or("").into(),
        style_ids: m
            .uints("characterStyleIDs")
            .map(Arc::from)
            .unwrap_or_else(|| Arc::from([] as [u32; 0])),
        styles,
    }
}

/// Glyph layout from `derivedTextData` (or, in older files, `textData`).
fn text_layout(m: MsgRef) -> Option<TextLayout> {
    if !m.has("glyphs") && !m.has("layoutSize") {
        return None;
    }
    let glyphs = m.collect_msgs("glyphs", |g| {
        let pos = g.msg("position").map(vec2).unwrap_or_default();
        let emoji = g
            .uints("emojiCodePoints")
            .filter(|c| !c.is_empty())
            .map(Arc::from);
        Glyph {
            blob: g.u32("commandsBlob"),
            x: pos.x as f32,
            y: pos.y as f32,
            font_size: g.f32("fontSize").unwrap_or(0.0),
            style_id: g.u32("styleID").unwrap_or(0),
            first_char: g.u32("firstCharacter").unwrap_or(0),
            advance: g.f32("advance").unwrap_or(0.0),
            rotation: g.f32("rotation").unwrap_or(0.0),
            emoji,
        }
    });
    let decorations = m
        .msgs("decorations")
        .map(|d| Decoration {
            rects: d
                .msgs("rects")
                .map(|r| {
                    [
                        r.f32("x").unwrap_or(0.0),
                        r.f32("y").unwrap_or(0.0),
                        r.f32("w").unwrap_or(0.0),
                        r.f32("h").unwrap_or(0.0),
                    ]
                })
                .collect(),
            style_id: d.u32("styleID").unwrap_or(0),
        })
        .collect();
    Some(TextLayout {
        glyphs,
        decorations,
        layout_size: m.msg("layoutSize").map(vec2),
        lines: m.list("baselines").count() as u32,
        truncated_at: m
            .i32("truncationStartIndex")
            .and_then(|i| u32::try_from(i).ok()),
    })
}

fn number(m: Option<MsgRef>) -> Option<(f32, String)> {
    let m = m?;
    Some((
        m.f32("value").unwrap_or(0.0),
        m.enum_name("units").unwrap_or("PIXELS").to_owned(),
    ))
}

fn text_style(m: &MsgRef) -> Option<TextStyle> {
    let font = m.msg("fontName");
    let style = TextStyle {
        font_family: font.and_then(|f| f.str("family")).map(Into::into),
        font_style: font.and_then(|f| f.str("style")).map(Into::into),
        font_size: m.f32("fontSize"),
        line_height: number(m.msg("lineHeight")),
        letter_spacing: number(m.msg("letterSpacing")),
        paragraph_spacing: m.f32("paragraphSpacing"),
        align_horizontal: m.enum_name("textAlignHorizontal").map(Into::into),
        align_vertical: m.enum_name("textAlignVertical").map(Into::into),
        decoration: m.enum_name("textDecoration").map(Into::into),
        case: m.enum_name("textCase").map(Into::into),
        auto_resize: m.enum_name("textAutoResize").map(Into::into),
    };
    (style != TextStyle::default()).then_some(style)
}

fn prop_value(v: Option<MsgRef>) -> PropValue {
    let Some(v) = v else {
        return PropValue::Other;
    };
    if let Some(b) = v.bool("boolValue") {
        PropValue::Bool(b)
    } else if let Some(t) = v.msg("textValue") {
        PropValue::Text(t.str("characters").unwrap_or("").into())
    } else if let Some(g) = v.msg("guidValue").and_then(guid) {
        PropValue::Symbol(g)
    } else {
        PropValue::Other
    }
}

fn prop_assignments(m: &MsgRef, field: &'static str) -> Arc<[PropAssignment]> {
    m.msgs(field)
        .filter_map(|a| {
            Some(PropAssignment {
                def_id: a.msg("defID").and_then(guid)?,
                value: prop_value(a.msg("value")),
            })
        })
        .collect()
}

fn auto_layout(m: &MsgRef) -> Option<AutoLayout> {
    let mode = m.enum_name("stackMode")?;
    if mode == "NONE" {
        return None;
    }
    let padding = m.f32("stackPadding");
    let horizontal = m.f32("stackHorizontalPadding").or(padding).unwrap_or(0.0);
    let vertical = m.f32("stackVerticalPadding").or(padding).unwrap_or(0.0);
    Some(AutoLayout {
        mode: mode.to_owned(),
        spacing: m.f32("stackSpacing").unwrap_or(0.0),
        padding_left: horizontal,
        padding_top: vertical,
        // Right and bottom default to 0, except in files from before
        // padding per side, which have one `stackPadding`.
        padding_right: m.f32("stackPaddingRight").or(padding).unwrap_or(0.0),
        padding_bottom: m.f32("stackPaddingBottom").or(padding).unwrap_or(0.0),
        primary_align: m.enum_name("stackPrimaryAlignItems").map(Into::into),
        counter_align: m.enum_name("stackCounterAlignItems").map(Into::into),
        wrap: m.enum_name("stackWrap") == Some("WRAP"),
        primary_sizing: m.enum_name("stackPrimarySizing").map(Into::into),
        counter_sizing: m.enum_name("stackCounterSizing").map(Into::into),
        counter_spacing: m.f32("stackCounterSpacing").unwrap_or(0.0),
        reverse_z: m.bool("stackReverseZIndex").unwrap_or(false),
    })
}

fn layout_child(m: &MsgRef) -> Option<LayoutChild> {
    let child = LayoutChild {
        grow: m.f32("stackChildPrimaryGrow"),
        align: m.enum_name("stackChildAlignSelf").map(Into::into),
        absolute: m.enum_name("stackPositioning").map(|p| p == "ABSOLUTE"),
        min_size: m.msg("minSize").and_then(|v| v.msg("value")).map(vec2),
        max_size: m.msg("maxSize").and_then(|v| v.msg("value")).map(vec2),
    };
    (child != LayoutChild::default()).then_some(child)
}

/// Reads one `NodeChange` (a node, an override, or derived layout).
pub fn props(m: MsgRef) -> Props {
    let mut p = Props {
        guid: m.msg("guid").and_then(guid),
        ..Props::default()
    };
    if let Some(parent) = m.msg("parentIndex") {
        p.parent = parent.msg("guid").and_then(guid);
        p.position = parent
            .str("position")
            .map(Into::into)
            .or_else(|| parent.u32("position").map(|n| format!("{n:010}").into()));
    }
    p.node_type = m
        .enum_name("type")
        .or_else(|| m.str("type"))
        .map(NodeType::parse);
    p.name = m.str("name").map(Into::into);
    p.visible = m.bool("visible");
    p.locked = m.bool("locked");
    p.opacity = m.f32("opacity");
    p.blend_mode = m.enum_name("blendMode").map(BlendMode::parse);
    p.size = m.msg("size").map(vec2);
    p.transform = m.msg("transform").map(affine);
    p.mask = m.bool("mask");
    p.mask_type = match m.enum_name("maskType") {
        Some("OUTLINE") => Some(MaskType::Outline),
        Some("LUMINANCE") => Some(MaskType::Luminance),
        Some(_) => Some(MaskType::Alpha),
        None => m.bool("maskIsOutline").map(|outline| {
            if outline {
                MaskType::Outline
            } else {
                MaskType::Alpha
            }
        }),
    };
    if m.has("fillPaints") {
        p.fills = Some(m.collect_msgs("fillPaints", paint));
    } else if m.has("backgroundPaints") && m.bool("backgroundEnabled") != Some(false) {
        // Frames in older files keep their fill as a background.
        p.fills = Some(m.collect_msgs("backgroundPaints", paint));
    }
    if m.has("strokePaints") {
        p.strokes = Some(m.collect_msgs("strokePaints", paint));
    }
    p.stroke_weight = m.f32("strokeWeight");
    p.stroke_align = m.enum_name("strokeAlign").map(|a| match a {
        "INSIDE" => StrokeAlign::Inside,
        "OUTSIDE" => StrokeAlign::Outside,
        _ => StrokeAlign::Center,
    });
    p.stroke_cap = m.enum_name("strokeCap").map(Into::into);
    p.stroke_join = m.enum_name("strokeJoin").map(Into::into);
    p.dash_pattern = m.floats("dashPattern").map(Arc::from);
    if m.has("fillGeometry") {
        p.fill_geometry = Some(path_refs(m.msgs("fillGeometry")));
    }
    if m.has("strokeGeometry") {
        p.stroke_geometry = Some(path_refs(m.msgs("strokeGeometry")));
    }
    if m.has("effects") {
        p.effects = Some(m.collect_msgs("effects", effect));
    }
    p.corner_radius = m.f32("cornerRadius");
    if m.bool("rectangleCornerRadiiIndependent") == Some(true)
        || m.has("rectangleTopLeftCornerRadius")
    {
        let r = p.corner_radius.unwrap_or(0.0);
        let radii = CornerRadii {
            top_left: m.f32("rectangleTopLeftCornerRadius").unwrap_or(r),
            top_right: m.f32("rectangleTopRightCornerRadius").unwrap_or(r),
            bottom_right: m.f32("rectangleBottomRightCornerRadius").unwrap_or(r),
            bottom_left: m.f32("rectangleBottomLeftCornerRadius").unwrap_or(r),
        };
        if m.bool("rectangleCornerRadiiIndependent") != Some(false) {
            p.corner_radii = Some(radii);
        }
    }
    p.corner_smoothing = m.f32("cornerSmoothing");
    p.clip_disabled = m.bool("frameMaskDisabled");
    p.background_color = m.msg("backgroundColor").map(color);
    p.internal_only = m.bool("internalOnly");
    if let Some(text) = m.msg("textData") {
        p.text_content = Some(Arc::new(text_content(text)));
        if let Some(layout) = text_layout(text) {
            p.text_layout = Some(Arc::new(layout));
        }
    }
    if let Some(derived) = m.msg("derivedTextData")
        && let Some(layout) = text_layout(derived)
    {
        p.text_layout = Some(Arc::new(layout));
    }
    if let Some(style) = text_style(&m) {
        p.text_style = Some(Arc::new(style));
    }
    if let Some(symbol) = m.msg("symbolData") {
        p.symbol = Some(Arc::new(SymbolData {
            symbol_id: symbol.msg("symbolID").and_then(guid),
            overrides: symbol.collect_msgs("symbolOverrides", props),
            uniform_scale: symbol.f32("uniformScaleFactor"),
        }));
    }
    if m.has("derivedSymbolData") {
        p.derived = Some(m.collect_msgs("derivedSymbolData", props));
    }
    p.swapped_symbol = m.msg("overriddenSymbolID").and_then(guid);
    if m.has("componentPropAssignments") {
        p.prop_assignments = Some(prop_assignments(&m, "componentPropAssignments"));
    }
    if m.has("componentPropRefs") {
        p.prop_refs = Some(
            m.msgs("componentPropRefs")
                .filter(|r| r.bool("isDeleted") != Some(true))
                .filter_map(|r| {
                    Some(PropRef {
                        def_id: r.msg("defID").and_then(guid)?,
                        field: match r.enum_name("componentPropNodeField") {
                            Some("VISIBLE") => PropField::Visible,
                            Some("TEXT_DATA") => PropField::Text,
                            Some("OVERRIDDEN_SYMBOL_ID") => PropField::SwappedSymbol,
                            _ => PropField::Other,
                        },
                    })
                })
                .collect(),
        );
    }
    if m.has("componentPropDefs") {
        p.prop_defs = Some(
            m.msgs("componentPropDefs")
                .filter(|d| d.bool("isDeleted") != Some(true))
                .filter_map(|d| {
                    Some(PropDef {
                        id: d.msg("id").and_then(guid)?,
                        name: d.str("name").unwrap_or("").to_owned(),
                        kind: d.enum_name("type").unwrap_or("").to_owned(),
                    })
                })
                .collect(),
        );
    }
    if let Some(path) = m.msg("guidPath") {
        p.guid_path = Some(path.msgs("guids").filter_map(guid).collect());
    }
    p.override_key = m.msg("overrideKey").and_then(guid);
    p.auto_layout = auto_layout(&m).map(Arc::new);
    p.layout_child = layout_child(&m);
    if m.has("exportSettings") {
        p.export_settings = Some(
            m.msgs("exportSettings")
                .map(|e| {
                    let c = e.msg("constraint");
                    ExportSetting {
                        format: e.enum_name("imageType").unwrap_or("PNG").to_owned(),
                        suffix: e.str("suffix").unwrap_or("").to_owned(),
                        constraint: c
                            .and_then(|c| c.enum_name("type"))
                            .unwrap_or("CONTENT_SCALE")
                            .to_owned(),
                        value: c.and_then(|c| c.f32("value")).unwrap_or(1.0),
                    }
                })
                .collect(),
        );
    }
    p.boolean_operation = m.enum_name("booleanOperation").map(Into::into);
    let (h, v) = (
        m.enum_name("horizontalConstraint"),
        m.enum_name("verticalConstraint"),
    );
    if h.is_some() || v.is_some() {
        p.constraints = Some((h.unwrap_or("MIN").into(), v.unwrap_or("MIN").into()));
    }
    p.description = m
        .str("description")
        .or_else(|| m.str("symbolDescription"))
        .filter(|d| !d.is_empty())
        .map(Into::into);
    p.is_state_group = m.bool("isStateGroup");
    let style = |new: &'static str, legacy: &'static str| {
        m.msg(new)
            .and_then(|s| s.msg("guid"))
            .and_then(guid)
            .or_else(|| m.msg(legacy).and_then(guid))
            .filter(|g| *g != Guid::default() && g.session != u32::MAX)
    };
    p.fill_style = style("styleIdForFill", "inheritFillStyleID");
    p.stroke_style = style("styleIdForStrokeFill", "inheritFillStyleIDForStroke");
    p.effect_style = style("styleIdForEffect", "inheritEffectStyleID");
    p.generated = generated_layers(&m);
    p
}

/// The layers of a FigJam object (see [`Props::generated`]): one per entry
/// of its derived layout, starting from the generation entry with the same
/// guid path. Layers with text are text layers, drawn above the others
/// (shapes drawn from their geometry: a connector's label background goes
/// under its label).
fn generated_layers(m: &MsgRef) -> Option<Arc<[Props]>> {
    let layout = m.msg("derivedImmutableFrameData")?;
    let generation: Vec<Props> = m
        .msg("nodeGenerationData")
        .map(|g| g.msgs("overrides").map(props).collect())
        .unwrap_or_default();
    let mut layers: Vec<Props> = layout
        .msgs("overrides")
        .map(props)
        .filter_map(|derived| {
            let path = derived.guid_path.clone().filter(|p| !p.is_empty())?;
            let mut layer = generation
                .iter()
                .find(|g| g.guid_path.as_deref() == Some(&*path))
                .cloned()
                .unwrap_or_default();
            layer.merge(&derived);
            layer.guid_path = Some(path);
            let text = layer.text_content.is_some() || layer.text_layout.is_some();
            layer.node_type = Some(if text {
                NodeType::Text
            } else {
                NodeType::Vector
            });
            Some(layer)
        })
        .collect();
    // A connector's label sits in a box (layer 2) along the line; its text
    // is placed within that box.
    if m.enum_name("type") == Some("CONNECTOR")
        && let Some(label) = layers
            .iter()
            .find(|l| l.node_type == Some(NodeType::Vector) && layer_index(l) == Some(2))
            .and_then(|l| l.transform)
    {
        for l in layers
            .iter_mut()
            .filter(|l| l.node_type == Some(NodeType::Text))
        {
            l.transform = Some(label.mul(&l.transform.unwrap_or_default()));
        }
    }
    layers.sort_by_key(|l| (l.node_type == Some(NodeType::Text), layer_index(l)));
    (!layers.is_empty()).then(|| layers.into())
}

/// Which of its object's generated layers `l` is (the local id of its path).
fn layer_index(l: &Props) -> Option<u32> {
    l.guid_path.as_deref()?.last().map(|g| g.local)
}

/// Whether a node change deletes its node (`phase: REMOVED`).
pub fn is_removed(m: &MsgRef) -> bool {
    m.enum_name("phase") == Some("REMOVED")
}

/// A list value's message elements (helper for the top-level message).
pub fn list_msgs<'a>(v: ValRef<'a>) -> impl Iterator<Item = MsgRef<'a>> + 'a {
    let schema = v.schema;
    match v.value {
        crate::kiwi::Value::List(items) => items.iter(),
        _ => [].iter(),
    }
    .filter_map(move |value| crate::kiwi::ValRef { schema, value }.as_msg())
}
