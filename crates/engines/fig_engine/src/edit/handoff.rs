//! Handoff and layout aids: layers' export presets, frames' layout grids,
//! and the ruler guides of pages and frames.

use super::{Txn, flags, parse_hex};
use crate::error::{FigError, Result};
use crate::model::{Axis, Color, GridAlign, GridPattern, Guide, LayoutGrid, NodeType};
use serde::Deserialize;
use std::sync::Arc;

/// A layout grid as the design panel describes it; absent fields take
/// Figma's defaults for a new grid.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridSpec {
    pub pattern: Option<GridPattern>,
    pub axis: Option<Axis>,
    pub align: Option<GridAlign>,
    pub visible: Option<bool>,
    /// Columns or rows; `0` for "Auto" (as many as fit).
    pub count: Option<i32>,
    pub offset: Option<f32>,
    pub section_size: Option<f32>,
    pub gutter: Option<f32>,
    /// `RRGGBB` or `RRGGBBAA`.
    pub color: Option<String>,
}

/// A guide as the canvas describes it; `keep` keeps an existing guide's id.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuideSpec {
    pub keep: Option<usize>,
    pub axis: Axis,
    pub offset: f32,
}

/// Figma stores "Auto" counts as the largest 32-bit integer.
pub const AUTO_COUNT: i32 = i32::MAX;

impl GridSpec {
    fn grid(&self) -> LayoutGrid {
        let base = LayoutGrid::default_grid();
        let pattern = self.pattern.unwrap_or(base.pattern);
        // New column and row grids start as Figma's: 5 stretched columns.
        let stripes = pattern == GridPattern::Stripes;
        LayoutGrid {
            pattern,
            axis: self.axis.unwrap_or(base.axis),
            align: self.align.unwrap_or(base.align),
            visible: self.visible.unwrap_or(true),
            count: match self.count {
                Some(c) if c <= 0 => AUTO_COUNT,
                Some(c) => c,
                None => base.count,
            },
            offset: self
                .offset
                .unwrap_or(if stripes { 0.0 } else { base.offset })
                .max(0.0),
            section_size: self.section_size.unwrap_or(base.section_size).max(1.0),
            gutter: self.gutter.unwrap_or(base.gutter).max(0.0),
            color: self
                .color
                .as_deref()
                .and_then(parse_hex)
                .unwrap_or(if stripes {
                    Color {
                        r: 1.0,
                        g: 0.0,
                        b: 0.0,
                        a: 0.1,
                    }
                } else {
                    base.color
                }),
        }
    }
}

impl Txn<'_> {
    /// Replaces layers' export presets.
    pub(super) fn set_exports(
        &mut self,
        ids: &[String],
        settings: &[crate::model::ExportSetting],
    ) -> Result<()> {
        let list: Arc<[crate::model::ExportSetting]> = settings
            .iter()
            .map(|s| {
                let mut s = s.clone();
                s.value = if s.value.is_finite() && s.value > 0.0 {
                    s.value
                } else {
                    1.0
                };
                s.quality = s.quality.clamp(1, 100);
                s
            })
            .collect();
        for i in self.resolve_all(ids)? {
            if matches!(
                self.doc.props(i).node_type(),
                NodeType::Canvas | NodeType::Document
            ) {
                continue;
            }
            self.edit(i, flags::EXPORTS).export_settings = Some(list.clone());
        }
        Ok(())
    }

    /// Replaces frames' layout grids.
    pub(super) fn set_layout_grids(&mut self, ids: &[String], grids: &[GridSpec]) -> Result<()> {
        let list: Arc<[LayoutGrid]> = grids.iter().map(GridSpec::grid).collect();
        for i in self.resolve_all(ids)? {
            let t = self.doc.props(i).node_type();
            if !t.is_frame_like() || t == NodeType::Section {
                continue;
            }
            self.edit(i, flags::LAYOUT_GRIDS).layout_grids = Some(list.clone());
        }
        Ok(())
    }

    /// Replaces a page's or frame's guides.
    pub(super) fn set_guides(&mut self, id: &str, specs: &[GuideSpec]) -> Result<()> {
        let i = self.resolve(id)?;
        let t = self.doc.props(i).node_type();
        if t != NodeType::Canvas && !t.is_frame_like() {
            return Err(FigError::Unsupported(
                "only pages and frames have guides".into(),
            ));
        }
        let existing = self
            .doc
            .props(i)
            .guides
            .clone()
            .unwrap_or_else(|| [].into());
        let list: Arc<[Guide]> = specs
            .iter()
            .filter(|s| s.offset.is_finite())
            .map(|s| Guide {
                axis: s.axis,
                offset: s.offset,
                guid: s
                    .keep
                    .and_then(|k| existing.get(k))
                    .and_then(|g| g.guid)
                    .or_else(|| Some(self.doc.new_guid())),
            })
            .collect();
        self.edit(i, flags::GUIDES).guides = Some(list);
        Ok(())
    }
}

#[cfg(test)]
mod test;
