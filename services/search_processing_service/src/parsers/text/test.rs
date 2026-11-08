use super::*;

#[test]
fn valid_utf8_is_returned_unchanged() {
    let html = "\u{feff}<html><meta charset=\"windows-1252\"><p>café — naïve</p></html>";

    let text = decode_text(html.as_bytes().to_vec(), FileType::Htm);

    assert_eq!(text.as_deref(), Some(html));
}

#[test]
fn html_in_its_declared_legacy_charset_is_decoded_exactly() {
    let mut html = b"<html><head><meta http-equiv=\"Content-Type\" content=\"text/html; charset=windows-1252\"></head><body>Caf".to_vec();
    html.extend_from_slice(&[0xE9, b' ', 0x93, b'q', b'u', b'o', b't', b'e', 0x94, 0xA0]);
    html.extend_from_slice(b"</body></html>");
    assert!(String::from_utf8(html.clone()).is_err());

    let text = decode_text(html, FileType::Htm).expect("windows-1252 html is text");

    assert!(
        text.ends_with("<body>Café \u{201c}quote\u{201d}\u{a0}</body></html>"),
        "{text}"
    );
}

#[test]
fn every_html_extension_honors_a_meta_charset() {
    let mut html = b"<meta charset='ISO-8859-1'>Fran".to_vec();
    html.extend_from_slice(&[0xE7, b'a', b'i', b's']);

    for file_type in [
        FileType::Html,
        FileType::Htm,
        FileType::Shtml,
        FileType::Xhtml,
        FileType::Xht,
    ] {
        let text = decode_text(html.clone(), file_type);
        assert_eq!(
            text.as_deref(),
            Some("<meta charset='ISO-8859-1'>Français"),
            "{file_type}"
        );
    }
}

#[test]
fn undeclared_invalid_html_keeps_its_valid_text() {
    let mut html = b"<html><title>Quarterly report".to_vec();
    html.push(0x92);
    html.extend_from_slice(b"s summary</title></html>");

    let text = decode_text(html, FileType::Htm);

    assert_eq!(
        text.as_deref(),
        Some("<html><title>Quarterly report\u{fffd}s summary</title></html>")
    );
}

#[test]
fn a_declared_utf16_charset_without_a_byte_order_mark_is_read_as_utf8() {
    let mut html = b"<meta charset=\"utf-16\">caf".to_vec();
    html.push(0xE9);

    let text = decode_text(html, FileType::Html);

    assert_eq!(
        text.as_deref(),
        Some("<meta charset=\"utf-16\">caf\u{fffd}")
    );
}

#[test]
fn an_unknown_charset_label_falls_back_to_utf8() {
    let mut html = b"<meta charset=\"not-a-charset\">caf".to_vec();
    html.push(0xE9);

    let text = decode_text(html, FileType::Html);

    assert_eq!(
        text.as_deref(),
        Some("<meta charset=\"not-a-charset\">caf\u{fffd}")
    );
}

#[test]
fn a_utf16_byte_order_mark_picks_the_encoding() {
    let mut html = vec![0xFF, 0xFE];
    for unit in "<p>café</p>".encode_utf16() {
        html.extend_from_slice(&unit.to_le_bytes());
    }

    let text = decode_text(html, FileType::Htm);

    assert_eq!(text.as_deref(), Some("<p>café</p>"));
}

#[test]
fn only_html_honors_a_charset_declaration() {
    let mut code = b"// charset=windows-1252\nlet name = \"caf".to_vec();
    code.extend_from_slice(&[0xE9, b'"', b';']);

    for file_type in [FileType::Txt, FileType::Js, FileType::Md] {
        let text = decode_text(code.clone(), file_type);
        assert_eq!(
            text.as_deref(),
            Some("// charset=windows-1252\nlet name = \"caf\u{fffd}\";"),
            "{file_type}"
        );
    }
}

#[test]
fn binary_content_is_not_text() {
    let gzip = vec![
        0x1F, 0x8B, 0x08, 0x00, 0xC3, 0x9F, 0xD4, 0xE1, 0xFA, 0xFF, 0x80, 0x81, 0xFE, 0xB0, 0xC0,
        0xF5,
    ];

    assert_eq!(decode_text(gzip, FileType::Htm), None);
}
