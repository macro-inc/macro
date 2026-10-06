use super::*;
use crate::codec::corpus;
use crate::codec::descriptor;

/// A string token as Photoshop writes it.
fn string_token(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    token(&mut out, &EngineValue::String(s.into()));
    out
}

/// Engine data laid out the way text layers store it.
fn tabbed_sample() -> Vec<u8> {
    let mut out = b"\n\n<<\n\t/EngineDict\n\t<<\n\t\t/Editor\n\t\t<<\n\t\t\t/Text ".to_vec();
    out.extend(string_token("Hi (there)\r"));
    out.extend_from_slice(
        b"\n\t\t>>\n\t\t/RunArray [\n\t\t<<\n\t\t\t/Axis [ 1.0 0.0 1.0 ]\n\t\t\t/XY [ ]\n\t\t>>\n\t\t<<\n\t\t\t/Props\n\t\t\t<<\n\t\t\t>>\n\t\t>>\n\t\t]\n\t\t/RunLengthArray [ 4 7 ]\n\t\t/IsJoinable 1\n\t\t/Spacing [ .8 1.0 1.33 ]\n\t\t/Shift -.25\n\t\t/Flag false\n\t>>\n\t/Name /Roman\n>>",
    );
    out
}

#[test]
fn parses_text_layer_layout() {
    let data = tabbed_sample();
    let v = parse(&data).expect("parses");
    let dict = v.get("EngineDict").expect("engine dict");
    assert_eq!(
        dict.path(&["Editor", "Text"]).and_then(EngineValue::as_str),
        Some("Hi (there)\r")
    );
    let runs = dict
        .get("RunArray")
        .and_then(EngineValue::as_array)
        .expect("runs");
    assert_eq!(runs.len(), 2);
    assert_eq!(
        runs[0].get("Axis"),
        Some(&EngineValue::Array(vec![
            EngineValue::Float(1.0),
            EngineValue::Float(0.0),
            EngineValue::Float(1.0)
        ]))
    );
    assert_eq!(runs[0].get("XY"), Some(&EngineValue::Array(Vec::new())));
    assert_eq!(runs[1].get("Props"), Some(&EngineValue::Dict(Vec::new())));
    assert_eq!(
        dict.get("RunLengthArray"),
        Some(&EngineValue::Array(vec![
            EngineValue::Int(4),
            EngineValue::Int(7)
        ]))
    );
    assert_eq!(dict.get("IsJoinable"), Some(&EngineValue::Int(1)));
    assert_eq!(dict.get("Shift"), Some(&EngineValue::Float(-0.25)));
    assert_eq!(dict.get("Flag"), Some(&EngineValue::Bool(false)));
    assert_eq!(v.get("Name"), Some(&EngineValue::Name("Roman".into())));
    assert_eq!(write(&v), data);
}

#[test]
fn parses_the_global_layout() {
    let mut data = b" /98 << /0 7 >> /0 << /1 [ << /0 ".to_vec();
    data.extend(string_token("Myriad"));
    data.extend_from_slice(b" /2 0 >> ] /27 /nil /31 36.0 /30 << >> >>");
    let v = parse(&data).expect("parses");
    assert_eq!(v.path(&["98", "0"]), Some(&EngineValue::Int(7)));
    let fonts = v
        .path(&["0", "1"])
        .and_then(EngineValue::as_array)
        .expect("array");
    assert_eq!(
        fonts[0].get("0").and_then(EngineValue::as_str),
        Some("Myriad")
    );
    assert_eq!(v.path(&["0", "27"]), Some(&EngineValue::Name("nil".into())));
    assert_eq!(write_compact(&v), data);
    assert_eq!(parse(&write(&v)).expect("tabbed"), v);
}

#[test]
fn formats_floats_like_photoshop() {
    let cases = [
        (0.0, "0.0"),
        (1.0, "1.0"),
        (0.8, ".8"),
        (1.33, "1.33"),
        (36.0, "36.0"),
        (-0.5, "-.5"),
        (-1.0, "-1.0"),
        (0.583, ".583"),
        (1.0 / 3.0, ".33333"),
        (104.199_98, "104.19998"),
        (-41.191_41, "-41.19141"),
        (0.000_001, "0.0"),
        (2.0e-5, ".00002"),
        (-0.0, "-0.0"),
        (f64::NAN, "0.0"),
    ];
    for (v, s) in cases {
        assert_eq!(format_float(v), s, "{v}");
        let back = parse(s.as_bytes()).expect("parses");
        assert_eq!(back.as_f64().map(format_float).as_deref(), Some(s));
    }
}

#[test]
fn escapes_strings() {
    // `(`, `)`, and `\` bytes are escaped, including inside UTF-16 units
    // (U+2028 holds a 0x28 byte, U+5C5C two backslashes).
    let text = "a(b)c\\d\u{2028}\u{5C5C}🎨\r\n";
    let v = EngineValue::Dict(vec![("T".into(), EngineValue::String(text.into()))]);
    let bytes = write(&v);
    assert_eq!(parse(&bytes).expect("parses"), v);
    assert_eq!(string_token("("), [b'(', 0xFE, 0xFF, 0, b'\\', b'(', b')']);
    // Strings without a byte order mark read as Latin-1.
    assert_eq!(
        parse(b"<< /A (abc) >>").expect("parses").get("A"),
        Some(&EngineValue::String("abc".into()))
    );
}

#[test]
fn rejects_damaged_data() {
    let bad: [&[u8]; 9] = [
        b"",
        b"<< /A (unterminated >>",
        b"<< /A 1",
        b"<< /A [ 1 2 >>",
        b"<< /A 1 >> >>",
        b"<< /A 1 >> 7",
        b"<< 5 >>",
        b"<< /A %% >>",
        b"<< /A 1.2.3 >>",
    ];
    for data in bad {
        assert!(parse(data).is_err(), "{:?}", String::from_utf8_lossy(data));
    }
    let deep = "[ ".repeat(MAX_DEPTH + 1) + &" ]".repeat(MAX_DEPTH + 1);
    assert!(parse(deep.as_bytes()).is_err());
    let ok = "[ ".repeat(MAX_DEPTH - 1) + &" ]".repeat(MAX_DEPTH - 1);
    assert!(parse(ok.as_bytes()).is_ok());
    // Trailing NULs and whitespace are fine.
    assert!(parse(b"<< /A 1 >>\n\0\0").is_ok());
}

#[test]
fn edits_dictionaries() {
    let mut v = parse(b"<< /A << /B 1 >> /C [ 1 ] >>").expect("parses");
    v.set("C", EngineValue::Bool(true));
    v.set("D", EngineValue::Float(2.5));
    if let Some(b) = v.path_mut(&["A", "B"]) {
        *b = EngineValue::Int(9);
    }
    assert_eq!(v.path(&["A", "B"]).and_then(EngineValue::as_i64), Some(9));
    assert_eq!(v.get("C").and_then(EngineValue::as_bool), Some(true));
    assert_eq!(v.get("D").and_then(EngineValue::as_f64), Some(2.5));
    assert_eq!(EngineValue::Float(3.0).as_i64(), Some(3));
    assert_eq!(EngineValue::Float(3.5).as_i64(), None);
    let keys: Vec<&str> = match &v {
        EngineValue::Dict(items) => items.iter().map(|(k, _)| k.as_str()).collect(),
        _ => Vec::new(),
    };
    assert_eq!(keys, ["A", "C", "D"]);
}

/// Every text layer's engine data and every global text data block in the
/// corpus, with whether it is the global (one-line) layout.
fn corpus_engine_data(file: &corpus::File) -> Vec<(Vec<u8>, bool)> {
    let mut out = Vec::new();
    for (_, key, data) in file.all_blocks() {
        if key == b"Txt2" {
            out.push((data.to_vec(), true));
        }
        if key == b"TySh"
            && let Some(text) = data.get(56..)
            && let Ok((d, _)) = descriptor::read(text)
            && let Some(descriptor::Value::RawData(raw)) = d.get("EngineData")
        {
            out.push((raw.clone(), false));
        }
    }
    out
}

#[test]
#[ignore = "reads the files in PSD_CORPUS_DIR"]
fn corpus_engine_data_round_trips() {
    let (mut count, mut exact, mut failures) = (0, 0, Vec::new());
    for file in corpus::files() {
        for (data, global) in corpus_engine_data(&file) {
            count += 1;
            let value = match parse(&data) {
                Ok(v) => v,
                Err(e) => {
                    failures.push(format!("{}: {e}", file.label()));
                    continue;
                }
            };
            let written = if global {
                write_compact(&value)
            } else {
                write(&value)
            };
            if parse(&written).ok().as_ref() != Some(&value) {
                failures.push(format!("{}: written data reads differently", file.label()));
            }
            if written == data {
                exact += 1;
            } else {
                eprintln!("{}: not byte-exact (global: {global})", file.label());
            }
        }
    }
    eprintln!(
        "{count} engine data blocks, {exact} byte-exact, {} failures",
        failures.len()
    );
    assert!(failures.is_empty(), "{failures:#?}");
}
