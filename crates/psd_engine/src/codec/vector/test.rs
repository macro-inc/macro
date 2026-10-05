use super::*;
use crate::codec::corpus;

const W: u32 = 200;
const H: u32 = 100;

/// Fixed 8.24 for a fraction.
fn fx(v: f64) -> i32 {
    (v * FIXED_ONE) as i32
}

/// A mask as Photoshop writes it: inverted and disabled, starting full,
/// a closed linked/unlinked pair and an open subtracting subpath.
fn sample_bytes() -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(3);
    w.u32(5);
    w.u16(PATH_FILL_RULE);
    w.zeros(24);
    w.u16(INITIAL_FILL_RULE);
    w.u16(1);
    w.zeros(22);
    // Closed subpath, combine, even-odd, shape 0.
    w.u16(CLOSED_LENGTH);
    w.u16(2);
    w.i16(1);
    w.u16(EVEN_ODD);
    w.u32(0);
    w.u32(0);
    w.zeros(10);
    w.u16(CLOSED_LINKED);
    for (y, x) in [(0.25, 0.5), (0.5, 0.25), (0.75, 0.125)] {
        w.i32(fx(y));
        w.i32(fx(x));
    }
    w.u16(CLOSED_UNLINKED);
    for _ in 0..3 {
        w.i32(fx(1.0));
        w.i32(fx(1.0));
    }
    // Open subpath, subtract, nonzero, shape 2.
    w.u16(OPEN_LENGTH);
    w.u16(1);
    w.i16(2);
    w.u16(NONZERO);
    w.u32(0);
    w.u32(2);
    w.zeros(10);
    w.u16(OPEN_UNLINKED);
    for _ in 0..3 {
        w.i32(fx(-0.5));
        w.i32(fx(0.0));
    }
    w.into_bytes()
}

#[test]
fn decodes_records_into_canvas_pixels() {
    let mask = decode(&sample_bytes(), W, H).expect("decodes");
    assert!(mask.invert && mask.disabled && !mask.unlinked && mask.fill_all);
    assert_eq!(mask.subpaths.len(), 2);
    let first = &mask.subpaths[0];
    assert!(first.closed && !first.nonzero);
    assert_eq!((first.op, first.shape), (PathOp::Combine, 0));
    assert_eq!(
        first.knots[0],
        Knot {
            before: (100.0, 25.0),
            anchor: (50.0, 50.0),
            after: (25.0, 75.0),
            linked: true,
        }
    );
    assert_eq!(first.knots[1], Knot::corner(200.0, 100.0));
    let second = &mask.subpaths[1];
    assert!(!second.closed && second.nonzero);
    assert_eq!((second.op, second.shape), (PathOp::Subtract, 2));
    assert_eq!(second.knots, [Knot::corner(0.0, -50.0)]);
}

#[test]
fn re_encodes_byte_for_byte() {
    let bytes = sample_bytes();
    let mask = decode(&bytes, W, H).expect("decodes");
    assert_eq!(encode(&mask, W, H), bytes);
    assert_eq!(decode(&encode(&mask, W, H), W, H).expect("decodes"), mask);

    // Alignment padding after the records is ignored.
    let mut padded = bytes.clone();
    padded.extend_from_slice(&[0, 0]);
    assert_eq!(decode(&padded, W, H).expect("decodes"), mask);
}

#[test]
fn encodes_new_masks() {
    let mask = VectorMask {
        subpaths: vec![Subpath {
            closed: true,
            op: PathOp::Intersect,
            knots: vec![
                Knot::corner(10.0, 10.0),
                Knot::corner(190.0, 10.0),
                Knot::corner(100.0, 90.0),
            ],
            nonzero: false,
            shape: 0,
        }],
        unlinked: true,
        ..VectorMask::default()
    };
    let bytes = encode(&mask, W, H);
    assert_eq!(bytes.len(), 8 + 26 * 6);
    let back = decode(&bytes, W, H).expect("decodes");
    assert_eq!(back.subpaths[0].op, PathOp::Intersect);
    for (a, b) in back.subpaths[0].knots.iter().zip(&mask.subpaths[0].knots) {
        assert!((a.anchor.0 - b.anchor.0).abs() < 1e-4 && (a.anchor.1 - b.anchor.1).abs() < 1e-4);
    }
    assert!(back.unlinked && !back.invert);
    // A zero-sized canvas does not divide by zero.
    assert_eq!(encode(&mask, 0, 0).len(), bytes.len());
}

#[test]
fn rejects_damaged_masks() {
    let bytes = sample_bytes();
    let mut wrong = bytes.clone();
    wrong[3] = 2;
    assert!(decode(&wrong, W, H).is_err());
    let mut unknown = bytes.clone();
    unknown[8 + 1] = 42;
    assert!(decode(&unknown, W, H).is_err());
    assert!(decode(&bytes[..6], W, H).is_err());
    // A knot before any length record starts a subpath.
    let mut w = Writer::new();
    w.u32(3);
    w.u32(0);
    w.u16(OPEN_LINKED);
    w.zeros(24);
    let mask = decode(&w.into_bytes(), W, H).expect("decodes");
    assert_eq!(mask.subpaths.len(), 1);
    assert!(!mask.subpaths[0].closed);
}

fn json_points(knot: &serde_json::Value) -> Vec<f64> {
    knot.get("points")
        .and_then(|p| p.as_array())
        .map(|p| p.iter().filter_map(|v| v.as_f64()).collect())
        .unwrap_or_default()
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_masks_re_encode_exactly() {
    let (mut count, mut compared, mut failures) = (0, 0, Vec::new());
    for file in corpus::files() {
        let ag = file.ag_psd_layers();
        for (layer, ag) in file.layers.iter().zip(ag) {
            for key in [b"vmsk", b"vsms"] {
                let Some(data) = layer.block(key) else {
                    continue;
                };
                count += 1;
                let label = format!("{} {}", file.label(), layer.display_name());
                let mask = match decode(data, file.width, file.height) {
                    Ok(m) => m,
                    Err(e) => {
                        failures.push(format!("{label}: {e}"));
                        continue;
                    }
                };
                let written = encode(&mask, file.width, file.height);
                let exact = data.starts_with(&written)
                    && data[written.len()..].iter().all(|&b| b == 0)
                    && data.len() - written.len() < 4;
                if !exact {
                    failures.push(format!("{label}: re-encodes differently"));
                }
                let Some(paths) = ag
                    .as_ref()
                    .and_then(|j| j.get("vectorMask"))
                    .and_then(|v| v.get("paths"))
                    .and_then(|p| p.as_array())
                else {
                    continue;
                };
                compared += 1;
                let ours: Vec<f64> = mask
                    .subpaths
                    .iter()
                    .flat_map(|s| &s.knots)
                    .flat_map(|k| [k.before, k.anchor, k.after])
                    .flat_map(|(x, y)| [x, y])
                    .collect();
                let theirs: Vec<f64> = paths
                    .iter()
                    .filter_map(|p| p.get("knots").and_then(|k| k.as_array()))
                    .flatten()
                    .flat_map(json_points)
                    .collect();
                let same = ours.len() == theirs.len()
                    && ours.iter().zip(&theirs).all(|(a, b)| (a - b).abs() < 1e-3);
                if !same {
                    failures.push(format!("{label}: points differ from ag-psd"));
                }
            }
        }
    }
    eprintln!(
        "{count} vector masks, {compared} compared with ag-psd, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
