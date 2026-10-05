use super::*;
use crate::model::{Document, Gradient, PatternFill};
use crate::render::cache::Cache;

/// A hard square shape over `rect`.
fn square(rect: IRect, inside: IRect) -> Plane {
    let mut p = Plane::filled(rect, 0.0);
    let mut i = 0;
    for y in rect.y..rect.bottom() {
        for x in rect.x..rect.right() {
            if inside.contains(x, y) {
                p.v[i] = 1.0;
            }
            i += 1;
        }
    }
    p
}

fn shadow(distance: f32, size: f32, spread: f32) -> Shadow {
    Shadow {
        enabled: true,
        blend: BlendMode::Multiply,
        color: Rgb::BLACK,
        opacity: 1.0,
        angle: 90.0,
        use_global_light: false,
        distance,
        spread,
        size,
        noise: 0.0,
        contour: Contour::default(),
        knocks_out: true,
    }
}

fn glow(size: f32, technique: GlowTechnique, source: GlowSource) -> Glow {
    Glow {
        enabled: true,
        blend: BlendMode::Screen,
        color: Rgb::WHITE,
        gradient: None,
        opacity: 1.0,
        noise: 0.0,
        technique,
        spread: 0.0,
        size,
        contour: Contour::default(),
        range: 1.0,
        jitter: 0.0,
        source,
    }
}

/// Renders effects of a 20×20 square at (40, 40) over the area around it.
fn run(fx: &Effects) -> (Stages, IRect) {
    let doc = Document::new(120, 120);
    let mut cache = Cache::default();
    let mut cx = Cx::new(&doc, 0, &mut cache, true);
    let region = IRect::new(0, 0, 120, 120);
    let shape = square(region.outset(margin(fx, 1.0)), IRect::new(40, 40, 20, 20));
    let stages = render(
        &mut cx,
        fx,
        &Inputs {
            shape: &shape,
            region,
            frame: IRect::new(40, 40, 20, 20),
        },
    );
    (stages, region)
}

#[test]
fn drop_shadows_fall_away_from_the_light() {
    // Light from above (90°), 10 px, hard.
    let fx = Effects {
        drop_shadows: vec![shadow(10.0, 0.0, 0.0)],
        ..Effects::default()
    };
    let (s, _) = run(&fx);
    let st = &s.below[0];
    assert!(st.knocked_out);
    assert_eq!(st.cov.get(50, 65), 1.0);
    assert_eq!(st.cov.get(50, 69), 1.0);
    assert_eq!(st.cov.get(50, 70), 0.0);
    assert_eq!(st.cov.get(50, 49), 0.0);
    // Light from the left (180°) casts to the right.
    let mut right = shadow(5.0, 0.0, 0.0);
    right.angle = 180.0;
    let (s, _) = run(&Effects {
        drop_shadows: vec![right],
        ..Effects::default()
    });
    assert_eq!(s.below[0].cov.get(64, 50), 1.0);
    assert_eq!(s.below[0].cov.get(65, 50), 0.0);
}

#[test]
fn shadow_size_blurs_over_its_extent_and_spread_hardens() {
    let (s, _) = run(&Effects {
        drop_shadows: vec![shadow(0.0, 12.0, 0.0)],
        ..Effects::default()
    });
    let c = &s.below[0].cov;
    // Half at the edge, mirrored around it, gone by the size.
    assert!(((c.get(39, 50) + c.get(40, 50)) / 2.0 - 0.5).abs() < 0.03);
    assert!(c.get(36, 50) < 0.25 && c.get(36, 50) > 0.0);
    assert!(c.get(40 - 13, 50) < 0.01);
    assert!(c.get(50, 50) > 0.9);
    // Full spread: a hard shape grown by the size.
    let (s, _) = run(&Effects {
        drop_shadows: vec![shadow(0.0, 6.0, 1.0)],
        ..Effects::default()
    });
    let c = &s.below[0].cov;
    assert_eq!(c.get(34, 50), 1.0);
    assert_eq!(c.get(33, 50), 0.0);
}

#[test]
fn inner_shadows_line_the_lit_edge() {
    let mut inner = shadow(4.0, 0.0, 0.0);
    inner.blend = BlendMode::Multiply;
    let (s, _) = run(&Effects {
        inner_shadows: vec![inner],
        ..Effects::default()
    });
    let c = &s.inside[0].cov;
    // Light from above: the shadow is along the top inside edge.
    assert_eq!(c.get(50, 40), 1.0);
    assert_eq!(c.get(50, 43), 1.0);
    assert_eq!(c.get(50, 44), 0.0);
    assert_eq!(c.get(50, 58), 0.0);
}

#[test]
fn glows_fade_out_and_in() {
    let (s, _) = run(&Effects {
        outer_glows: vec![glow(10.0, GlowTechnique::Precise, GlowSource::Edge)],
        ..Effects::default()
    });
    let c = &s.below[0].cov;
    assert!(s.below[0].knocked_out);
    // Precise: linear from the edge out to the size (range 100%).
    assert!((c.get(35, 50) - 0.55).abs() < 0.06, "{}", c.get(35, 50));
    assert!(c.get(30, 50) < 0.06);
    assert_eq!(c.get(25, 50), 0.0);
    let (s, _) = run(&Effects {
        inner_glows: vec![glow(6.0, GlowTechnique::Softer, GlowSource::Edge)],
        ..Effects::default()
    });
    let edge = &s.inside[0].cov;
    assert!(edge.get(40, 50) > edge.get(45, 50));
    assert!(edge.get(50, 50) < 0.01);
    let (s, _) = run(&Effects {
        inner_glows: vec![glow(6.0, GlowTechnique::Softer, GlowSource::Center)],
        ..Effects::default()
    });
    let center = &s.inside[0].cov;
    assert!(center.get(50, 50) > 0.99 && center.get(40, 50) < center.get(45, 50));
}

#[test]
fn strokes_take_their_width_outside_inside_or_centered() {
    let stroke = |position| StrokeEffect {
        enabled: true,
        blend: BlendMode::Normal,
        opacity: 1.0,
        size: 4.0,
        position,
        fill: Fill::Solid { color: Rgb::BLACK },
    };
    let (s, _) = run(&Effects {
        strokes: vec![stroke(StrokePosition::Outside)],
        ..Effects::default()
    });
    assert!(s.inside.is_empty());
    let band = &s.beside[0].cov;
    let row: Vec<f32> = (34..42).map(|x| band.get(x, 50)).collect();
    assert_eq!(row, [0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]);
    let (s, _) = run(&Effects {
        strokes: vec![stroke(StrokePosition::Inside)],
        ..Effects::default()
    });
    assert!(s.beside.is_empty());
    let inner = &s.inside[0].cov;
    let row: Vec<f32> = (38..46).map(|x| inner.get(x, 50)).collect();
    assert_eq!(row, [0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0]);
    let (s, _) = run(&Effects {
        strokes: vec![stroke(StrokePosition::Center)],
        ..Effects::default()
    });
    assert_eq!(
        (s.beside[0].cov.get(38, 50), s.beside[0].cov.get(37, 50)),
        (1.0, 0.0)
    );
    assert_eq!(
        (s.inside[0].cov.get(41, 50), s.inside[0].cov.get(42, 50)),
        (1.0, 0.0)
    );
}

#[test]
fn overlays_stack_pattern_then_gradient_then_color() {
    let overlay = |fill: Fill, blend| Overlay {
        enabled: true,
        blend,
        opacity: 1.0,
        fill,
    };
    let fx = Effects {
        color_overlays: vec![overlay(
            Fill::Solid { color: Rgb::WHITE },
            BlendMode::Screen,
        )],
        gradient_overlays: vec![overlay(
            Fill::Gradient {
                gradient: Gradient::default(),
            },
            BlendMode::Multiply,
        )],
        pattern_overlays: vec![overlay(
            Fill::Pattern {
                pattern: PatternFill {
                    pattern: "none".into(),
                    name: String::new(),
                    scale: 1.0,
                    angle: 0.0,
                    align_with_layer: true,
                    phase: (0.0, 0.0),
                },
            },
            BlendMode::Darken,
        )],
        ..Effects::default()
    };
    let (s, _) = run(&fx);
    let modes: Vec<BlendMode> = s.inside.iter().map(|st| st.mode).collect();
    assert_eq!(
        modes,
        [BlendMode::Darken, BlendMode::Multiply, BlendMode::Screen]
    );
    // The whole shape, with the overlay's color.
    assert_eq!(s.inside[2].at(0), ([1.0, 1.0, 1.0], 1.0));
}

#[test]
fn bevels_light_the_side_facing_the_light() {
    let fx = Effects {
        bevels: vec![Bevel {
            enabled: true,
            style: BevelStyle::InnerBevel,
            technique: BevelTechnique::Smooth,
            depth: 1.0,
            up: true,
            size: 5.0,
            soften: 0.0,
            angle: 90.0,
            altitude: 30.0,
            use_global_light: false,
            highlight_blend: BlendMode::Screen,
            highlight_color: Rgb::WHITE,
            highlight_opacity: 1.0,
            shadow_blend: BlendMode::Multiply,
            shadow_color: Rgb::BLACK,
            shadow_opacity: 1.0,
            gloss: Contour::default(),
            contour: None,
        }],
        ..Effects::default()
    };
    let (s, _) = run(&fx);
    let (shadow, highlight) = (&s.inside[0].cov, &s.inside[1].cov);
    // Light from above: the top slope is lit, the bottom one shaded.
    assert!(highlight.get(50, 42) > 0.3 && shadow.get(50, 42) < 0.05);
    assert!(shadow.get(50, 57) > 0.3 && highlight.get(50, 57) < 0.05);
    // The flat middle is neither.
    assert!(highlight.get(50, 50) < 0.05 && shadow.get(50, 50) < 0.05);
}

#[test]
fn satins_shade_inside_and_effects_can_be_off() {
    let fx = Effects {
        satins: vec![Satin {
            enabled: true,
            blend: BlendMode::Multiply,
            color: Rgb::BLACK,
            opacity: 0.5,
            angle: 0.0,
            distance: 5.0,
            size: 4.0,
            invert: false,
            contour: Contour::default(),
        }],
        ..Effects::default()
    };
    let (s, _) = run(&fx);
    let c = &s.inside[0].cov;
    assert!(c.get(42, 50) > 0.3, "{}", c.get(42, 50));
    assert!(c.get(50, 50) < 0.05);
    let off = Effects {
        enabled: false,
        ..fx
    };
    let (s, _) = run(&off);
    assert!(s.inside.is_empty());
    assert_eq!(margin(&off, 1.0), 0);
}

#[test]
fn margins_cover_offsets_and_blurs() {
    let fx = Effects {
        drop_shadows: vec![shadow(10.0, 12.0, 0.0)],
        ..Effects::default()
    };
    let m = margin(&fx, 1.0);
    assert!(m >= 10 + 12, "{m}");
    assert!(margin(&fx, 0.25) < m);
    // The style's scale is how its sizes were scaled already.
    let scaled = Effects { scale: 2.0, ..fx };
    assert_eq!(margin(&scaled, 1.0), m);
}
