//! Reading node entries.

use super::{
    BlobRef, DecodeError, Decoded, ENTRY_VERSION, NodeState, UNSUPPORTED_PAINTS, dec_align,
    dec_blend, dec_effect, dec_gradient, dec_mask, dec_node_type, dec_prop_field, dec_scale_mode,
    dec_winding,
};
use crate::model::{
    Action, Affine, AutoLayout, Baseline, Color, ColorStop, CornerRadii, Decoration, Effect,
    ExportSetting, FlowStart, Glyph, Guid, ImageFilters, ImagePaint, Interaction, LayoutChild,
    OverlaySettings, Paint, PaintKind, PathRef, PropAssignment, PropDef, PropRef, PropValue, Props,
    StyleRun, SymbolData, TextContent, TextLayout, TextStyle, Vec2, VectorData,
};
use std::sync::Arc;

/// Reads entries; `blob` resolves a reference to a document blob index.
pub struct Reader<'a> {
    data: &'a [u8],
    at: usize,
    keys: Vec<Arc<str>>,
    blob: &'a dyn Fn(&BlobRef) -> Option<u32>,
}

impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8], blob: &'a dyn Fn(&BlobRef) -> Option<u32>) -> Self {
        Self {
            data,
            at: 0,
            keys: Vec::new(),
            blob,
        }
    }

    fn u8(&mut self) -> Decoded<u8> {
        let b = *self.data.get(self.at).ok_or(DecodeError::Invalid)?;
        self.at += 1;
        Ok(b)
    }

    fn bool(&mut self) -> Decoded<bool> {
        Ok(self.u8()? != 0)
    }

    fn var(&mut self) -> Decoded<u64> {
        let mut v = 0u64;
        for shift in (0..64).step_by(7) {
            let b = self.u8()?;
            v |= u64::from(b & 0x7f) << shift;
            if b & 0x80 == 0 {
                return Ok(v);
            }
        }
        Err(DecodeError::Invalid)
    }

    fn u32(&mut self) -> Decoded<u32> {
        u32::try_from(self.var()?).map_err(|_| DecodeError::Invalid)
    }

    fn len(&mut self) -> Decoded<usize> {
        let n = usize::try_from(self.var()?).map_err(|_| DecodeError::Invalid)?;
        // Every item takes at least a byte.
        if n > self.data.len() - self.at {
            return Err(DecodeError::Invalid);
        }
        Ok(n)
    }

    fn take(&mut self, n: usize) -> Decoded<&'a [u8]> {
        let end = self.at.checked_add(n).ok_or(DecodeError::Invalid)?;
        let bytes = self.data.get(self.at..end).ok_or(DecodeError::Invalid)?;
        self.at = end;
        Ok(bytes)
    }

    fn f32(&mut self) -> Decoded<f32> {
        let b = self.take(4)?;
        Ok(f32::from_bits(u32::from_le_bytes([b[0], b[1], b[2], b[3]])))
    }

    fn f64(&mut self) -> Decoded<f64> {
        let b = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(b);
        Ok(f64::from_bits(u64::from_le_bytes(a)))
    }

    fn string(&mut self) -> Decoded<String> {
        let n = self.len()?;
        let bytes = self.take(n)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| DecodeError::Invalid)
    }

    fn arc_str(&mut self) -> Decoded<Arc<str>> {
        Ok(self.string()?.into())
    }

    fn opt<T>(&mut self, f: impl FnOnce(&mut Self) -> Decoded<T>) -> Decoded<Option<T>> {
        match self.u8()? {
            0 => Ok(None),
            1 => f(self).map(Some),
            _ => Err(DecodeError::Invalid),
        }
    }

    fn list<T>(&mut self, mut f: impl FnMut(&mut Self) -> Decoded<T>) -> Decoded<Vec<T>> {
        let n = self.len()?;
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            out.push(f(self)?);
        }
        Ok(out)
    }

    fn arc_list<T>(&mut self, f: impl FnMut(&mut Self) -> Decoded<T>) -> Decoded<Arc<[T]>> {
        Ok(self.list(f)?.into())
    }

    fn guid(&mut self) -> Decoded<Guid> {
        Ok(Guid {
            session: self.u32()?,
            local: self.u32()?,
        })
    }

    fn vec2(&mut self) -> Decoded<Vec2> {
        Ok(Vec2::new(self.f64()?, self.f64()?))
    }

    fn affine(&mut self) -> Decoded<Affine> {
        Ok(Affine {
            m00: self.f64()?,
            m01: self.f64()?,
            m02: self.f64()?,
            m10: self.f64()?,
            m11: self.f64()?,
            m12: self.f64()?,
        })
    }

    fn color(&mut self) -> Decoded<Color> {
        Ok(Color {
            r: self.f32()?,
            g: self.f32()?,
            b: self.f32()?,
            a: self.f32()?,
        })
    }

    fn blob(&mut self) -> Decoded<u32> {
        let reference = match self.u8()? {
            0 => BlobRef::Base(self.u32()?),
            1 => {
                let at = self.len()?;
                BlobRef::Shared(self.keys.get(at).ok_or(DecodeError::Invalid)?.clone())
            }
            _ => return Err(DecodeError::Invalid),
        };
        (self.blob)(&reference).ok_or(match reference {
            BlobRef::Shared(key) => DecodeError::Missing(key),
            BlobRef::Base(_) => DecodeError::Invalid,
        })
    }

    fn paths(&mut self) -> Decoded<Arc<[PathRef]>> {
        self.arc_list(|r| {
            Ok(PathRef {
                winding: dec_winding(r.u8()?),
                blob: r.blob()?,
                style: r.u32()?,
            })
        })
    }

    fn paint(&mut self) -> Decoded<Paint> {
        let kind = match self.u8()? {
            0 => PaintKind::Solid(self.color()?),
            1 => {
                let kind = dec_gradient(self.u8()?);
                let stops = self.arc_list(|r| {
                    Ok(ColorStop {
                        color: r.color()?,
                        position: r.f32()?,
                    })
                })?;
                PaintKind::Gradient {
                    kind,
                    stops,
                    transform: self.affine()?,
                }
            }
            2 => PaintKind::Image(ImagePaint {
                hash: self.opt(Self::arc_str)?,
                scale_mode: dec_scale_mode(self.u8()?),
                transform: self.affine()?,
                scale: self.f32()?,
                rotation: self.f32()?,
                filters: ImageFilters {
                    exposure: self.f32()?,
                    contrast: self.f32()?,
                    saturation: self.f32()?,
                    temperature: self.f32()?,
                    tint: self.f32()?,
                    highlights: self.f32()?,
                    shadows: self.f32()?,
                },
                original_size: self.opt(Self::vec2)?,
            }),
            3 => {
                let name = self.string()?;
                PaintKind::Unsupported(
                    UNSUPPORTED_PAINTS
                        .into_iter()
                        .find(|n| *n == name)
                        .unwrap_or("paint"),
                )
            }
            _ => return Err(DecodeError::Invalid),
        };
        Ok(Paint {
            kind,
            opacity: self.f32()?,
            visible: self.bool()?,
            blend_mode: dec_blend(self.u8()?),
        })
    }

    fn paints(&mut self) -> Decoded<Arc<[Paint]>> {
        self.arc_list(Self::paint)
    }

    fn effect(&mut self) -> Decoded<Effect> {
        Ok(Effect {
            kind: dec_effect(self.u8()?),
            visible: self.bool()?,
            color: self.color()?,
            offset: self.vec2()?,
            radius: self.f32()?,
            spread: self.f32()?,
            blend_mode: dec_blend(self.u8()?),
            show_behind_node: self.bool()?,
        })
    }

    fn opt_arc_str(&mut self) -> Decoded<Option<Arc<str>>> {
        self.opt(Self::arc_str)
    }

    fn opt_string(&mut self) -> Decoded<Option<String>> {
        self.opt(Self::string)
    }

    fn text_content(&mut self) -> Decoded<TextContent> {
        Ok(TextContent {
            characters: self.arc_str()?,
            style_ids: self.arc_list(Self::u32)?,
            styles: self.arc_list(Self::style_run)?,
        })
    }

    fn style_run(&mut self) -> Decoded<StyleRun> {
        Ok(StyleRun {
            id: self.u32()?,
            fills: self.opt(Self::paints)?,
            font_family: self.opt_arc_str()?,
            font_style: self.opt_arc_str()?,
            font_size: self.opt(Self::f32)?,
            decoration: self.opt_arc_str()?,
            letter_spacing: self.opt(|r| Ok((r.f32()?, r.arc_str()?)))?,
            line_height: self.opt(|r| Ok((r.f32()?, r.arc_str()?)))?,
            case: self.opt_arc_str()?,
        })
    }

    fn text_layout(&mut self) -> Decoded<TextLayout> {
        Ok(TextLayout {
            glyphs: self.arc_list(|r| {
                Ok(Glyph {
                    blob: r.opt(Self::blob)?,
                    x: r.f32()?,
                    y: r.f32()?,
                    font_size: r.f32()?,
                    style_id: r.u32()?,
                    first_char: r.u32()?,
                    advance: r.f32()?,
                    rotation: r.f32()?,
                    emoji: r.opt(|r| r.arc_list(Self::u32))?,
                })
            })?,
            decorations: self.arc_list(|r| {
                Ok(Decoration {
                    rects: r.arc_list(|r| Ok([r.f32()?, r.f32()?, r.f32()?, r.f32()?]))?,
                    style_id: r.u32()?,
                })
            })?,
            layout_size: self.opt(Self::vec2)?,
            lines: self.u32()?,
            truncated_at: self.opt(Self::u32)?,
            first_baseline: self.opt(Self::f32)?,
            baselines: self.arc_list(|r| {
                Ok(Baseline {
                    first_char: r.u32()?,
                    end_char: r.u32()?,
                    x: r.f32()?,
                    y: r.f32()?,
                    width: r.f32()?,
                    line_y: r.f32()?,
                    line_height: r.f32()?,
                    line_ascent: r.f32()?,
                })
            })?,
        })
    }

    fn measure(&mut self) -> Decoded<Option<(f32, String)>> {
        self.opt(|r| Ok((r.f32()?, r.string()?)))
    }

    fn text_style(&mut self) -> Decoded<TextStyle> {
        Ok(TextStyle {
            font_family: self.opt_string()?,
            font_style: self.opt_string()?,
            font_size: self.opt(Self::f32)?,
            line_height: self.measure()?,
            letter_spacing: self.measure()?,
            paragraph_spacing: self.opt(Self::f32)?,
            align_horizontal: self.opt_string()?,
            align_vertical: self.opt_string()?,
            decoration: self.opt_string()?,
            case: self.opt_string()?,
            auto_resize: self.opt_string()?,
        })
    }

    fn auto_layout(&mut self) -> Decoded<AutoLayout> {
        Ok(AutoLayout {
            mode: self.string()?,
            spacing: self.f32()?,
            padding_top: self.f32()?,
            padding_right: self.f32()?,
            padding_bottom: self.f32()?,
            padding_left: self.f32()?,
            primary_align: self.opt_string()?,
            counter_align: self.opt_string()?,
            wrap: self.bool()?,
            primary_sizing: self.opt_string()?,
            counter_sizing: self.opt_string()?,
            counter_spacing: self.f32()?,
            reverse_z: self.bool()?,
            strokes_in_layout: self.bool()?,
        })
    }

    fn layout_child(&mut self) -> Decoded<LayoutChild> {
        Ok(LayoutChild {
            grow: self.opt(Self::f32)?,
            align: self.opt_arc_str()?,
            absolute: self.opt(Self::bool)?,
            min_size: self.opt(Self::vec2)?,
            max_size: self.opt(Self::vec2)?,
        })
    }

    fn interaction(&mut self) -> Decoded<Interaction> {
        Ok(Interaction {
            id: self.opt(Self::guid)?,
            trigger: self.arc_str()?,
            timeout: self.opt(Self::f32)?,
            actions: self.arc_list(|r| {
                Ok(Action {
                    connection: r.arc_str()?,
                    navigation: r.arc_str()?,
                    destination: r.opt(Self::guid)?,
                    transition: r.arc_str()?,
                    duration: r.f32()?,
                    easing: r.opt_arc_str()?,
                    url: r.opt_arc_str()?,
                    open_in_new_tab: r.opt(Self::bool)?,
                    overlay_offset: r.opt(Self::vec2)?,
                })
            })?,
        })
    }

    pub fn props(&mut self) -> Decoded<Props> {
        Ok(Props {
            guid: self.opt(Self::guid)?,
            parent: self.opt(Self::guid)?,
            position: self.opt_arc_str()?,
            node_type: self.opt(|r| Ok(dec_node_type(r.u8()?)))?,
            name: self.opt_arc_str()?,
            visible: self.opt(Self::bool)?,
            locked: self.opt(Self::bool)?,
            opacity: self.opt(Self::f32)?,
            blend_mode: self.opt(|r| Ok(dec_blend(r.u8()?)))?,
            size: self.opt(Self::vec2)?,
            transform: self.opt(Self::affine)?,
            mask: self.opt(Self::bool)?,
            mask_type: self.opt(|r| Ok(dec_mask(r.u8()?)))?,
            fills: self.opt(Self::paints)?,
            strokes: self.opt(Self::paints)?,
            stroke_weight: self.opt(Self::f32)?,
            stroke_sides: self.opt(|r| Ok([r.f32()?, r.f32()?, r.f32()?, r.f32()?]))?,
            stroke_align: self.opt(|r| Ok(dec_align(r.u8()?)))?,
            stroke_cap: self.opt_arc_str()?,
            stroke_join: self.opt_arc_str()?,
            dash_pattern: self.opt(|r| r.arc_list(Self::f32))?,
            fill_geometry: self.opt(Self::paths)?,
            stroke_geometry: self.opt(Self::paths)?,
            effects: self.opt(|r| r.arc_list(Self::effect))?,
            corner_radius: self.opt(Self::f32)?,
            corner_radii: self.opt(|r| {
                Ok(CornerRadii {
                    top_left: r.f32()?,
                    top_right: r.f32()?,
                    bottom_right: r.f32()?,
                    bottom_left: r.f32()?,
                })
            })?,
            corner_smoothing: self.opt(Self::f32)?,
            clip_disabled: self.opt(Self::bool)?,
            background_color: self.opt(Self::color)?,
            internal_only: self.opt(Self::bool)?,
            text_content: self.opt(|r| r.text_content().map(Arc::new))?,
            text_layout: self.opt(|r| r.text_layout().map(Arc::new))?,
            text_style: self.opt(|r| r.text_style().map(Arc::new))?,
            symbol: self.opt(|r| {
                Ok(Arc::new(SymbolData {
                    symbol_id: r.opt(Self::guid)?,
                    overrides: r.arc_list(Self::props)?,
                    uniform_scale: r.opt(Self::f32)?,
                }))
            })?,
            derived: self.opt(|r| r.arc_list(Self::props))?,
            swapped_symbol: self.opt(Self::guid)?,
            prop_assignments: self.opt(|r| {
                r.arc_list(|r| {
                    let def_id = r.guid()?;
                    let value = match r.u8()? {
                        0 => PropValue::Bool(r.bool()?),
                        1 => PropValue::Text(r.arc_str()?),
                        2 => PropValue::Symbol(r.guid()?),
                        3 => PropValue::Other,
                        _ => return Err(DecodeError::Invalid),
                    };
                    Ok(PropAssignment { def_id, value })
                })
            })?,
            prop_refs: self.opt(|r| {
                r.arc_list(|r| {
                    Ok(PropRef {
                        def_id: r.guid()?,
                        field: dec_prop_field(r.u8()?),
                    })
                })
            })?,
            prop_defs: self.opt(|r| {
                r.arc_list(|r| {
                    Ok(PropDef {
                        id: r.guid()?,
                        name: r.string()?,
                        kind: r.string()?,
                    })
                })
            })?,
            guid_path: self.opt(|r| r.arc_list(Self::guid))?,
            override_key: self.opt(Self::guid)?,
            auto_layout: self.opt(|r| r.auto_layout().map(Arc::new))?,
            layout_child: self.opt(Self::layout_child)?,
            export_settings: self.opt(|r| {
                r.arc_list(|r| {
                    Ok(ExportSetting {
                        format: r.string()?,
                        suffix: r.string()?,
                        constraint: r.string()?,
                        value: r.f32()?,
                    })
                })
            })?,
            boolean_operation: self.opt_arc_str()?,
            vector_data: self.opt(|r| {
                Ok(Arc::new(VectorData {
                    network_blob: r.opt(Self::blob)?,
                    normalized_size: r.opt(Self::vec2)?,
                }))
            })?,
            constraints: self.opt(|r| Ok((r.arc_str()?, r.arc_str()?)))?,
            description: self.opt_arc_str()?,
            is_state_group: self.opt(Self::bool)?,
            fill_style: self.opt(Self::guid)?,
            stroke_style: self.opt(Self::guid)?,
            effect_style: self.opt(Self::guid)?,
            generated: self.opt(|r| r.arc_list(Self::props))?,
            vector_styles: self.opt(|r| r.arc_list(Self::style_run))?,
            interactions: self.opt(|r| r.arc_list(Self::interaction))?,
            flow_start: self.opt(|r| {
                Ok(Arc::new(FlowStart {
                    name: r.arc_str()?,
                    description: r.arc_str()?,
                    position: r.arc_str()?,
                }))
            })?,
            overlay: self.opt(|r| {
                Ok(Arc::new(OverlaySettings {
                    position: r.arc_str()?,
                    close_on_click_outside: r.bool()?,
                    background: r.opt(Self::color)?,
                }))
            })?,
            prototype_start: self.opt(Self::guid)?,
            recomputed: self.bool()?,
        })
    }

    /// Reads a whole entry written by [`Writer::node`].
    pub fn node(mut self) -> Decoded<NodeState> {
        if self.u8()? != ENTRY_VERSION {
            return Err(DecodeError::Invalid);
        }
        self.keys = self.list(Self::arc_str)?;
        let state = NodeState {
            props: self.props()?,
            removed: self.bool()?,
            listed: self.bool()?,
            edits: self.u32()?,
            source: self.opt(Self::guid)?,
        };
        if self.at != self.data.len() {
            return Err(DecodeError::Invalid);
        }
        Ok(state)
    }
}
