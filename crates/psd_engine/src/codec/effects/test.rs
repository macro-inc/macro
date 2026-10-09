use super::*;
use crate::codec::corpus;
use crate::codec::paint::color;
use crate::model::{
    BevelStyle, BevelTechnique, BlendMode, Contour, Fill, GlowSource, GlowTechnique, Gradient,
    PatternFill, Rgb, StrokePosition,
};

fn prc(v: f64) -> Value {
    Value::UnitDouble("#Prc".into(), v)
}

fn pxl(v: f64) -> Value {
    Value::UnitDouble("#Pxl".into(), v)
}

fn ang(v: f64) -> Value {
    Value::UnitDouble("#Ang".into(), v)
}

fn rgb(r: f64, g: f64, b: f64) -> Value {
    Value::Descriptor(color::to_descriptor(Rgb::new(
        (r / 255.0) as f32,
        (g / 255.0) as f32,
        (b / 255.0) as f32,
    )))
}

fn en(ty: &str, v: &str) -> Value {
    paint::enum_value(ty, v)
}

/// A drop shadow as Photoshop writes it.
fn drop_shadow(present: bool, size: f64) -> Descriptor {
    Descriptor::new("DrSh")
        .with("enab", Value::Bool(present))
        .with("present", Value::Bool(present))
        .with("showInDialog", Value::Bool(true))
        .with("Md  ", en("BlnM", "Mltp"))
        .with("Clr ", rgb(10.0, 20.0, 30.0))
        .with("Opct", prc(75.0))
        .with("uglg", Value::Bool(true))
        .with("lagl", ang(120.0))
        .with("Dstn", pxl(5.0))
        .with("Ckmt", pxl(10.0))
        .with("blur", pxl(size))
        .with("Nose", prc(0.0))
        .with("AntA", Value::Bool(false))
        .with(
            "TrnS",
            Value::Descriptor(paint::contour_descriptor(&Contour::default())),
        )
        .with("layerConceals", Value::Bool(true))
}

fn stroke(size: f64) -> Descriptor {
    Descriptor::new("FrFX")
        .with("enab", Value::Bool(true))
        .with("present", Value::Bool(true))
        .with("showInDialog", Value::Bool(true))
        .with("Styl", en("FStl", "InsF"))
        .with("PntT", en("FrFl", "SClr"))
        .with("Md  ", en("BlnM", "Nrml"))
        .with("Opct", prc(100.0))
        .with("Sz  ", pxl(size))
        .with("Clr ", rgb(255.0, 0.0, 0.0))
        .with("overprint", Value::Bool(false))
}

fn block(d: &Descriptor) -> Vec<u8> {
    let mut out = vec![0, 0, 0, 0];
    out.extend(descriptor::write_versioned(d));
    out
}

/// A single-instance style with one effect of most kinds.
fn single_style() -> Descriptor {
    let glow = |class: &str| {
        Descriptor::new(class)
            .with("enab", Value::Bool(true))
            .with("Md  ", en("BlnM", "Scrn"))
            .with("Clr ", rgb(255.0, 255.0, 190.0))
            .with("Opct", prc(35.0))
            .with("GlwT", en("BETE", "PrBL"))
            .with("Ckmt", pxl(20.0))
            .with("blur", pxl(7.0))
            .with("Nose", prc(1.0))
            .with("ShdN", prc(2.0))
            .with("Inpr", prc(50.0))
            .with("glwS", en("IGSr", "SrcC"))
    };
    let bevel = Descriptor::new("ebbl")
        .with("enab", Value::Bool(true))
        .with("hglM", en("BlnM", "Scrn"))
        .with("hglC", rgb(255.0, 255.0, 255.0))
        .with("hglO", prc(50.0))
        .with("sdwM", en("BlnM", "Mltp"))
        .with("sdwC", rgb(0.0, 0.0, 0.0))
        .with("sdwO", prc(40.0))
        .with("bvlT", en("bvlT", "Slmt"))
        .with("bvlS", en("BESl", "PlEb"))
        .with("uglg", Value::Bool(false))
        .with("lagl", ang(90.0))
        .with("Lald", ang(30.0))
        .with("srgR", prc(250.0))
        .with("blur", pxl(9.0))
        .with("bvlD", en("BESs", "Out "))
        .with("Sftn", pxl(2.0))
        .with("useShape", Value::Bool(true))
        .with(
            "MpgS",
            Value::Descriptor(paint::contour_descriptor(&Contour {
                name: "Cone".into(),
                points: vec![(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)],
            })),
        );
    let satin = Descriptor::new("ChFX")
        .with("enab", Value::Bool(false))
        .with("Md  ", en("BlnM", "Mltp"))
        .with("Clr ", rgb(0.0, 0.0, 0.0))
        .with("Invr", Value::Bool(true))
        .with("Opct", prc(50.0))
        .with("lagl", ang(19.0))
        .with("Dstn", pxl(11.0))
        .with("blur", pxl(14.0));
    let mut gradient_overlay = Descriptor::new("GrFl")
        .with("enab", Value::Bool(true))
        .with("Md  ", en("BlnM", "Nrml"))
        .with("Opct", prc(90.0));
    paint::put_gradient(&mut gradient_overlay, &Gradient::default());
    let mut pattern_overlay = Descriptor::new("patternFill")
        .with("enab", Value::Bool(true))
        .with("Md  ", en("BlnM", "Ovrl"))
        .with("Opct", prc(100.0));
    paint::put_pattern(
        &mut pattern_overlay,
        &PatternFill {
            pattern: "pattern-id".into(),
            name: "Tile".into(),
            scale: 1.0,
            angle: 0.0,
            align_with_layer: true,
            phase: (0.0, 0.0),
        },
        "Algn",
    );
    Descriptor::new("null")
        .with("Scl ", prc(100.0))
        .with("masterFXSwitch", Value::Bool(true))
        .with("DrSh", Value::Descriptor(drop_shadow(true, 5.0)))
        .with("OrGl", Value::Descriptor(glow("OrGl")))
        .with(
            "SoFi",
            Value::Descriptor(
                Descriptor::new("SoFi")
                    .with("enab", Value::Bool(true))
                    .with("Md  ", en("BlnM", "Nrml"))
                    .with("Opct", prc(100.0))
                    .with("Clr ", rgb(0.0, 0.0, 255.0)),
            ),
        )
        .with("GrFl", Value::Descriptor(gradient_overlay))
        .with("patternFill", Value::Descriptor(pattern_overlay))
        .with("FrFX", Value::Descriptor(stroke(3.0)))
        .with("IrGl", Value::Descriptor(glow("IrGl")))
        .with("ebbl", Value::Descriptor(bevel))
        .with("ChFX", Value::Descriptor(satin))
}

#[test]
fn decodes_every_effect() {
    let data = block(&single_style());
    let fx = decode(Some(&data), None, None)
        .expect("decodes")
        .expect("style");
    assert!(fx.enabled && fx.scale == 1.0);
    let s = &fx.drop_shadows[0];
    assert_eq!(
        (s.blend, s.opacity, s.angle, s.distance, s.size),
        (BlendMode::Multiply, 0.75, 120.0, 5.0, 5.0)
    );
    assert!((s.spread - 0.1).abs() < 1e-6 && s.knocks_out && s.use_global_light);
    assert_eq!(s.color.to_u8(), [10, 20, 30]);
    let og = &fx.outer_glows[0];
    assert_eq!(
        (og.technique, og.source),
        (GlowTechnique::Precise, GlowSource::Edge)
    );
    assert!((og.spread - 0.2).abs() < 1e-6 && (og.jitter - 0.02).abs() < 1e-6);
    assert_eq!(fx.inner_glows[0].source, GlowSource::Center);
    let b = &fx.bevels[0];
    assert_eq!(
        (b.style, b.technique, b.up),
        (BevelStyle::PillowEmboss, BevelTechnique::ChiselSoft, false)
    );
    assert_eq!(
        (b.depth, b.size, b.soften, b.shadow_opacity),
        (2.5, 9.0, 2.0, 0.4)
    );
    assert_eq!(b.contour.as_ref().map(|c| c.name.as_str()), Some("Cone"));
    assert!(!fx.satins[0].enabled && fx.satins[0].invert);
    assert_eq!(
        fx.color_overlays[0].fill,
        Fill::Solid {
            color: Rgb::new(0.0, 0.0, 1.0)
        }
    );
    assert_eq!(
        fx.gradient_overlays[0].fill,
        Fill::Gradient {
            gradient: Gradient::default()
        }
    );
    assert!(
        matches!(&fx.pattern_overlays[0].fill, Fill::Pattern { pattern } if pattern.pattern == "pattern-id")
    );
    assert_eq!(fx.pattern_overlays[0].blend, BlendMode::Overlay);
    let st = &fx.strokes[0];
    assert_eq!((st.size, st.position), (3.0, StrokePosition::Inside));
    assert!(fx.inner_shadows.is_empty());
}

#[test]
fn unchanged_styles_write_back_as_they_were() {
    let data = block(&single_style());
    let fx = decode(Some(&data), None, None)
        .expect("decodes")
        .expect("style");
    let mut padded = data.clone();
    padded.extend_from_slice(&[0, 0, 0]);
    assert_eq!(encode(&fx, Some(&padded)), (*b"lfx2", data));
}

#[test]
fn changes_only_the_items_that_differ() {
    let original = single_style();
    let data = block(&original);
    let mut fx = decode(Some(&data), None, None)
        .expect("decodes")
        .expect("style");
    fx.drop_shadows[0].size = 12.0;
    fx.strokes[0].fill = Fill::Solid {
        color: Rgb::new(0.0, 1.0, 0.0),
    };
    let (key, out) = encode(&fx, Some(&data));
    assert_eq!(key, *b"lfx2");
    let (_, d, _) = read_block(&out).expect("reads");
    let keys: Vec<&str> = d.items.iter().map(|(k, _)| k.as_str()).collect();
    let original_keys: Vec<&str> = original.items.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys, original_keys);
    let shadow = d.object("DrSh").expect("shadow");
    assert_eq!(shadow.unit("blur"), Some(("#Pxl", 12.0)));
    let mut expected = drop_shadow(true, 12.0);
    expected.name = shadow.name.clone();
    assert_eq!(shadow, &expected);
    for key in [
        "OrGl",
        "SoFi",
        "GrFl",
        "patternFill",
        "IrGl",
        "ebbl",
        "ChFX",
    ] {
        assert_eq!(d.get(key), original.get(key), "{key}");
    }
    assert_eq!(decode(Some(&out), None, None).expect("decodes"), Some(fx));
}

#[test]
fn lists_several_effects_of_a_kind() {
    let data = block(&single_style());
    let mut fx = decode(Some(&data), None, None)
        .expect("decodes")
        .expect("style");
    let mut second = fx.drop_shadows[0].clone();
    second.color = Rgb::WHITE;
    fx.drop_shadows.push(second);
    fx.strokes.clear();
    let (key, out) = encode(&fx, Some(&data));
    assert_eq!(key, *b"lmfx");
    let (_, d, _) = read_block(&out).expect("reads");
    assert_eq!(d.items[2].0, "dropShadowMulti");
    assert_eq!(d.list("dropShadowMulti").map(<[Value]>::len), Some(2));
    assert!(!d.has("DrSh") && !d.has("FrFX"));
    assert_eq!(decode(None, Some(&out), None).expect("decodes"), Some(fx));
}

#[test]
fn keeps_placeholder_effects() {
    let placeholder = drop_shadow(false, 54.0);
    let style = Descriptor::new("null")
        .with("Scl ", prc(100.0))
        .with("masterFXSwitch", Value::Bool(true))
        .with(
            "dropShadowMulti",
            Value::List(vec![
                Value::Descriptor(placeholder.clone()),
                Value::Descriptor(drop_shadow(true, 3.0)),
            ]),
        )
        .with(
            "frameFXMulti",
            Value::List(vec![
                Value::Descriptor(stroke(7.0)),
                Value::Descriptor(stroke(18.0)),
            ]),
        )
        .with("numModifyingFX", Value::Integer(3));
    let data = block(&style);
    let mut fx = decode(None, Some(&data), None)
        .expect("decodes")
        .expect("style");
    assert_eq!(fx.drop_shadows.len(), 1);
    assert_eq!(fx.strokes.len(), 2);
    fx.strokes.truncate(1);
    fx.drop_shadows[0].enabled = false;
    let (key, out) = encode(&fx, Some(&data));
    assert_eq!(key, *b"lfx2");
    let (_, d, _) = read_block(&out).expect("reads");
    let shadows = d.list("dropShadowMulti").expect("list");
    assert_eq!(shadows[0], Value::Descriptor(placeholder));
    assert_eq!(d.list("frameFXMulti").map(<[Value]>::len), Some(1));
    assert_eq!(d.number("numModifyingFX"), Some(1.0));
    assert_eq!(decode(Some(&out), None, None).expect("decodes"), Some(fx));
}

#[test]
fn writes_new_styles() {
    let data = block(&single_style());
    let fx = decode(Some(&data), None, None)
        .expect("decodes")
        .expect("style");
    let (key, out) = encode(&fx, None);
    assert_eq!(key, *b"lfx2");
    assert_eq!(
        decode(Some(&out), None, None).expect("decodes"),
        Some(fx.clone())
    );
    let (_, d, _) = read_block(&out).expect("reads");
    let keys: Vec<&str> = d.items.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(
        keys,
        [
            "Scl ",
            "masterFXSwitch",
            "DrSh",
            "OrGl",
            "SoFi",
            "GrFl",
            "patternFill",
            "FrFX",
            "IrGl",
            "ebbl",
            "ChFX"
        ]
    );

    let mut several = fx;
    several.strokes.push(several.strokes[0].clone());
    several.enabled = false;
    several.scale = 0.5;
    let (key, out) = encode(&several, None);
    assert_eq!(key, *b"lmfx");
    let (_, d, _) = read_block(&out).expect("reads");
    assert!(d.has("dropShadowMulti") && d.has("frameFXMulti") && d.has("numModifyingFX"));
    assert_eq!(
        decode(None, Some(&out), None).expect("decodes"),
        Some(several)
    );
    assert_eq!(decode(None, None, None).expect("nothing to read"), None);
}

#[test]
fn removes_effects_the_model_dropped() {
    let data = block(&single_style());
    let mut fx = decode(Some(&data), None, None)
        .expect("decodes")
        .expect("style");
    fx.drop_shadows.clear();
    fx.bevels.clear();
    let (_, out) = encode(&fx, Some(&data));
    let (_, d, _) = read_block(&out).expect("reads");
    assert!(!d.has("DrSh") && !d.has("ebbl"));
    assert_eq!(decode(Some(&out), None, None).expect("decodes"), Some(fx));
}

/// A legacy block: common state, a drop shadow, a bevel, a solid fill.
fn legacy_block() -> Vec<u8> {
    let mut w = Writer::new();
    w.u16(0);
    w.u16(4);
    w.sig(b"8BIM");
    w.sig(b"cmnS");
    w.u32(7);
    w.u32(0);
    w.u8(1);
    w.zeros(2);
    w.sig(b"8BIM");
    w.sig(b"dsdw");
    w.u32(51);
    w.u32(2);
    w.fixed(6.0);
    w.u32(0);
    w.fixed(90.0);
    w.fixed(21.0);
    color::write_binary(&mut w, Rgb::new(1.0, 0.0, 0.0));
    w.sig(b"8BIM");
    w.sig(b"mul ");
    w.u8(1);
    w.u8(0);
    w.u8(191);
    color::write_binary(&mut w, Rgb::new(1.0, 0.0, 0.0));
    w.sig(b"8BIM");
    w.sig(b"bevl");
    w.u32(78);
    w.u32(2);
    w.fixed(120.0);
    w.fixed(5.0);
    w.fixed(4.0);
    w.sig(b"8BIM");
    w.sig(b"scrn");
    w.sig(b"8BIM");
    w.sig(b"mul ");
    color::write_binary(&mut w, Rgb::WHITE);
    color::write_binary(&mut w, Rgb::BLACK);
    w.u8(3);
    w.u8(255);
    w.u8(128);
    w.u8(1);
    w.u8(1);
    w.u8(1);
    color::write_binary(&mut w, Rgb::WHITE);
    color::write_binary(&mut w, Rgb::BLACK);
    w.sig(b"8BIM");
    w.sig(b"sofi");
    w.u32(34);
    w.u32(2);
    w.sig(b"8BIM");
    w.sig(b"norm");
    color::write_binary(&mut w, Rgb::new(0.0, 0.0, 1.0));
    w.u8(255);
    w.u8(1);
    color::write_binary(&mut w, Rgb::new(0.0, 0.0, 1.0));
    w.into_bytes()
}

#[test]
fn reads_legacy_effects() {
    let fx = decode(None, None, Some(&legacy_block()))
        .expect("decodes")
        .expect("style");
    let s = &fx.drop_shadows[0];
    assert_eq!(
        (s.size, s.angle, s.distance, s.blend),
        (6.0, 90.0, 21.0, BlendMode::Multiply)
    );
    assert!(s.enabled && !s.use_global_light && (s.opacity - 0.749).abs() < 1e-3);
    let b = &fx.bevels[0];
    assert_eq!(
        (b.style, b.angle, b.size, b.up),
        (BevelStyle::Emboss, 120.0, 4.0, false)
    );
    assert_eq!(b.highlight_blend, BlendMode::Screen);
    assert_eq!(
        fx.color_overlays[0].fill,
        Fill::Solid {
            color: Rgb::new(0.0, 0.0, 1.0)
        }
    );
    // The descriptor-based block wins over the legacy one.
    let data = block(&single_style());
    let modern = decode(Some(&data), None, Some(&legacy_block())).expect("decodes");
    assert_eq!(modern.map(|fx| fx.outer_glows.len()), Some(1));
}

#[test]
fn reports_damaged_styles() {
    assert!(decode(Some(&[0, 0, 0, 0, 0, 0, 0, 16, 1]), None, None).is_err());
    assert!(decode(None, None, Some(&[0, 1])).is_err());
    // A damaged list falls back to the other blocks.
    let data = block(&single_style());
    assert!(
        decode(Some(&data), Some(&[1, 2]), None)
            .expect("decodes")
            .is_some()
    );
}

fn json_f(v: Option<&serde_json::Value>) -> Option<f64> {
    let v = v?;
    v.as_f64().or_else(|| v.get("value")?.as_f64())
}

fn json_color(v: Option<&serde_json::Value>) -> Option<Rgb> {
    let v = v?;
    let c = |k: &str| v.get(k).and_then(serde_json::Value::as_f64);
    if let (Some(r), Some(g), Some(b)) = (c("r"), c("g"), c("b")) {
        return Some(Rgb::new(
            (r / 255.0) as f32,
            (g / 255.0) as f32,
            (b / 255.0) as f32,
        ));
    }
    let (r, g, b) = (c("fr")?, c("fg")?, c("fb")?);
    Some(Rgb::new(
        r.clamp(0.0, 1.0) as f32,
        g.clamp(0.0, 1.0) as f32,
        b.clamp(0.0, 1.0) as f32,
    ))
}

fn close(a: f64, b: f32) -> bool {
    (a - f64::from(b)).abs() < 1e-3
}

/// ag-psd's present effects of a kind (it lists placeholders too).
fn ag_list<'a>(fx: &'a serde_json::Value, key: &str) -> Vec<&'a serde_json::Value> {
    let v = fx.get(key);
    let all: Vec<&serde_json::Value> = match v.and_then(|v| v.as_array()) {
        Some(list) => list.iter().collect(),
        None => v.into_iter().collect(),
    };
    all.into_iter()
        .filter(|e| e.get("present").and_then(|p| p.as_bool()) != Some(false))
        .collect()
}

/// Differences between our effects and ag-psd's, for what both read.
fn compare(ours: &Effects, theirs: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    let mut check = |what: &str, ok: bool| {
        if !ok {
            out.push(what.to_string());
        }
    };
    let shadows = [
        ("dropShadow", &ours.drop_shadows),
        ("innerShadow", &ours.inner_shadows),
    ];
    for (key, list) in shadows {
        let ag = ag_list(theirs, key);
        check(key, ag.len() == list.len());
        for (a, s) in ag.iter().zip(list.iter()) {
            check(
                "shadow size",
                json_f(a.get("size")).is_some_and(|v| close(v, s.size)),
            );
            check(
                "shadow distance",
                json_f(a.get("distance")).is_some_and(|v| close(v, s.distance)),
            );
            check(
                "shadow angle",
                json_f(a.get("angle")).is_none_or(|v| close(v, s.angle)),
            );
            check(
                "shadow opacity",
                json_f(a.get("opacity")).is_none_or(|v| close(v, s.opacity)),
            );
            check(
                "shadow color",
                json_color(a.get("color")).is_none_or(|c| c.to_u8() == s.color.to_u8()),
            );
        }
    }
    let ag = ag_list(theirs, "stroke");
    check("stroke", ag.len() == ours.strokes.len());
    for (a, s) in ag.iter().zip(&ours.strokes) {
        check(
            "stroke size",
            json_f(a.get("size")).is_some_and(|v| close(v, s.size)),
        );
        check(
            "stroke opacity",
            json_f(a.get("opacity")).is_none_or(|v| close(v, s.opacity)),
        );
        if let Fill::Solid { color } = s.fill {
            check(
                "stroke color",
                json_color(a.get("color")).is_none_or(|c| c.to_u8() == color.to_u8()),
            );
        }
    }
    let overlays = [
        ("solidFill", &ours.color_overlays),
        ("gradientOverlay", &ours.gradient_overlays),
        ("patternOverlay", &ours.pattern_overlays),
    ];
    for (key, list) in overlays {
        let ag = ag_list(theirs, key);
        check(key, ag.len() == list.len());
        for (a, o) in ag.iter().zip(list.iter()) {
            check(
                "overlay opacity",
                json_f(a.get("opacity")).is_none_or(|v| close(v, o.opacity)),
            );
        }
    }
    let singles = [
        ("outerGlow", ours.outer_glows.len()),
        ("innerGlow", ours.inner_glows.len()),
        ("bevel", ours.bevels.len()),
        ("satin", ours.satins.len()),
    ];
    for (key, n) in singles {
        check(key, ag_list(theirs, key).len() == n);
    }
    for (a, g) in ag_list(theirs, "outerGlow").iter().zip(&ours.outer_glows) {
        check(
            "glow size",
            json_f(a.get("size")).is_some_and(|v| close(v, g.size)),
        );
    }
    for (a, b) in ag_list(theirs, "bevel").iter().zip(&ours.bevels) {
        check(
            "bevel size",
            json_f(a.get("size")).is_some_and(|v| close(v, b.size)),
        );
        check(
            "bevel depth",
            json_f(a.get("strength")).is_none_or(|v| close(v, b.depth)),
        );
    }
    let disabled = theirs
        .get("disabled")
        .and_then(|d| d.as_bool())
        .unwrap_or(false);
    check("master switch", disabled != ours.enabled);
    out
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_effects() {
    let (mut count, mut legacy, mut compared, mut failures) = (0, 0, 0, Vec::new());
    for file in corpus::files() {
        let ag = file.ag_psd_layers();
        for (layer, ag) in file.layers.iter().zip(ag) {
            let label = format!("{} {}", file.label(), layer.display_name());
            let (lfx2, lmfx) = (
                layer.block(b"lfx2"),
                layer.block(b"lmfx").or(layer.block(b"lfxs")),
            );
            if let Some(data) = layer.block(b"lrFX") {
                legacy += 1;
                if let Err(e) = decode(None, None, Some(data)) {
                    failures.push(format!("{label}: lrFX: {e}"));
                }
            }
            let Some(data) = lmfx.or(lfx2) else { continue };
            count += 1;
            let fx = match decode(lfx2, lmfx, None) {
                Ok(Some(fx)) => fx,
                Ok(None) => continue,
                Err(e) => {
                    failures.push(format!("{label}: {e}"));
                    continue;
                }
            };
            let (_, out) = encode(&fx, Some(data));
            if !data.starts_with(&out) || data.len() - out.len() >= 4 {
                failures.push(format!("{label}: re-encodes differently"));
            }
            // A changed style re-encodes into a style that reads back as it.
            let mut changed = fx.clone();
            changed.scale = 0.5;
            for s in &mut changed.drop_shadows {
                s.size += 1.0;
            }
            let (key, out) = encode(&changed, Some(data));
            let (lfx2_out, lmfx_out) = if key == *b"lmfx" {
                (None, Some(&out[..]))
            } else {
                (Some(&out[..]), None)
            };
            if decode(lfx2_out, lmfx_out, None).ok().flatten() != Some(changed) {
                failures.push(format!("{label}: a changed style reads back differently"));
            }
            if let Some(theirs) = ag.as_ref().and_then(|j| j.get("effects")) {
                compared += 1;
                for what in compare(&fx, theirs) {
                    failures.push(format!("{label}: {what} differs from ag-psd"));
                }
            }
        }
    }
    eprintln!(
        "{count} styles, {legacy} legacy blocks, {compared} compared with ag-psd, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
