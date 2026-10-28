//! Resolved series and point formatting (explicit `c:spPr` over automatic).

use super::model::{ChartModel, GroupModel, Kind, MarkerModel, SeriesModel, ShapeProps, Symbol};
use super::style::{resolve_fill, resolve_line, solid_line};
use crate::model::color::Rgba;
use crate::model::fill::{Cap, Fill, Join, Line, LineProps};

/// Automatic marker symbols in series order (Excel's sequence).
const AUTO_SYMBOLS: [Symbol; 9] = [
    Symbol::Diamond,
    Symbol::Square,
    Symbol::Triangle,
    Symbol::X,
    Symbol::Star,
    Symbol::Circle,
    Symbol::Plus,
    Symbol::Dot,
    Symbol::Dash,
];

/// Default marker size in points.
const MARKER_SIZE: f32 = 5.0;

/// Width of automatic series lines (points).
const SERIES_LINE: f32 = 2.25;

/// A resolved marker.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MarkerLook {
    pub symbol: Symbol,
    pub size: f32,
    pub fill: Option<Fill>,
    pub line: Option<Line>,
}

/// Resolved formatting of a series or one of its points.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Look {
    pub fill: Option<Fill>,
    pub line: Option<Line>,
    pub marker: Option<MarkerLook>,
}

impl GroupModel {
    /// Whether the series of this group are drawn as filled shapes.
    pub fn filled(&self) -> bool {
        match self.kind {
            Kind::Bar | Kind::Area | Kind::Pie | Kind::Doughnut | Kind::Bubble => true,
            Kind::Radar => self.style == "filled",
            Kind::Line | Kind::Scatter | Kind::Stock => false,
        }
    }

    /// Whether points are colored individually (`total_series`: series in the whole chart).
    pub fn varies_by_point(&self, total_series: usize) -> bool {
        match self.kind {
            Kind::Pie | Kind::Doughnut => self.vary_colors,
            Kind::Stock | Kind::Area => false,
            _ => self.vary_colors && self.series.len() == 1 && total_series == 1,
        }
    }

    fn auto_symbol(&self) -> bool {
        match self.kind {
            Kind::Line => self.markers,
            Kind::Scatter => !matches!(self.style.as_str(), "line" | "smooth"),
            Kind::Radar => self.style == "marker",
            _ => false,
        }
    }
}

impl ChartModel {
    /// Number of series in the chart.
    pub fn series_count(&self) -> usize {
        self.groups.iter().map(|g| g.series.len()).sum()
    }

    /// Whether group `g` colors its points individually.
    pub fn varies(&self, g: &GroupModel) -> bool {
        g.varies_by_point(self.series_count())
    }

    /// Automatic color index of a point (series index unless colors vary by point).
    pub fn color_index(&self, g: &GroupModel, s: &SeriesModel, point: Option<usize>) -> usize {
        match point {
            Some(p) if g.varies_by_point(self.series_count()) => p,
            _ => s.idx,
        }
    }

    /// Formatting of series `s`, or of point `point` when given.
    pub fn look(&self, g: &GroupModel, s: &SeriesModel, point: Option<usize>) -> Look {
        let color = self.auto_color(self.color_index(g, s, point));
        let dpt = point.and_then(|p| s.point(p));
        let shape = dpt
            .and_then(|d| d.shape.clone())
            .unwrap_or_else(|| s.shape.clone());
        if g.filled() {
            let fill = resolve_fill(&shape, Some(Fill::Solid(color)));
            let line = resolve_line(shape.line.as_ref(), None);
            return Look {
                fill,
                line,
                marker: None,
            };
        }
        let auto_line = (g.kind != Kind::Stock).then(|| series_line(color));
        let line = resolve_line(shape.line.as_ref(), auto_line);
        let marker_model = match dpt.and_then(|d| d.marker.as_ref()) {
            Some(pm) => {
                let base = s.marker.clone().unwrap_or_default();
                Some(MarkerModel {
                    symbol: pm.symbol.or(base.symbol),
                    size: pm.size.or(base.size),
                    shape: base.shape.overlaid(&pm.shape),
                })
            }
            None => s.marker.clone(),
        };
        let symbol = match marker_model.as_ref().and_then(|m| m.symbol) {
            Some(Symbol::None) => None,
            Some(Symbol::Auto) => Some(AUTO_SYMBOLS[s.idx % AUTO_SYMBOLS.len()]),
            Some(sym) => Some(sym),
            None => g
                .auto_symbol()
                .then(|| AUTO_SYMBOLS[s.idx % AUTO_SYMBOLS.len()]),
        };
        let marker = symbol.map(|symbol| {
            let mm = marker_model.clone().unwrap_or_default();
            MarkerLook {
                symbol,
                size: mm.size.unwrap_or(MARKER_SIZE),
                fill: resolve_fill(&mm.shape, Some(Fill::Solid(color))),
                line: resolve_line(mm.shape.line.as_ref(), Some(solid_line(color, 0.75))),
            }
        });
        Look {
            fill: None,
            line,
            marker,
        }
    }

    /// Formatting of a chart element with an automatic outline.
    pub fn element_line(
        &self,
        shape: Option<&ShapeProps>,
        auto: Option<LineProps>,
    ) -> Option<Line> {
        match shape {
            Some(s) => resolve_line(s.line.as_ref(), auto),
            None => auto.and_then(|a| a.resolve()),
        }
    }
}

/// The automatic line of a line-type series.
fn series_line(color: Rgba) -> LineProps {
    LineProps {
        width: Some(SERIES_LINE),
        fill: Some(Fill::Solid(color)),
        cap: Some(Cap::Round),
        join: Some(Join::Round),
        ..Default::default()
    }
}
