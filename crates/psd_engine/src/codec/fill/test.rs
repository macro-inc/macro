use super::*;
use crate::codec::corpus;
use crate::model::{ColorStop, Gradient, GradientKind, OpacityStop, PatternFill};

fn rgbc(r: f64, g: f64, b: f64) -> Value {
    Value::Descriptor(
        Descriptor::new("RGBC")
            .with("Rd  ", Value::Double(r))
            .with("Grn ", Value::Double(g))
            .with("Bl  ", Value::Double(b)),
    )
}

/// A gradient fill as Photoshop writes it.
fn gradient_descriptor() -> Descriptor {
    let stop = |loc: i32, c: Value| {
        Value::Descriptor(
            Descriptor::new("Clrt")
                .with("Clr ", c)
                .with("Type", paint::enum_value("Clry", "UsrS"))
                .with("Lctn", Value::Integer(loc))
                .with("Mdpn", Value::Integer(50)),
        )
    };
    let opacity = |loc: i32| {
        Value::Descriptor(
            Descriptor::new("TrnS")
                .with("Opct", paint::percent_value(1.0))
                .with("Lctn", Value::Integer(loc))
                .with("Mdpn", Value::Integer(50)),
        )
    };
    let mut grad = Descriptor::new("Grdn")
        .with("Nm  ", Value::Text("Red, Green".into()))
        .with("GrdF", paint::enum_value("GrdF", "CstS"))
        .with("Intr", Value::Double(4096.0))
        .with(
            "Clrs",
            Value::List(vec![
                stop(0, rgbc(225.0, 0.0, 25.0)),
                stop(4096, rgbc(0.0, 96.0, 27.0)),
            ]),
        )
        .with("Trns", Value::List(vec![opacity(0), opacity(4096)]));
    grad.name = "Gradient".into();
    Descriptor::new("null")
        .with("Dthr", Value::Bool(true))
        .with("Angl", paint::angle_value(126.03))
        .with("Type", paint::enum_value("GrdT", "Rdl "))
        .with("Scl ", Value::UnitDouble("#Prc".into(), 169.0))
        .with("Grad", Value::Descriptor(grad))
}

#[test]
fn reads_and_keeps_solid_fills() {
    let data =
        descriptor::write_versioned(&Descriptor::new("null").with("Clr ", rgbc(255.0, 0.0, 51.0)));
    let fill = decode(b"SoCo", &data).expect("decodes");
    assert_eq!(
        fill,
        Fill::Solid {
            color: Rgb::new(1.0, 0.0, 0.2)
        }
    );
    let mut padded = data.clone();
    padded.extend_from_slice(&[0, 0]);
    assert_eq!(
        encode(&fill, Some((b"SoCo", &padded))),
        (*b"SoCo", data.clone())
    );
    let blue = Fill::Solid {
        color: Rgb::new(0.0, 0.0, 1.0),
    };
    let (key, out) = encode(&blue, Some((b"SoCo", &data)));
    assert_eq!(key, *b"SoCo");
    assert_eq!(decode(&key, &out).expect("decodes"), blue);
}

#[test]
fn reads_gradient_fills_and_changes_only_what_differs() {
    let data = descriptor::write_versioned(&gradient_descriptor());
    let Fill::Gradient { gradient } = decode(b"GdFl", &data).expect("decodes") else {
        panic!("not a gradient");
    };
    assert_eq!(gradient.kind, GradientKind::Radial);
    assert!(gradient.dither && !gradient.reverse && gradient.align_with_layer);
    assert!((gradient.angle - 126.03).abs() < 1e-4);
    assert!((gradient.scale - 1.69).abs() < 1e-6);
    assert_eq!(gradient.colors.len(), 2);
    assert_eq!(gradient.colors[1].location, 1.0);

    let mut changed = gradient.clone();
    changed.angle = 45.0;
    let (key, out) = encode(
        &Fill::Gradient {
            gradient: changed.clone(),
        },
        Some((b"GdFl", &data)),
    );
    assert_eq!(key, *b"GdFl");
    let (d, _) = descriptor::read_versioned(&out).expect("reads");
    let original = gradient_descriptor();
    for key in ["Dthr", "Type", "Scl ", "Grad"] {
        assert_eq!(d.get(key), original.get(key), "{key}");
    }
    assert_eq!(d.unit("Angl"), Some(("#Ang", 45.0)));
    assert_eq!(
        decode(b"GdFl", &out).expect("decodes"),
        Fill::Gradient { gradient: changed }
    );
}

#[test]
fn writes_new_fills_of_every_kind() {
    let gradient = Gradient {
        kind: GradientKind::Diamond,
        colors: vec![ColorStop {
            location: 0.5,
            midpoint: 0.25,
            color: Rgb::new(0.0, 1.0, 0.0),
        }],
        opacities: vec![OpacityStop {
            location: 0.0,
            midpoint: 0.5,
            opacity: 0.5,
        }],
        ..Gradient::default()
    };
    let fills = [
        Fill::Solid {
            color: Rgb::new(0.2, 0.4, 0.6),
        },
        Fill::Gradient { gradient },
        Fill::Pattern {
            pattern: PatternFill {
                pattern: "id".into(),
                name: "Tile".into(),
                scale: 2.0,
                angle: 0.0,
                align_with_layer: true,
                phase: (1.0, 2.0),
            },
        },
    ];
    for fill in fills {
        let (key, data) = encode(&fill, None);
        assert_eq!(decode(&key, &data).expect("decodes"), fill);
        // A fill of another kind replaces the original block.
        let original = encode(&Fill::Solid { color: Rgb::BLACK }, None).1;
        let (new_key, data) = encode(&fill, Some((b"SoCo", &original)));
        assert_eq!(new_key, key);
        assert_eq!(decode(&new_key, &data).expect("decodes"), fill);
    }
}

#[test]
fn keeps_shape_fills_in_vscg() {
    let mut data = b"SoCo".to_vec();
    data.extend(descriptor::write_versioned(
        &Descriptor::new("null").with("Clr ", rgbc(0.0, 0.0, 0.0)),
    ));
    assert_eq!(
        decode(b"vscg", &data).expect("decodes"),
        Fill::Solid { color: Rgb::BLACK }
    );
    assert_eq!(
        encode(&Fill::Solid { color: Rgb::BLACK }, Some((b"vscg", &data))).1,
        data
    );
    let gradient = Fill::Gradient {
        gradient: Gradient::default(),
    };
    let (key, out) = encode(&gradient, Some((b"vscg", &data)));
    assert_eq!(key, *b"vscg");
    assert_eq!(out[..4], *b"GdFl");
    assert_eq!(decode(b"vscg", &out).expect("decodes"), gradient);
    assert!(decode(b"vscg", b"So").is_err());
}

/// A shape stroke as Photoshop writes it, 1 point wide at 300 ppi.
fn stroke_descriptor() -> Descriptor {
    let mut d = new_stroke();
    d.set(
        "strokeStyleLineWidth",
        Value::UnitDouble("#Pnt".into(), 1.0),
    );
    d.set("strokeStyleResolution", Value::Double(300.0));
    d.set(
        "strokeStyleLineDashSet",
        Value::List(vec![
            Value::UnitDouble("#Nne".into(), 4.0),
            Value::UnitDouble("#Nne".into(), 2.0),
        ]),
    );
    d.set(
        "strokeStyleContent",
        Value::Descriptor(
            Descriptor::new("solidColorLayer").with("Clr ", rgbc(28.0, 110.0, 232.0)),
        ),
    );
    d
}

#[test]
fn reads_and_writes_shape_strokes() {
    let data = descriptor::write_versioned(&stroke_descriptor());
    let stroke = decode_stroke(&data).expect("decodes");
    assert!(stroke.enabled && stroke.fill_enabled);
    assert!((stroke.width - 300.0 / 72.0).abs() < 1e-5);
    assert_eq!(stroke.dashes, [4.0, 2.0]);
    assert_eq!(
        (stroke.cap, stroke.join, stroke.align),
        (LineCap::Butt, LineJoin::Miter, StrokeAlign::Center)
    );
    assert_eq!(encode_stroke(&stroke, Some(&data)), data);

    let mut changed = stroke.clone();
    changed.width = 25.0 / 6.0 * 2.0;
    changed.cap = LineCap::Round;
    changed.dashes.clear();
    changed.fill = Fill::Gradient {
        gradient: Gradient::default(),
    };
    let out = encode_stroke(&changed, Some(&data));
    let (d, _) = descriptor::read_versioned(&out).expect("reads");
    assert_eq!(d.unit("strokeStyleLineWidth").map(|u| u.0), Some("#Pnt"));
    assert_eq!(
        d.object("strokeStyleContent").map(|c| c.class.as_str()),
        Some("gradientLayer")
    );
    let back = decode_stroke(&out).expect("decodes");
    assert!((back.width - changed.width).abs() < 1e-5);
    assert_eq!(back.cap, LineCap::Round);
    assert!(back.dashes.is_empty());
    assert_eq!(back.fill, changed.fill);

    let fresh = VectorStroke {
        enabled: false,
        fill_enabled: true,
        width: 3.0,
        align: StrokeAlign::Outside,
        cap: LineCap::Square,
        join: LineJoin::Bevel,
        miter_limit: 4.0,
        dashes: vec![1.0, 1.0],
        dash_offset: 0.5,
        opacity: 0.25,
        blend: BlendMode::Screen,
        fill: Fill::Solid { color: Rgb::WHITE },
    };
    assert_eq!(
        decode_stroke(&encode_stroke(&fresh, None)).expect("decodes"),
        fresh
    );
}

fn json_rgb(v: &serde_json::Value) -> Option<Rgb> {
    let c = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_f64())
            .map(|x| (x / 255.0) as f32)
    };
    Some(Rgb::new(c("r")?, c("g")?, c("b")?))
}

fn near(a: Rgb, b: Rgb) -> bool {
    (a.r - b.r).abs() < 2e-3 && (a.g - b.g).abs() < 2e-3 && (a.b - b.b).abs() < 2e-3
}

/// Checks a fill against ag-psd's `vectorFill`-style content.
fn same_as_ag_psd(fill: &Fill, theirs: &serde_json::Value) -> bool {
    match (fill, theirs.get("type").and_then(|t| t.as_str())) {
        (Fill::Solid { color }, Some("color")) => theirs
            .get("color")
            .and_then(json_rgb)
            .is_some_and(|c| near(c, *color)),
        (Fill::Gradient { gradient }, Some("solid" | "noise")) => {
            let stops = theirs.get("colorStops").and_then(|s| s.as_array());
            stops.is_none_or(|s| s.len() == gradient.colors.len())
        }
        (Fill::Pattern { pattern }, Some("pattern")) => {
            theirs.get("id").and_then(|i| i.as_str()) == Some(pattern.pattern.as_str())
        }
        _ => false,
    }
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_fills_and_strokes() {
    let (mut count, mut compared, mut failures) = (0, 0, Vec::new());
    for file in corpus::files() {
        let ag = file.ag_psd_layers();
        for (layer, ag) in file.layers.iter().zip(ag) {
            let label = format!("{} {}", file.label(), layer.display_name());
            for key in &KEYS {
                let Some(data) = layer.block(key) else {
                    continue;
                };
                count += 1;
                match decode(key, data) {
                    Ok(fill) => {
                        let (k, out) = encode(&fill, Some((key, data)));
                        if k != *key || !data.starts_with(&out) || data.len() - out.len() >= 4 {
                            failures.push(format!("{label}: {key:?} re-encodes differently"));
                        }
                        if let Some(theirs) = ag.as_ref().and_then(|j| j.get("vectorFill")) {
                            compared += 1;
                            if !same_as_ag_psd(&fill, theirs) {
                                failures.push(format!("{label}: fill differs from ag-psd"));
                            }
                        }
                    }
                    Err(e) => failures.push(format!("{label}: {e}")),
                }
            }
            if let Some(data) = layer.block(b"vstk") {
                count += 1;
                match decode_stroke(data) {
                    Ok(stroke) => {
                        let out = encode_stroke(&stroke, Some(data));
                        if !data.starts_with(&out) || data.len() - out.len() >= 4 {
                            failures.push(format!("{label}: vstk re-encodes differently"));
                        }
                        if let Some(theirs) = ag.as_ref().and_then(|j| j.get("vectorStroke")) {
                            compared += 1;
                            let enabled = theirs.get("strokeEnabled").and_then(|v| v.as_bool());
                            let content = theirs.get("content");
                            if enabled != Some(stroke.enabled)
                                || content.is_some_and(|c| !same_as_ag_psd(&stroke.fill, c))
                            {
                                failures.push(format!("{label}: stroke differs from ag-psd"));
                            }
                        }
                    }
                    Err(e) => failures.push(format!("{label}: {e}")),
                }
            }
        }
    }
    eprintln!(
        "{count} fill and stroke blocks, {compared} compared with ag-psd, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
