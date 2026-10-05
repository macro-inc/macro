use super::*;
use crate::codec::corpus;
use crate::model::{Gradient, LevelsChannel};

/// Writes 16-bit integers.
fn shorts(values: &[i16]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_be_bytes()).collect()
}

/// Every adjustment, with blocks as Photoshop lays them out.
fn samples() -> Vec<([u8; 4], Vec<u8>, Adjustment)> {
    let mut out = Vec::new();

    let mut levl = shorts(&[2, 10, 245, 0, 255, 100, 5, 250, 3, 252, 150]);
    for _ in 0..27 {
        levl.extend(shorts(&[0, 255, 0, 255, 100]));
    }
    out.push((
        *b"levl",
        levl,
        Adjustment::Levels {
            channels: vec![
                LevelsChannel {
                    in_black: 10,
                    in_white: 245,
                    out_black: 0,
                    out_white: 255,
                    gamma: 1.0,
                },
                LevelsChannel {
                    in_black: 5,
                    in_white: 250,
                    out_black: 3,
                    out_white: 252,
                    gamma: 1.5,
                },
                LevelsChannel::default(),
                LevelsChannel::default(),
            ],
        },
    ));

    let curves = vec![
        (0, vec![(0, 0), (64, 40), (255, 255)]),
        (2, vec![(0, 10), (255, 245)]),
    ];
    out.push((
        *b"curv",
        tone::encode_curves(&curves),
        Adjustment::Curves { channels: curves },
    ));

    let mut exp = vec![0, 1];
    for v in [-2.0f32, 0.1, 1.2] {
        exp.extend(v.to_be_bytes());
    }
    exp.extend([0, 0]);
    out.push((
        *b"expA",
        exp,
        Adjustment::Exposure {
            exposure: -2.0,
            offset: 0.1,
            gamma: 1.2,
        },
    ));

    let vib = Descriptor::new("null")
        .with("vibrance", Value::Integer(21))
        .with("Strt", Value::Integer(-5));
    out.push((
        *b"vibA",
        descriptor::write_versioned(&vib),
        Adjustment::Vibrance {
            vibrance: 21,
            saturation: -5,
        },
    ));

    let mut hue = vec![0, 2, 1, 0];
    hue.extend(shorts(&[66, 25, 0, 0, -40, 5]));
    let mut ranges = Vec::new();
    for (i, range) in HUE_RANGES.iter().enumerate() {
        let adjust = [i as i16, -(i as i16), 2 * i as i16];
        hue.extend(shorts(range));
        hue.extend(shorts(&adjust));
        ranges.push(HueRange {
            range: *range,
            hue: adjust[0],
            saturation: adjust[1],
            lightness: adjust[2],
        });
    }
    hue.extend([7; 36]); // the newer range midpoints, kept as they are
    out.push((
        *b"hue2",
        hue,
        Adjustment::HueSaturation {
            colorize: true,
            colorization: (66, 25, 0),
            master: (0, -40, 5),
            ranges,
        },
    ));

    let mut blnc = shorts(&[0, 0, 0, 0, 16, -21, 33, 38, 35]);
    blnc.extend([1, 0]);
    out.push((
        *b"blnc",
        blnc,
        Adjustment::ColorBalance {
            shadows: [0, 0, 0],
            midtones: [0, 16, -21],
            highlights: [33, 38, 35],
            preserve_luminosity: true,
        },
    ));

    let mut bw = Descriptor::new("null");
    for (key, v) in BLACK_WHITE_KEYS.iter().zip([40, 60, 40, 60, 20, 80]) {
        bw.items.push(((*key).into(), Value::Integer(v)));
    }
    let bw = bw
        .with("useTint", Value::Bool(true))
        .with(
            "tintColor",
            Value::Descriptor(color::to_descriptor(Rgb::new(1.0, 0.5, 0.0))),
        )
        .with("bwPresetKind", Value::Integer(1))
        .with("blackAndWhitePresetFileName", Value::Text(String::new()));
    out.push((
        *b"blwh",
        descriptor::write_versioned(&bw),
        Adjustment::BlackWhite {
            weights: [40, 60, 40, 60, 20, 80],
            tint: Some(Rgb::new(1.0, 0.5, 0.0)),
        },
    ));

    let mut phfl = vec![0, 2];
    phfl.extend(shorts(&[0, -1, 0, 0, 0]));
    phfl.extend([0, 0, 0, 25, 1, 0, 0, 0]);
    out.push((
        *b"phfl",
        phfl,
        Adjustment::PhotoFilter {
            color: Rgb::new(1.0, 0.0, 0.0),
            density: 0.25,
            preserve_luminosity: true,
        },
    ));

    let mut mixr = vec![0, 1, 0, 0];
    mixr.extend(shorts(&[
        100, 0, 0, 0, 0, 0, 90, 10, 0, 5, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0,
    ]));
    out.push((
        *b"mixr",
        mixr,
        Adjustment::ChannelMixer {
            monochrome: false,
            rows: [[100, 0, 0, 0], [0, 90, 10, 5], [0, 0, 100, 0]],
        },
    ));

    out.push((*b"nvrt", Vec::new(), Adjustment::Invert));
    out.push((
        *b"post",
        vec![0, 16, 0, 0],
        Adjustment::Posterize { levels: 16 },
    ));
    out.push((
        *b"thrs",
        vec![0, 182, 0, 0],
        Adjustment::Threshold { level: 182 },
    ));

    let mut selc = vec![0, 1, 0, 1];
    selc.extend([0; 8]);
    let mut colors = [[0; 4]; 9];
    for (i, c) in colors.iter_mut().enumerate() {
        *c = [i as i16, -(i as i16), 3, -4];
        selc.extend(shorts(c));
    }
    out.push((
        *b"selc",
        selc,
        Adjustment::SelectiveColor {
            absolute: true,
            colors,
        },
    ));

    let gradient = Gradient {
        name: "Violet, Orange".into(),
        colors: vec![
            ColorStopSample::stop(0.0, Rgb::new(1.0, 0.0, 1.0)),
            ColorStopSample::stop(1.0, Rgb::new(1.0, 0.0, 0.0)),
        ],
        ..Gradient::default()
    };
    let adjustment = Adjustment::GradientMap {
        gradient: gradient.clone(),
        dither: true,
        reverse: false,
    };
    out.push((
        *b"grdm",
        tone::encode_gradient_map(&gradient, true, false, None),
        adjustment,
    ));
    out
}

/// Builds color stops for the samples.
struct ColorStopSample;

impl ColorStopSample {
    fn stop(location: f32, color: Rgb) -> crate::model::ColorStop {
        crate::model::ColorStop {
            location,
            midpoint: 0.5,
            color,
        }
    }
}

#[test]
fn lists_every_adjustment_key() {
    for key in [
        b"brit", b"CgEd", b"levl", b"curv", b"expA", b"vibA", b"hue2", b"blnc", b"blwh", b"phfl",
        b"mixr", b"nvrt", b"post", b"thrs", b"grdm", b"selc", b"clrL",
    ] {
        assert!(is_adjustment_key(key), "{}", String::from_utf8_lossy(key));
    }
    for key in [b"SoCo", b"lfx2", b"TySh", b"luni"] {
        assert!(!is_adjustment_key(key));
    }
    assert_eq!(
        decode(b"clrL", &[0, 1]).expect("decodes"),
        Adjustment::Other { key: "clrL".into() }
    );
    assert!(encode(&Adjustment::Other { key: "clrL".into() }, &[]).is_empty());
}

#[test]
fn decodes_and_keeps_every_adjustment() {
    for (key, data, adjustment) in samples() {
        let label = String::from_utf8_lossy(&key).into_owned();
        assert_eq!(decode(&key, &data).expect(&label), adjustment, "{label}");
        assert_eq!(
            encode(&adjustment, &[(key, &data)]),
            [(key, data.clone())],
            "{label}"
        );
        // Without an original, the written block reads back the same.
        let fresh = encode(&adjustment, &[]);
        assert_eq!(fresh.len(), 1, "{label}");
        assert_eq!(fresh[0].0, key, "{label}");
        assert_eq!(
            decode(&key, &fresh[0].1).expect(&label),
            adjustment,
            "{label}"
        );
    }
}

/// Changes every value an adjustment has.
fn changed(adjustment: &Adjustment) -> Adjustment {
    let mut a = adjustment.clone();
    match &mut a {
        Adjustment::Levels { channels } => channels[0].gamma = 2.5,
        Adjustment::Curves { channels } => channels[0].1.push((128, 200)),
        Adjustment::Exposure { exposure, .. } => *exposure = 1.0,
        Adjustment::Vibrance { vibrance, .. } => *vibrance = -50,
        Adjustment::HueSaturation { master, .. } => master.0 = 90,
        Adjustment::ColorBalance { midtones, .. } => midtones[0] = -100,
        Adjustment::BlackWhite { tint, .. } => *tint = None,
        Adjustment::PhotoFilter { density, color, .. } => {
            *density = 0.75;
            *color = Rgb::new(0.0, 0.0, 1.0);
        }
        Adjustment::ChannelMixer { monochrome, .. } => *monochrome = true,
        Adjustment::Posterize { levels } => *levels = 4,
        Adjustment::Threshold { level } => *level = 1,
        Adjustment::SelectiveColor { absolute, .. } => *absolute = false,
        Adjustment::GradientMap { reverse, .. } => *reverse = true,
        _ => {}
    }
    a
}

#[test]
fn patches_changed_adjustments() {
    for (key, data, adjustment) in samples() {
        let label = String::from_utf8_lossy(&key).into_owned();
        let edited = changed(&adjustment);
        let out = encode(&edited, &[(key, &data)]);
        assert_eq!(out.len(), 1, "{label}");
        assert_eq!(decode(&key, &out[0].1).expect(&label), edited, "{label}");
        if key == *b"hue2" {
            assert_eq!(out[0].1[100..], [7; 36]);
        }
        if key == *b"levl" {
            assert_eq!(out[0].1[42..], data[42..]);
        }
    }
}

#[test]
fn brightness_contrast_writes_both_blocks() {
    let cged = Descriptor::new("null")
        .with("Vrsn", Value::Integer(1))
        .with("Brgh", Value::Integer(22))
        .with("Cntr", Value::Integer(-7))
        .with("means", Value::Integer(127))
        .with("Lab ", Value::Bool(false))
        .with("useLegacy", Value::Bool(false))
        .with("Auto", Value::Bool(false));
    let cged = descriptor::write_versioned(&cged);
    let brit = vec![0; 8];
    let modern = Adjustment::BrightnessContrast {
        brightness: 22,
        contrast: -7,
        legacy: false,
    };
    assert_eq!(decode(b"CgEd", &cged).expect("decodes"), modern);
    let blocks = [(*b"brit", &brit[..]), (*b"CgEd", &cged[..])];
    assert_eq!(
        encode(&modern, &blocks),
        [(*b"brit", brit.clone()), (*b"CgEd", cged.clone())]
    );

    let legacy = Adjustment::BrightnessContrast {
        brightness: 19,
        contrast: -18,
        legacy: true,
    };
    let out = encode(&legacy, &blocks);
    assert_eq!(out[0], (*b"brit", vec![0, 19, 255, 238, 0, 0, 0, 0]));
    assert_eq!(decode(b"CgEd", &out[1].1).expect("decodes"), legacy);
    assert_eq!(decode(b"brit", &out[0].1).expect("decodes"), legacy);

    let fresh = encode(&modern, &[]);
    assert_eq!(fresh[0], (*b"brit", vec![0; 8]));
    assert_eq!(decode(b"CgEd", &fresh[1].1).expect("decodes"), modern);

    // A CgEd naming a preset is not Brightness/Contrast.
    let preset = Descriptor::new("null")
        .with("Vrsn", Value::Integer(1))
        .with("presetKind", Value::Integer(1))
        .with("presetFileName", Value::Text("Increase Contrast".into()));
    assert!(decode(b"CgEd", &descriptor::write_versioned(&preset)).is_err());
}

#[test]
fn reads_curve_variants() {
    // Version 4 (channel-indexed) with a map curve.
    let mut data = vec![1, 0, 4, 0, 0, 0, 1, 0, 3];
    data.extend((0..=255u8).rev());
    let Adjustment::Curves { channels } = decode(b"curv", &data).expect("decodes") else {
        panic!("not curves");
    };
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0].0, 3);
    assert_eq!(channels[0].1[0], (0, 255));
    assert_eq!(channels[0].1.len(), 256);
    assert!(decode(b"curv", &[0, 0, 9, 0, 0, 0, 0]).is_err());
    assert!(decode(b"curv", &[0, 0, 1, 0, 0, 0, 1, 255, 255]).is_err());
}

#[test]
fn reads_photo_filter_version_three_and_noise_maps() {
    let mut phfl = vec![0, 3];
    for v in [10_000i32, 0, 0] {
        phfl.extend(v.to_be_bytes());
    }
    phfl.extend([0, 0, 0, 50, 0]);
    let Adjustment::PhotoFilter { color, density, .. } = decode(b"phfl", &phfl).expect("decodes")
    else {
        panic!("not a photo filter");
    };
    assert_eq!(color.to_u8(), [255, 255, 255]);
    assert_eq!(density, 0.5);

    let Adjustment::GradientMap { gradient, .. } =
        decode(b"grdm", &samples()[13].1).expect("decodes")
    else {
        panic!("not a gradient map");
    };
    assert_eq!(gradient.name, "Violet, Orange");
    // The same block marked noise approximates its stops.
    let mut noise = samples()[13].1.clone();
    let mode_at = noise.len() - 2 - 16 - 2 - 4 - 2 - 2 - 4 - 2;
    noise[mode_at + 1] = 1;
    let Adjustment::GradientMap { gradient, .. } = decode(b"grdm", &noise).expect("decodes") else {
        panic!("not a gradient map");
    };
    assert!(gradient.colors.len() >= 2);
}

fn json_number(v: Option<&serde_json::Value>) -> Option<f64> {
    v?.as_f64()
}

/// Differences between our adjustment and ag-psd's.
fn compare(ours: &Adjustment, theirs: &serde_json::Value) -> Vec<String> {
    let ty = theirs
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or_default();
    let n = |k: &str| json_number(theirs.get(k));
    let ok = match ours {
        Adjustment::BrightnessContrast {
            brightness,
            contrast,
            ..
        } => {
            ty == "brightness/contrast"
                && n("brightness") == Some(f64::from(*brightness))
                && n("contrast") == Some(f64::from(*contrast))
        }
        Adjustment::Levels { channels } => {
            ty == "levels"
                && theirs.get("rgb").is_some_and(|rgb| {
                    json_number(rgb.get("shadowInput")) == Some(f64::from(channels[0].in_black))
                        && json_number(rgb.get("highlightInput"))
                            == Some(f64::from(channels[0].in_white))
                })
        }
        Adjustment::Curves { channels } => {
            ty == "curves"
                && theirs
                    .get("rgb")
                    .and_then(|c| c.as_array())
                    .is_some_and(|rgb| {
                        channels
                            .first()
                            .is_some_and(|(_, points)| points.len() == rgb.len())
                    })
        }
        Adjustment::Exposure { exposure, .. } => {
            ty == "exposure"
                && n("exposure").is_some_and(|e| (e - f64::from(*exposure)).abs() < 1e-6)
        }
        Adjustment::Vibrance { vibrance, .. } => {
            ty == "vibrance" && n("vibrance").is_none_or(|v| v == f64::from(*vibrance))
        }
        Adjustment::HueSaturation { .. } => ty == "hue/saturation",
        Adjustment::ColorBalance { midtones, .. } => {
            ty == "color balance"
                && theirs
                    .get("midtones")
                    .and_then(|m| json_number(m.get("cyanRed")))
                    == Some(f64::from(midtones[0]))
        }
        Adjustment::BlackWhite { weights, .. } => {
            ty == "black & white" && n("reds") == Some(f64::from(weights[0]))
        }
        Adjustment::PhotoFilter { density, .. } => {
            ty == "photo filter"
                && n("density").is_some_and(|d| (d - f64::from(*density)).abs() < 1e-6)
        }
        Adjustment::ChannelMixer { monochrome, .. } => {
            ty == "channel mixer"
                && theirs.get("monochrome").and_then(|m| m.as_bool()) == Some(*monochrome)
        }
        Adjustment::Invert => ty == "invert",
        Adjustment::Posterize { levels } => {
            ty == "posterize" && n("levels") == Some(f64::from(*levels))
        }
        Adjustment::Threshold { level } => {
            ty == "threshold" && n("level") == Some(f64::from(*level))
        }
        Adjustment::GradientMap { gradient, .. } => {
            ty == "gradient map"
                && theirs
                    .get("colorStops")
                    .and_then(|s| s.as_array())
                    .is_some_and(|s| s.len() == gradient.colors.len())
        }
        Adjustment::SelectiveColor { absolute, .. } => {
            ty == "selective color"
                && theirs.get("mode").and_then(|m| m.as_str())
                    == Some(if *absolute { "absolute" } else { "relative" })
        }
        Adjustment::Other { .. } => ty == "color lookup" || ty.is_empty(),
    };
    if ok {
        Vec::new()
    } else {
        vec![format!("{ours:?} vs {theirs}")]
    }
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_adjustments() {
    let (mut count, mut compared, mut failures) = (0, 0, Vec::new());
    for file in corpus::files() {
        let ag = file.ag_psd_layers();
        for (layer, ag) in file.layers.iter().zip(ag) {
            let blocks: Vec<([u8; 4], &[u8])> = layer
                .blocks
                .iter()
                .filter(|(k, _)| is_adjustment_key(k))
                .map(|(k, d)| (*k, d.as_slice()))
                .collect();
            let Some(&(first, data)) = blocks.first() else {
                continue;
            };
            count += 1;
            let label = format!("{} {}", file.label(), layer.display_name());
            let (key, data) = match blocks.iter().find(|(k, _)| k == b"CgEd") {
                Some(&(k, d)) if first == *b"brit" => (k, d),
                _ => (first, data),
            };
            let adjustment = match decode(&key, data) {
                Ok(a) => a,
                Err(e) => {
                    failures.push(format!("{label}: {e}"));
                    continue;
                }
            };
            for (k, out) in encode(&adjustment, &blocks) {
                let Some(&(_, original)) = blocks.iter().find(|(b, _)| *b == k) else {
                    failures.push(format!("{label}: wrote a new {k:?} block"));
                    continue;
                };
                if !original.starts_with(&out) || original.len() - out.len() >= 4 {
                    failures.push(format!("{label}: {k:?} re-encodes differently"));
                }
            }
            let edited = changed(&adjustment);
            for (k, out) in encode(&edited, &blocks) {
                if k == key && decode(&k, &out).ok() != Some(edited.clone()) {
                    failures.push(format!("{label}: an edit reads back differently"));
                }
            }
            if let Some(theirs) = ag.as_ref().and_then(|j| j.get("adjustment")) {
                compared += 1;
                failures.extend(
                    compare(&adjustment, theirs)
                        .into_iter()
                        .map(|d| format!("{label}: {d}")),
                );
            }
        }
    }
    eprintln!(
        "{count} adjustment layers, {compared} compared with ag-psd, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
