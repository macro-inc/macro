use super::*;

fn text(name: &str) -> Option<String> {
    glyph_text(name, false)
}

#[test]
fn reads_glyph_list_names() {
    assert_eq!(text("A").as_deref(), Some("A"));
    assert_eq!(text("space").as_deref(), Some(" "));
    assert_eq!(text("Aacute").as_deref(), Some("Á"));
    assert_eq!(text("quotedblleft").as_deref(), Some("\u{201C}"));
    assert_eq!(text("Euro").as_deref(), Some("€"));
    assert_eq!(text("afii10017").as_deref(), Some("А"));
    assert_eq!(text("alpha").as_deref(), Some("α"));
    assert_eq!(text("ffi").as_deref(), Some("\u{FB03}"));
    // Several code points, and pdf.js's additions for TeX fonts.
    assert_eq!(text("dalethatafpatah").as_deref(), Some("\u{05D3}\u{05B2}"));
    assert_eq!(text("angbracketleft").as_deref(), Some("\u{3008}"));
    assert_eq!(text("nosuchglyph"), None);
}

#[test]
fn reads_uni_and_u_names() {
    assert_eq!(text("uni0041").as_deref(), Some("A"));
    assert_eq!(text("uni00e9").as_deref(), Some("é"));
    assert_eq!(text("uni00410042").as_deref(), Some("AB"));
    assert_eq!(text("u1F600").as_deref(), Some("😀"));
    assert_eq!(text("u0041").as_deref(), Some("A"));
    // Lengths and values the names cannot have.
    assert_eq!(text("uni004"), None);
    assert_eq!(text("uniD800"), None);
    assert_eq!(text("u12"), None);
    assert_eq!(text("u110000"), None);
    // `union` is a glyph list name, not a `uni` code.
    assert_eq!(text("union").as_deref(), Some("∪"));
}

#[test]
fn drops_suffixes_and_splits_ligatures() {
    assert_eq!(text("a.sc").as_deref(), Some("a"));
    assert_eq!(text("f_f_i").as_deref(), Some("ffi"));
    assert_eq!(text("f_i.alt").as_deref(), Some("fi"));
    assert_eq!(text("uni0066_uni0069").as_deref(), Some("fi"));
    assert_eq!(text(".notdef"), None);
    assert_eq!(text("f_bogus"), None);
}

#[test]
fn reads_dingbats_only_for_zapf_dingbats() {
    assert_eq!(glyph_text("a1", true).as_deref(), Some("\u{2701}"));
    assert_eq!(glyph_text("a20", true).as_deref(), Some("\u{2714}"));
    assert_eq!(glyph_text("a1", false), None);
    // Other names still read the glyph list.
    assert_eq!(glyph_text("space", true).as_deref(), Some(" "));
}

#[test]
fn single_characters_prefer_whole_names() {
    assert_eq!(glyph_char("fi", false), Some('\u{FB01}'));
    assert_eq!(glyph_char("f_i", false), Some('\u{FB01}'));
    assert_eq!(glyph_char("f_f_i", false), Some('\u{FB03}'));
    assert_eq!(glyph_char("A.swash", false), Some('A'));
    assert_eq!(glyph_char("a_b", false), None);
    assert_eq!(glyph_char("uni00410042", false), None);
}
