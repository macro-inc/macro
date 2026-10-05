//! Writing a `.fig` file after edits.
//!
//! The original file is decoded again with its complete schema, so every
//! field the engine does not model survives. Each edited node's record is
//! patched in the fields its [`Node::edits`] name, removed nodes' records are
//! dropped, created nodes get new records (copies start from their source's),
//! and blobs the edits added are appended. The result is the current ZIP
//! layout: `canvas.fig`, `meta.json`, a fresh `thumbnail.png`, and the image
//! fills.
//!
//! [`blank`] makes a new, empty design with a built-in schema that follows
//! Figma's field names and types.

use crate::container::Container;
use crate::document::{Document, Node};
use crate::edit::flags;
use crate::error::{Result, corrupt};
use crate::images::{ImageStore, encode_png};
use crate::kiwi::{Decoder, Msg, Reader, Schema, Value, Writer, schema_from_text};
use crate::model::{
    Affine, BlendMode, Color, Effect, EffectKind, GradientKind, Guid, ImageScaleMode, NodeType,
    Paint, PaintKind, PathRef, Props, StrokeAlign, Vec2, WindingRule,
};
use crate::render::{self, RenderOptions, Viewport};
use crate::scene::Scene;
use std::collections::HashMap;

/// The schema of designs created in Macro: a subset of Figma's, with the
/// same type and field names, so the files are ordinary `.fig` files.
pub const MACRO_SCHEMA: &str = "
enum MessageType JOIN_START NODE_CHANGES USER_CHANGES JOIN_END SIGNAL STYLE STYLE_SET_CHANGES INTERACTIVE_SLIDE_CHANGE
enum NodePhase CREATED REMOVED
enum NodeType NONE DOCUMENT CANVAS GROUP FRAME BOOLEAN_OPERATION VECTOR STAR LINE ELLIPSE RECTANGLE REGULAR_POLYGON ROUNDED_RECTANGLE TEXT SLICE SYMBOL INSTANCE STICKY SHAPE_WITH_TEXT CONNECTOR CODE_BLOCK WIDGET STAMP MEDIA HIGHLIGHT SECTION SECTION_OVERLAY WASHI_TAPE VARIABLE TABLE TABLE_CELL
enum BlendMode PASS_THROUGH NORMAL DARKEN MULTIPLY LINEAR_BURN COLOR_BURN LIGHTEN SCREEN LINEAR_DODGE COLOR_DODGE OVERLAY SOFT_LIGHT HARD_LIGHT DIFFERENCE EXCLUSION HUE SATURATION COLOR LUMINOSITY
enum PaintType SOLID GRADIENT_LINEAR GRADIENT_RADIAL GRADIENT_ANGULAR GRADIENT_DIAMOND IMAGE EMOJI VIDEO
enum ImageScaleMode STRETCH FIT FILL TILE
enum EffectType INNER_SHADOW DROP_SHADOW FOREGROUND_BLUR BACKGROUND_BLUR
enum StrokeAlign CENTER INSIDE OUTSIDE
enum StrokeCap NONE ROUND SQUARE ARROW_LINES ARROW_EQUILATERAL
enum StrokeJoin MITER BEVEL ROUND
enum WindingRule NONZERO ODD
enum NumberUnits RAW PIXELS PERCENT
enum TextAlignHorizontal LEFT CENTER RIGHT JUSTIFIED
enum TextAlignVertical TOP CENTER BOTTOM
enum TextAutoResize NONE WIDTH_AND_HEIGHT HEIGHT
enum StackMode NONE HORIZONTAL VERTICAL GRID
enum StackAlign MIN CENTER MAX BASELINE
enum StackCounterAlign MIN CENTER MAX STRETCH AUTO BASELINE
enum StackJustify MIN CENTER MAX SPACE_EVENLY SPACE_BETWEEN SPACE_AROUND SPACE_EVENLY_CSS
enum StackSize FIXED RESIZE_TO_FIT RESIZE_TO_FIT_WITH_IMPLICIT_SIZE
enum StackPositioning AUTO ABSOLUTE
enum StackWrap NO_WRAP WRAP
enum ConstraintType MIN CENTER MAX STRETCH SCALE FIXED_MIN FIXED_MAX
enum TextDecoration NONE UNDERLINE STRIKETHROUGH
enum TextCase ORIGINAL UPPER LOWER TITLE SMALL_CAPS SMALL_CAPS_FORCED
struct GUID sessionID:uint localID:uint
struct Color r:float g:float b:float a:float
struct Vector x:float y:float
struct Rect x:float y:float w:float h:float
struct Matrix m00:float m01:float m02:float m10:float m11:float m12:float
message ParentIndex guid:GUID position:string
message Number value:float units:NumberUnits
message FontName family:string style:string postscript:string
message ColorStop color:Color position:float
message Image hash:byte[] name:string
message Paint type:PaintType color:Color opacity:float visible:bool blendMode:BlendMode stops:ColorStop[] transform:Matrix image:Image imageScaleMode:ImageScaleMode rotation:float scale:float originalImageWidth:uint originalImageHeight:uint
message Effect type:EffectType color:Color offset:Vector radius:float visible:bool blendMode:BlendMode spread:float showShadowBehindNode:bool
message Path windingRule:WindingRule commandsBlob:uint styleID:uint
message Glyph commandsBlob:uint position:Vector styleID:uint fontSize:float firstCharacter:uint advance:float
message Baseline position:Vector width:float lineY:float lineHeight:float lineAscent:float firstCharacter:uint endCharacter:uint
message Decoration rects:Rect[] styleID:uint
message DerivedTextData layoutSize:Vector baselines:Baseline[] glyphs:Glyph[] decorations:Decoration[]
message TextData characters:string characterStyleIDs:uint[] styleOverrideTable:NodeChange[]
message GUIDPath guids:GUID[]
message SymbolData symbolID:GUID symbolOverrides:NodeChange[] uniformScaleFactor:float
message NodeChange guid:GUID phase:NodePhase parentIndex:ParentIndex type:NodeType name:string visible:bool locked:bool opacity:float blendMode:BlendMode size:Vector transform:Matrix mask:bool fillPaints:Paint[] strokePaints:Paint[] strokeWeight:float strokeAlign:StrokeAlign strokeCap:StrokeCap strokeJoin:StrokeJoin dashPattern:float[] fillGeometry:Path[] strokeGeometry:Path[] effects:Effect[] cornerRadius:float rectangleTopLeftCornerRadius:float rectangleTopRightCornerRadius:float rectangleBottomLeftCornerRadius:float rectangleBottomRightCornerRadius:float rectangleCornerRadiiIndependent:bool cornerSmoothing:float frameMaskDisabled:bool backgroundColor:Color backgroundOpacity:float backgroundEnabled:bool internalOnly:bool textData:TextData derivedTextData:DerivedTextData fontSize:float fontName:FontName lineHeight:Number letterSpacing:Number textAlignHorizontal:TextAlignHorizontal textAlignVertical:TextAlignVertical textAutoResize:TextAutoResize paragraphSpacing:float textDecoration:TextDecoration textCase:TextCase derivedSymbolData:NodeChange[] stackMode:StackMode stackSpacing:float stackHorizontalPadding:float stackVerticalPadding:float stackPaddingRight:float stackPaddingBottom:float stackPrimaryAlignItems:StackJustify stackCounterAlignItems:StackAlign stackPrimarySizing:StackSize stackCounterSizing:StackSize stackWrap:StackWrap stackChildPrimaryGrow:float stackChildAlignSelf:StackCounterAlign stackPositioning:StackPositioning horizontalConstraint:ConstraintType verticalConstraint:ConstraintType symbolData:SymbolData overriddenSymbolID:GUID guidPath:GUIDPath overrideKey:GUID
message Blob bytes:byte[]
message Message type:MessageType sessionID:uint ackID:uint nodeChanges:NodeChange[] blobs:Blob[]
";

/// The format version written into new files' headers.
const MACRO_VERSION: u32 = 48;

/// Kiwi values built against one schema.
struct Build<'s> {
    schema: &'s Schema,
}

impl<'s> Build<'s> {
    fn def(&self, name: &str) -> Option<u32> {
        self.schema.def_index(name)
    }

    /// The type of `parent`'s field `field`.
    fn sub(&self, parent: u32, field: &str) -> Option<u32> {
        self.schema.field_def(parent, field)
    }

    /// The enum value `value` of `parent`'s enum-typed field `field`.
    fn enum_of(&self, parent: u32, field: &str, value: &str) -> Option<Value> {
        let def = self.sub(parent, field)?;
        let f = self
            .schema
            .def(def)
            .fields
            .iter()
            .find(|f| f.name == value)?;
        Some(Value::Enum(def, f.id))
    }

    fn set_enum(&self, m: &mut Msg, field: &str, value: &str) {
        if let Some(v) = self.enum_of(m.def, field, value) {
            m.set(self.schema, field, v);
        }
    }

    fn msg_field(&self, m: &mut Msg, field: &str, build: impl FnOnce(&Self, &mut Msg)) {
        if let Some(def) = self.sub(m.def, field) {
            let mut inner = Msg::new(def);
            build(self, &mut inner);
            m.set(self.schema, field, Value::Msg(Box::new(inner)));
        }
    }

    fn list_field(&self, m: &mut Msg, field: &str, items: Vec<Value>) {
        m.set(self.schema, field, Value::List(items));
    }

    fn guid(&self, def: u32, g: Guid) -> Msg {
        let mut m = Msg::new(def);
        m.set(self.schema, "sessionID", Value::Uint(g.session));
        m.set(self.schema, "localID", Value::Uint(g.local));
        m
    }

    fn guid_field(&self, m: &mut Msg, field: &str, g: Guid) {
        if let Some(def) = self.sub(m.def, field) {
            let v = self.guid(def, g);
            m.set(self.schema, field, Value::Msg(Box::new(v)));
        }
    }

    fn vector(&self, m: &mut Msg, field: &str, v: Vec2) {
        self.msg_field(m, field, |b, inner| {
            inner.set(b.schema, "x", Value::Float(v.x as f32));
            inner.set(b.schema, "y", Value::Float(v.y as f32));
        });
    }

    fn color(&self, m: &mut Msg, field: &str, c: Color) {
        self.msg_field(m, field, |b, inner| {
            inner.set(b.schema, "r", Value::Float(c.r));
            inner.set(b.schema, "g", Value::Float(c.g));
            inner.set(b.schema, "b", Value::Float(c.b));
            inner.set(b.schema, "a", Value::Float(c.a));
        });
    }

    fn matrix(&self, m: &mut Msg, field: &str, t: &Affine) {
        self.msg_field(m, field, |b, inner| {
            for (name, v) in [
                ("m00", t.m00),
                ("m01", t.m01),
                ("m02", t.m02),
                ("m10", t.m10),
                ("m11", t.m11),
                ("m12", t.m12),
            ] {
                inner.set(b.schema, name, Value::Float(v as f32));
            }
        });
    }

    fn paint(&self, def: u32, p: &Paint) -> Option<Value> {
        let mut m = Msg::new(def);
        let kind = match &p.kind {
            PaintKind::Solid(c) => {
                self.color(&mut m, "color", *c);
                "SOLID"
            }
            PaintKind::Gradient {
                kind,
                stops,
                transform,
            } => {
                let stop_def = self.sub(def, "stops");
                let items = stop_def
                    .map(|sd| {
                        stops
                            .iter()
                            .map(|s| {
                                let mut sm = Msg::new(sd);
                                self.color(&mut sm, "color", s.color);
                                sm.set(self.schema, "position", Value::Float(s.position));
                                Value::Msg(Box::new(sm))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                self.list_field(&mut m, "stops", items);
                self.matrix(&mut m, "transform", transform);
                match kind {
                    GradientKind::Linear => "GRADIENT_LINEAR",
                    GradientKind::Radial => "GRADIENT_RADIAL",
                    GradientKind::Angular => "GRADIENT_ANGULAR",
                    GradientKind::Diamond => "GRADIENT_DIAMOND",
                }
            }
            PaintKind::Image(img) => {
                if let Some(hash) = img.hash.as_deref().and_then(unhex) {
                    self.msg_field(&mut m, "image", |b, inner| {
                        inner.set(b.schema, "hash", Value::Bytes(hash.into()));
                    });
                }
                self.set_enum(
                    &mut m,
                    "imageScaleMode",
                    match img.scale_mode {
                        ImageScaleMode::Stretch => "STRETCH",
                        ImageScaleMode::Fit => "FIT",
                        ImageScaleMode::Fill => "FILL",
                        ImageScaleMode::Tile => "TILE",
                    },
                );
                self.matrix(&mut m, "transform", &img.transform);
                m.set(self.schema, "scale", Value::Float(img.scale));
                m.set(self.schema, "rotation", Value::Float(img.rotation));
                if let Some(s) = img.original_size {
                    m.set(self.schema, "originalImageWidth", Value::Uint(s.x as u32));
                    m.set(self.schema, "originalImageHeight", Value::Uint(s.y as u32));
                }
                "IMAGE"
            }
            PaintKind::Unsupported(_) => return None,
        };
        self.set_enum(&mut m, "type", kind);
        m.set(self.schema, "opacity", Value::Float(p.opacity));
        m.set(self.schema, "visible", Value::Bool(p.visible));
        self.set_enum(&mut m, "blendMode", blend_name(p.blend_mode));
        Some(Value::Msg(Box::new(m)))
    }

    fn paints(&self, m: &mut Msg, field: &str, paints: &[Paint]) {
        let Some(def) = self.sub(m.def, field) else {
            return;
        };
        let items = paints.iter().filter_map(|p| self.paint(def, p)).collect();
        self.list_field(m, field, items);
    }

    fn effects(&self, m: &mut Msg, effects: &[Effect]) {
        let Some(def) = self.sub(m.def, "effects") else {
            return;
        };
        let items = effects
            .iter()
            .filter_map(|e| {
                let kind = match e.kind {
                    EffectKind::DropShadow => "DROP_SHADOW",
                    EffectKind::InnerShadow => "INNER_SHADOW",
                    EffectKind::LayerBlur => "FOREGROUND_BLUR",
                    EffectKind::BackgroundBlur => "BACKGROUND_BLUR",
                    EffectKind::Other => return None,
                };
                let mut em = Msg::new(def);
                self.set_enum(&mut em, "type", kind);
                self.color(&mut em, "color", e.color);
                self.vector(&mut em, "offset", e.offset);
                em.set(self.schema, "radius", Value::Float(e.radius));
                em.set(self.schema, "spread", Value::Float(e.spread));
                em.set(self.schema, "visible", Value::Bool(e.visible));
                self.set_enum(&mut em, "blendMode", blend_name(e.blend_mode));
                Some(Value::Msg(Box::new(em)))
            })
            .collect();
        self.list_field(m, "effects", items);
    }

    fn geometry(&self, m: &mut Msg, field: &str, paths: Option<&[PathRef]>) {
        let Some(paths) = paths else {
            m.remove(self.schema, field);
            return;
        };
        let Some(def) = self.sub(m.def, field) else {
            return;
        };
        let items = paths
            .iter()
            .map(|p| {
                let mut pm = Msg::new(def);
                self.set_enum(
                    &mut pm,
                    "windingRule",
                    match p.winding {
                        WindingRule::NonZero => "NONZERO",
                        WindingRule::EvenOdd => "ODD",
                    },
                );
                pm.set(self.schema, "commandsBlob", Value::Uint(p.blob));
                pm.set(self.schema, "styleID", Value::Uint(p.style));
                Value::Msg(Box::new(pm))
            })
            .collect();
        self.list_field(m, field, items);
    }

    fn number(&self, m: &mut Msg, field: &str, (value, units): &(f32, String)) {
        self.msg_field(m, field, |b, inner| {
            inner.set(b.schema, "value", Value::Float(*value));
            b.set_enum(inner, "units", units);
        });
    }

    fn text(&self, m: &mut Msg, props: &Props) {
        if let Some(content) = &props.text_content {
            let existing = match m.get(self.schema, "textData") {
                Some(Value::Msg(t)) => Some((**t).clone()),
                _ => None,
            };
            if let Some(def) = self.sub(m.def, "textData") {
                let mut t = existing.unwrap_or_else(|| Msg::new(def));
                t.set(
                    self.schema,
                    "characters",
                    Value::Str(content.characters.as_ref().into()),
                );
                if content.style_ids.is_empty() {
                    t.remove(self.schema, "characterStyleIDs");
                } else {
                    t.set(
                        self.schema,
                        "characterStyleIDs",
                        Value::Uints(content.style_ids.as_ref().into()),
                    );
                }
                self.style_overrides(&mut t, &content.styles);
                m.set(self.schema, "textData", Value::Msg(Box::new(t)));
            }
        }
        if let Some(style) = &props.text_style {
            if let Some(fs) = style.font_size {
                m.set(self.schema, "fontSize", Value::Float(fs));
            }
            if let Some(family) = &style.font_family {
                let font_style = style.font_style.as_deref().unwrap_or("Regular");
                let same = match m.get(self.schema, "fontName") {
                    Some(Value::Msg(f)) => {
                        matches!(f.get(self.schema, "family"), Some(Value::Str(s)) if s.as_ref() == family.as_str())
                            && matches!(f.get(self.schema, "style"), Some(Value::Str(s)) if s.as_ref() == font_style)
                    }
                    _ => false,
                };
                if !same {
                    self.msg_field(m, "fontName", |b, inner| {
                        inner.set(b.schema, "family", Value::Str(family.as_str().into()));
                        inner.set(b.schema, "style", Value::Str(font_style.into()));
                        let ps = format!(
                            "{}-{}",
                            family.replace(' ', ""),
                            font_style.replace(' ', "")
                        );
                        inner.set(b.schema, "postscript", Value::Str(ps.into()));
                    });
                    // Axis values and the font's version belong to the old face.
                    for f in ["fontVariations", "fontVersion"] {
                        m.remove(self.schema, f);
                    }
                }
            }
            if let Some(lh) = &style.line_height {
                self.number(m, "lineHeight", lh);
            }
            if let Some(ls) = &style.letter_spacing {
                self.number(m, "letterSpacing", ls);
            }
            if let Some(p) = style.paragraph_spacing {
                m.set(self.schema, "paragraphSpacing", Value::Float(p));
            }
            self.set_enum(
                m,
                "textDecoration",
                style.decoration.as_deref().unwrap_or("NONE"),
            );
            self.set_enum(m, "textCase", style.case.as_deref().unwrap_or("ORIGINAL"));
            if let Some(a) = &style.auto_resize {
                self.set_enum(m, "textAutoResize", a);
            }
            if let Some(a) = &style.align_horizontal {
                self.set_enum(m, "textAlignHorizontal", a);
            }
            if let Some(a) = &style.align_vertical {
                self.set_enum(m, "textAlignVertical", a);
            }
            // The text no longer follows a shared text style.
            for f in ["styleIdForText", "inheritTextStyleKey"] {
                m.remove(self.schema, f);
            }
        }
        // Files from before `derivedTextData` keep the layout in `textData`.
        let target = if self.sub(m.def, "derivedTextData").is_some() {
            "derivedTextData"
        } else {
            "textData"
        };
        if let Some(layout) = &props.text_layout
            && let Some(def) = self.sub(m.def, target)
        {
            let mut d = match (target, m.get(self.schema, target)) {
                ("textData", Some(Value::Msg(t))) => {
                    let mut t = (**t).clone();
                    t.remove(self.schema, "baselines");
                    t
                }
                _ => Msg::new(def),
            };
            self.vector(
                &mut d,
                "layoutSize",
                layout.layout_size.unwrap_or(props.size()),
            );
            if let Some(gdef) = self.sub(def, "glyphs") {
                let glyphs = layout
                    .glyphs
                    .iter()
                    .map(|g| {
                        let mut gm = Msg::new(gdef);
                        if let Some(b) = g.blob {
                            gm.set(self.schema, "commandsBlob", Value::Uint(b));
                        }
                        self.vector(
                            &mut gm,
                            "position",
                            Vec2::new(f64::from(g.x), f64::from(g.y)),
                        );
                        gm.set(self.schema, "styleID", Value::Uint(g.style_id));
                        gm.set(self.schema, "fontSize", Value::Float(g.font_size));
                        gm.set(self.schema, "firstCharacter", Value::Uint(g.first_char));
                        gm.set(self.schema, "advance", Value::Float(g.advance));
                        Value::Msg(Box::new(gm))
                    })
                    .collect();
                self.list_field(&mut d, "glyphs", glyphs);
            }
            if !layout.decorations.is_empty()
                && let Some(ddef) = self.sub(def, "decorations")
                && let Some(rdef) = self.sub(ddef, "rects")
            {
                let decorations = layout
                    .decorations
                    .iter()
                    .map(|deco| {
                        let mut dm = Msg::new(ddef);
                        let rects = deco
                            .rects
                            .iter()
                            .map(|r| {
                                let mut rm = Msg::new(rdef);
                                for (k, v) in ["x", "y", "w", "h"].into_iter().zip(r) {
                                    rm.set(self.schema, k, Value::Float(*v));
                                }
                                Value::Msg(Box::new(rm))
                            })
                            .collect();
                        dm.set(self.schema, "rects", Value::List(rects));
                        dm.set(self.schema, "styleID", Value::Uint(deco.style_id));
                        Value::Msg(Box::new(dm))
                    })
                    .collect();
                self.list_field(&mut d, "decorations", decorations);
            }
            m.set(self.schema, target, Value::Msg(Box::new(d)));
        }
    }

    /// Drops the properties an edit took over from the per-character style
    /// table (the node's own style now applies).
    fn style_overrides(&self, t: &mut Msg, runs: &[crate::model::StyleRun]) {
        let Some(Value::List(entries)) = t.get(self.schema, "styleOverrideTable").cloned() else {
            return;
        };
        let entries = entries
            .into_iter()
            .map(|e| {
                let Value::Msg(mut e) = e else { return e };
                let id = match e.get(self.schema, "styleID") {
                    Some(Value::Uint(id)) => Some(*id),
                    _ => None,
                };
                if let Some(run) = id.and_then(|id| runs.iter().find(|r| r.id == id)) {
                    let mut drop = Vec::new();
                    if run.font_size.is_none() {
                        drop.push("fontSize");
                    }
                    if run.font_family.is_none() && run.font_style.is_none() {
                        drop.extend(["fontName", "fontVariations", "fontVersion"]);
                    }
                    if run.decoration.is_none() {
                        drop.push("textDecoration");
                    }
                    if run.fills.is_none() {
                        drop.extend(["fillPaints", "styleIdForFill"]);
                    }
                    for f in drop {
                        e.remove(self.schema, f);
                    }
                }
                Value::Msg(e)
            })
            .collect();
        t.set(self.schema, "styleOverrideTable", Value::List(entries));
    }

    /// Rewrites the fields of `m` that `edits` names, from `node`.
    fn patch(&self, m: &mut Msg, node: &Node, doc: &Document, edits: u32) {
        let p = &node.props;
        let s = self.schema;
        if edits & flags::TRANSFORM != 0 {
            self.matrix(m, "transform", &p.transform());
        }
        if edits & flags::SIZE != 0 {
            self.vector(m, "size", p.size());
        }
        if edits & flags::NAME != 0 {
            m.set(s, "name", Value::Str(p.name().into()));
        }
        if edits & flags::VISIBLE != 0 {
            m.set(s, "visible", Value::Bool(p.visible()));
        }
        if edits & flags::LOCKED != 0 {
            m.set(s, "locked", Value::Bool(p.locked.unwrap_or(false)));
        }
        if edits & flags::OPACITY != 0 {
            m.set(s, "opacity", Value::Float(p.opacity()));
        }
        if edits & flags::BLEND != 0 {
            self.set_enum(m, "blendMode", blend_name(p.blend_mode()));
        }
        if edits & flags::FILLS != 0 {
            self.paints(m, "fillPaints", p.fills());
            if p.fill_style.is_none() {
                for f in ["styleIdForFill", "inheritFillStyleID"] {
                    m.remove(s, f);
                }
            }
            if matches!(p.node_type(), NodeType::Frame | NodeType::Symbol) {
                // Older files keep frame fills as a background.
                for f in ["backgroundPaints", "backgroundEnabled"] {
                    m.remove(s, f);
                }
            }
        }
        if edits & flags::STROKES != 0 {
            self.paints(m, "strokePaints", p.strokes());
            if p.stroke_style.is_none() {
                for f in ["styleIdForStrokeFill", "inheritFillStyleIDForStroke"] {
                    m.remove(s, f);
                }
            }
        }
        if edits & flags::STROKE_WEIGHT != 0 {
            m.set(s, "strokeWeight", Value::Float(p.stroke_weight()));
            match p.dash_pattern.as_deref() {
                Some(d) => {
                    m.set(s, "dashPattern", Value::Floats(d.into()));
                }
                None => m.remove(s, "dashPattern"),
            }
        }
        if edits & flags::STROKE_ALIGN != 0 {
            self.set_enum(
                m,
                "strokeAlign",
                match p.stroke_align() {
                    StrokeAlign::Center => "CENTER",
                    StrokeAlign::Inside => "INSIDE",
                    StrokeAlign::Outside => "OUTSIDE",
                },
            );
        }
        if edits & flags::RADIUS != 0 {
            let r = p.radii();
            m.set(
                s,
                "cornerRadius",
                Value::Float(p.corner_radius.unwrap_or(r.top_left)),
            );
            m.set(s, "rectangleTopLeftCornerRadius", Value::Float(r.top_left));
            m.set(
                s,
                "rectangleTopRightCornerRadius",
                Value::Float(r.top_right),
            );
            m.set(
                s,
                "rectangleBottomLeftCornerRadius",
                Value::Float(r.bottom_left),
            );
            m.set(
                s,
                "rectangleBottomRightCornerRadius",
                Value::Float(r.bottom_right),
            );
            m.set(s, "rectangleCornerRadiiIndependent", Value::Bool(false));
        }
        if edits & flags::BACKGROUND != 0
            && let Some(c) = p.background_color
        {
            self.color(m, "backgroundColor", c);
        }
        if edits & flags::CLIP != 0 {
            m.set(
                s,
                "frameMaskDisabled",
                Value::Bool(p.clip_disabled.unwrap_or(false)),
            );
        }
        if edits & flags::EFFECTS != 0 {
            self.effects(m, p.effects());
        }
        if edits & flags::GEOMETRY != 0 {
            self.geometry(m, "fillGeometry", p.fill_geometry.as_deref());
            self.geometry(m, "strokeGeometry", p.stroke_geometry.as_deref());
        }
        if edits & flags::TEXT != 0 {
            self.text(m, p);
        }
        if edits & flags::TYPE != 0 {
            let t = match p.node_type() {
                NodeType::RoundedRectangle => "ROUNDED_RECTANGLE",
                other => type_name(other),
            };
            self.set_enum(m, "type", t);
            if p.node_type() != NodeType::Instance {
                for f in [
                    "symbolData",
                    "derivedSymbolData",
                    "componentPropAssignments",
                    "overriddenSymbolID",
                ] {
                    m.remove(s, f);
                }
            }
        }
        if edits & flags::INSTANCE_OF != 0
            && let Some(symbol) = p.symbol.as_deref()
            && let Some(id) = symbol.symbol_id
            && let Some(def) = self.sub(m.def, "symbolData")
        {
            let mut sm = Msg::new(def);
            self.guid_field(&mut sm, "symbolID", id);
            m.set(s, "symbolData", Value::Msg(Box::new(sm)));
        }
        if edits & (flags::OVERRIDES | flags::DERIVED) != 0 {
            self.overrides(m, p, doc);
        }
        if edits & flags::STROKE_CAP != 0
            && let Some(cap) = &p.stroke_cap
        {
            self.set_enum(m, "strokeCap", cap);
        }
        if edits & flags::PROP_ASSIGNMENTS != 0
            && let Some(list) = p.prop_assignments.as_deref()
        {
            self.prop_assignments(m, list);
        }
        if edits & flags::CONSTRAINTS != 0
            && let Some((h, v)) = &p.constraints
        {
            self.set_enum(m, "horizontalConstraint", h);
            self.set_enum(m, "verticalConstraint", v);
        }
        if edits & flags::AUTO_LAYOUT != 0 {
            self.auto_layout(m, p.auto_layout.as_deref());
        }
        if edits & flags::LAYOUT_CHILD != 0
            && let Some(c) = &p.layout_child
        {
            if let Some(g) = c.grow {
                m.set(s, "stackChildPrimaryGrow", Value::Float(g));
            }
            if let Some(a) = &c.align {
                self.set_enum(m, "stackChildAlignSelf", a);
            }
            if let Some(a) = c.absolute {
                self.set_enum(m, "stackPositioning", if a { "ABSOLUTE" } else { "AUTO" });
            }
        }
        if edits & flags::PARENT != 0 {
            let parent_guid = node.parent.and_then(|pi| doc.props(pi).guid);
            if let (Some(g), Some(def)) = (parent_guid, self.sub(m.def, "parentIndex")) {
                let mut pm = Msg::new(def);
                if let Some(gdef) = self.sub(def, "guid") {
                    let gm = self.guid(gdef, g);
                    pm.set(s, "guid", Value::Msg(Box::new(gm)));
                }
                pm.set(
                    s,
                    "position",
                    Value::Str(p.position.as_deref().unwrap_or("!").into()),
                );
                m.set(s, "parentIndex", Value::Msg(Box::new(pm)));
            }
        }
    }

    /// Sets text property values in `componentPropAssignments`, keeping the
    /// file's other values and fields.
    fn prop_assignments(&self, m: &mut Msg, list: &[crate::model::PropAssignment]) {
        let s = self.schema;
        let Some(def) = self.sub(m.def, "componentPropAssignments") else {
            return;
        };
        let mut entries: Vec<Msg> = match m.get(s, "componentPropAssignments") {
            Some(Value::List(l)) => l
                .iter()
                .filter_map(|v| match v {
                    Value::Msg(m) => Some((**m).clone()),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        };
        for a in list {
            let crate::model::PropValue::Text(text) = &a.value else {
                continue;
            };
            let k = match entries.iter().position(|e| {
                matches!(e.get(s, "defID"), Some(Value::Msg(g))
                    if matches!(g.get(s, "sessionID"), Some(Value::Uint(v)) if *v == a.def_id.session)
                        && matches!(g.get(s, "localID"), Some(Value::Uint(v)) if *v == a.def_id.local))
            }) {
                Some(k) => k,
                None => {
                    let mut e = Msg::new(def);
                    self.guid_field(&mut e, "defID", a.def_id);
                    entries.push(e);
                    entries.len() - 1
                }
            };
            let e = &mut entries[k];
            let Some(vdef) = self.sub(e.def, "value") else {
                continue;
            };
            let mut value = match e.get(s, "value") {
                Some(Value::Msg(v)) => (**v).clone(),
                _ => Msg::new(vdef),
            };
            if let Some(tdef) = self.sub(vdef, "textValue") {
                let mut t = match value.get(s, "textValue") {
                    Some(Value::Msg(t)) => (**t).clone(),
                    _ => Msg::new(tdef),
                };
                t.set(s, "characters", Value::Str(text.as_ref().into()));
                for f in ["characterStyleIDs", "styleOverrideTable", "lines"] {
                    t.remove(s, f);
                }
                value.set(s, "textValue", Value::Msg(Box::new(t)));
            }
            e.set(s, "value", Value::Msg(Box::new(value)));
        }
        m.set(
            s,
            "componentPropAssignments",
            Value::List(
                entries
                    .into_iter()
                    .map(|e| Value::Msg(Box::new(e)))
                    .collect(),
            ),
        );
    }

    fn read_path(&self, m: &Msg) -> Vec<Guid> {
        let s = self.schema;
        let Some(Value::Msg(gp)) = m.get(s, "guidPath") else {
            return Vec::new();
        };
        let Some(Value::List(guids)) = gp.get(s, "guids") else {
            return Vec::new();
        };
        guids
            .iter()
            .filter_map(|g| {
                let Value::Msg(g) = g else { return None };
                let n = |f| match g.get(s, f) {
                    Some(Value::Uint(v)) => *v,
                    _ => 0,
                };
                Some(Guid {
                    session: n("sessionID"),
                    local: n("localID"),
                })
            })
            .collect()
    }

    fn write_path(&self, m: &mut Msg, path: &[Guid]) {
        let Some(def) = self.sub(m.def, "guidPath") else {
            return;
        };
        let mut gp = Msg::new(def);
        if let Some(gdef) = self.sub(def, "guids") {
            let guids = path
                .iter()
                .map(|&g| Value::Msg(Box::new(self.guid(gdef, g))))
                .collect();
            gp.set(self.schema, "guids", Value::List(guids));
        }
        m.set(self.schema, "guidPath", Value::Msg(Box::new(gp)));
    }

    /// Writes an instance's overrides into its `symbolData`, patching the
    /// file's own override records (so fields the engine does not model
    /// survive), and drops derived layout the edits made stale.
    fn overrides(&self, m: &mut Msg, p: &Props, doc: &Document) {
        let s = self.schema;
        let same = |a: &[Guid], b: &[Guid]| {
            a.len() == b.len()
                && a.iter()
                    .zip(b)
                    .all(|(x, y)| crate::edit::guid_of(doc, *x) == crate::edit::guid_of(doc, *y))
        };
        if let Some(symbol) = p.symbol.as_deref()
            && let Some(def) = self.sub(m.def, "symbolData")
            && let Some(odef) = self.sub(def, "symbolOverrides")
        {
            let mut sm = match m.get(s, "symbolData") {
                Some(Value::Msg(sm)) => (**sm).clone(),
                _ => Msg::new(def),
            };
            let mut list: Vec<Msg> = match sm.get(s, "symbolOverrides") {
                Some(Value::List(l)) => l
                    .iter()
                    .filter_map(|v| match v {
                        Value::Msg(m) => Some((**m).clone()),
                        _ => None,
                    })
                    .collect(),
                _ => Vec::new(),
            };
            // Only overrides the editor changed are written; the file's
            // others are copied as they are.
            for o in symbol.overrides.iter().filter(|o| o.recomputed) {
                let Some(path) = o.guid_path.as_deref() else {
                    continue;
                };
                let k = match list.iter().position(|e| same(&self.read_path(e), path)) {
                    Some(k) => k,
                    None => {
                        let mut e = Msg::new(odef);
                        self.write_path(&mut e, path);
                        list.push(e);
                        list.len() - 1
                    }
                };
                let mut edits = 0;
                for (set, flag) in [
                    (o.name.is_some(), flags::NAME),
                    (o.visible.is_some(), flags::VISIBLE),
                    (o.opacity.is_some(), flags::OPACITY),
                    (o.fills.is_some(), flags::FILLS),
                    (o.strokes.is_some(), flags::STROKES),
                    (o.stroke_weight.is_some(), flags::STROKE_WEIGHT),
                    (o.effects.is_some(), flags::EFFECTS),
                    (o.stroke_align.is_some(), flags::STROKE_ALIGN),
                    (o.corner_radius.is_some(), flags::RADIUS),
                    (o.text_content.is_some(), flags::TEXT),
                    (o.size.is_some(), flags::SIZE),
                    (o.prop_assignments.is_some(), flags::PROP_ASSIGNMENTS),
                ] {
                    if set {
                        edits |= flag;
                    }
                }
                let node = Node {
                    props: o.clone(),
                    parent: None,
                    children: Vec::new(),
                    edits,
                    removed: false,
                    source: None,
                };
                self.patch(&mut list[k], &node, doc, edits);
            }
            sm.set(
                s,
                "symbolOverrides",
                Value::List(list.into_iter().map(|e| Value::Msg(Box::new(e))).collect()),
            );
            m.set(s, "symbolData", Value::Msg(Box::new(sm)));
        }
        if let Some(derived) = p.derived.as_deref()
            && let Some(def) = self.sub(m.def, "derivedSymbolData")
        {
            // Entries the edits made stale are gone from memory; drop them.
            let mut list: Vec<Msg> = match m.get(s, "derivedSymbolData") {
                Some(Value::List(l)) => l
                    .iter()
                    .filter_map(|v| match v {
                        Value::Msg(e) => Some((**e).clone()),
                        _ => None,
                    })
                    .filter(|e| {
                        let path = self.read_path(e);
                        derived
                            .iter()
                            .any(|d| d.guid_path.as_deref().is_some_and(|p| same(p, &path)))
                    })
                    .collect(),
                _ => Vec::new(),
            };
            // Write the ones the editor laid out.
            for d in derived.iter().filter(|d| d.recomputed) {
                let Some(path) = d.guid_path.as_deref() else {
                    continue;
                };
                let k = match list.iter().position(|e| same(&self.read_path(e), path)) {
                    Some(k) => k,
                    None => {
                        let mut e = Msg::new(def);
                        self.write_path(&mut e, path);
                        list.push(e);
                        list.len() - 1
                    }
                };
                let mut edits = 0;
                for (set, flag) in [
                    (d.transform.is_some(), flags::TRANSFORM),
                    (d.size.is_some(), flags::SIZE),
                    (
                        d.fill_geometry.is_some() || d.stroke_geometry.is_some(),
                        flags::GEOMETRY,
                    ),
                ] {
                    if set {
                        edits |= flag;
                    }
                }
                let node = Node {
                    props: d.clone(),
                    parent: None,
                    children: Vec::new(),
                    edits,
                    removed: false,
                    source: None,
                };
                self.patch(&mut list[k], &node, doc, edits);
                if d.text_layout.is_some() {
                    self.text(&mut list[k], &d.clone());
                }
            }
            m.set(
                s,
                "derivedSymbolData",
                Value::List(list.into_iter().map(|e| Value::Msg(Box::new(e))).collect()),
            );
        }
    }

    fn auto_layout(&self, m: &mut Msg, al: Option<&crate::model::AutoLayout>) {
        let s = self.schema;
        let Some(al) = al else {
            self.set_enum(m, "stackMode", "NONE");
            return;
        };
        self.set_enum(m, "stackMode", &al.mode);
        m.set(s, "stackSpacing", Value::Float(al.spacing));
        m.remove(s, "stackPadding");
        m.set(s, "stackHorizontalPadding", Value::Float(al.padding_left));
        m.set(s, "stackVerticalPadding", Value::Float(al.padding_top));
        m.set(s, "stackPaddingRight", Value::Float(al.padding_right));
        m.set(s, "stackPaddingBottom", Value::Float(al.padding_bottom));
        for (field, value) in [
            ("stackPrimaryAlignItems", &al.primary_align),
            ("stackCounterAlignItems", &al.counter_align),
        ] {
            match value {
                Some(v) => self.set_enum(m, field, v),
                None => m.remove(s, field),
            }
        }
        self.set_enum(
            m,
            "stackPrimarySizing",
            al.primary_sizing
                .as_deref()
                .unwrap_or("RESIZE_TO_FIT_WITH_IMPLICIT_SIZE"),
        );
        self.set_enum(
            m,
            "stackCounterSizing",
            al.counter_sizing.as_deref().unwrap_or("FIXED"),
        );
        self.set_enum(m, "stackWrap", if al.wrap { "WRAP" } else { "NO_WRAP" });
    }

    /// A complete record for a node created in Macro.
    fn create(&self, def: u32, node: &Node, doc: &Document) -> Msg {
        let mut m = Msg::new(def);
        let p = &node.props;
        if let Some(g) = p.guid {
            self.guid_field(&mut m, "guid", g);
        }
        self.set_enum(&mut m, "phase", "CREATED");
        let t = match p.node_type() {
            NodeType::RoundedRectangle => "ROUNDED_RECTANGLE",
            other => type_name(other),
        };
        self.set_enum(&mut m, "type", t);
        let mut edits = !flags::GEOMETRY;
        if p.fill_geometry.is_some() || p.stroke_geometry.is_some() {
            edits |= flags::GEOMETRY;
        }
        if p.node_type() != NodeType::Text {
            edits &= !flags::TEXT;
        }
        self.patch(&mut m, node, doc, edits);
        m
    }
}

fn blend_name(b: BlendMode) -> &'static str {
    use BlendMode::*;
    match b {
        PassThrough => "PASS_THROUGH",
        Normal => "NORMAL",
        Darken => "DARKEN",
        Multiply => "MULTIPLY",
        LinearBurn => "LINEAR_BURN",
        ColorBurn => "COLOR_BURN",
        Lighten => "LIGHTEN",
        Screen => "SCREEN",
        LinearDodge => "LINEAR_DODGE",
        ColorDodge => "COLOR_DODGE",
        Overlay => "OVERLAY",
        SoftLight => "SOFT_LIGHT",
        HardLight => "HARD_LIGHT",
        Difference => "DIFFERENCE",
        Exclusion => "EXCLUSION",
        Hue => "HUE",
        Saturation => "SATURATION",
        Color => "COLOR",
        Luminosity => "LUMINOSITY",
    }
}

fn type_name(t: NodeType) -> &'static str {
    use NodeType::*;
    match t {
        Document => "DOCUMENT",
        Canvas => "CANVAS",
        Group => "GROUP",
        Frame => "FRAME",
        BooleanOperation => "BOOLEAN_OPERATION",
        Vector => "VECTOR",
        Star => "STAR",
        Line => "LINE",
        Ellipse => "ELLIPSE",
        Rectangle => "RECTANGLE",
        RegularPolygon => "REGULAR_POLYGON",
        RoundedRectangle => "ROUNDED_RECTANGLE",
        Text => "TEXT",
        Slice => "SLICE",
        Symbol => "SYMBOL",
        Instance => "INSTANCE",
        Section => "SECTION",
        _ => "FRAME",
    }
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

/// What saving does with one node's records.
enum Plan {
    Patch(usize),
    Drop,
}

/// Reads a node change's id, leaving `r` after the record.
fn scan_guid(
    decoder: &Decoder,
    schema: &Schema,
    r: &mut Reader,
    node_def: u32,
) -> Result<Option<Guid>> {
    let def = schema.def(node_def);
    let mut guid = None;
    loop {
        let id = r.var_uint()?;
        if id == 0 {
            return Ok(guid);
        }
        let field = def
            .field_by_id(id)
            .ok_or_else(|| corrupt(format!("kiwi: {} has no field {id}", def.name)))?;
        if field.name == "guid" {
            if let Value::Msg(m) = decoder.field(r, field, 0)? {
                let uint = |name| match m.get(schema, name) {
                    Some(Value::Uint(v)) => *v,
                    _ => 0,
                };
                guid = Some(Guid {
                    session: uint("sessionID"),
                    local: uint("localID"),
                });
            }
        } else {
            decoder.skip_field(r, field, 0)?;
        }
    }
}

/// Writes the edited document as a `.fig` file. `original` is the file it
/// was opened from. Records of unedited nodes are copied byte for byte;
/// only edited ones are decoded and re-encoded.
pub fn save(doc: &Document, original: &[u8]) -> Result<Vec<u8>> {
    let container = Container::open_without_images(original)?;
    let schema = Schema::decode(&container.schema)?;
    let b = Build { schema: &schema };
    let message_def = b
        .def("Message")
        .ok_or_else(|| corrupt("the schema has no Message type"))?;
    let node_def = b
        .sub(message_def, "nodeChanges")
        .ok_or_else(|| corrupt("the schema has no node changes"))?;
    let blob_def = b.sub(message_def, "blobs");
    let decoder = Decoder::new(&schema);

    let mut plans: HashMap<Guid, Plan> = HashMap::new();
    let mut sources: HashMap<Guid, Option<Msg>> = HashMap::new();
    for (k, node) in doc.nodes.iter().enumerate() {
        let Some(guid) = node.props.guid else {
            continue;
        };
        if node.edits == 0 {
            continue;
        }
        if node.edits & flags::CREATED != 0 {
            if !node.removed
                && let Some(s) = node.source
            {
                sources.insert(s, None);
            }
            continue;
        }
        plans.insert(
            guid,
            if node.removed {
                Plan::Drop
            } else {
                Plan::Patch(k)
            },
        );
    }

    let data = container.message.as_slice();
    let mut r = Reader::new(data);
    let mut out = Writer::default();
    let def = schema.def(message_def);
    let mut wrote_blobs = false;
    let new_blobs = || -> Vec<u8> {
        let mut w = Writer::default();
        if let Some(blob_def) = blob_def {
            for k in doc.original_blobs..doc.blobs.len() {
                let mut m = Msg::new(blob_def);
                m.set(
                    &schema,
                    "bytes",
                    Value::Bytes(doc.blobs.bytes(k as u32).unwrap_or_default().into()),
                );
                schema.encode(&m, &mut w);
            }
        }
        w.bytes
    };
    loop {
        let start = r.at;
        let id = r.var_uint()?;
        if id == 0 {
            break;
        }
        let field = def
            .field_by_id(id)
            .ok_or_else(|| corrupt(format!("kiwi: Message has no field {id}")))?;
        if field.array && field.name == "nodeChanges" {
            let count = r.var_uint()? as usize;
            let mut records = Writer::default();
            let mut written = 0u32;
            for _ in 0..count {
                let rs = r.at;
                let guid = scan_guid(&decoder, &schema, &mut r, node_def)?;
                let raw = &data[rs..r.at];
                let decode = || decoder.decode(&mut Reader::new(raw), node_def);
                if let Some(g) = guid
                    && let Some(slot) = sources.get_mut(&g)
                {
                    let m = decode()?;
                    match slot {
                        // A later record for the same node updates it.
                        Some(base) => {
                            for (i, v) in m.fields {
                                let name = schema.def(node_def).fields[i as usize].name.clone();
                                base.set(&schema, &name, v);
                            }
                        }
                        None => *slot = Some(m),
                    }
                }
                match guid.and_then(|g| plans.get(&g)) {
                    Some(Plan::Drop) => {}
                    Some(Plan::Patch(k)) => {
                        let mut m = decode()?;
                        let node = &doc.nodes[*k];
                        b.patch(&mut m, node, doc, node.edits);
                        schema.encode(&m, &mut records);
                        written += 1;
                    }
                    None => {
                        records.bytes.extend_from_slice(raw);
                        written += 1;
                    }
                }
            }
            for node in &doc.nodes {
                if node.edits & flags::CREATED == 0 || node.removed {
                    continue;
                }
                let Some(guid) = node.props.guid else {
                    continue;
                };
                let record = match node.source.and_then(|s| sources.get(&s).cloned().flatten()) {
                    Some(mut base) => {
                        b.guid_field(&mut base, "guid", guid);
                        base.remove(&schema, "overrideKey");
                        b.patch(&mut base, node, doc, node.edits);
                        base
                    }
                    None => b.create(node_def, node, doc),
                };
                schema.encode(&record, &mut records);
                written += 1;
            }
            out.var_uint(id);
            out.var_uint(written);
            out.bytes.extend_from_slice(&records.bytes);
        } else if field.array && field.name == "blobs" {
            let count = r.var_uint()?;
            let rs = r.at;
            for _ in 0..count {
                decoder.skip(&mut r, field.ty, 0)?;
            }
            let added = (doc.blobs.len() - doc.original_blobs) as u32;
            out.var_uint(id);
            out.var_uint(count + added);
            out.bytes.extend_from_slice(&data[rs..r.at]);
            out.bytes.extend_from_slice(&new_blobs());
            wrote_blobs = true;
        } else {
            decoder.skip_field(&mut r, field, 0)?;
            out.bytes.extend_from_slice(&data[start..r.at]);
        }
    }
    if !wrote_blobs
        && doc.blobs.len() > doc.original_blobs
        && let Some(f) = def.fields.iter().find(|f| f.name == "blobs")
    {
        out.var_uint(f.id);
        out.var_uint((doc.blobs.len() - doc.original_blobs) as u32);
        out.bytes.extend_from_slice(&new_blobs());
    }
    out.var_uint(0);
    let canvas = document_bytes(container.version, &container.schema, &out.bytes);
    Ok(package(doc, &canvas, container.meta.as_ref()))
}

/// `fig-kiwi` header and the deflated schema and message chunks.
fn document_bytes(version: u32, schema: &[u8], message: &[u8]) -> Vec<u8> {
    let mut out = b"fig-kiwi".to_vec();
    out.extend_from_slice(&version.to_le_bytes());
    for chunk in [schema, message] {
        // Fast deflate: big files' messages are tens of megabytes.
        let compressed = miniz_oxide::deflate::compress_to_vec(chunk, 1);
        out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        out.extend_from_slice(&compressed);
    }
    out
}

/// The ZIP around a document: meta, thumbnail, and images.
fn package(doc: &Document, canvas: &[u8], meta: Option<&serde_json::Value>) -> Vec<u8> {
    let mut meta = meta.cloned().unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = meta.as_object_mut() {
        obj.insert(
            "file_name".into(),
            serde_json::Value::String(doc.file_name.clone().unwrap_or_else(|| "Untitled".into())),
        );
    }
    let meta_bytes = serde_json::to_vec(&meta).unwrap_or_default();
    let thumb = thumbnail(doc).unwrap_or_default();
    let mut names: Vec<(String, &[u8])> = vec![
        ("canvas.fig".into(), canvas),
        ("meta.json".into(), meta_bytes.as_slice()),
    ];
    if !thumb.is_empty() {
        names.push(("thumbnail.png".into(), thumb.as_slice()));
    }
    let mut hashes: Vec<&String> = doc.images.keys().collect();
    hashes.sort();
    for h in hashes {
        names.push((format!("images/{h}"), &doc.images[h]));
    }
    let entries: Vec<(&str, &[u8])> = names.iter().map(|(n, b)| (n.as_str(), *b)).collect();
    crate::zip::write_stored(&entries)
}

/// A render of the first page's content, at most 400 px wide, as Figma
/// stores for file previews.
pub fn thumbnail(doc: &Document) -> Option<Vec<u8>> {
    let &page = doc.pages.first()?;
    let scene = Scene::build(doc, page);
    let bounds = scene.node(scene.root()).bounds;
    if bounds.is_empty() {
        return None;
    }
    let scale = (400.0 / bounds.w).min(300.0 / bounds.h).min(2.0);
    let pixmap = render::render(
        doc,
        &scene,
        &mut ImageStore::default(),
        &Viewport {
            x: bounds.x,
            y: bounds.y,
            scale,
            width: ((bounds.w * scale).ceil() as u32).max(1),
            height: ((bounds.h * scale).ceil() as u32).max(1),
        },
        RenderOptions {
            outline: false,
            background: Some(doc.page_background(page)),
        },
    )?;
    Some(encode_png(&pixmap))
}

/// A new design: one empty page named "Page 1", on Figma's canvas gray.
pub fn blank(name: &str) -> Vec<u8> {
    let schema_bytes = schema_from_text(MACRO_SCHEMA);
    let schema = Schema::decode(&schema_bytes).expect("the built-in schema decodes");
    let b = Build { schema: &schema };
    let node_def = b.def("NodeChange").expect("NodeChange");
    let message_def = b.def("Message").expect("Message");
    let node = |guid: Guid, parent: Option<Guid>, t: &str, name: &str, position: &str| {
        let mut m = Msg::new(node_def);
        b.guid_field(&mut m, "guid", guid);
        b.set_enum(&mut m, "phase", "CREATED");
        b.set_enum(&mut m, "type", t);
        m.set(&schema, "name", Value::Str(name.into()));
        m.set(&schema, "visible", Value::Bool(true));
        m.set(&schema, "opacity", Value::Float(1.0));
        if let Some(p) = parent {
            b.msg_field(&mut m, "parentIndex", |b2, pm| {
                if let Some(gdef) = b2.sub(pm.def, "guid") {
                    let gm = b2.guid(gdef, p);
                    pm.set(b2.schema, "guid", Value::Msg(Box::new(gm)));
                }
                pm.set(b2.schema, "position", Value::Str(position.into()));
            });
        }
        m
    };
    let root = Guid {
        session: 0,
        local: 0,
    };
    let page = Guid {
        session: 0,
        local: 1,
    };
    let doc_node = node(root, None, "DOCUMENT", "Document", "");
    let mut page_node = node(page, Some(root), "CANVAS", "Page 1", "!");
    b.color(
        &mut page_node,
        "backgroundColor",
        Color {
            r: 0.961,
            g: 0.961,
            b: 0.961,
            a: 1.0,
        },
    );
    let mut message = Msg::new(message_def);
    b.set_enum(&mut message, "type", "NODE_CHANGES");
    message.set(
        &schema,
        "nodeChanges",
        Value::List(vec![
            Value::Msg(Box::new(doc_node)),
            Value::Msg(Box::new(page_node)),
        ]),
    );
    message.set(&schema, "blobs", Value::List(Vec::new()));
    let mut w = Writer::default();
    schema.encode(&message, &mut w);
    let canvas = document_bytes(MACRO_VERSION, &schema_bytes, &w.bytes);
    let meta = serde_json::json!({ "file_name": name, "client_meta": { "background_color": { "r": 0.961, "g": 0.961, "b": 0.961, "a": 1.0 } } });
    let meta_bytes = serde_json::to_vec(&meta).unwrap_or_default();
    crate::zip::write_stored(&[("canvas.fig", &canvas), ("meta.json", &meta_bytes)])
}

#[cfg(test)]
mod test;
