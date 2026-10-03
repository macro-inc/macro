//! Chart rendering (`c:chartSpace` parts).
//!
//! Native charts carry no preview picture, so they are drawn from the data
//! caches stored in the chart part. Formatting the part leaves unspecified
//! gets Office's automatic formatting, and layout follows Office's automatic
//! rules: title on top, legend on its side, axis labels measured to size the
//! plot area (unless a manual layout fixes it).

mod axes;
mod axis;
mod canvas;
mod date;
mod depth;
mod dlabel;
mod legend;
mod look;
mod model;
mod numfmt;
mod parse;
mod pie;
mod plot;
mod radar;
mod series;
mod style;
mod table;
#[cfg(test)]
mod test;
mod ticks;
mod trend;
mod user;

use super::build::Builder;
use super::scene::{Group, Node};
use crate::model::presentation::{PartRef, SlideContext};
use crate::path::{Affine, Path, Point, Rect};
use canvas::Canvas;
use model::{ChartModel, Kind, LegendPos, ManualLayout};
use style::{Role, resolve_fill, resolve_line};

/// Padding between the chart area edge and its content (points).
const PAD: f32 = 5.0;
/// Gap between the title or legend and the plot area (points).
const GAP: f32 = 6.0;

/// Appends the nodes of a chart filling `bbox` (frame-local) under `world`.
pub fn chart_nodes(
    b: &mut Builder<'_>,
    ctx: &SlideContext,
    chart: &PartRef,
    bbox: Rect,
    world: &Affine,
    out: &mut Vec<Node>,
) {
    if !(bbox.w > 1.0 && bbox.h > 1.0) {
        return;
    }
    let theme_override = chart
        .rels
        .iter()
        .find(|r| r.rel_type.ends_with("/themeOverride"))
        .map(|r| chart.rels.resolve(r))
        .and_then(|name| b.loader.part(&name))
        .map(|p| p.doc);
    let Some(m) = parse::parse(chart, ctx, theme_override.as_ref()) else {
        return;
    };
    let mut cv = Canvas {
        fonts: b.fonts,
        images: &mut *b.loader,
        world: *world,
        chart: bbox,
        out: Vec::new(),
    };
    draw(&m, bbox, &mut cv);
    let mut nodes = cv.out;
    user::user_shapes(b, ctx, chart, bbox, world, &mut nodes);
    if !nodes.is_empty() {
        let clip = Path::rect(bbox).transform(world);
        out.push(
            Group {
                children: nodes,
                opacity: 1.0,
                clip: Some(clip),
                effects: Vec::new(),
            }
            .into_node(),
        );
    }
}

/// Resolves a manual layout against the chart rectangle and the automatic position.
fn layout_rect(l: &ManualLayout, chart: Rect, auto: Rect) -> Rect {
    let x = match l.x {
        Some(v) if l.x_edge => chart.x + v as f32 * chart.w,
        Some(v) => auto.x + v as f32 * chart.w,
        None => auto.x,
    };
    let y = match l.y {
        Some(v) if l.y_edge => chart.y + v as f32 * chart.h,
        Some(v) => auto.y + v as f32 * chart.h,
        None => auto.y,
    };
    let w = match l.w {
        Some(v) if l.w_edge => chart.x + v as f32 * chart.w - x,
        Some(v) => v as f32 * chart.w,
        None => auto.w,
    };
    let h = match l.h {
        Some(v) if l.h_edge => chart.y + v as f32 * chart.h - y,
        Some(v) => v as f32 * chart.h,
        None => auto.h,
    };
    Rect::from_xywh(x, y, w.max(1.0), h.max(1.0))
}

/// The chart title's text, or `None` when no title shows.
fn title_paras(m: &ChartModel) -> Option<Vec<(crate::render::label::HAlign, Vec<canvas::Span>)>> {
    let series: Vec<&model::SeriesModel> = m.groups.iter().flat_map(|g| g.series.iter()).collect();
    let single = (series.len() == 1)
        .then(|| series[0].name.clone())
        .flatten();
    let base = m.base_text(Role::Title);
    match &m.title {
        Some(t) => Some(plot::title_paras(
            t,
            &base,
            single.as_deref().unwrap_or("Chart Title"),
        )),
        None if !m.auto_title_deleted => {
            let name = single?;
            let t = model::TitleModel::default();
            Some(plot::title_paras(&t, &base, &name))
        }
        None => None,
    }
}

fn draw(m: &ChartModel, bbox: Rect, cv: &mut Canvas<'_>) {
    let area_path = if m.rounded {
        rounded_rect(bbox, bbox.w.min(bbox.h) * 0.05)
    } else {
        Path::rect(bbox)
    };
    let fill = resolve_fill(&m.space_shape, None);
    cv.shape(&area_path, fill.as_ref(), None, bbox);
    let mut avail = Rect::from_ltrb(
        bbox.x + PAD,
        bbox.y + PAD,
        bbox.right() - PAD,
        bbox.bottom() - PAD,
    );

    // Title.
    let mut title = None;
    if let Some(paras) = title_paras(m) {
        let block = cv.layout(&paras, bbox.w * 0.8);
        if !block.is_empty() {
            let t = m.title.clone().unwrap_or_default();
            let rot = t
                .rich
                .as_ref()
                .and_then(|r| r.rot)
                .or(t.tx_pr.rot)
                .unwrap_or(0.0);
            let (w, h) = block.rotated_size(rot);
            let auto = Rect::from_xywh(bbox.x + (bbox.w - w) / 2.0, bbox.y + PAD, w, h);
            let rect = t.layout.as_ref().map_or(auto, |l| {
                let r = layout_rect(l, bbox, auto);
                Rect::from_xywh(r.x, r.y, w, h)
            });
            // A title in the upper half keeps the plot below it unless it overlays.
            if !t.overlay && rect.y + rect.h / 2.0 < bbox.y + bbox.h / 2.0 {
                avail = Rect::from_ltrb(
                    avail.x,
                    avail.y.max(rect.bottom() + GAP),
                    avail.right(),
                    avail.bottom(),
                );
            }
            title = Some((block, rot, rect, t));
        }
    }

    // Legend.
    let mut legend = None;
    if let Some(lm) = &m.legend {
        let entries = legend::entries(m, lm);
        let manual = lm.layout.as_ref().map(|l| layout_rect(l, bbox, avail));
        if let Some(placed) = legend::place(cv, &entries, lm.pos, avail, manual) {
            if !lm.overlay {
                let r = placed.rect;
                // The plot avoids the legend (a manually placed one too).
                let next = match lm.pos {
                    LegendPos::Right | LegendPos::TopRight => Rect::from_ltrb(
                        avail.x,
                        avail.y,
                        avail.right().min(r.x - GAP),
                        avail.bottom(),
                    ),
                    LegendPos::Left => Rect::from_ltrb(
                        avail.x.max(r.right() + GAP),
                        avail.y,
                        avail.right(),
                        avail.bottom(),
                    ),
                    LegendPos::Top => Rect::from_ltrb(
                        avail.x,
                        avail.y.max(r.bottom() + GAP),
                        avail.right(),
                        avail.bottom(),
                    ),
                    LegendPos::Bottom => Rect::from_ltrb(
                        avail.x,
                        avail.y,
                        avail.right(),
                        avail.bottom().min(r.y - GAP),
                    ),
                };
                if next.w > avail.w * 0.3 && next.h > avail.h * 0.3 {
                    avail = next;
                }
            }
            legend = Some((entries, placed, lm));
        }
    }
    if avail.w < 4.0 || avail.h < 4.0 {
        avail = Rect::from_xywh(
            bbox.x + bbox.w * 0.1,
            bbox.y + bbox.h * 0.1,
            bbox.w * 0.8,
            bbox.h * 0.8,
        );
    }

    // Plot area.
    let manual = m
        .plot_layout
        .as_ref()
        .map(|l| (clamp_into(layout_rect(l, bbox, avail), bbox), l.inner));
    let mut labels = Vec::new();
    match m.groups.first() {
        Some(g) if matches!(g.kind, Kind::Pie | Kind::Doughnut) => {
            pie::pie(cv, m, g, avail, manual.map(|(r, _)| r), bbox, &mut labels);
        }
        Some(g) if g.kind == Kind::Radar => {
            radar::radar(cv, m, g, avail, manual.map(|(r, _)| r), bbox, &mut labels);
        }
        Some(_) => {
            if let Some(mut p) = plot::Plot::new(m) {
                p.layout(cv, avail, manual);
                p.draw_back(cv);
                series::draw(cv, &p, bbox, &mut labels);
                p.draw_front(cv);
            }
        }
        None => {}
    }
    dlabel::draw_all(cv, &labels);

    if let Some((entries, placed, lm)) = &legend {
        legend::draw(cv, m, lm, entries, placed);
    }
    if let Some((block, rot, rect, t)) = &title {
        let fill = resolve_fill(&t.shape, None);
        let line = resolve_line(t.shape.line.as_ref(), None);
        cv.shape(&Path::rect(*rect), fill.as_ref(), line.as_ref(), *rect);
        cv.block(
            block,
            Point::new(rect.x + rect.w / 2.0, rect.y + rect.h / 2.0),
            *rot,
        );
    }
    if let Some(l) = resolve_line(m.space_shape.line.as_ref(), None) {
        cv.stroke(&area_path, &l);
    }
}

/// Keeps a manual rectangle inside the chart (Office never draws the plot outside it).
fn clamp_into(r: Rect, chart: Rect) -> Rect {
    let l = r.x.clamp(chart.x, chart.right() - 1.0);
    let t = r.y.clamp(chart.y, chart.bottom() - 1.0);
    let rr = r.right().clamp(l + 1.0, chart.right());
    let b = r.bottom().clamp(t + 1.0, chart.bottom());
    Rect::from_ltrb(l, t, rr, b)
}

fn rounded_rect(r: Rect, rad: f32) -> Path {
    let mut p = Path::new();
    let k = rad.min(r.w / 2.0).min(r.h / 2.0);
    p.move_to(Point::new(r.x + k, r.y));
    p.line_to(Point::new(r.right() - k, r.y));
    p.quad_to(Point::new(r.right(), r.y), Point::new(r.right(), r.y + k));
    p.line_to(Point::new(r.right(), r.bottom() - k));
    p.quad_to(
        Point::new(r.right(), r.bottom()),
        Point::new(r.right() - k, r.bottom()),
    );
    p.line_to(Point::new(r.x + k, r.bottom()));
    p.quad_to(Point::new(r.x, r.bottom()), Point::new(r.x, r.bottom() - k));
    p.line_to(Point::new(r.x, r.y + k));
    p.quad_to(Point::new(r.x, r.y), Point::new(r.x + k, r.y));
    p.close();
    p
}
