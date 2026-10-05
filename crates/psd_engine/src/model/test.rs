use super::*;

#[test]
fn blend_keys_round_trip() {
    for mode in BlendMode::ALL {
        assert_eq!(BlendMode::from_key(&mode.key()), Some(mode));
    }
    assert_eq!(BlendMode::from_key(b"what"), None);
}

#[test]
fn color_modes_round_trip() {
    for code in 0..=9 {
        if let Some(mode) = ColorMode::from_code(code) {
            assert_eq!(mode.code(), code);
        }
    }
    assert_eq!(ColorMode::from_code(5), None);
}

#[test]
fn hex_colors() {
    let c = Rgb::parse_hex("#ff8000").unwrap();
    assert_eq!(c.to_u8(), [255, 128, 0]);
    assert_eq!(c.hex(), "#ff8000");
    assert!(Rgb::parse_hex("#ff80").is_none());
}

#[test]
fn gradient_samples_follow_stops_and_midpoints() {
    let mut g = Gradient::default();
    g.smoothness = 0.0;
    assert_eq!(g.sample(0.0), [0.0, 0.0, 0.0, 1.0]);
    assert_eq!(g.sample(1.0), [1.0, 1.0, 1.0, 1.0]);
    let mid = g.sample(0.5);
    assert!((mid[0] - 0.5).abs() < 1e-6);
    // Moving the midpoint toward the first stop brightens the middle.
    g.colors[0].midpoint = 0.25;
    assert!(g.sample(0.5)[0] > 0.6);
    let lut = Gradient {
        reverse: true,
        ..Gradient::default()
    }
    .lut();
    assert_eq!(lut[0], [255, 255, 255, 255]);
    assert_eq!(lut[255], [0, 0, 0, 255]);
}

#[test]
fn contours_interpolate() {
    let c = Contour::default();
    assert_eq!(c.apply(0.25), 0.25);
    let cone = Contour {
        name: "Cone".into(),
        points: vec![(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)],
    };
    assert_eq!(cone.apply(0.5), 1.0);
    assert_eq!(cone.apply(0.75), 0.5);
}

fn sample_document() -> Document {
    let mut doc = Document::new(100, 50);
    let bg = doc.push_layer(Layer::new(1, "Background"));
    let mut group = Layer::new(2, "Group");
    group.kind = LayerKind::Group { open: true };
    let group = doc.push_layer(group);
    let inner = doc.push_layer(Layer::new(3, "Inner"));
    doc.layer_mut(inner).parent = Some(group);
    doc.layer_mut(group).children.push(inner);
    doc.roots = vec![bg, group];
    doc
}

#[test]
fn orders_and_lookups() {
    let mut doc = sample_document();
    assert_eq!(doc.panel_order(), vec![(1, 0), (2, 1), (0, 0)]);
    assert_eq!(doc.paint_order(), vec![0, 1, 2]);
    assert_eq!(doc.find(3), Some(2));
    assert!(doc.is_within(2, 1));
    assert!(!doc.is_within(0, 1));
    assert!(doc.is_shown(2));
    doc.layer_mut(1).visible = false;
    assert!(!doc.is_shown(2));
    assert_eq!(doc.siblings(2), &[2]);
}

#[test]
fn composite_stale_areas_merge() {
    let mut c = Composite {
        raster: Raster::rgba(),
        stale: Vec::new(),
    };
    c.invalidate(IRect::new(0, 0, 10, 10));
    c.invalidate(IRect::new(2, 2, 3, 3));
    assert_eq!(c.stale.len(), 1);
    c.invalidate(IRect::new(-5, -5, 30, 30));
    assert_eq!(c.stale, vec![IRect::new(-5, -5, 30, 30)]);
    assert!(!c.covers(&IRect::new(0, 0, 1, 1)));
    assert!(c.covers(&IRect::new(100, 100, 1, 1)));
}

#[test]
fn effect_reach_covers_shadows() {
    let mut fx = Effects::default();
    assert_eq!(fx.reach(), 2);
    fx.drop_shadows.push(Shadow {
        enabled: true,
        blend: BlendMode::Multiply,
        color: Rgb::BLACK,
        opacity: 0.75,
        angle: 120.0,
        use_global_light: true,
        distance: 5.0,
        spread: 0.0,
        size: 10.0,
        noise: 0.0,
        contour: Contour::default(),
        knocks_out: true,
    });
    assert!(fx.any_visible());
    assert_eq!(fx.reach(), 22);
}
