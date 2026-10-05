//! Writing node entries.

use super::{
    BlobRef, ENTRY_VERSION, NodeState, enc_align, enc_blend, enc_effect, enc_gradient, enc_mask,
    enc_node_type, enc_prop_field, enc_scale_mode, enc_style_type, enc_variable_type, enc_winding,
};
use crate::model::{
    Action, Affine, AutoLayout, Axis, Baseline, Color, ColorStop, CornerRadii, Decoration, Effect,
    ExportConstraint, ExportFormat, ExportSetting, FlowStart, Glyph, GridAlign, GridPattern, Guid,
    Guide, ImageFilters, ImagePaint, Interaction, LayoutChild, LayoutGrid, LibraryLink,
    OverlaySettings, Paint, PaintKind, PathRef, PropAssignment, PropDef, PropRef, PropValue, Props,
    StyleRun, SymbolData, TextContent, TextLayout, TextStyle, Variable, VariableMode,
    VariableValue, VariantOrder, VariantSpec, Vec2, VectorData,
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
            w.u32(p.style);
        });
    }

    fn paint(&mut self, p: &Paint) {
        let Paint {
            kind,
            opacity,
            visible,
            blend_mode,
            color_var,
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
        self.opt(color_var, |w, g| w.guid(g));
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
        self.list(styles, |w, run| w.style_run(run));
    }

    fn style_run(&mut self, run: &StyleRun) {
        let StyleRun {
            id,
            fills,
            font_family,
            font_style,
            font_size,
            decoration,
            letter_spacing,
            line_height,
            case,
        } = run;
        self.u32(*id);
        self.opt(fills, |w, f| w.paints(f));
        self.opt_str(font_family);
        self.opt_str(font_style);
        self.opt(font_size, |w, s| w.f32(*s));
        self.opt_str(decoration);
        for m in [letter_spacing, line_height] {
            self.opt(m, |w, (v, unit)| {
                w.f32(*v);
                w.str(unit);
            });
        }
        self.opt_str(case);
    }

    fn text_layout(&mut self, t: &TextLayout) {
        let TextLayout {
            glyphs,
            decorations,
            layout_size,
            lines,
            truncated_at,
            first_baseline,
            baselines,
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
        self.opt(truncated_at, |w, v| w.u32(*v));
        self.opt(first_baseline, |w, v| w.f32(*v));
        self.list(baselines, |w, b| {
            let Baseline {
                first_char,
                end_char,
                x,
                y,
                width,
                line_y,
                line_height,
                line_ascent,
            } = b;
            w.u32(*first_char);
            w.u32(*end_char);
            for v in [x, y, width, line_y, line_height, line_ascent] {
                w.f32(*v);
            }
        });
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

    fn export_setting(&mut self, e: &ExportSetting) {
        let ExportSetting {
            format,
            suffix,
            constraint,
            value,
            svg_outline_text,
            svg_include_id,
            contents_only,
            use_absolute_bounds,
            quality,
        } = e;
        self.u8(match format {
            ExportFormat::Png => 0,
            ExportFormat::Jpeg => 1,
            ExportFormat::Svg => 2,
            ExportFormat::Pdf => 3,
        });
        self.str(suffix);
        self.u8(match constraint {
            ExportConstraint::ContentScale => 0,
            ExportConstraint::ContentWidth => 1,
            ExportConstraint::ContentHeight => 2,
        });
        self.f32(*value);
        self.bool(*svg_outline_text);
        self.bool(*svg_include_id);
        self.bool(*contents_only);
        self.bool(*use_absolute_bounds);
        self.u8(*quality);
    }

    fn axis(&mut self, a: Axis) {
        self.bool(a == Axis::Y);
    }

    fn layout_grid(&mut self, g: &LayoutGrid) {
        let LayoutGrid {
            pattern,
            axis,
            align,
            visible,
            count,
            offset,
            section_size,
            gutter,
            color,
        } = g;
        self.bool(*pattern == GridPattern::Grid);
        self.axis(*axis);
        self.u8(match align {
            GridAlign::Min => 0,
            GridAlign::Center => 1,
            GridAlign::Stretch => 2,
            GridAlign::Max => 3,
        });
        self.bool(*visible);
        self.var(u64::from(*count as u32));
        self.f32(*offset);
        self.f32(*section_size);
        self.f32(*gutter);
        self.color(color);
    }

    fn ruler_guide(&mut self, g: &Guide) {
        let Guide { axis, offset, guid } = g;
        self.axis(*axis);
        self.f32(*offset);
        self.opt(guid, |w, g| w.guid(g));
    }

    fn interaction(&mut self, i: &Interaction) {
        let Interaction {
            id,
            trigger,
            timeout,
            actions,
        } = i;
        self.opt(id, |w, g| w.guid(g));
        self.str(trigger);
        self.opt(timeout, |w, v| w.f32(*v));
        self.list(actions, |w, a| {
            let Action {
                connection,
                navigation,
                destination,
                transition,
                duration,
                easing,
                url,
                open_in_new_tab,
                overlay_offset,
            } = a;
            w.str(connection);
            w.str(navigation);
            w.opt(destination, |w, g| w.guid(g));
            w.str(transition);
            w.f32(*duration);
            w.opt_str(easing);
            w.opt_str(url);
            w.opt(open_in_new_tab, |w, v| w.bool(*v));
            w.opt(overlay_offset, |w, v| w.vec2(v));
        });
    }

    fn props_list(&mut self, list: &[Props]) {
        self.list(list, |w, p| w.props(p));
    }

    fn variable(&mut self, v: &Variable) {
        let Variable {
            set,
            resolved_type,
            values,
        } = v;
        self.opt(set, |w, g| w.guid(g));
        self.u8(enc_variable_type(*resolved_type));
        self.list(values, |w, (mode, value)| {
            w.guid(mode);
            match value {
                VariableValue::Color(c) => {
                    w.u8(0);
                    w.color(c);
                }
                VariableValue::Float(f) => {
                    w.u8(1);
                    w.f32(*f);
                }
                VariableValue::Text(t) => {
                    w.u8(2);
                    w.str(t);
                }
                VariableValue::Bool(b) => {
                    w.u8(3);
                    w.bool(*b);
                }
                VariableValue::Alias(g) => {
                    w.u8(4);
                    w.guid(g);
                }
                VariableValue::Other => w.u8(5),
            }
        });
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
            vector_data,
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
            variable,
            variable_modes,
            mode_by_set,
            generated,
            vector_styles,
            layout_grids,
            guides,
            interactions,
            flow_start,
            overlay,
            prototype_start,
            library,
            macro_data,
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
            w.list(list, Self::export_setting)
        });
        self.opt_str(boolean_operation);
        self.opt(vector_data, |w, v| {
            let VectorData {
                network_blob,
                normalized_size,
            } = **v;
            w.opt(&network_blob, |w, b| w.blob(*b));
            w.opt(&normalized_size, |w, s| w.vec2(s));
        });
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
        self.opt(variable, |w, v| w.variable(v));
        self.opt(variable_modes, |w, list| {
            w.list(list, |w, m| {
                let VariableMode { id, name } = m;
                w.guid(id);
                w.str(name);
            });
        });
        self.opt(mode_by_set, |w, list| {
            w.list(list, |w, (set, mode)| {
                w.guid(set);
                w.guid(mode);
            });
        });
        self.opt(generated, |w, d| w.props_list(d));
        self.opt(vector_styles, |w, list| {
            w.list(list, |w, run| w.style_run(run))
        });
        self.opt(layout_grids, |w, list| w.list(list, Self::layout_grid));
        self.opt(guides, |w, list| w.list(list, Self::ruler_guide));
        self.opt(interactions, |w, list| {
            w.list(list, |w, i| w.interaction(i))
        });
        self.opt(flow_start, |w, f| {
            let FlowStart {
                name,
                description,
                position,
            } = &**f;
            w.str(name);
            w.str(description);
            w.str(position);
        });
        self.opt(overlay, |w, o| {
            let OverlaySettings {
                position,
                close_on_click_outside,
                background,
            } = &**o;
            w.str(position);
            w.bool(*close_on_click_outside);
            w.opt(background, |w, c| w.color(c));
        });
        self.opt(prototype_start, |w, g| w.guid(g));
        self.opt(library, |w, l| {
            let LibraryLink {
                publishable,
                version,
                published_version,
                source,
                publish_id,
            } = &**l;
            w.opt(publishable, |w, v| w.bool(*v));
            w.opt_str(version);
            w.opt_str(published_version);
            w.opt_str(source);
            w.opt(publish_id, |w, g| w.guid(g));
        });
        self.opt(macro_data, |w, list| {
            w.list(list, |w, (k, v)| {
                w.str(k);
                w.str(v);
            });
        });
        self.bool(*recomputed);
    }

    /// The finished entry: version, the shared blob keys it uses, and the
    /// body.
    pub fn node(mut self, state: &NodeState) -> Vec<u8> {
        self.props(&state.props);
        self.bool(state.removed);
        self.bool(state.listed);
        self.var(state.edits);
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
