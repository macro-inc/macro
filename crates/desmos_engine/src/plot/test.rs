use super::*;
use crate::document::GraphDocument;

fn scene(latex: &str) -> PlotScene {
    let mut doc = GraphDocument::default();
    doc.set_latex("1", latex.into()).unwrap();
    plot(&doc)
}

#[test]
fn plots_a_parabola_across_the_window() {
    let scene = scene("y=x^2");
    let Some(PlotItem::Polyline { points, .. }) = scene
        .items
        .iter()
        .find(|item| matches!(item, PlotItem::Polyline { .. }))
    else {
        panic!("{:?}", scene.items);
    };
    assert!(points.len() > 100);
    let mid = points
        .iter()
        .min_by(|a, b| a[0].abs().total_cmp(&b[0].abs()))
        .unwrap();
    assert!(mid[1].abs() < 0.2);
}

#[test]
fn plots_a_circle_implicitly() {
    let scene = scene("x^2+y^2=25");
    let points: usize = scene
        .items
        .iter()
        .map(|item| match item {
            PlotItem::Polyline { points, .. } => points.len(),
            _ => 0,
        })
        .sum();
    assert!(points > 40);
}

#[test]
fn plots_a_point() {
    let scene = scene("(3,4)");
    assert!(
        scene
            .items
            .iter()
            .any(|item| matches!(item, PlotItem::Point { x, y, .. } if (*x - 3.0).abs() < 1e-9 && (*y - 4.0).abs() < 1e-9))
    );
}

#[test]
fn shades_an_inequality() {
    let scene = scene("y>x");
    assert!(
        scene
            .items
            .iter()
            .any(|item| matches!(item, PlotItem::Fill { .. }))
    );
}

#[test]
fn plots_a_polar_rose() {
    let scene = scene("r=2sin(3theta)");
    let points: usize = scene
        .items
        .iter()
        .map(|item| match item {
            PlotItem::Polyline { points, .. } => points.len(),
            _ => 0,
        })
        .sum();
    assert!(points > 100);
}

#[test]
fn plots_a_parametric_circle() {
    let scene = scene("(cos(t), sin(t))");
    let points: usize = scene
        .items
        .iter()
        .map(|item| match item {
            PlotItem::Polyline { points, .. } => points.len(),
            _ => 0,
        })
        .sum();
    assert!(points > 100);
}

#[test]
fn restriction_drops_the_left_half() {
    let scene = scene("y=x {x>0}");
    let Some(PlotItem::Polyline { points, .. }) = scene
        .items
        .iter()
        .find(|item| matches!(item, PlotItem::Polyline { .. }))
    else {
        panic!("{:?}", scene.items);
    };
    assert!(points.iter().all(|p| p[0] >= -1e-6));
}
