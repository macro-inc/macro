use super::*;

#[test]
fn integers_round_trip() {
    let mut w = Writer::new();
    w.u8(1);
    w.i16(-2);
    w.u32(3);
    w.i64(-4);
    w.f64(1.5);
    w.fixed(72.0);
    w.sig(b"8BIM");
    let bytes = w.into_bytes();
    let mut r = Reader::new(&bytes);
    assert_eq!(r.u8().unwrap(), 1);
    assert_eq!(r.i16().unwrap(), -2);
    assert_eq!(r.u32().unwrap(), 3);
    assert_eq!(r.i64().unwrap(), -4);
    assert_eq!(r.f64().unwrap(), 1.5);
    assert_eq!(r.fixed().unwrap(), 72.0);
    assert_eq!(&r.sig().unwrap(), b"8BIM");
    assert!(r.is_empty());
    assert!(r.u8().is_err());
}

#[test]
fn pascal_strings_pad() {
    let mut w = Writer::new();
    w.pascal(b"abc", 4);
    w.pascal(b"", 2);
    assert_eq!(w.buf, [3, b'a', b'b', b'c', 0, 0]);
    let mut r = Reader::new(&w.buf);
    assert_eq!(r.pascal(4).unwrap(), b"abc");
    assert_eq!(r.pascal(2).unwrap(), b"");
    assert!(r.is_empty());
}

#[test]
fn unicode_strings_drop_trailing_nul() {
    let mut w = Writer::new();
    w.unicode_nul("Layer 1 ✓");
    w.unicode("plain");
    let mut r = Reader::new(&w.buf);
    assert_eq!(r.unicode().unwrap(), "Layer 1 ✓");
    assert_eq!(r.unicode().unwrap(), "plain");
}

#[test]
fn lengths_fill_in() {
    let mut w = Writer::new();
    let at = w.placeholder(false);
    w.bytes(&[1, 2, 3]);
    w.fill_length(at, false, 0);
    assert_eq!(&w.buf[..4], &[0, 0, 0, 3]);
    let at = w.placeholder(true);
    w.u8(9);
    w.fill_length(at, true, 1);
    assert_eq!(&w.buf[7..15], &[0, 0, 0, 0, 0, 0, 0, 2]);
}

#[test]
fn mac_roman_names() {
    assert_eq!(mac_roman(b"Layer 1"), "Layer 1");
    assert_eq!(mac_roman(&[0x8e]), "é");
    assert_eq!(to_mac_roman("Café"), vec![b'C', b'a', b'f', 0x8e]);
    assert_eq!(to_mac_roman("日本"), b"??".to_vec());
}
