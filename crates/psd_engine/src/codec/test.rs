//! Damaged input: every decoder, and every encoder given a damaged
//! original, must return (an error or a value) rather than panic.

use super::*;
use crate::binary::Writer;
use crate::codec::descriptor::{Descriptor, Id, Value};
use crate::model::{
    Adjustment, AntiAlias, Effects, Fill, Gradient, Knot, LevelsChannel, ParagraphRun, PathOp, Rgb,
    Shadow, StrokeEffect, StrokePosition, Subpath, TextLayer, TextOrientation, TextRun, VectorMask,
    VectorStroke,
};

/// A small deterministic generator.
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
}

/// Damaged copies of a block: every prefix, and random byte changes,
/// insertions, and removals.
fn damaged(data: &[u8], random: &mut Random) -> Vec<Vec<u8>> {
    let mut out: Vec<Vec<u8>> = (0..data.len()).map(|n| data[..n].to_vec()).collect();
    for _ in 0..300 {
        let mut d = data.to_vec();
        for _ in 0..1 + random.below(4) {
            let at = random.below(d.len());
            match random.below(5) {
                0 => d.insert(at, random.next() as u8),
                1 if !d.is_empty() => {
                    d.remove(at);
                }
                2 if !d.is_empty() => d[at] = 0xFF,
                3 if !d.is_empty() => d[at] = 0,
                _ if !d.is_empty() => d[at] = random.next() as u8,
                _ => {}
            }
        }
        out.push(d);
    }
    out
}

fn text_layer() -> TextLayer {
    TextLayer {
        text: "Damaged\rtext\r".into(),
        runs: vec![
            TextRun {
                length: 8,
                style: Default::default(),
            },
            TextRun {
                length: 5,
                style: Default::default(),
            },
        ],
        paragraphs: vec![ParagraphRun {
            length: 13,
            align: Default::default(),
        }],
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        area: Some([0.0, 0.0, 10.0, 10.0]),
        orientation: TextOrientation::Horizontal,
        anti_alias: AntiAlias::Sharp,
        warped: false,
    }
}

fn effects() -> Effects {
    let shadow = Shadow {
        enabled: true,
        blend: Default::default(),
        color: Rgb::BLACK,
        opacity: 0.5,
        angle: 30.0,
        use_global_light: false,
        distance: 3.0,
        spread: 0.1,
        size: 4.0,
        noise: 0.0,
        contour: Default::default(),
        knocks_out: true,
    };
    let stroke = StrokeEffect {
        enabled: true,
        blend: Default::default(),
        opacity: 1.0,
        size: 2.0,
        position: StrokePosition::Center,
        fill: Fill::Gradient {
            gradient: Gradient::default(),
        },
    };
    Effects {
        drop_shadows: vec![shadow.clone(), shadow],
        strokes: vec![stroke],
        ..Effects::default()
    }
}

fn smart_block() -> Vec<u8> {
    let corners = Value::List((0..8).map(|i| Value::Double(f64::from(i))).collect());
    let d = Descriptor::new("null")
        .with("Idnt", Value::Text("id".into()))
        .with("Trnf", corners.clone())
        .with("nonAffineTransform", corners)
        .with(
            Id::string("warp"),
            Value::Descriptor(Descriptor::new("warp")),
        );
    let mut w = Writer::new();
    w.sig(b"soLD");
    w.u32(4);
    w.bytes(&descriptor::write_versioned(&d));
    w.into_bytes()
}

fn pattern_block() -> Vec<u8> {
    let mut p = Writer::new();
    p.u32(1);
    p.u32(3);
    p.i16(2);
    p.i16(2);
    p.unicode_nul("p");
    p.pascal(b"id", 1);
    p.u32(3);
    let mut list = Writer::new();
    for v in [0, 0, 2, 2, 3] {
        list.u32(v);
    }
    for _ in 0..3 {
        list.u32(1);
        list.u32(23 + 8);
        list.u32(8);
        for v in [0, 0, 2, 2] {
            list.u32(v);
        }
        list.u16(8);
        list.u8(1);
        list.bytes(&[0, 2, 0, 2, 0xFF, 7, 0xFF, 9]);
    }
    list.u32(0);
    list.u32(0);
    p.u32(list.len() as u32);
    p.bytes(&list.into_bytes());
    let p = p.into_bytes();
    let mut w = Writer::new();
    w.u32(p.len() as u32);
    w.bytes(&p);
    w.into_bytes()
}

#[test]
fn damaged_blocks_never_panic() {
    let mut random = Random(0x9E37_79B9_7F4A_7C15);
    let mask = VectorMask {
        subpaths: vec![Subpath {
            closed: true,
            op: PathOp::Subtract,
            knots: vec![Knot::corner(1.0, 2.0), Knot::corner(3.0, 4.0)],
            nonzero: true,
            shape: 1,
        }],
        ..VectorMask::default()
    };
    let stroke = VectorStroke {
        enabled: true,
        fill_enabled: true,
        width: 2.0,
        align: Default::default(),
        cap: Default::default(),
        join: Default::default(),
        miter_limit: 4.0,
        dashes: vec![2.0],
        dash_offset: 0.0,
        opacity: 1.0,
        blend: Default::default(),
        fill: Fill::Solid { color: Rgb::WHITE },
    };
    let adjustments = [
        Adjustment::Levels {
            channels: vec![LevelsChannel::default(); 4],
        },
        Adjustment::Curves {
            channels: vec![(0, vec![(0, 0), (255, 255)])],
        },
        Adjustment::GradientMap {
            gradient: Gradient::default(),
            dither: false,
            reverse: true,
        },
        Adjustment::HueSaturation {
            colorize: false,
            colorization: (0, 0, 0),
            master: (1, 2, 3),
            ranges: Vec::new(),
        },
        Adjustment::PhotoFilter {
            color: Rgb::WHITE,
            density: 0.5,
            preserve_luminosity: true,
        },
        Adjustment::BlackWhite {
            weights: [1; 6],
            tint: Some(Rgb::BLACK),
        },
        Adjustment::BrightnessContrast {
            brightness: 1,
            contrast: 2,
            legacy: false,
        },
    ];

    let text = text::encode(&text_layer(), None);
    for d in damaged(&text, &mut random) {
        let _ = text::decode(&d);
        let _ = text::encode(&text_layer(), Some(&d));
        let _ = engine_data::parse(&d);
    }
    let (_, fx) = effects::encode(&effects(), None);
    for d in damaged(&fx, &mut random) {
        let _ = effects::decode(Some(&d), Some(&d), Some(&d));
        let _ = effects::decode(None, None, Some(&d));
        let _ = effects::encode(&effects(), Some(&d));
    }
    let masks = vector::encode(&mask, 100, 100);
    for d in damaged(&masks, &mut random) {
        let _ = vector::decode(&d, 100, 100);
    }
    let vstk = fill::encode_stroke(&stroke, None);
    for d in damaged(&vstk, &mut random) {
        let _ = fill::decode_stroke(&d);
        let _ = fill::encode_stroke(&stroke, Some(&d));
    }
    let (key, gradient_fill) = fill::encode(&effects().strokes[0].fill, None);
    for d in damaged(&gradient_fill, &mut random) {
        let _ = fill::decode(&key, &d);
        let _ = fill::decode(b"vscg", &d);
        let _ = fill::encode(&Fill::Solid { color: Rgb::BLACK }, Some((&key, &d)));
    }
    for adjustment in &adjustments {
        for (key, block) in adjustment::encode(adjustment, &[]) {
            for d in damaged(&block, &mut random) {
                let _ = adjustment::decode(&key, &d);
                let _ = adjustment::encode(adjustment, &[(key, &d)]);
            }
        }
    }
    for d in damaged(&smart_block(), &mut random) {
        let _ = smart::decode(b"SoLd", &d);
        let _ = smart::decode(b"PlLd", &d);
        let _ = smart::encode_corners(b"SoLd", &d, &[1.0; 8]);
        let _ = smart::encode_corners(b"PlLd", &d, &[1.0; 8]);
    }
    for d in damaged(&pattern_block(), &mut random) {
        let _ = pattern::decode(&d, false);
        let _ = pattern::decode(&d, true);
    }
    let descriptor_bytes = descriptor::write(&Descriptor::new("null").with(
        "list",
        Value::List(vec![Value::Text("x".into()), Value::Double(1.0)]),
    ));
    for d in damaged(&descriptor_bytes, &mut random) {
        let _ = descriptor::read(&d);
    }
}

/// Damaged copies of a large block: sixteen prefixes and `count` random
/// changes.
fn sampled(data: &[u8], random: &mut Random, count: usize) -> Vec<Vec<u8>> {
    let mut out: Vec<Vec<u8>> = (0..16)
        .map(|i| data[..data.len() * i / 16].to_vec())
        .collect();
    for _ in 0..count {
        let mut d = data.to_vec();
        for _ in 0..1 + random.below(4) {
            if d.is_empty() {
                break;
            }
            let at = random.below(d.len());
            match random.below(4) {
                0 => d.truncate(at),
                1 => d[at] = 0xFF,
                2 => d[at] = 0,
                _ => d[at] = random.next() as u8,
            }
        }
        out.push(d);
    }
    out
}

/// Runs damaged copies of a block through its decoder, and through its
/// encoder as the original. False for keys no codec here reads.
fn exercise(key: &[u8; 4], data: &[u8], file: &corpus::File, random: &mut Random) -> bool {
    let (w, h) = (file.width, file.height);
    let copies = sampled(data, random, 40);
    match key {
        b"TySh" => {
            let clean = text::decode(data).ok();
            for d in &copies {
                if let Ok(layer) = text::decode(d) {
                    let _ = text::encode(&layer, Some(d));
                }
                if let Some(layer) = &clean {
                    let _ = text::encode(layer, Some(d));
                }
            }
        }
        b"lfx2" | b"lmfx" | b"lfxs" | b"lrFX" => {
            let decode = |d: &[u8]| match key {
                b"lrFX" => effects::decode(None, None, Some(d)),
                _ => effects::decode(Some(d), None, None),
            };
            let clean = decode(data).ok().flatten();
            for d in &copies {
                if let Ok(Some(fx)) = decode(d) {
                    let _ = effects::encode(&fx, Some(d));
                }
                if let Some(fx) = &clean {
                    let _ = effects::encode(fx, Some(d));
                }
            }
        }
        b"vmsk" | b"vsms" => {
            for d in &copies {
                if let Ok(mask) = vector::decode(d, w, h) {
                    let _ = vector::encode(&mask, w, h);
                }
            }
        }
        b"SoCo" | b"GdFl" | b"PtFl" | b"vscg" => {
            let clean = fill::decode(key, data).ok();
            for d in &copies {
                if let Ok(f) = fill::decode(key, d) {
                    let _ = fill::encode(&f, Some((key, d)));
                }
                if let Some(f) = &clean {
                    let _ = fill::encode(f, Some((key, d)));
                }
                let _ = fill::encode(&Fill::Solid { color: Rgb::BLACK }, Some((key, d)));
            }
        }
        b"vstk" => {
            let clean = fill::decode_stroke(data).ok();
            for d in &copies {
                if let Ok(s) = fill::decode_stroke(d) {
                    let _ = fill::encode_stroke(&s, Some(d));
                }
                if let Some(s) = &clean {
                    let _ = fill::encode_stroke(s, Some(d));
                }
            }
        }
        b"SoLd" | b"SoLE" | b"PlLd" => {
            for d in &copies {
                let _ = smart::decode(key, d);
                let _ = smart::encode_corners(key, d, &[1.0; 8]);
            }
        }
        b"Patt" | b"Pat2" | b"Pat3" => {
            for d in &copies {
                let _ = pattern::decode(d, file.psb);
            }
        }
        b"Txt2" => {
            for d in &copies {
                let _ = engine_data::parse(d);
            }
        }
        k if adjustment::is_adjustment_key(k) => {
            let clean = adjustment::decode(k, data).ok();
            for d in &copies {
                if let Ok(a) = adjustment::decode(k, d) {
                    let _ = adjustment::encode(&a, &[(*k, d)]);
                }
                if let Some(a) = &clean {
                    let _ = adjustment::encode(a, &[(*k, d)]);
                }
            }
        }
        _ => {
            let offsets = corpus::descriptor_offsets(key, data);
            for d in &copies {
                for &at in &offsets {
                    let _ = descriptor::read(d.get(at..).unwrap_or_default());
                }
            }
            return !offsets.is_empty();
        }
    }
    true
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn damaged_corpus_blocks_never_panic() {
    let mut random = Random(0x2545_F491_4F6C_DD1D);
    let mut blocks = 0;
    for file in corpus::files() {
        for (_, key, data) in file.all_blocks() {
            if exercise(key, data, &file, &mut random) {
                blocks += 1;
            }
        }
    }
    eprintln!("{blocks} blocks damaged without a panic");
}
