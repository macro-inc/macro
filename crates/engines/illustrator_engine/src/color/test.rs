use super::{ColorSpace, SampleConverter};
use crate::function::testing::{Mock, dict, obj, stream};
use crate::pdf::{Dict, Object};

#[track_caller]
fn assert_rgb(actual: [f32; 3], expected: [f32; 3], tolerance: f32) {
    assert!(
        actual
            .iter()
            .zip(&expected)
            .all(|(a, e)| (a - e).abs() <= tolerance),
        "{actual:?} != {expected:?}"
    );
}

fn parse(src: &str) -> ColorSpace {
    parse_with(&Mock::default(), src, &Dict::new())
}

fn parse_with(mock: &Mock, src: &str, resources: &Dict) -> ColorSpace {
    ColorSpace::parse(mock, &obj(src), resources).expect("color space parses")
}

#[test]
fn device_spaces_by_name_and_abbreviation() {
    for (name, cs, n) in [
        ("/DeviceGray", ColorSpace::Gray, 1),
        ("/G", ColorSpace::Gray, 1),
        ("/DeviceRGB", ColorSpace::Rgb, 3),
        ("/RGB", ColorSpace::Rgb, 3),
        ("/DeviceCMYK", ColorSpace::Cmyk, 4),
        ("/CMYK", ColorSpace::Cmyk, 4),
        ("[/DeviceRGB]", ColorSpace::Rgb, 3),
        ("/Pattern", ColorSpace::Pattern(None), 0),
    ] {
        let parsed = parse(name);
        assert_eq!(parsed, cs, "{name}");
        assert_eq!(parsed.components(), n, "{name}");
    }
    assert!(ColorSpace::parse(&Mock::default(), &obj("/Nope"), &Dict::new()).is_err());
    assert!(ColorSpace::parse(&Mock::default(), &obj("42"), &Dict::new()).is_err());
}

#[test]
fn initial_colors() {
    assert_eq!(ColorSpace::Gray.initial(), vec![0.0]);
    assert_eq!(ColorSpace::Rgb.initial(), vec![0.0; 3]);
    assert_eq!(ColorSpace::Cmyk.initial(), vec![0.0, 0.0, 0.0, 1.0]);
    let lab = parse("[/Lab << /WhitePoint [0.9642 1 0.8249] /Range [10 50 -20 -5] >>]");
    assert_eq!(lab.initial(), vec![0.0, 10.0, -5.0]);
    let sep = parse(
        "[/Separation /Spot /DeviceCMYK
          << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 0 0 0] /N 1 >>]",
    );
    assert_eq!(sep.initial(), vec![1.0]);
}

#[test]
fn names_resolve_through_resources() {
    let mut mock = Mock::default();
    mock.add(5, Object::Stream(stream("<< /N 4 >>", b"profile")));
    let resources = dict("<< /ColorSpace << /CS0 [/ICCBased 5 0 R] /CS1 /CS0 /Loop /Loop >> >>");
    let cs = parse_with(&mock, "/CS1", &resources);
    assert_eq!(
        cs,
        ColorSpace::Icc {
            n: 4,
            alternate: Box::new(ColorSpace::Cmyk)
        }
    );
    assert_eq!(cs.components(), 4);
    // ICC CMYK starts at no ink, unlike DeviceCMYK.
    assert_eq!(cs.initial(), vec![0.0; 4]);
    // A name that refers to itself fails instead of looping.
    assert!(ColorSpace::parse(&mock, &obj("/Loop"), &resources).is_err());
}

#[test]
fn gray_and_rgb_clamp() {
    assert_rgb(ColorSpace::Gray.to_rgb(&[0.25]), [0.25; 3], 1e-6);
    assert_rgb(ColorSpace::Gray.to_rgb(&[1.5]), [1.0; 3], 1e-6);
    assert_rgb(
        ColorSpace::Rgb.to_rgb(&[0.1, -1.0, 2.0]),
        [0.1, 0.0, 1.0],
        1e-6,
    );
    // Missing components read as zero.
    assert_rgb(ColorSpace::Rgb.to_rgb(&[1.0]), [1.0, 0.0, 0.0], 1e-6);
}

#[test]
fn cmyk_spot_values() {
    let cmyk = ColorSpace::Cmyk;
    assert_rgb(cmyk.to_rgb(&[0.0, 0.0, 0.0, 0.0]), [1.0, 1.0, 1.0], 1e-3);
    // Press black is not pure black; cyan is a press cyan.
    assert_rgb(
        cmyk.to_rgb(&[0.0, 0.0, 0.0, 1.0]),
        [0.171, 0.182, 0.206],
        0.005,
    );
    assert_rgb(
        cmyk.to_rgb(&[1.0, 0.0, 0.0, 0.0]),
        [0.0, 0.724, 0.948],
        0.005,
    );
    assert_rgb(
        cmyk.to_rgb(&[0.0, 1.0, 1.0, 0.0]),
        [1.0, 0.180, 0.089],
        0.005,
    );
    // Rich black is darker than plain black.
    let rich = cmyk.to_rgb(&[0.6, 0.4, 0.4, 1.0]);
    assert!(rich.iter().all(|&v| v < 0.12), "{rich:?}");
}

#[test]
fn calibrated_spaces_by_gamma() {
    let gray = parse("[/CalGray << /WhitePoint [0.9505 1 1.089] /Gamma 2.2 >>]");
    assert_eq!(gray, ColorSpace::CalGray { gamma: 2.2 });
    // Gamma 2.2 is close to sRGB's curve.
    assert_rgb(gray.to_rgb(&[0.5]), [0.5; 3], 0.02);
    // Gamma 1 is linear light, lighter in sRGB.
    let linear = parse("[/CalGray << /WhitePoint [0.9505 1 1.089] >>]");
    assert_rgb(linear.to_rgb(&[0.5]), [0.7354; 3], 0.002);
    let rgb = parse("[/CalRGB << /WhitePoint [0.9505 1 1.089] /Gamma [1.8 1.8 1.8] >>]");
    assert_eq!(rgb.components(), 3);
    assert_rgb(rgb.to_rgb(&[1.0, 0.0, 0.5]), [1.0, 0.0, 0.5723], 0.002);
}

#[test]
fn lab_converts_through_xyz_with_bradford_adaptation() {
    let lab = parse("[/Lab << /WhitePoint [0.9642 1 0.8249] /Range [-128 127 -128 127] >>]");
    assert_eq!(lab.components(), 3);
    assert_rgb(lab.to_rgb(&[100.0, 0.0, 0.0]), [1.0; 3], 0.002);
    assert_rgb(lab.to_rgb(&[0.0, 0.0, 0.0]), [0.0; 3], 0.002);
    assert_rgb(lab.to_rgb(&[50.0, 0.0, 0.0]), [0.4663; 3], 0.002);
    // sRGB red, as Lab relative to D50.
    assert_rgb(lab.to_rgb(&[54.292, 80.816, 69.887]), [1.0, 0.0, 0.0], 0.01);
    assert_rgb(
        lab.to_rgb(&[60.0, 40.0, -30.0]),
        [0.7577, 0.4593, 0.7788],
        0.003,
    );
    // a* and b* clamp to the range.
    let narrow = parse("[/Lab << /WhitePoint [0.9642 1 0.8249] /Range [0 0 0 0] >>]");
    assert_rgb(narrow.to_rgb(&[50.0, 80.0, 80.0]), [0.4663; 3], 0.002);
}

#[test]
fn icc_uses_its_alternate_or_component_count() {
    let mut mock = Mock::default();
    mock.add(1, Object::Stream(stream("<< /N 3 >>", b"")));
    mock.add(
        2,
        Object::Stream(stream(
            "<< /N 3 /Alternate [/Lab << /WhitePoint [0.9642 1 0.8249] >>] /Range [0 100 -128 127 -128 127] >>",
            b"",
        )),
    );
    mock.add(
        3,
        Object::Stream(stream("<< /N 1 /Alternate /DeviceRGB >>", b"")),
    );
    let rgb = parse_with(&mock, "[/ICCBased 1 0 R]", &Dict::new());
    assert_eq!(
        rgb,
        ColorSpace::Icc {
            n: 3,
            alternate: Box::new(ColorSpace::Rgb)
        }
    );
    assert_rgb(rgb.to_rgb(&[0.2, 0.4, 0.6]), [0.2, 0.4, 0.6], 1e-6);
    let lab = parse_with(&mock, "[/ICCBased 2 0 R]", &Dict::new());
    assert_rgb(lab.to_rgb(&[100.0, 0.0, 0.0]), [1.0; 3], 0.002);
    assert_eq!(lab.ranges()[1], [-100.0, 100.0]);
    // An alternate that disagrees with N is replaced by the device space.
    let gray = parse_with(&mock, "[/ICCBased 3 0 R]", &Dict::new());
    assert_eq!(
        gray,
        ColorSpace::Icc {
            n: 1,
            alternate: Box::new(ColorSpace::Gray)
        }
    );
}

#[test]
fn indexed_lookups_from_strings_and_streams() {
    let cs = parse("[/Indexed /DeviceRGB 2 <FF000000FF000000FF>]");
    assert_eq!(cs.components(), 1);
    assert_eq!(cs.ranges(), vec![[0.0, 2.0]]);
    assert_rgb(cs.to_rgb(&[0.0]), [1.0, 0.0, 0.0], 1e-6);
    assert_rgb(cs.to_rgb(&[1.0]), [0.0, 1.0, 0.0], 1e-6);
    assert_rgb(cs.to_rgb(&[2.0]), [0.0, 0.0, 1.0], 1e-6);
    // Out-of-range indexes clamp.
    assert_rgb(cs.to_rgb(&[9.0]), [0.0, 0.0, 1.0], 1e-6);
    let mut mock = Mock::default();
    mock.add(4, Object::Stream(stream("<< >>", &[0, 255])));
    let gray = parse_with(&mock, "[/I /G 1 4 0 R]", &Dict::new());
    assert_rgb(gray.to_rgb(&[1.0]), [1.0; 3], 1e-6);
    // A short table reads as zeros.
    let short = parse("[/Indexed /DeviceGray 3 <FF>]");
    assert_rgb(short.to_rgb(&[3.0]), [0.0; 3], 1e-6);
    // Lab bases scale the bytes to their ranges.
    let lab = parse("[/Indexed [/Lab << /WhitePoint [0.9642 1 0.8249] >>] 0 <FF8080>]");
    assert_rgb(lab.to_rgb(&[0.0]), [1.0; 3], 0.01);
}

#[test]
fn separations_through_tint_transforms() {
    let spot = parse(
        "[/Separation /PANTONE#20Red /DeviceCMYK
          << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 1 0] /N 1 >>]",
    );
    match &spot {
        ColorSpace::Separation { name, .. } => assert_eq!(name, "PANTONE Red"),
        other => panic!("{other:?}"),
    }
    assert!(!spot.is_invisible());
    assert_rgb(spot.to_rgb(&[0.0]), [1.0; 3], 1e-3);
    assert_rgb(
        spot.to_rgb(&[1.0]),
        ColorSpace::Cmyk.to_rgb(&[0.0, 1.0, 1.0, 0.0]),
        1e-6,
    );
    let none = parse("[/Separation /None /DeviceGray << /FunctionType 2 /Domain [0 1] /N 1 >>]");
    assert!(none.is_invisible());
    let all = parse(
        "[/Separation /All /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C1 [1 1 1 1] /N 1 >>]",
    );
    assert_rgb(all.to_rgb(&[0.25]), [0.75; 3], 1e-6);
}

#[test]
fn devicen_through_a_calculator() {
    let mut mock = Mock::default();
    mock.add(
        7,
        Object::Stream(stream(
            "<< /FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1 0 1] >>",
            b"{ 0 0 }",
        )),
    );
    let cs = parse_with(
        &mock,
        "[/DeviceN [/Cyan /Magenta] /DeviceCMYK 7 0 R << /Subtype /DeviceN >>]",
        &Dict::new(),
    );
    assert_eq!(cs.components(), 2);
    assert_eq!(cs.initial(), vec![1.0, 1.0]);
    assert_rgb(
        cs.to_rgb(&[1.0, 0.0]),
        ColorSpace::Cmyk.to_rgb(&[1.0, 0.0, 0.0, 0.0]),
        1e-6,
    );
    let none = parse_with(
        &mock,
        "[/DeviceN [/None /None] /DeviceCMYK 7 0 R]",
        &Dict::new(),
    );
    assert!(none.is_invisible());
    let indexed = ColorSpace::Indexed {
        base: Box::new(none),
        hival: 0,
        lookup: vec![0, 0],
    };
    assert!(indexed.is_invisible());
}

#[test]
fn patterns_with_and_without_a_base() {
    assert_eq!(parse("/Pattern"), ColorSpace::Pattern(None));
    let uncolored = parse("[/Pattern /DeviceRGB]");
    assert_eq!(uncolored.components(), 3);
    assert_rgb(uncolored.to_rgb(&[0.0, 0.5, 1.0]), [0.0, 0.5, 1.0], 1e-6);
}

#[test]
fn rgb_rows_fill_rgba_pixels() {
    let mut out = [9u8; 8];
    ColorSpace::Gray.rgb_row(&[0.0, 1.0], &mut out, 4);
    assert_eq!(out, [0, 0, 0, 9, 255, 255, 255, 9]);
    let mut out = [0u8; 6];
    ColorSpace::Cmyk.rgb_row(&[0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &mut out, 3);
    assert_eq!(out, [255; 6]);
}

#[test]
fn sample_converter_tables_and_decode_arrays() {
    // 8-bit gray, inverted by its Decode array.
    let gray = ColorSpace::Gray;
    let mut c = SampleConverter::new(&gray, 8, Some(&[1.0, 0.0]));
    let mut out = [0u8; 8];
    c.convert(&[0, 255], &mut out, 4);
    assert_eq!(out, [255, 255, 255, 0, 0, 0, 0, 0]);
    // 16-bit RGB.
    let rgb = ColorSpace::Rgb;
    let mut c = SampleConverter::new(&rgb, 16, None);
    let mut out = [0u8; 3];
    c.convert(&[65535, 32768, 0], &mut out, 3);
    assert_eq!(out, [255, 128, 0]);
    // 2-bit indexed: the default decode maps samples to indexes.
    let indexed = parse("[/Indexed /DeviceRGB 3 <000000FF000000FF000000FF>]");
    let mut c = SampleConverter::new(&indexed, 2, None);
    let mut out = [0u8; 12];
    c.convert(&[0, 1, 2, 3], &mut out, 3);
    assert_eq!(out, [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    // CMYK per pixel.
    let cmyk = ColorSpace::Cmyk;
    let mut c = SampleConverter::new(&cmyk, 8, None);
    let mut out = [0u8; 6];
    c.convert(&[0, 0, 0, 0, 0, 0, 0, 255], &mut out, 3);
    assert_eq!(&out[..3], &[255, 255, 255]);
    let black = ColorSpace::Cmyk.to_rgb(&[0.0, 0.0, 0.0, 1.0]);
    let expected = black.map(|v| (v * 255.0 + 0.5) as u8);
    assert_eq!(&out[3..], &expected);
    // Lab through its fast path agrees with to_rgb.
    let lab = parse("[/Lab << /WhitePoint [0.9642 1 0.8249] /Range [-128 127 -128 127] >>]");
    let mut c = SampleConverter::new(&lab, 8, None);
    let mut out = [0u8; 3];
    c.convert(&[153, 168, 98], &mut out, 3);
    let direct = lab
        .to_rgb(&[60.0, -128.0 + 168.0, -128.0 + 98.0])
        .map(|v| (v * 255.0 + 0.5) as u8);
    for (a, b) in out.iter().zip(direct) {
        assert!(a.abs_diff(b) <= 1, "{out:?} vs {direct:?}");
    }
}

/// Parses every color space, function, and shading the corpora hold
/// (see `GRAPHICS_CORPUS_DIR`), using each a little, and lists failures.
#[test]
#[ignore = "needs GRAPHICS_CORPUS_DIR, exported from local corpora"]
fn corpus_objects_parse() {
    use crate::function::Function;
    use crate::function::testing::{Corpus, corpus_manifest};
    use crate::pdf::ObjRef;
    use crate::shading::Shading;
    let Some((dir, entries)) = corpus_manifest() else {
        return;
    };
    let mut counts = std::collections::BTreeMap::<String, (usize, usize)>::new();
    for e in entries.iter().filter(|e| e["kind"] == "parse") {
        let what = e["what"].as_str().unwrap_or_default();
        let name = e["dir"].as_str().unwrap_or_default();
        let xref = e["xref"].as_u64().unwrap_or_default() as u32;
        let corpus = Corpus {
            dir: dir.join(name),
        };
        let object = Object::Ref(ObjRef::new(xref, 0));
        let result = match what {
            "colorspace" => ColorSpace::parse(&corpus, &object, &Dict::new()).map(|cs| {
                let rgb = cs.to_rgb(&cs.initial());
                assert!(rgb.iter().all(|v| (0.0..=1.0).contains(v)), "{rgb:?}");
            }),
            "function" => Function::parse(&corpus, &object).map(|f| {
                let lo: Vec<f32> = f.domain().iter().map(|d| d[0]).collect();
                let hi: Vec<f32> = f.domain().iter().map(|d| d[1]).collect();
                assert!(
                    f.eval(&lo)
                        .iter()
                        .chain(&f.eval(&hi))
                        .all(|v| v.is_finite())
                );
            }),
            _ => Shading::parse(&corpus, &object, &Dict::new()).map(|sh| {
                let mut pixmap = tiny_skia::Pixmap::new(32, 32).unwrap();
                sh.paint(
                    &mut pixmap.as_mut(),
                    tiny_skia::Transform::identity(),
                    None,
                    1.0,
                );
                let _ = sh.stops();
            }),
        };
        let count = counts.entry(what.to_string()).or_default();
        count.0 += 1;
        if let Err(err) = result {
            count.1 += 1;
            println!("{name} {xref} ({what}): {err}");
        }
    }
    for (what, (total, failed)) in &counts {
        println!("{what}: {total} parsed, {failed} failed");
    }
}
