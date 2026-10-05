//! Writing node entries.

use super::{
    BlobRef, ENTRY_VERSION, NodeState, enc_align, enc_blend, enc_effect, enc_gradient, enc_mask,
    enc_node_type, enc_prop_field, enc_scale_mode, enc_style_type, enc_winding,
};
use crate::model::{
    Affine, AutoLayout, Color, ColorStop, CornerRadii, Decoration, Effect, ExportSetting, Glyph,
    Guid, ImageFilters, ImagePaint, LayoutChild, Paint, PaintKind, PathRef, PropAssignment,
    PropDef, PropRef, PropValue, Props, StyleRun, SymbolData, TextContent, TextLayout, TextStyle,
    VariantOrder, VariantSpec, Vec2,
};
use std::sync::Arc;

/// Writes entries; `blob` maps a document blob index to its reference.
pub struct Writer<'a> {
    out: Vec<u8>,
    keys: Vec<Arc<str>>,
    blob: &'a mut dyn FnMut(u32) -> BlobRef,
}

impl<'a> Writer<'a> {
    pub fn new(blob: &'a mut dyn FnMut(u32) -> BlobRef) -> Self {
        Self {
            out: Vec::new(),
            keys: Vec::new(),
            blob,
        }
    }

    fn u8(&mut self, v: u8) {
        self.out.push(v);
    }

    fn bool(&mut self, v: bool) {
        self.u8(u8::from(v));
    }

    fn var(&mut self, mut v: u64) {
        loop {
            let byte = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                self.out.push(byte);
                return;
            }
            self.out.push(byte | 0x80);
        }
    }

    fn u32(&mut self, v: u32) {
        self.var(u64::from(v));
    }

    fn len(&mut self, n: usize) {
        self.var(n as u64);
    }

    fn f32(&mut self, v: f32) {
        self.out.extend_from_slice(&v.to_bits().to_le_bytes());
    }

    fn f64(&mut self, v: f64) {
        self.out.extend_from_slice(&v.to_bits().to_le_bytes());
    }

    fn str(&mut self, s: &str) {
        self.len(s.len());
        self.out.extend_from_slice(s.as_bytes());
    }

    fn opt<T>(&mut self, v: &Option<T>, f: impl FnOnce(&mut Self, &T)) {
        match v {
            Some(v) => {
                self.u8(1);
                f(self, v);
            }
            None => self.u8(0),
        }
    }

    fn list<T>(&mut self, items: &[T], mut f: impl FnMut(&mut Self, &T)) {
        self.len(items.len());
        for item in items {
            f(self, item);
        }
    }

    fn guid(&mut self, g: &Guid) {
        self.u32(g.session);
        self.u32(g.local);
    }

    fn vec2(&mut self, v: &Vec2) {
        self.f64(v.x);
        self.f64(v.y);
    }

    fn affine(&mut self, t: &Affine) {
        for v in [t.m00, t.m01, t.m02, t.m10, t.m11, t.m12] {
            self.f64(v);
        }
    }

    fn color(&mut self, c: &Color) {
        for v in [c.r, c.g, c.b, c.a] {
            self.f32(v);
        }
    }

    fn blob(&mut self, index: u32) {
        match (self.blob)(index) {
            BlobRef::Base(i) => {
                self.u8(0);
                self.u32(i);
            }
            BlobRef::Shared(key) => {
                let at = match self.keys.iter().position(|k| *k == key) {
                    Some(at) => at,
                    None => {
                        self.keys.push(key);
                        self.keys.len() - 1
                    }
                };
                self.u8(1);
                self.len(at);
            }
        }
    }

    fn paths(&mut self, paths: &[PathRef]) {
        self.list(paths, |w, p| {
            w.u8(enc_winding(p.winding));
            w.blob(p.blob);
        });
    }

    fn paint(&mut self, p: &Paint) {
        let Paint {
            kind,
            opacity,
            visible,
            blend_mode,
        } = p;
        match kind {
            PaintKind::Solid(c) => {
                self.u8(0);
                self.color(c);
            }
            PaintKind::Gradient {
                kind,
                stops,
                transform,
            } => {
                self.u8(1);
                self.u8(enc_gradient(*kind));
                self.list(stops, |w, s| {
                    let ColorStop { color, position } = s;
                    w.color(color);
                    w.f32(*position);
                });
                self.affine(transform);
            }
            PaintKind::Image(img) => {
                let ImagePaint {
                    hash,
                    scale_mode,
                    transform,
                    scale,
                    rotation,
                    filters,
                    original_size,
                } = img;
                self.u8(2);
                self.opt(hash, |w, h| w.str(h));
                self.u8(enc_scale_mode(*scale_mode));
                self.affine(transform);
                self.f32(*scale);
                self.f32(*rotation);
                let ImageFilters {
                    exposure,
                    contrast,
                    saturation,
                    temperature,
                    tint,
                    highlights,
                    shadows,
                } = filters;
                for v in [
                    exposure,
                    contrast,
                    saturation,
                    temperature,
                    tint,
                    highlights,
                    shadows,
                ] {
                    self.f32(*v);
                }
                self.opt(original_size, |w, s| w.vec2(s));
            }
            PaintKind::Unsupported(name) => {
                self.u8(3);
                self.str(name);
            }
        }
        self.f32(*opacity);
        self.bool(*visible);
        self.u8(enc_blend(*blend_mode));
    }

    fn paints(&mut self, paints: &[Paint]) {
        self.list(paints, |w, p| w.paint(p));
    }

    fn effect(&mut self, e: &Effect) {
        let Effect {
            kind,
            visible,
            color,
            offset,
            radius,
            spread,
            blend_mode,
            show_behind_node,
        } = e;
        self.u8(enc_effect(*kind));
        self.bool(*visible);
        self.color(color);
        self.vec2(offset);
        self.f32(*radius);
        self.f32(*spread);
        self.u8(enc_blend(*blend_mode));
        self.bool(*show_behind_node);
    }

    fn opt_str(&mut self, s: &Option<impl AsRef<str>>) {
        self.opt(s, |w, s| w.str(s.as_ref()));
    }

    fn text_content(&mut self, t: &TextContent) {
        let TextContent {
            characters,
            style_ids,
            styles,
        } = t;
        self.str(characters);
        self.list(style_ids, |w, id| w.u32(*id));
        self.list(styles, |w, run| {
            let StyleRun {
                id,
                fills,
                font_family,
                font_style,
                font_size,
                decoration,
            } = run;
            w.u32(*id);
            w.opt(fills, |w, f| w.paints(f));
            w.opt_str(font_family);
            w.opt_str(font_style);
            w.opt(font_size, |w, s| w.f32(*s));
            w.opt_str(decoration);
        });
    }

    fn text_layout(&mut self, t: &TextLayout) {
        let TextLayout {
            glyphs,
            decorations,
            layout_size,
            lines,
            first_baseline,
        } = t;
        self.list(glyphs, |w, g| {
            let Glyph {
                blob,
                x,
                y,
                font_size,
                style_id,
                first_char,
                advance,
                rotation,
                emoji,
            } = g;
            w.opt(blob, |w, b| w.blob(*b));
            w.f32(*x);
            w.f32(*y);
            w.f32(*font_size);
            w.u32(*style_id);
            w.u32(*first_char);
            w.f32(*advance);
            w.f32(*rotation);
            w.opt(emoji, |w, e| w.list(e, |w, c| w.u32(*c)));
        });
        self.list(decorations, |w, d| {
            let Decoration { rects, style_id } = d;
            w.list(rects, |w, r| {
                for v in r {
                    w.f32(*v);
                }
            });
            w.u32(*style_id);
        });
        self.opt(layout_size, |w, s| w.vec2(s));
        self.u32(*lines);
        self.opt(first_baseline, |w, v| w.f32(*v));
    }

    fn text_style(&mut self, t: &TextStyle) {
        let TextStyle {
            font_family,
            font_style,
            font_size,
            line_height,
            letter_spacing,
            paragraph_spacing,
            align_horizontal,
            align_vertical,
            decoration,
            case,
            auto_resize,
        } = t;
        self.opt_str(font_family);
        self.opt_str(font_style);
        self.opt(font_size, |w, v| w.f32(*v));
        for m in [line_height, letter_spacing] {
            self.opt(m, |w, (v, unit)| {
                w.f32(*v);
                w.str(unit);
            });
        }
        self.opt(paragraph_spacing, |w, v| w.f32(*v));
        for s in [
            align_horizontal,
            align_vertical,
            decoration,
            case,
            auto_resize,
        ] {
            self.opt_str(s);
        }
    }

    fn auto_layout(&mut self, a: &AutoLayout) {
        let AutoLayout {
            mode,
            spacing,
            padding_top,
            padding_right,
            padding_bottom,
            padding_left,
            primary_align,
            counter_align,
            wrap,
            primary_sizing,
            counter_sizing,
            counter_spacing,
            reverse_z,
            strokes_in_layout,
        } = a;
        self.str(mode);
        for v in [
            spacing,
            padding_top,
            padding_right,
            padding_bottom,
            padding_left,
        ] {
            self.f32(*v);
        }
        self.opt_str(primary_align);
        self.opt_str(counter_align);
        self.bool(*wrap);
        self.opt_str(primary_sizing);
        self.opt_str(counter_sizing);
        self.f32(*counter_spacing);
        self.bool(*reverse_z);
        self.bool(*strokes_in_layout);
    }

    fn layout_child(&mut self, c: &LayoutChild) {
        let LayoutChild {
            grow,
            align,
            absolute,
            min_size,
            max_size,
        } = c;
        self.opt(grow, |w, v| w.f32(*v));
        self.opt_str(align);
        self.opt(absolute, |w, v| w.bool(*v));
        self.opt(min_size, |w, v| w.vec2(v));
        self.opt(max_size, |w, v| w.vec2(v));
    }

    fn props_list(&mut self, list: &[Props]) {
        self.list(list, |w, p| w.props(p));
    }

    fn prop_value(&mut self, value: &PropValue) {
        match value {
            PropValue::Bool(b) => {
                self.u8(0);
                self.bool(*b);
            }
            PropValue::Text(t) => {
                self.u8(1);
                self.str(t);
            }
            PropValue::Symbol(g) => {
                self.u8(2);
                self.guid(g);
            }
            PropValue::Other => self.u8(3),
        }
    }

    /// Every field of `p`.
    pub fn props(&mut self, p: &Props) {
        let Props {
            guid,
            parent,
            position,
            node_type,
            name,
            visible,
            locked,
            opacity,
            blend_mode,
            size,
            transform,
            mask,
            mask_type,
            fills,
            strokes,
            stroke_weight,
            stroke_sides,
            stroke_align,
            stroke_cap,
            stroke_join,
            dash_pattern,
            fill_geometry,
            stroke_geometry,
            effects,
            corner_radius,
            corner_radii,
            corner_smoothing,
            clip_disabled,
            background_color,
            internal_only,
            text_content,
            text_layout,
            text_style,
            symbol,
            derived,
            swapped_symbol,
            prop_assignments,
            prop_refs,
            prop_defs,
            guid_path,
            override_key,
            auto_layout,
            layout_child,
            export_settings,
            boolean_operation,
            constraints,
            description,
            is_state_group,
            fill_style,
            stroke_style,
            effect_style,
            text_style_id,
            key,
            style_type,
            sort_position,
            soft_deleted,
            variant_specs,
            variant_orders,
            props_bubbled,
            recomputed,
        } = p;
        self.opt(guid, |w, g| w.guid(g));
        self.opt(parent, |w, g| w.guid(g));
        self.opt_str(position);
        self.opt(node_type, |w, t| w.u8(enc_node_type(*t)));
        self.opt_str(name);
        for b in [visible, locked] {
            self.opt(b, |w, v| w.bool(*v));
        }
        self.opt(opacity, |w, v| w.f32(*v));
        self.opt(blend_mode, |w, v| w.u8(enc_blend(*v)));
        self.opt(size, |w, v| w.vec2(v));
        self.opt(transform, |w, t| w.affine(t));
        self.opt(mask, |w, v| w.bool(*v));
        self.opt(mask_type, |w, v| w.u8(enc_mask(*v)));
        self.opt(fills, |w, v| w.paints(v));
        self.opt(strokes, |w, v| w.paints(v));
        self.opt(stroke_weight, |w, v| w.f32(*v));
        self.opt(stroke_sides, |w, s| {
            for v in s {
                w.f32(*v);
            }
        });
        self.opt(stroke_align, |w, v| w.u8(enc_align(*v)));
        self.opt_str(stroke_cap);
        self.opt_str(stroke_join);
        self.opt(dash_pattern, |w, v| w.list(v, |w, d| w.f32(*d)));
        self.opt(fill_geometry, |w, v| w.paths(v));
        self.opt(stroke_geometry, |w, v| w.paths(v));
        self.opt(effects, |w, v| w.list(v, |w, e| w.effect(e)));
        self.opt(corner_radius, |w, v| w.f32(*v));
        self.opt(corner_radii, |w, r| {
            let CornerRadii {
                top_left,
                top_right,
                bottom_right,
                bottom_left,
            } = r;
            for v in [top_left, top_right, bottom_right, bottom_left] {
                w.f32(*v);
            }
        });
        self.opt(corner_smoothing, |w, v| w.f32(*v));
        self.opt(clip_disabled, |w, v| w.bool(*v));
        self.opt(background_color, |w, c| w.color(c));
        self.opt(internal_only, |w, v| w.bool(*v));
        self.opt(text_content, |w, t| w.text_content(t));
        self.opt(text_layout, |w, t| w.text_layout(t));
        self.opt(text_style, |w, t| w.text_style(t));
        self.opt(symbol, |w, s| {
            let SymbolData {
                symbol_id,
                overrides,
                uniform_scale,
            } = &**s;
            w.opt(symbol_id, |w, g| w.guid(g));
            w.props_list(overrides);
            w.opt(uniform_scale, |w, v| w.f32(*v));
        });
        self.opt(derived, |w, d| w.props_list(d));
        self.opt(swapped_symbol, |w, g| w.guid(g));
        self.opt(prop_assignments, |w, list| {
            w.list(list, |w, a| {
                let PropAssignment { def_id, value } = a;
                w.guid(def_id);
                w.prop_value(value);
            });
        });
        self.opt(prop_refs, |w, list| {
            w.list(list, |w, r| {
                let PropRef { def_id, field } = r;
                w.guid(def_id);
                w.u8(enc_prop_field(*field));
            });
        });
        self.opt(prop_defs, |w, list| {
            w.list(list, |w, d| {
                let PropDef {
                    id,
                    name,
                    kind,
                    initial,
                    preferred,
                } = d;
                w.guid(id);
                w.str(name);
                w.str(kind);
                w.opt(initial, |w, v| w.prop_value(v));
                w.list(preferred, |w, k| w.str(k));
            });
        });
        self.opt(guid_path, |w, path| w.list(path, |w, g| w.guid(g)));
        self.opt(override_key, |w, g| w.guid(g));
        self.opt(auto_layout, |w, a| w.auto_layout(a));
        self.opt(layout_child, |w, c| w.layout_child(c));
        self.opt(export_settings, |w, list| {
            w.list(list, |w, e| {
                let ExportSetting {
                    format,
                    suffix,
                    constraint,
                    value,
                } = e;
                w.str(format);
                w.str(suffix);
                w.str(constraint);
                w.f32(*value);
            });
        });
        self.opt_str(boolean_operation);
        self.opt(constraints, |w, (h, v)| {
            w.str(h);
            w.str(v);
        });
        self.opt_str(description);
        self.opt(is_state_group, |w, v| w.bool(*v));
        for g in [fill_style, stroke_style, effect_style, text_style_id] {
            self.opt(g, |w, g| w.guid(g));
        }
        self.opt_str(key);
        self.opt(style_type, |w, t| w.u8(enc_style_type(*t)));
        self.opt_str(sort_position);
        self.opt(soft_deleted, |w, v| w.bool(*v));
        self.opt(variant_specs, |w, list| {
            w.list(list, |w, s| {
                let VariantSpec { def_id, value } = s;
                w.guid(def_id);
                w.str(value);
            });
        });
        self.opt(variant_orders, |w, list| {
            w.list(list, |w, o| {
                let VariantOrder { property, values } = o;
                w.str(property);
                w.list(values, |w, v| w.str(v));
            });
        });
        self.opt(props_bubbled, |w, v| w.bool(*v));
        self.bool(*recomputed);
    }

    /// The finished entry: version, the shared blob keys it uses, and the
    /// body.
    pub fn node(mut self, state: &NodeState) -> Vec<u8> {
        self.props(&state.props);
        self.bool(state.removed);
        self.bool(state.listed);
        self.u32(state.edits);
        self.opt(&state.source, |w, g| w.guid(g));
        let body = std::mem::take(&mut self.out);
        let keys = std::mem::take(&mut self.keys);
        self.u8(ENTRY_VERSION);
        self.len(keys.len());
        for k in &keys {
            self.str(k);
        }
        self.out.extend_from_slice(&body);
        self.out
    }
}
