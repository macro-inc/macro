//! Parses a `c:chartSpace` part into the chart model.
//!
//! Parsing never fails: missing or malformed elements fall back to the
//! defaults Office applies, and series/point counts are capped so a hostile
//! part cannot make rendering unbounded.

use super::date::TimeUnit;
use super::model::{
    AxisKind, AxisModel, Blanks, ChartModel, Crosses, DataRef, DataTableModel, GroupModel,
    Grouping, Kind, LabelModel, LabelPos, LabelsModel, LegendModel, LegendPos, MAX_POINTS,
    MAX_SERIES, MAX_TRENDLINES, ManualLayout, MarkerModel, NumFmt, PointModel, RichPara, RichRun,
    RichText, SeriesModel, ShapeProps, Side, Symbol, TextProps, TextSpec, Tick, TickLabels,
    TitleModel, TrendKind, TrendlineModel,
};
use super::style::Palette;
use crate::model::color::{ColorContext, ColorMap, Rgba};
use crate::model::fill::{Fill, find_fill, parse_line};
use crate::model::presentation::{PartRef, SlideContext};
use crate::model::theme::Theme;
use crate::xml::{NodeId, Ns, XmlDoc, parse_bool};

/// Parsing context.
struct Cx<'a> {
    doc: &'a XmlDoc,
    colors: ColorContext<'a>,
    theme: &'a Theme,
    part: &'a PartRef,
}

impl Cx<'_> {
    /// Element children of `node`, resolving `mc:AlternateContent`.
    fn kids(&self, node: NodeId) -> Vec<NodeId> {
        let doc = self.doc;
        let mut out = Vec::new();
        for c in doc.children(node) {
            if doc.ns(c) == Ns::MC && doc.local(c) == "AlternateContent" {
                if let Some(branch) = alternate_branch(doc, c) {
                    out.extend(doc.children(branch));
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    /// First chart-namespace child named `local`.
    fn kid(&self, node: NodeId, local: &str) -> Option<NodeId> {
        self.kids(node)
            .into_iter()
            .find(|&c| self.doc.is(c, Ns::C, local))
    }

    /// An extension child named `local` (`c:extLst/c:ext/*`, any namespace).
    fn ext_child(&self, node: NodeId, local: &str) -> Option<NodeId> {
        let doc = self.doc;
        let list = self.kid(node, "extLst")?;
        self.kids_named(list, "ext")
            .into_iter()
            .flat_map(|e| doc.children(e))
            .find(|&c| doc.local(c) == local)
    }

    /// All chart-namespace children named `local`.
    fn kids_named(&self, node: NodeId, local: &str) -> Vec<NodeId> {
        self.kids(node)
            .into_iter()
            .filter(|&c| self.doc.is(c, Ns::C, local))
            .collect()
    }

    /// `val` of a child element.
    fn val(&self, node: NodeId, local: &str) -> Option<&str> {
        self.kid(node, local).and_then(|c| self.doc.attr(c, "val"))
    }

    /// Numeric `val` of a child element (finite only).
    fn num(&self, node: NodeId, local: &str) -> Option<f64> {
        self.val(node, local)
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|v| v.is_finite())
    }

    /// Boolean child element: present without `val` means true.
    fn flag(&self, node: NodeId, local: &str) -> Option<bool> {
        let c = self.kid(node, local)?;
        Some(
            self.doc
                .attr(c, "val")
                .map_or(Some(true), parse_bool)
                .unwrap_or(true),
        )
    }

    fn shape(&self, node: NodeId) -> ShapeProps {
        let Some(sp) = self.kid(node, "spPr") else {
            return ShapeProps::default();
        };
        let rels = self.part.rels.clone();
        let resolver = move |id: &str| rels.target_part(id);
        ShapeProps {
            fill: find_fill(self.doc, sp, &self.colors, &resolver),
            line: self
                .doc
                .child(sp, Ns::A, "ln")
                .map(|l| parse_line(self.doc, l, &self.colors, &resolver)),
        }
    }

    fn rpr(&self, node: NodeId) -> TextProps {
        let doc = self.doc;
        let rels = self.part.rels.clone();
        let resolver = move |id: &str| rels.target_part(id);
        let color = find_fill(doc, node, &self.colors, &resolver).and_then(|f| match f {
            Fill::None => Some(Rgba::TRANSPARENT),
            other => other.representative_color(),
        });
        let family = doc
            .child(node, Ns::A, "latin")
            .and_then(|l| doc.attr(l, "typeface"))
            .map(|t| self.theme.resolve_typeface(t).to_owned())
            .filter(|t| !t.is_empty());
        TextProps {
            size: doc
                .attr_f64(node, "sz")
                .filter(|s| *s > 0.0)
                .map(|s| (s / 100.0) as f32),
            bold: doc.attr_bool(node, "b"),
            italic: doc.attr_bool(node, "i"),
            underline: doc.attr(node, "u").map(|u| u != "none"),
            color,
            family,
        }
    }

    /// Rotation of an `a:bodyPr` in degrees.
    fn body_rot(&self, body: NodeId) -> Option<f32> {
        let doc = self.doc;
        let rot = doc
            .attr_f64(body, "rot")
            .filter(|r| r.abs() <= 21_600_000.0)
            .map(|r| (r / 60_000.0) as f32);
        rot.or(match doc.attr(body, "vert") {
            Some("vert") | Some("eaVert") => Some(90.0),
            Some("vert270") => Some(-90.0),
            _ => None,
        })
    }

    fn tx_pr(&self, node: NodeId) -> TextSpec {
        let Some(tx) = self.kid(node, "txPr") else {
            return TextSpec::default();
        };
        let doc = self.doc;
        let rot = doc
            .child(tx, Ns::A, "bodyPr")
            .and_then(|b| self.body_rot(b));
        let props = doc
            .child(tx, Ns::A, "p")
            .and_then(|p| doc.child(p, Ns::A, "pPr"))
            .and_then(|p| doc.child(p, Ns::A, "defRPr"))
            .map(|d| self.rpr(d))
            .unwrap_or_default();
        TextSpec { props, rot }
    }

    fn rich(&self, rich: NodeId) -> RichText {
        let doc = self.doc;
        let rot = doc
            .child(rich, Ns::A, "bodyPr")
            .and_then(|b| self.body_rot(b));
        let mut paras = Vec::new();
        for p in doc.children_named(rich, Ns::A, "p") {
            let ppr = doc.child(p, Ns::A, "pPr");
            let def = ppr
                .and_then(|n| doc.child(n, Ns::A, "defRPr"))
                .map(|d| self.rpr(d))
                .unwrap_or_default();
            let align = ppr.and_then(|n| doc.attr(n, "algn")).map(str::to_owned);
            let mut runs = Vec::new();
            for r in doc.children(p) {
                match doc.local(r) {
                    "r" | "fld" => {
                        let text = doc
                            .child(r, Ns::A, "t")
                            .map(|t| doc.text(t))
                            .unwrap_or_default();
                        let props = doc
                            .child(r, Ns::A, "rPr")
                            .map(|n| self.rpr(n))
                            .unwrap_or_default();
                        let field = (doc.local(r) == "fld")
                            .then(|| doc.attr(r, "type").unwrap_or("").to_owned());
                        runs.push(RichRun { text, props, field });
                    }
                    "br" => runs.push(RichRun {
                        text: "\n".into(),
                        props: TextProps::default(),
                        field: None,
                    }),
                    _ => {}
                }
            }
            paras.push(RichPara { align, def, runs });
        }
        RichText { paras, rot }
    }

    fn layout(&self, node: NodeId) -> Option<ManualLayout> {
        let ml = self.kid(self.kid(node, "layout")?, "manualLayout")?;
        let edge = |n: &str| self.val(ml, n) == Some("edge");
        let l = ManualLayout {
            inner: self.val(ml, "layoutTarget") == Some("inner"),
            x_edge: edge("xMode"),
            y_edge: edge("yMode"),
            w_edge: edge("wMode"),
            h_edge: edge("hMode"),
            x: self.num(ml, "x"),
            y: self.num(ml, "y"),
            w: self.num(ml, "w"),
            h: self.num(ml, "h"),
        };
        (l.x.is_some() || l.y.is_some() || l.w.is_some() || l.h.is_some()).then_some(l)
    }

    fn title(&self, node: NodeId) -> TitleModel {
        let mut t = TitleModel {
            tx_pr: self.tx_pr(node),
            layout: self.layout(node),
            overlay: self.flag(node, "overlay").unwrap_or(false),
            shape: self.shape(node),
            ..Default::default()
        };
        if let Some(tx) = self.kid(node, "tx") {
            if let Some(r) = self.kid(tx, "rich") {
                t.rich = Some(self.rich(r));
            } else if let Some(sr) = self.kid(tx, "strRef") {
                t.text_ref = self.data(sr).map(|d| {
                    d.text
                        .iter()
                        .flatten()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" ")
                });
            }
        }
        t
    }

    fn num_fmt(&self, node: NodeId) -> Option<NumFmt> {
        let n = self.kid(node, "numFmt")?;
        Some(NumFmt {
            code: self
                .doc
                .attr(n, "formatCode")
                .unwrap_or("General")
                .to_owned(),
            linked: self
                .doc
                .attr(n, "sourceLinked")
                .and_then(parse_bool)
                .unwrap_or(false),
        })
    }

    /// Reads a reference or literal (`c:strRef`, `c:numRef`, `c:strLit`...) or its parent (`c:cat`).
    fn data(&self, node: NodeId) -> Option<DataRef> {
        let doc = self.doc;
        let local = doc.local(node);
        let cache = match local {
            "strRef" => self.kid(node, "strCache"),
            "numRef" => self.kid(node, "numCache"),
            "multiLvlStrRef" => self.kid(node, "multiLvlStrCache"),
            "strLit" | "numLit" | "strCache" | "numCache" | "multiLvlStrCache" => Some(node),
            _ => {
                let inner = self.kids(node).into_iter().find(|&c| {
                    doc.ns(c) == Ns::C
                        && matches!(
                            doc.local(c),
                            "strRef" | "numRef" | "multiLvlStrRef" | "strLit" | "numLit"
                        )
                })?;
                return self.data(inner);
            }
        }?;
        let numeric = matches!(doc.local(cache), "numCache" | "numLit");
        let declared = self.num(cache, "ptCount").map(|c| c.max(0.0) as usize);
        let read_level = |lvl: NodeId| -> Vec<(usize, String)> {
            self.kids_named(lvl, "pt")
                .into_iter()
                .filter_map(|pt| {
                    let idx = doc.attr_i64(pt, "idx").filter(|i| *i >= 0)? as usize;
                    (idx < MAX_POINTS).then(|| {
                        (
                            idx,
                            self.kid(pt, "v").map(|v| doc.text(v)).unwrap_or_default(),
                        )
                    })
                })
                .collect()
        };
        let levels: Vec<Vec<(usize, String)>> = if doc.local(cache) == "multiLvlStrCache" {
            self.kids_named(cache, "lvl")
                .into_iter()
                .map(read_level)
                .collect()
        } else {
            vec![read_level(cache)]
        };
        let max_idx = levels
            .iter()
            .flatten()
            .map(|(i, _)| i + 1)
            .max()
            .unwrap_or(0);
        let count = declared.unwrap_or(max_idx).max(max_idx).min(MAX_POINTS);
        let to_vec = |pts: &[(usize, String)]| {
            let mut v = vec![None; count];
            for (i, s) in pts {
                if let Some(slot) = v.get_mut(*i) {
                    *slot = Some(s.clone());
                }
            }
            v
        };
        let text = levels
            .first()
            .map(|l| to_vec(l))
            .unwrap_or_else(|| vec![None; count]);
        let nums = text
            .iter()
            .map(|t| {
                t.as_deref()
                    .and_then(|s| s.trim().parse::<f64>().ok())
                    .filter(|v| v.is_finite())
            })
            .collect();
        let format = self
            .kid(cache, "formatCode")
            .map(|f| doc.text(f))
            .filter(|f| !f.trim().is_empty());
        let outer = levels.iter().skip(1).map(|l| to_vec(l)).collect();
        Some(DataRef {
            count,
            text,
            nums,
            format,
            numeric,
            outer,
        })
    }

    fn marker(&self, node: NodeId) -> MarkerModel {
        let symbol = self.val(node, "symbol").map(|s| match s {
            "none" => Symbol::None,
            "circle" => Symbol::Circle,
            "square" => Symbol::Square,
            "diamond" => Symbol::Diamond,
            "triangle" => Symbol::Triangle,
            "x" => Symbol::X,
            "star" => Symbol::Star,
            "dash" => Symbol::Dash,
            "dot" => Symbol::Dot,
            "plus" => Symbol::Plus,
            _ => Symbol::Auto,
        });
        MarkerModel {
            symbol,
            size: self.num(node, "size").map(|s| s.clamp(2.0, 72.0) as f32),
            shape: self.shape(node),
        }
    }

    fn label(&self, node: NodeId) -> LabelModel {
        let doc = self.doc;
        let mut l = LabelModel {
            delete: self.flag(node, "delete"),
            show_val: self.flag(node, "showVal"),
            show_percent: self.flag(node, "showPercent"),
            show_cat: self.flag(node, "showCatName"),
            show_ser: self.flag(node, "showSerName"),
            show_bubble: self.flag(node, "showBubbleSize"),
            show_key: self.flag(node, "showLegendKey"),
            pos: self.val(node, "dLblPos").map(|p| match p {
                "b" => LabelPos::Bottom,
                "ctr" => LabelPos::Center,
                "inBase" => LabelPos::InBase,
                "inEnd" => LabelPos::InEnd,
                "l" => LabelPos::Left,
                "outEnd" => LabelPos::OutEnd,
                "r" => LabelPos::Right,
                "t" => LabelPos::Top,
                _ => LabelPos::BestFit,
            }),
            num_fmt: self.num_fmt(node),
            separator: self.kid(node, "separator").map(|s| doc.text(s)),
            text: self.tx_pr(node),
            shape: self.shape(node),
            // Office 2013 keeps leader lines of non-pie labels in an extension.
            show_leader: self.flag(node, "showLeaderLines").or_else(|| {
                self.ext_child(node, "showLeaderLines").map(|n| {
                    doc.attr(n, "val")
                        .map_or(Some(true), parse_bool)
                        .unwrap_or(true)
                })
            }),
            leader: self
                .kid(node, "leaderLines")
                .or_else(|| self.ext_child(node, "leaderLines"))
                .map(|l| self.shape(l)),
            ..Default::default()
        };
        if let Some(rich) = self.kid(node, "tx").and_then(|tx| self.kid(tx, "rich")) {
            let r = self.rich(rich);
            if let Some(first) = r.paras.iter().flat_map(|p| p.runs.iter()).next() {
                let mut props = first.props.clone();
                if let Some(p) = r.paras.first() {
                    props.inherit(&p.def);
                }
                l.text.props = props;
            }
            let mut pieces = Vec::new();
            for (k, p) in r.paras.iter().enumerate() {
                if k > 0 {
                    pieces.push((None, "\n".to_owned()));
                }
                pieces.extend(
                    p.runs
                        .iter()
                        .map(|run| (run.field.clone(), run.text.clone())),
                );
            }
            l.custom = Some(pieces);
            if r.rot.is_some() {
                l.text.rot = r.rot;
            }
        }
        if let Some(ml) = self.layout(node) {
            l.offset = Some((ml.x.unwrap_or(0.0), ml.y.unwrap_or(0.0)));
        }
        l
    }

    fn labels(&self, node: NodeId) -> Option<LabelsModel> {
        let d = self.kid(node, "dLbls")?;
        let all = self.label(d);
        let points = self
            .kids_named(d, "dLbl")
            .into_iter()
            .filter_map(|p| Some((self.num(p, "idx")?.max(0.0) as usize, self.label(p))))
            .collect();
        Some(LabelsModel { all, points })
    }

    fn series(&self, node: NodeId) -> SeriesModel {
        let doc = self.doc;
        let name = self.kid(node, "tx").and_then(|tx| {
            if let Some(v) = self.kid(tx, "v") {
                return Some(doc.text(v));
            }
            self.data(tx).map(|d| {
                d.text
                    .iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
        });
        let points = self
            .kids_named(node, "dPt")
            .into_iter()
            .take(MAX_POINTS)
            .filter_map(|p| {
                Some(PointModel {
                    idx: self.num(p, "idx")?.max(0.0) as usize,
                    shape: self.kid(p, "spPr").map(|_| self.shape(p)),
                    marker: self.kid(p, "marker").map(|m| self.marker(m)),
                    explosion: self.num(p, "explosion").map(|e| e.clamp(0.0, 400.0) as f32),
                    invert: self.flag(p, "invertIfNegative"),
                })
            })
            .collect();
        let pick = |names: &[&str]| {
            names
                .iter()
                .find_map(|n| self.kid(node, n))
                .and_then(|c| self.data(c))
        };
        SeriesModel {
            idx: self
                .num(node, "idx")
                .map_or(0, |v| v.clamp(0.0, 1e6) as usize),
            order: self
                .num(node, "order")
                .map_or(0, |v| v.clamp(0.0, 1e6) as usize),
            name,
            shape: self.shape(node),
            marker: self.kid(node, "marker").map(|m| self.marker(m)),
            points,
            labels: self.labels(node),
            cat: pick(&["cat", "xVal"]),
            val: pick(&["val", "yVal"]),
            bubble: pick(&["bubbleSize"]),
            invert_if_negative: self.flag(node, "invertIfNegative").unwrap_or(false),
            explosion: self
                .num(node, "explosion")
                .map_or(0.0, |e| e.clamp(0.0, 400.0) as f32),
            smooth: self.flag(node, "smooth").unwrap_or(false),
            trendlines: self
                .kids_named(node, "trendline")
                .into_iter()
                .take(MAX_TRENDLINES)
                .filter_map(|t| self.trendline(t))
                .collect(),
        }
    }

    fn trendline(&self, node: NodeId) -> Option<TrendlineModel> {
        let count = |name: &str, lo: f64, hi: f64, default: usize| {
            self.num(node, name)
                .map_or(default, |v| v.clamp(lo, hi) as usize)
        };
        let kind = match self.val(node, "trendlineType")? {
            "linear" => TrendKind::Linear,
            "exp" => TrendKind::Exp,
            "log" => TrendKind::Log,
            "poly" => TrendKind::Poly(count("order", 2.0, 6.0, 2)),
            "power" => TrendKind::Power,
            "movingAvg" => TrendKind::MovingAvg(count("period", 2.0, 255.0, 2)),
            _ => return None,
        };
        let extent = |name: &str| self.num(node, name).map_or(0.0, |v| v.clamp(0.0, 1e9));
        Some(TrendlineModel {
            kind,
            name: self.kid(node, "name").map(|n| self.doc.text(n)),
            shape: self.shape(node),
            forward: extent("forward"),
            backward: extent("backward"),
            intercept: self.num(node, "intercept"),
            show_eq: self.flag(node, "dispEq").unwrap_or(false),
            show_r2: self.flag(node, "dispRSqr").unwrap_or(false),
            label: self.kid(node, "trendlineLbl").map(|l| self.label(l)),
        })
    }

    fn group(&self, node: NodeId) -> Option<GroupModel> {
        let local = self.doc.local(node);
        let kind = match local {
            "barChart" | "bar3DChart" => Kind::Bar,
            "lineChart" | "line3DChart" => Kind::Line,
            "areaChart" | "area3DChart" => Kind::Area,
            "pieChart" | "pie3DChart" | "ofPieChart" => Kind::Pie,
            "doughnutChart" => Kind::Doughnut,
            "scatterChart" => Kind::Scatter,
            "radarChart" => Kind::Radar,
            "bubbleChart" => Kind::Bubble,
            "stockChart" => Kind::Stock,
            _ => return None,
        };
        let grouping = match self.val(node, "grouping") {
            Some("stacked") => Grouping::Stacked,
            Some("percentStacked") => Grouping::Percent,
            Some("clustered") => Grouping::Clustered,
            Some("standard") => Grouping::Standard,
            _ if kind == Kind::Bar => Grouping::Clustered,
            _ => Grouping::Standard,
        };
        let mut series: Vec<SeriesModel> = self
            .kids_named(node, "ser")
            .into_iter()
            .take(MAX_SERIES)
            .map(|s| self.series(s))
            .collect();
        series.sort_by_key(|s| s.order);
        let style = self
            .val(node, "scatterStyle")
            .or_else(|| self.val(node, "radarStyle"))
            .unwrap_or("")
            .to_owned();
        let up_down = self.kid(node, "upDownBars").map(|u| {
            let up = self
                .kid(u, "upBars")
                .map(|b| self.shape(b))
                .unwrap_or_default();
            let down = self
                .kid(u, "downBars")
                .map(|b| self.shape(b))
                .unwrap_or_default();
            (
                up,
                down,
                self.num(u, "gapWidth")
                    .map_or(150.0, |g| g.clamp(0.0, 500.0) as f32),
            )
        });
        Some(GroupModel {
            kind,
            horizontal: self.val(node, "barDir") == Some("bar"),
            grouping,
            vary_colors: self.flag(node, "varyColors").unwrap_or(true),
            gap_width: self
                .num(node, "gapWidth")
                .map_or(150.0, |g| g.clamp(0.0, 500.0) as f32),
            overlap: self
                .num(node, "overlap")
                .map(|o| o.clamp(-100.0, 100.0) as f32),
            hole_size: self
                .num(node, "holeSize")
                .map_or(10.0, |h| h.clamp(1.0, 90.0) as f32),
            first_slice: self
                .num(node, "firstSliceAng")
                .map_or(0.0, |a| a.rem_euclid(360.0) as f32),
            style,
            markers: self.flag(node, "marker").unwrap_or(true),
            bubble_scale: self
                .num(node, "bubbleScale")
                .map_or(100.0, |s| s.clamp(0.0, 300.0) as f32),
            show_neg_bubbles: self.flag(node, "showNegBubbles").unwrap_or(false),
            size_is_width: self.val(node, "sizeRepresents") == Some("w"),
            series,
            ax_ids: self
                .kids_named(node, "axId")
                .into_iter()
                .filter_map(|a| self.doc.attr_i64(a, "val"))
                .map(|v| v as u32)
                .collect(),
            labels: self.labels(node),
            hi_low: self.kid(node, "hiLowLines").map(|h| self.shape(h)),
            drop_lines: self.kid(node, "dropLines").map(|h| self.shape(h)),
            up_down,
            is_3d: local.contains("3D"),
            gap_depth: self
                .num(node, "gapDepth")
                .map_or(150.0, |g| g.clamp(0.0, 500.0) as f32),
        })
    }

    fn axis(&self, node: NodeId) -> Option<AxisModel> {
        let kind = match self.doc.local(node) {
            "catAx" => AxisKind::Cat,
            "valAx" => AxisKind::Val,
            "dateAx" => AxisKind::Date,
            "serAx" => AxisKind::Ser,
            _ => return None,
        };
        let scaling = self.kid(node, "scaling");
        let sc = |n: &str| scaling.and_then(|s| self.num(s, n));
        let tick = |n: &str, d: Tick| match self.val(node, n) {
            Some("none") => Tick::None,
            Some("in") => Tick::In,
            Some("out") => Tick::Out,
            Some("cross") => Tick::Cross,
            _ => d,
        };
        let crosses = match (self.num(node, "crossesAt"), self.val(node, "crosses")) {
            (Some(v), _) => Crosses::At(v),
            (None, Some("min")) => Crosses::Min,
            (None, Some("max")) => Crosses::Max,
            _ => Crosses::AutoZero,
        };
        let units = self.kid(node, "dispUnits");
        let builtin = units
            .and_then(|d| self.val(d, "builtInUnit"))
            .and_then(|u| {
                Some(match u {
                    "hundreds" => (1e2, "Hundreds"),
                    "thousands" => (1e3, "Thousands"),
                    "tenThousands" => (1e4, "Ten Thousands"),
                    "hundredThousands" => (1e5, "Hundred Thousands"),
                    "millions" => (1e6, "Millions"),
                    "tenMillions" => (1e7, "Ten Millions"),
                    "hundredMillions" => (1e8, "Hundred Millions"),
                    "billions" => (1e9, "Billions"),
                    "trillions" => (1e12, "Trillions"),
                    _ => return None,
                })
            });
        let custom = units
            .and_then(|d| self.num(d, "custUnit"))
            .filter(|v| *v > 0.0);
        let disp_unit = custom.or(builtin.map(|(v, _)| v));
        let disp_label = units.and_then(|d| self.kid(d, "dispUnitsLbl")).map(|l| {
            (
                self.title(l),
                builtin.map_or_else(String::new, |(_, name)| name.to_owned()),
            )
        });
        Some(AxisModel {
            id: self.doc.attr_i64(self.kid(node, "axId")?, "val")? as u32,
            kind,
            deleted: self.flag(node, "delete").unwrap_or(false),
            side: match self.val(node, "axPos") {
                Some("l") => Side::Left,
                Some("r") => Side::Right,
                Some("t") => Side::Top,
                _ => Side::Bottom,
            },
            reversed: scaling.and_then(|s| self.val(s, "orientation")) == Some("maxMin"),
            min: sc("min"),
            max: sc("max"),
            log_base: sc("logBase").filter(|b| *b >= 2.0 && *b <= 1000.0),
            major_unit: self.num(node, "majorUnit").filter(|u| *u > 0.0),
            minor_unit: self.num(node, "minorUnit").filter(|u| *u > 0.0),
            major_grid: self.kid(node, "majorGridlines").map(|g| self.shape(g)),
            minor_grid: self.kid(node, "minorGridlines").map(|g| self.shape(g)),
            num_fmt: self.num_fmt(node),
            major_tick: tick("majorTickMark", Tick::Out),
            minor_tick: tick("minorTickMark", Tick::None),
            tick_labels: match self.val(node, "tickLblPos") {
                Some("low") => TickLabels::Low,
                Some("high") => TickLabels::High,
                Some("none") => TickLabels::None,
                _ => TickLabels::NextTo,
            },
            shape: self.shape(node),
            text: self.tx_pr(node),
            cross_ax: self
                .kid(node, "crossAx")
                .and_then(|c| self.doc.attr_i64(c, "val"))
                .map(|v| v as u32),
            crosses,
            between: self.val(node, "crossBetween").map(|v| v != "midCat"),
            title: self.kid(node, "title").map(|t| self.title(t)),
            label_skip: self
                .num(node, "tickLblSkip")
                .map(|v| v.clamp(1.0, 1e6) as usize),
            mark_skip: self
                .num(node, "tickMarkSkip")
                .map(|v| v.clamp(1.0, 1e6) as usize),
            label_offset: self
                .num(node, "lblOffset")
                .map_or(100.0, |v| v.clamp(0.0, 1000.0) as f32),
            no_multi_level: self.flag(node, "noMultiLvlLbl").unwrap_or(false),
            disp_unit,
            disp_label,
            base_time: TimeUnit::parse(self.val(node, "baseTimeUnit")),
            major_time: TimeUnit::parse(self.val(node, "majorTimeUnit")),
        })
    }

    fn legend(&self, node: NodeId) -> LegendModel {
        let mut deleted = Vec::new();
        let mut entry_text = Vec::new();
        for e in self.kids_named(node, "legendEntry") {
            let Some(idx) = self.num(e, "idx").map(|v| v.max(0.0) as usize) else {
                continue;
            };
            if self.flag(e, "delete").unwrap_or(false) {
                deleted.push(idx);
            } else {
                entry_text.push((idx, self.tx_pr(e)));
            }
        }
        LegendModel {
            pos: match self.val(node, "legendPos") {
                Some("l") => LegendPos::Left,
                Some("t") => LegendPos::Top,
                Some("b") => LegendPos::Bottom,
                Some("tr") => LegendPos::TopRight,
                _ => LegendPos::Right,
            },
            overlay: self.flag(node, "overlay").unwrap_or(false),
            layout: self.layout(node),
            deleted,
            entry_text,
            text: self.tx_pr(node),
            shape: self.shape(node),
        }
    }
}

/// Picks the branch of an `mc:AlternateContent` (the fallback unless the choice needs only `c14`).
fn alternate_branch(doc: &XmlDoc, ac: NodeId) -> Option<NodeId> {
    let mut fallback = None;
    for c in doc.children(ac) {
        match doc.local(c) {
            "Choice"
                if doc
                    .attr(c, "Requires")
                    .is_some_and(|r| r.split_whitespace().all(|p| p == "c14")) =>
            {
                // c14 choices hold extension elements only; the fallback has the standard ones.
                let has_chart = doc.children(c).any(|k| doc.ns(k) == Ns::C);
                if has_chart {
                    return Some(c);
                }
            }
            "Fallback" => fallback = Some(c),
            _ => {}
        }
    }
    fallback
}

/// The slide theme with a chart's `themeOverride` (colors and fonts) applied.
fn effective_theme(base: &Theme, theme_override: Option<&std::sync::Arc<XmlDoc>>) -> Theme {
    let mut theme = base.clone();
    if let Some(doc) = theme_override {
        let ov = Theme::parse(std::sync::Arc::clone(doc));
        let root = doc.root();
        let elements = doc.child(root, Ns::A, "themeElements").unwrap_or(root);
        if doc.child(elements, Ns::A, "clrScheme").is_some() {
            theme.colors = ov.colors;
        }
        if doc.child(elements, Ns::A, "fontScheme").is_some() {
            theme.major = ov.major;
            theme.minor = ov.minor;
        }
    }
    theme
}

/// Parses a chart part (`theme_override`: the chart's `themeOverride` part).
pub(crate) fn parse(
    part: &PartRef,
    ctx: &SlideContext,
    theme_override: Option<&std::sync::Arc<XmlDoc>>,
) -> Option<ChartModel> {
    let doc = &part.doc;
    let root = doc.root();
    if !doc.is(root, Ns::C, "chartSpace") {
        return None;
    }
    let theme = effective_theme(&ctx.theme, theme_override);
    let map = doc
        .child(root, Ns::C, "clrMapOvr")
        .map_or_else(|| ctx.color_map.clone(), |n| ColorMap::parse(doc, n));
    let colors = ColorContext {
        scheme: &theme.colors,
        map: &map,
        ph_clr: None,
    };
    let cx = Cx {
        doc,
        colors,
        theme: &theme,
        part,
    };
    let chart = cx.kid(root, "chart")?;
    let plot = cx.kid(chart, "plotArea");
    let mut groups = Vec::new();
    let mut axes = Vec::new();
    if let Some(plot) = plot {
        for c in cx.kids(plot) {
            if doc.ns(c) != Ns::C {
                continue;
            }
            if let Some(g) = cx.group(c) {
                if groups.len() < MAX_SERIES {
                    groups.push(g);
                }
            } else if let Some(a) = cx.axis(c) {
                axes.push(a);
            }
        }
    }
    let style = c14_style(doc, root)
        .or_else(|| cx.num(root, "style").map(|s| s as u32))
        .filter(|s| (1..=48).contains(s))
        .unwrap_or(2);
    let palette = Palette::new(&colors);
    let font = theme.resolve_typeface("+mn-lt");
    let wall = |name: &str| cx.kid(chart, name).map(|w| cx.shape(w)).unwrap_or_default();
    Some(ChartModel {
        title: cx.kid(chart, "title").map(|t| cx.title(t)),
        auto_title_deleted: cx.flag(chart, "autoTitleDeleted").unwrap_or(true),
        groups,
        axes,
        plot_layout: plot.and_then(|p| cx.layout(p)),
        plot_shape: plot.map(|p| cx.shape(p)).unwrap_or_default(),
        data_table: plot
            .and_then(|p| cx.kid(p, "dTable"))
            .map(|d| DataTableModel {
                horz: cx.flag(d, "showHorzBorder").unwrap_or(false),
                vert: cx.flag(d, "showVertBorder").unwrap_or(false),
                outline: cx.flag(d, "showOutline").unwrap_or(false),
                keys: cx.flag(d, "showKeys").unwrap_or(false),
                shape: cx.shape(d),
                text: cx.tx_pr(d),
            }),
        legend: cx.kid(chart, "legend").map(|l| cx.legend(l)),
        space_shape: cx.shape(root),
        text: cx.tx_pr(root),
        style,
        blanks: match cx.val(chart, "dispBlanksAs") {
            Some("zero") => Blanks::Zero,
            Some("span") => Blanks::Span,
            _ => Blanks::Gap,
        },
        date1904: cx.flag(root, "date1904").unwrap_or(false),
        rounded: cx.flag(root, "roundedCorners").unwrap_or(false),
        palette,
        rot_x: cx
            .kid(chart, "view3D")
            .and_then(|v| cx.num(v, "rotX"))
            .map(|r| r.clamp(-90.0, 90.0) as f32),
        rot_y: cx
            .kid(chart, "view3D")
            .and_then(|v| cx.num(v, "rotY"))
            .map(|r| r.rem_euclid(360.0) as f32),
        depth_percent: cx
            .kid(chart, "view3D")
            .and_then(|v| cx.num(v, "depthPercent"))
            .map(|d| d.clamp(20.0, 2000.0) as f32),
        back_wall: wall("backWall"),
        side_wall: wall("sideWall"),
        floor: wall("floor"),
        font: if font.is_empty() {
            "Calibri".to_owned()
        } else {
            font.to_owned()
        },
    })
}

/// `c14:style` inside an `mc:AlternateContent` choice (`val` 101-148).
fn c14_style(doc: &XmlDoc, root: NodeId) -> Option<u32> {
    doc.children(root)
        .filter(|&c| doc.ns(c) == Ns::MC && doc.local(c) == "AlternateContent")
        .flat_map(|ac| doc.children(ac).collect::<Vec<_>>())
        .flat_map(|branch| doc.children(branch).collect::<Vec<_>>())
        .find(|&n| doc.ns(n) == Ns::C14 && doc.local(n) == "style")
        .and_then(|n| doc.attr_i64(n, "val"))
        .map(|v| {
            if v > 100 {
                (v - 100) as u32
            } else {
                v.max(0) as u32
            }
        })
}
