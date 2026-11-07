use super::*;
use crate::codec::corpus;

const TRNF: [f64; 8] = [10.0, 20.0, 110.0, 20.0, 110.0, 70.0, 10.0, 70.0];
const PERSPECTIVE: [f64; 8] = [10.0, 20.0, 110.0, 20.0, 90.0, 70.0, 30.0, 70.0];

fn so_ld(non_affine: [f64; 8]) -> Vec<u8> {
    let warp = Descriptor::new(descriptor::Id::string("warp"))
        .with(
            "warpStyle",
            Value::Enum("warpStyle".into(), "warpNone".into()),
        )
        .with("warpValue", Value::Double(0.0));
    let d = Descriptor::new("null")
        .with("Idnt", Value::Text("instance-id".into()))
        .with("placed", Value::Text("content-id".into()))
        .with("PgNm", Value::Integer(1))
        .with("Trnf", corners_value(&TRNF))
        .with("nonAffineTransform", corners_value(&non_affine))
        .with(descriptor::Id::string("warp"), Value::Descriptor(warp))
        .with(
            "Sz  ",
            Value::Descriptor(
                Descriptor::new("Pnt ")
                    .with("Wdth", Value::Double(100.0))
                    .with("Hght", Value::Double(50.0)),
            ),
        );
    let mut w = Writer::new();
    w.sig(b"soLD");
    w.u32(4);
    w.bytes(&descriptor::write_versioned(&d));
    w.into_bytes()
}

fn pl_ld() -> Vec<u8> {
    let mut w = Writer::new();
    w.sig(b"plcL");
    w.u32(3);
    w.pascal(b"instance-id", 1);
    for v in [1, 1, 16, 2] {
        w.i32(v);
    }
    for c in TRNF {
        w.f64(c);
    }
    w.u32(0);
    w.bytes(&descriptor::write_versioned(&Descriptor::new("warp")));
    w.into_bytes()
}

fn descriptor_of(data: &[u8]) -> Descriptor {
    read_so_ld(data).expect("reads").descriptor
}

#[test]
fn decodes_so_ld() {
    let o = decode(b"SoLd", &so_ld(PERSPECTIVE)).expect("decodes");
    assert_eq!(o.id, "content-id");
    assert_eq!(o.corners, PERSPECTIVE);
    assert_eq!(o.file_name, None);
    assert!(!o.linked);
    assert_eq!(
        decode(b"SoLE", &so_ld(TRNF)).expect("decodes").corners,
        TRNF
    );
}

#[test]
fn decodes_pl_ld() {
    let o = decode(b"PlLd", &pl_ld()).expect("decodes");
    assert_eq!(o.id, "instance-id");
    assert_eq!(o.corners, TRNF);
}

#[test]
fn moves_both_transforms() {
    let original = so_ld(PERSPECTIVE);
    // Unchanged corners write the descriptor back as it was.
    assert_eq!(encode_corners(b"SoLd", &original, &PERSPECTIVE), original);

    // Doubling about the origin and moving by (5, -3).
    let edit = |c: &[f64; 8]| {
        let mut out = *c;
        for i in 0..4 {
            out[2 * i] = c[2 * i] * 2.0 + 5.0;
            out[2 * i + 1] = c[2 * i + 1] * 2.0 - 3.0;
        }
        out
    };
    let moved = encode_corners(b"SoLd", &original, &edit(&PERSPECTIVE));
    assert_eq!(
        decode(b"SoLd", &moved).expect("decodes").corners,
        edit(&PERSPECTIVE)
    );
    let before = descriptor_of(&original);
    let after = descriptor_of(&moved);
    assert_eq!(corners_item(&after, "Trnf"), Some(edit(&TRNF)));
    for key in ["Idnt", "placed", "PgNm", "warp", "Sz  "] {
        assert_eq!(after.get(key), before.get(key), "{key}");
    }
    assert_eq!(moved[..12], original[..12]);
}

#[test]
fn rewrites_pl_ld_corners_in_place() {
    let original = pl_ld();
    let corners = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
    let out = encode_corners(b"PlLd", &original, &corners);
    assert_eq!(out.len(), original.len());
    assert_eq!(decode(b"PlLd", &out).expect("decodes").corners, corners);
    let at = read_pl_ld(&original).expect("reads").corners_at;
    assert_eq!(out[..at], original[..at]);
    assert_eq!(out[at + 64..], original[at + 64..]);
}

#[test]
fn handles_damaged_and_other_blocks() {
    let mut bad = so_ld(TRNF);
    bad[0] = b'x';
    assert!(decode(b"SoLd", &bad).is_err());
    assert_eq!(encode_corners(b"SoLd", &bad, &TRNF), bad);
    let mut version = pl_ld();
    version[7] = 9;
    assert!(decode(b"PlLd", &version).is_err());
    assert!(decode(b"PlLd", &pl_ld()[..20]).is_err());
    assert!(decode(b"lfx2", &pl_ld()).is_err());
    assert_eq!(affine_between(&[0.0; 8], &TRNF), None);
}

fn json_corners(value: Option<&serde_json::Value>) -> Option<Vec<f64>> {
    value?.as_array()?.iter().map(|v| v.as_f64()).collect()
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_smart_objects() {
    let (mut count, mut compared, mut failures) = (0, 0, Vec::new());
    for file in corpus::files() {
        let ag = file.ag_psd_layers();
        for (layer, ag) in file.layers.iter().zip(ag) {
            for key in [b"SoLd", b"SoLE", b"PlLd"] {
                let Some(data) = layer.block(key) else {
                    continue;
                };
                count += 1;
                let label = format!("{} {}", file.label(), layer.display_name());
                let object = match decode(key, data) {
                    Ok(o) => o,
                    Err(e) => {
                        failures.push(format!("{label}: {e}"));
                        continue;
                    }
                };
                let same = encode_corners(key, data, &object.corners);
                if !data.starts_with(&same) || data.len() - same.len() >= 4 {
                    failures.push(format!("{label}: unchanged corners rewrote the block"));
                }
                let Some(placed) = ag.as_ref().and_then(|j| j.get("placedLayer")) else {
                    continue;
                };
                if key == b"PlLd" && layer.block(b"SoLd").is_some() {
                    continue;
                }
                compared += 1;
                let theirs = json_corners(placed.get("nonAffineTransform"))
                    .or_else(|| json_corners(placed.get("transform")));
                if theirs.as_deref() != Some(&object.corners[..]) {
                    failures.push(format!("{label}: corners differ from ag-psd"));
                }
                let id = placed.get("placed").or_else(|| placed.get("id"));
                if id.and_then(|v| v.as_str()) != Some(object.id.as_str()) {
                    failures.push(format!("{label}: id differs from ag-psd"));
                }
            }
        }
    }
    eprintln!(
        "{count} smart object blocks, {compared} compared with ag-psd, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
