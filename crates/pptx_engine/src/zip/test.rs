use super::*;

fn build(entries: &[(&str, &[u8], bool)]) -> Vec<u8> {
    let mut w = Writer::new();
    for (name, data, compress) in entries {
        w.add(name, WriteData::Fresh { data, compress: *compress }).unwrap();
    }
    w.finish().unwrap()
}

#[test]
fn crc32_matches_reference_vector() {
    assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    assert_eq!(crc32(b""), 0);
}

#[test]
fn round_trips_stored_and_deflated_entries() {
    let big = "<a:t>hello world</a:t>".repeat(500);
    let bytes = build(&[
        ("[Content_Types].xml", b"<Types/>", true),
        ("ppt/slides/slide1.xml", big.as_bytes(), true),
        ("ppt/media/image1.png", &[0x89, b'P', b'N', b'G'], false),
    ]);
    let archive = Archive::parse(&bytes).unwrap();
    let names: Vec<_> = archive.entries().iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["[Content_Types].xml", "ppt/slides/slide1.xml", "ppt/media/image1.png"]);
    let slide = &archive.entries()[1];
    assert_eq!(slide.method, METHOD_DEFLATE);
    assert!(slide.compressed_size < slide.uncompressed_size);
    assert_eq!(archive.read(slide).unwrap(), big.as_bytes());
    assert_eq!(archive.read(&archive.entries()[2]).unwrap(), [0x89, b'P', b'N', b'G']);
}

#[test]
fn raw_copy_preserves_compressed_bytes() {
    let data = "x".repeat(10_000);
    let original = build(&[("a.xml", data.as_bytes(), true)]);
    let archive = Archive::parse(&original).unwrap();
    let entry = &archive.entries()[0];
    let mut w = Writer::new();
    w.add("a.xml", WriteData::Raw { entry, raw: archive.raw_data(entry) }).unwrap();
    let copy = w.finish().unwrap();
    let reparsed = Archive::parse(&copy).unwrap();
    assert_eq!(reparsed.raw_data(&reparsed.entries()[0]), archive.raw_data(entry));
    assert_eq!(reparsed.read(&reparsed.entries()[0]).unwrap(), data.as_bytes());
}

#[test]
fn detects_corruption() {
    let mut bytes = build(&[("a.xml", b"hello hello hello hello hello hello hello hello hello hello hello", false)]);
    // Flip a payload byte (after the 30-byte header and 5-byte name).
    bytes[36] ^= 0xFF;
    let archive = Archive::parse(&bytes).unwrap();
    assert!(matches!(archive.read(&archive.entries()[0]), Err(Error::Zip(_))));
}

#[test]
fn rejects_non_zip_and_ole() {
    assert!(Archive::parse(b"not a zip at all, definitely not").is_err());
    let mut ole = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    ole.resize(512, 0);
    assert!(matches!(Archive::parse(&ole), Err(Error::Unsupported(_))));
}

#[test]
fn decodes_cp437_names() {
    assert_eq!(decode_name(&[b'a', 0x82], 0), "aé");
    assert_eq!(decode_name("é".as_bytes(), FLAG_UTF8), "é");
}
