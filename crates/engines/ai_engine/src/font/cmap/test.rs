use super::*;

const SHIFT_LIKE: &str = r"
%!PS-Adobe-3.0 Resource-CMap
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> def
/CMapName /Test-H def
/CMapType 1 def
3 begincodespacerange
<00> <80>
<8140> <9FFC>
<A0> <DF>
endcodespacerange
2 begincidrange
<20> <7e> 231
<8140> <817e> 633
endcidrange
1 begincidchar
<A1> 327
endcidchar
1 beginnotdefrange
<00> <1f> 1
endnotdefrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end
";

fn codes(cmap: &CMap, bytes: &[u8]) -> Vec<(u32, u8)> {
    cmap.decode(bytes).iter().map(|c| (c.code, c.len)).collect()
}

#[test]
fn splits_strings_by_codespace() {
    let cmap = CMap::parse(SHIFT_LIKE.as_bytes());
    assert_eq!(cmap.name(), Some("Test-H"));
    assert!(!cmap.vertical());
    assert_eq!(
        codes(&cmap, &[0x41, 0x81, 0x40, 0xA1, 0x81]),
        [(0x41, 1), (0x8140, 2), (0xA1, 1), (0x81, 1)]
    );
    // Bytes in no range take the length of the range their first byte
    // starts (here none, so one byte).
    assert_eq!(codes(&cmap, &[0xFF, 0x41]), [(0xFF, 1), (0x41, 1)]);
}

#[test]
fn maps_codes_to_cids() {
    let cmap = CMap::parse(SHIFT_LIKE.as_bytes());
    assert_eq!(cmap.cid(0x20), Some(231));
    assert_eq!(cmap.cid(0x41), Some(231 + 0x21));
    assert_eq!(cmap.cid(0x8141), Some(634));
    assert_eq!(cmap.cid(0xA1), Some(327));
    // Notdef ranges give one CID to every code.
    assert_eq!(cmap.cid(0x05), Some(1));
    assert_eq!(cmap.cid(0x9000), None);
}

#[test]
fn identity_and_predefined_cmaps() {
    let h = CMap::predefined("Identity-H");
    assert!(h.identity() && !h.vertical());
    assert_eq!(codes(&h, &[0x01, 0x02, 0x03]), [(0x0102, 2), (0x03, 1)]);
    assert_eq!(h.cid(0x1234), Some(0x1234));
    assert!(CMap::predefined("Identity-V").vertical());

    let ucs2 = CMap::predefined("UniJIS-UCS2-H");
    assert!(ucs2.unicode_codes());
    assert_eq!(ucs2.text(0x3042).as_deref(), Some("あ"));
    assert_eq!(ucs2.cid(0x3042), None);

    let utf16 = CMap::predefined("UniGB-UTF16-V");
    assert!(utf16.vertical());
    assert_eq!(
        codes(&utf16, &[0xD8, 0x3D, 0xDE, 0x00, 0x00, 0x41]),
        [(0xD83D_DE00, 4), (0x41, 2)]
    );
    assert_eq!(utf16.text(0xD83D_DE00).as_deref(), Some("😀"));

    let sjis = CMap::predefined("90ms-RKSJ-H");
    assert_eq!(
        codes(&sjis, &[0x41, 0x82, 0xA0, 0xB1]),
        [(0x41, 1), (0x82A0, 2), (0xB1, 1)]
    );
}

#[test]
fn usecmap_borrows_identity() {
    let cmap =
        CMap::parse(b"/Identity-H usecmap\n1 begincidchar\n<0005> 77\nendcidchar\n/WMode 1 def");
    assert!(cmap.vertical());
    assert_eq!(cmap.cid(5), Some(77));
    assert_eq!(cmap.cid(6), Some(6));
    assert_eq!(codes(&cmap, &[0, 5]), [(5, 2)]);
}

const TO_UNICODE: &str = r"
/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CMapName /Adobe-Identity-UCS def
1 begincodespacerange <0000> <FFFF> endcodespacerange
4 beginbfchar
<0003> <0020>
<0010> <00660069>
<0011> <D835DC9C>
<0012> /Euro
endbfchar
3 beginbfrange
<0020> <0022> <0041>
<0030> <0032> [<0061> <00620063> <D83DDE00>]
<0040> <0041> <D83DDE00>
endbfrange
endcmap CMapName currentdict /CMap defineresource pop end end
";

#[test]
fn reads_to_unicode_maps() {
    let cmap = CMap::parse(TO_UNICODE.as_bytes());
    let text = |code| cmap.text(code);
    assert_eq!(text(0x03).as_deref(), Some(" "));
    // Ligatures, surrogate pairs, and glyph names.
    assert_eq!(text(0x10).as_deref(), Some("fi"));
    assert_eq!(text(0x11).as_deref(), Some("\u{1D49C}"));
    assert_eq!(text(0x12).as_deref(), Some("€"));
    // Ranges increment the last character; arrays list each code's text.
    assert_eq!(text(0x20).as_deref(), Some("A"));
    assert_eq!(text(0x22).as_deref(), Some("C"));
    assert_eq!(text(0x23), None);
    assert_eq!(text(0x31).as_deref(), Some("bc"));
    assert_eq!(text(0x32).as_deref(), Some("😀"));
    assert_eq!(text(0x41).as_deref(), Some("😁"));
    assert_eq!(text(0x50), None);
}

#[test]
fn reads_code_points_written_as_odd_hex() {
    // MuPDF writes code points past the BMP as bare hex.
    let cmap = CMap::parse(
        b"1 beginbfchar <0001> <1F600> endbfchar\n\
          1 beginbfrange <14FD> <14FF> <10300> endbfrange\n\
          1 beginbfchar <0002> <041> endbfchar",
    );
    assert_eq!(cmap.text(1).as_deref(), Some("😀"));
    assert_eq!(cmap.text(0x14FE).as_deref(), Some("\u{10301}"));
    // Short odd hex is bytes padded with a 0 digit, as PDF reads it.
    assert_eq!(cmap.text(2).as_deref(), Some("\u{0410}"));
}

#[test]
fn single_byte_and_nested_to_unicode_ranges() {
    let cmap = CMap::parse(
        b"1 begincodespacerange <00> <FF> endcodespacerange\n\
          1 beginbfrange <00> <FF> <0000> endbfrange\n\
          1 beginbfchar <41> <0042> endbfchar\n\
          1 beginbfrange <61> <62> <0058> endbfrange",
    );
    assert_eq!(cmap.text(0x41).as_deref(), Some("B"));
    assert_eq!(cmap.text(0x42).as_deref(), Some("B"));
    assert_eq!(cmap.text(0x61).as_deref(), Some("X"));
    assert_eq!(cmap.text(0x63).as_deref(), Some("c"));
    assert_eq!(codes(&cmap, b"ab"), [(0x61, 1), (0x62, 1)]);
}

#[test]
fn damaged_cmaps_do_not_fail() {
    for data in [
        &b""[..],
        b"begincodespacerange <00",
        b"1 begincidrange <0000> <FFFF> endcidrange",
        b"1 beginbfrange <0000> <0001> [<0041> endbfrange",
        b"[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[",
        b"1 beginbfrange <FFFFFFFF> <00000000> <0041> endbfrange <<>> )",
        b"(unterminated \\",
    ] {
        let cmap = CMap::parse(data);
        let _ = cmap.decode(&[1, 2, 3]);
        let _ = (cmap.cid(1), cmap.text(1));
    }
}
