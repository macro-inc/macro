use super::*;
use crate::binary::Writer;
use crate::codec::corpus;

/// A Unicode string as descriptors store it (with a trailing NUL).
fn unicode(w: &mut Writer, s: &str) {
    w.unicode_nul(s);
}

fn code(w: &mut Writer, id: &[u8; 4]) {
    w.u32(0);
    w.bytes(id);
}

fn string_id(w: &mut Writer, id: &str) {
    w.u32(id.len() as u32);
    w.bytes(id.as_bytes());
}

/// A reference with one item of every form.
fn reference_bytes() -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(7);
    w.sig(b"prop");
    unicode(&mut w, "");
    code(&mut w, b"Lyr ");
    code(&mut w, b"Opct");
    w.sig(b"Clss");
    unicode(&mut w, "");
    code(&mut w, b"Dcmn");
    w.sig(b"Enmr");
    unicode(&mut w, "");
    code(&mut w, b"Lyr ");
    code(&mut w, b"Ordn");
    code(&mut w, b"Trgt");
    w.sig(b"rele");
    unicode(&mut w, "");
    code(&mut w, b"Lyr ");
    w.u32(2);
    w.sig(b"Idnt");
    w.u32(17);
    w.sig(b"indx");
    w.u32(3);
    w.sig(b"name");
    unicode(&mut w, "");
    code(&mut w, b"Lyr ");
    unicode(&mut w, "Layer 1");
    w.into_bytes()
}

/// An object array of two unit-float items.
fn object_array_bytes() -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(16);
    unicode(&mut w, "");
    string_id(&mut w, "rationalPoint");
    w.u32(2);
    for (key, values) in [(b"Hrzn", [1.0, 2.5]), (b"Vrtc", [3.0, 4.25])] {
        code(&mut w, key);
        w.sig(b"UnFl");
        w.sig(b"#Pxl");
        w.u32(2);
        for v in values {
            w.f64(v);
        }
    }
    w.into_bytes()
}

fn every_type() -> Descriptor {
    let inner = Descriptor::new("RGBC")
        .with("Rd  ", Value::Double(255.0))
        .with("Grn ", Value::Double(12.5))
        .with("Bl  ", Value::Double(0.0));
    Descriptor {
        name: "Layer style".into(),
        class: Id::new("null"),
        items: vec![
            (Id::new("Clr "), Value::Descriptor(inner.clone())),
            (Id::new("glob"), Value::GlobalObject(inner)),
            (
                Id::new("list"),
                Value::List(vec![Value::Integer(1), Value::Text("two".into())]),
            ),
            (Id::new("doub"), Value::Double(-1.25)),
            (Id::new("Opct"), Value::UnitDouble("#Prc".into(), 75.0)),
            (
                Id::new("pts "),
                Value::UnitFloats("#Pxl".into(), vec![1.0, 2.0, 3.0]),
            ),
            (Id::new("Txt "), Value::Text("Héllo, wörld 🎨".into())),
            (
                Id::new("Md  "),
                Value::Enum(Id::new("BlnM"), Id::new("linearBurn")),
            ),
            (Id::new("long"), Value::Integer(-7)),
            (Id::new("comp"), Value::LargeInteger(1 << 40)),
            (Id::new("masterFXSwitch"), Value::Bool(true)),
            (Id::new("type"), Value::Class("".into(), Id::new("Lyr "))),
            (
                Id::new("glbc"),
                Value::GlobalClass("Doc".into(), Id::new("Dcmn")),
            ),
            (Id::new("null"), Value::Reference(reference_bytes())),
            (Id::new("alis"), Value::Alias(vec![1, 2, 3])),
            (Id::new("EngineData"), Value::RawData(vec![0, 255, 7])),
            (
                Id::new("meshPoints"),
                Value::ObjectArray(object_array_bytes()),
            ),
            (Id::new("Pth "), Value::Path(b"txtu....".to_vec())),
            (
                Id::string("warp"),
                Value::Enum(Id::string("time"), Id::new("hold")),
            ),
        ],
    }
}

#[test]
fn round_trips_every_type() {
    let d = every_type();
    let bytes = write(&d);
    let (back, used) = read(&bytes).expect("reads back");
    assert_eq!(used, bytes.len());
    assert_eq!(back, d);
    assert_eq!(write(&back), bytes);
}

#[test]
fn reads_hand_built_bytes() {
    let mut w = Writer::new();
    unicode(&mut w, "");
    code(&mut w, b"null");
    w.u32(3);
    code(&mut w, b"Opct");
    w.sig(b"UntF");
    w.sig(b"#Prc");
    w.f64(50.0);
    string_id(&mut w, "masterFXSwitch");
    w.sig(b"bool");
    w.u8(1);
    code(&mut w, b"Md  ");
    w.sig(b"enum");
    code(&mut w, b"BlnM");
    code(&mut w, b"Mltp");
    w.bytes(&[0xAA, 0xBB]); // what follows the descriptor
    let bytes = w.into_bytes();

    let (d, used) = read(&bytes).expect("reads");
    assert_eq!(used, bytes.len() - 2);
    assert_eq!(d.name, "");
    assert_eq!(d.class, "null");
    assert_eq!(d.unit("Opct"), Some(("#Prc", 50.0)));
    assert_eq!(d.bool("masterFXSwitch"), Some(true));
    assert_eq!(d.enumeration("Md  "), Some("Mltp"));
    assert_eq!(write(&d), bytes[..used]);
}

#[test]
fn keeps_four_letter_string_ids() {
    let mut w = Writer::new();
    unicode(&mut w, "");
    string_id(&mut w, "warp");
    w.u32(1);
    string_id(&mut w, "view");
    w.sig(b"long");
    w.i32(2);
    let bytes = w.into_bytes();

    let (d, _) = read(&bytes).expect("reads");
    assert_eq!(d.class, "warp");
    assert!(!d.class.is_code());
    assert_ne!(d.class, Id::new("warp"));
    assert_eq!(d.number("view"), Some(2.0));
    assert_eq!(write(&d), bytes);
}

#[test]
fn keeps_references_aliases_arrays_and_paths_as_stored() {
    let d = Descriptor::new("null")
        .with("null", Value::Reference(reference_bytes()))
        .with("meshPoints", Value::ObjectArray(object_array_bytes()));
    let bytes = write(&d);
    let (back, _) = read(&bytes).expect("reads");
    assert_eq!(back.get("null"), Some(&Value::Reference(reference_bytes())));
    assert_eq!(
        back.get("meshPoints"),
        Some(&Value::ObjectArray(object_array_bytes()))
    );
}

#[test]
fn rejects_damaged_data_without_panicking() {
    let bytes = write(&every_type());
    for n in 0..bytes.len() {
        assert!(read(&bytes[..n]).is_err(), "prefix of {n} bytes");
    }

    // An unknown value type.
    let mut w = Writer::new();
    unicode(&mut w, "");
    code(&mut w, b"null");
    w.u32(1);
    code(&mut w, b"Key ");
    w.sig(b"????");
    w.u32(0);
    assert!(read(&w.into_bytes()).is_err());

    // Counts far beyond the data.
    let mut w = Writer::new();
    unicode(&mut w, "");
    code(&mut w, b"null");
    w.u32(u32::MAX);
    assert!(read(&w.into_bytes()).is_err());
    let mut w = Writer::new();
    w.u32(u32::MAX);
    w.u16(0);
    assert!(read(&w.into_bytes()).is_err());
}

#[test]
fn rejects_nesting_beyond_the_limit() {
    let mut d = Descriptor::new("leaf");
    for _ in 0..MAX_DEPTH + 2 {
        d = Descriptor::new("node").with("next", Value::Descriptor(d));
    }
    assert!(read(&write(&d)).is_err());

    let mut v = Value::Integer(1);
    for _ in 0..MAX_DEPTH + 2 {
        v = Value::List(vec![v]);
    }
    assert!(read(&write(&Descriptor::new("null").with("deep", v))).is_err());

    let mut d = Descriptor::new("leaf");
    for _ in 0..MAX_DEPTH - 1 {
        d = Descriptor::new("node").with("next", Value::Descriptor(d));
    }
    assert!(read(&write(&d)).is_ok());
}

#[test]
fn reads_and_writes_the_version() {
    let d = Descriptor::new("null").with("Vrsn", Value::Integer(1));
    let bytes = write_versioned(&d);
    assert_eq!(bytes[..4], [0, 0, 0, 16]);
    let (back, used) = read_versioned(&bytes).expect("reads");
    assert_eq!(back, d);
    assert_eq!(used, bytes.len());
    let mut wrong = bytes;
    wrong[3] = 17;
    assert!(read_versioned(&wrong).is_err());
}

#[test]
fn edits_items_in_place() {
    let mut d = Descriptor::new("null")
        .with("a", Value::Integer(1))
        .with("b", Value::Integer(2));
    d.set("a", Value::Bool(false));
    d.set("c", Value::Text("x".into()));
    let keys: Vec<&str> = d.items.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys, ["a", "b", "c"]);
    assert_eq!(d.bool("a"), Some(false));
    assert_eq!(d.remove("b"), Some(Value::Integer(2)));
    assert!(!d.has("b"));
    assert_eq!(d.text("c"), Some("x"));
    assert!(Id::new("Clr ").is_code());
    assert!(!Id::new("masterFXSwitch").is_code());
    assert_eq!(format!("{:?}", Id::string("warp")), "string \"warp\"");
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_descriptors_round_trip() {
    let (mut blocks, mut failures) = (0, Vec::new());
    for file in corpus::files() {
        let mut spans: Vec<(String, &[u8])> = Vec::new();
        for (_, key, data) in file.all_blocks() {
            for offset in corpus::descriptor_offsets(key, data) {
                spans.push((String::from_utf8_lossy(key).into_owned(), &data[offset..]));
            }
        }
        for (id, data) in &file.resources {
            if data.starts_with(&[0, 0, 0, 16])
                && [1065, 1076, 1080, 1082, 1083, 1088, 3000].contains(id)
            {
                spans.push((format!("resource {id}"), &data[4..]));
            }
        }
        for (what, data) in spans {
            blocks += 1;
            match read(data) {
                Ok((d, used)) if write(&d) == data[..used] => {}
                Ok(_) => failures.push(format!("{}: {what} wrote different bytes", file.label())),
                Err(e) => failures.push(format!("{}: {what}: {e}", file.label())),
            }
        }
    }
    eprintln!("{blocks} descriptors, {} failures", failures.len());
    assert!(failures.is_empty(), "{failures:#?}");
}
