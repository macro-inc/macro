//! Sample explicit curves, implicit contours, inequalities, and points.

use crate::document::{Expression, GraphDocument, Viewport};
use crate::eval::{Env, cmp};
use crate::expr::{Expr, RelationKind, Restriction, Statement};
use crate::parse::parse_statement;
use serde::{Deserialize, Serialize};

/// One drawable produced for the graph paper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PlotItem {
    /// A stroke in graph units.
    Polyline {
        /// Owning expression.
        id: String,
        /// Hex color.
        color: String,
        /// Connected samples.
        points: Vec<[f64; 2]>,
    },
    /// A filled region (inequality).
    Fill {
        /// Owning expression.
        id: String,
        /// Hex color.
        color: String,
        /// Axis-aligned cell.
        rect: [f64; 4],
    },
    /// A plotted point.
    Point {
        /// Owning expression.
        id: String,
        /// Hex color.
        color: String,
        /// X.
        x: f64,
        /// Y.
        y: f64,
    },
    /// A parse or eval problem for that row.
    Error {
        /// Owning expression.
        id: String,
        /// Human-readable reason.
        message: String,
    },
}

/// Everything the UI needs to paint one frame.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlotScene {
    /// Current window.
    pub viewport: Viewport,
    /// Drawables, back to front.
    pub items: Vec<PlotItem>,
    /// Parameters the user can still add sliders for.
    pub needed_sliders: Vec<String>,
}

const EXPLICIT_SAMPLES: usize = 960;
const IMPLICIT_CELLS: usize = 128;
const FILL_CELLS: usize = 96;
const POLAR_SAMPLES: usize = 720;
const PARAMETRIC_SAMPLES: usize = 720;

/// Plot every visible expression.
pub fn plot(document: &GraphDocument) -> PlotScene {
    let env = document.env();
    let mut items = Vec::new();
    for expr in &document.expressions {
        if expr.hidden || expr.latex.trim().is_empty() {
            continue;
        }
        match parse_statement(&expr.latex) {
            Ok(Statement::Assignment { .. } | Statement::Function { .. }) => {}
            Ok(stmt) => plot_statement(expr, &stmt, &env, document.viewport, &mut items),
            Err(error) => items.push(PlotItem::Error {
                id: expr.id.clone(),
                message: error.to_string(),
            }),
        }
    }
    PlotScene {
        viewport: document.viewport,
        items,
        needed_sliders: document.needed_sliders(),
    }
}

fn plot_statement(
    expr: &Expression,
    stmt: &Statement,
    env: &Env,
    viewport: Viewport,
    items: &mut Vec<PlotItem>,
) {
    let Statement::Relation {
        left,
        kind,
        right,
        restrict,
    } = stmt
    else {
        return;
    };
    if let Expr::Point(x, y) = right
        && left.is_none()
    {
        if x.uses("t") || y.uses("t") {
            sample_parametric(expr, x, y, restrict, env, viewport, items);
            return;
        }
        match (env.eval(x), env.eval(y)) {
            (Ok(x), Ok(y)) if x.is_finite() && y.is_finite() && allowed(env, restrict, x, y) => {
                items.push(PlotItem::Point {
                    id: expr.id.clone(),
                    color: expr.color.clone(),
                    x,
                    y,
                });
            }
            (Err(error), _) | (_, Err(error)) => items.push(PlotItem::Error {
                id: expr.id.clone(),
                message: error.to_string(),
            }),
            _ => {}
        }
        return;
    }

    let lhs = left.clone().unwrap_or(Expr::Name("y".into()));
    if *kind != RelationKind::Equal {
        fill_inequality(expr, &lhs, *kind, right, restrict, env, viewport, items);
        return;
    }

    if is_name(&lhs, "r") {
        sample_polar(expr, right, restrict, env, items);
        return;
    }
    if is_name(&lhs, "y") && !right.uses("y") {
        sample_explicit(expr, true, right, restrict, env, viewport, items);
        return;
    }
    if is_name(&lhs, "x") && !right.uses("x") {
        sample_explicit(expr, false, right, restrict, env, viewport, items);
        return;
    }
    implicit_contour(expr, &lhs, right, restrict, env, viewport, items);
}

fn is_name(expr: &Expr, name: &str) -> bool {
    matches!(expr, Expr::Name(n) if n == name)
}

fn allowed(env: &Env, restrict: &[Restriction], x: f64, y: f64) -> bool {
    if restrict.is_empty() {
        return true;
    }
    let mut child = env.clone();
    child.set("x", x);
    child.set("y", y);
    restrict
        .iter()
        .all(|r| match (child.eval(&r.left), child.eval(&r.right)) {
            (Ok(l), Ok(rv)) => cmp(r.kind, l, rv),
            _ => false,
        })
}

fn sample_explicit(
    expr: &Expression,
    y_of_x: bool,
    body: &Expr,
    restrict: &[Restriction],
    env: &Env,
    viewport: Viewport,
    items: &mut Vec<PlotItem>,
) {
    let (start, end) = if y_of_x {
        (viewport.xmin, viewport.xmax)
    } else {
        (viewport.ymin, viewport.ymax)
    };
    let span = if y_of_x {
        viewport.ymax - viewport.ymin
    } else {
        viewport.xmax - viewport.xmin
    };
    let mut current = Vec::new();
    let mut prev: Option<(f64, f64)> = None;
    for i in 0..EXPLICIT_SAMPLES {
        let t = start + (end - start) * i as f64 / (EXPLICIT_SAMPLES - 1) as f64;
        let mut child = env.clone();
        if y_of_x {
            child.set("x", t);
        } else {
            child.set("y", t);
        }
        let Ok(value) = child.eval(body) else {
            flush_line(expr, &mut current, items);
            prev = None;
            continue;
        };
        if !value.is_finite() {
            flush_line(expr, &mut current, items);
            prev = None;
            continue;
        }
        let point = if y_of_x { [t, value] } else { [value, t] };
        if !allowed(env, restrict, point[0], point[1]) {
            flush_line(expr, &mut current, items);
            prev = None;
            continue;
        }
        if let Some((_, prev_v)) = prev
            && (value - prev_v).abs() > span * 0.55
        {
            flush_line(expr, &mut current, items);
        }
        current.push(point);
        prev = Some((t, value));
    }
    flush_line(expr, &mut current, items);
}

fn flush_line(expr: &Expression, points: &mut Vec<[f64; 2]>, items: &mut Vec<PlotItem>) {
    if points.len() >= 2 {
        items.push(PlotItem::Polyline {
            id: expr.id.clone(),
            color: expr.color.clone(),
            points: std::mem::take(points),
        });
    } else {
        points.clear();
    }
}

fn sample_polar(
    expr: &Expression,
    body: &Expr,
    restrict: &[Restriction],
    env: &Env,
    items: &mut Vec<PlotItem>,
) {
    let mut current = Vec::new();
    for i in 0..POLAR_SAMPLES {
        let theta = std::f64::consts::TAU * i as f64 / (POLAR_SAMPLES - 1) as f64;
        let mut child = env.clone();
        child.set("theta", theta);
        let Ok(r) = child.eval(body) else {
            flush_line(expr, &mut current, items);
            continue;
        };
        if !r.is_finite() {
            flush_line(expr, &mut current, items);
            continue;
        }
        let x = r * theta.cos();
        let y = r * theta.sin();
        if !allowed(env, restrict, x, y) {
            flush_line(expr, &mut current, items);
            continue;
        }
        current.push([x, y]);
    }
    flush_line(expr, &mut current, items);
}

fn sample_parametric(
    expr: &Expression,
    x_body: &Expr,
    y_body: &Expr,
    restrict: &[Restriction],
    env: &Env,
    viewport: Viewport,
    items: &mut Vec<PlotItem>,
) {
    let _ = viewport;
    let mut current = Vec::new();
    for i in 0..PARAMETRIC_SAMPLES {
        let t = std::f64::consts::TAU * i as f64 / (PARAMETRIC_SAMPLES - 1) as f64;
        let mut child = env.clone();
        child.set("t", t);
        let (Ok(x), Ok(y)) = (child.eval(x_body), child.eval(y_body)) else {
            flush_line(expr, &mut current, items);
            continue;
        };
        if !x.is_finite() || !y.is_finite() || !allowed(env, restrict, x, y) {
            flush_line(expr, &mut current, items);
            continue;
        }
        current.push([x, y]);
    }
    flush_line(expr, &mut current, items);
}

fn implicit_contour(
    expr: &Expression,
    left: &Expr,
    right: &Expr,
    restrict: &[Restriction],
    env: &Env,
    viewport: Viewport,
    items: &mut Vec<PlotItem>,
) {
    let cols = IMPLICIT_CELLS;
    let rows = IMPLICIT_CELLS;
    let mut grid = vec![f64::NAN; (cols + 1) * (rows + 1)];
    for iy in 0..=rows {
        let y = viewport.ymin + (viewport.ymax - viewport.ymin) * iy as f64 / rows as f64;
        for ix in 0..=cols {
            let x = viewport.xmin + (viewport.xmax - viewport.xmin) * ix as f64 / cols as f64;
            grid[iy * (cols + 1) + ix] = residual(left, right, env, x, y);
        }
    }
    let mut current = Vec::new();
    for iy in 0..rows {
        for ix in 0..cols {
            let i00 = iy * (cols + 1) + ix;
            let i10 = i00 + 1;
            let i01 = i00 + (cols + 1);
            let i11 = i01 + 1;
            let v = [grid[i00], grid[i10], grid[i11], grid[i01]];
            if v.iter().any(|n| !n.is_finite()) {
                continue;
            }
            let cx =
                viewport.xmin + (viewport.xmax - viewport.xmin) * (ix as f64 + 0.5) / cols as f64;
            let cy =
                viewport.ymin + (viewport.ymax - viewport.ymin) * (iy as f64 + 0.5) / rows as f64;
            if !allowed(env, restrict, cx, cy) {
                continue;
            }
            let x0 = viewport.xmin + (viewport.xmax - viewport.xmin) * ix as f64 / cols as f64;
            let x1 =
                viewport.xmin + (viewport.xmax - viewport.xmin) * (ix + 1) as f64 / cols as f64;
            let y0 = viewport.ymin + (viewport.ymax - viewport.ymin) * iy as f64 / rows as f64;
            let y1 =
                viewport.ymin + (viewport.ymax - viewport.ymin) * (iy + 1) as f64 / rows as f64;
            let corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
            let mut pts = Vec::new();
            for i in 0..4 {
                let j = (i + 1) % 4;
                if v[i] == 0.0 {
                    pts.push(corners[i]);
                }
                if v[i] * v[j] < 0.0 {
                    let t = v[i] / (v[i] - v[j]);
                    pts.push([
                        corners[i][0] + t * (corners[j][0] - corners[i][0]),
                        corners[i][1] + t * (corners[j][1] - corners[i][1]),
                    ]);
                }
            }
            for pair in pts.chunks(2) {
                if pair.len() != 2 {
                    continue;
                }
                if current.last() != Some(&pair[0]) {
                    flush_line(expr, &mut current, items);
                    current.push(pair[0]);
                }
                current.push(pair[1]);
            }
        }
    }
    flush_line(expr, &mut current, items);
}

#[expect(
    clippy::too_many_arguments,
    reason = "plot inputs stay explicit at the call site"
)]
fn fill_inequality(
    expr: &Expression,
    left: &Expr,
    kind: RelationKind,
    right: &Expr,
    restrict: &[Restriction],
    env: &Env,
    viewport: Viewport,
    items: &mut Vec<PlotItem>,
) {
    let cols = FILL_CELLS;
    let rows = FILL_CELLS;
    let dx = (viewport.xmax - viewport.xmin) / cols as f64;
    let dy = (viewport.ymax - viewport.ymin) / rows as f64;
    for iy in 0..rows {
        let y = viewport.ymin + (iy as f64 + 0.5) * dy;
        let mut run: Option<usize> = None;
        for ix in 0..=cols {
            let inside = if ix < cols {
                let x = viewport.xmin + (ix as f64 + 0.5) * dx;
                let value = residual(left, right, env, x, y);
                value.is_finite()
                    && allowed(env, restrict, x, y)
                    && match kind {
                        RelationKind::Lt => value < 0.0,
                        RelationKind::Gt => value > 0.0,
                        RelationKind::Le => value <= 0.0,
                        RelationKind::Ge => value >= 0.0,
                        RelationKind::Equal => false,
                    }
            } else {
                false
            };
            match (inside, run) {
                (true, None) => run = Some(ix),
                (false, Some(start)) => {
                    let x0 = viewport.xmin + start as f64 * dx;
                    items.push(PlotItem::Fill {
                        id: expr.id.clone(),
                        color: expr.color.clone(),
                        rect: [x0, y - dy / 2.0, (ix - start) as f64 * dx, dy],
                    });
                    run = None;
                }
                _ => {}
            }
        }
    }
    implicit_contour(expr, left, right, restrict, env, viewport, items);
}

fn residual(left: &Expr, right: &Expr, env: &Env, x: f64, y: f64) -> f64 {
    let mut child = env.clone();
    child.set("x", x);
    child.set("y", y);
    match (child.eval(left), child.eval(right)) {
        (Ok(l), Ok(r)) => l - r,
        _ => f64::NAN,
    }
}

#[cfg(test)]
mod test;
