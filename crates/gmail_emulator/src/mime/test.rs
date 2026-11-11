use super::*;

#[test]
fn a_multipart_message_becomes_gmails_part_tree() {
    let raw = b"From: a@example.com\r\nTo: b@example.com\r\nSubject: =?UTF-8?Q?Caf=C3=A9?=\r\n\
        Content-Type: multipart/mixed; boundary=\"b\"\r\n\r\n\
        --b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello   there\r\n\
        --b\r\nContent-Type: application/pdf; name=\"a.pdf\"\r\n\
        Content-Disposition: attachment; filename=\"a.pdf\"\r\n\
        Content-Transfer-Encoding: base64\r\n\r\nJVBERg==\r\n--b--\r\n";

    let parsed = parse(raw).unwrap();

    assert_eq!(parsed.header("subject"), Some("Café"));
    assert_eq!(parsed.snippet, "Hello there");
    assert!(parsed.has_attachment);
    let json = part_json(&parsed.payload, Format::Full, 7);
    assert_eq!(json["mimeType"], "multipart/mixed");
    assert_eq!(json["parts"][0]["partId"], "0");
    assert_eq!(
        json["parts"][0]["body"]["data"],
        encode_body(b"Hello   there")
    );
    assert_eq!(json["parts"][1]["filename"], "a.pdf");
    assert_eq!(json["parts"][1]["body"]["size"], 4);
    assert!(json["parts"][1]["body"].get("data").is_none());

    let attachment_id = json["parts"][1]["body"]["attachmentId"].as_str().unwrap();
    let part_id = attachment_part_id(attachment_id).unwrap();
    assert_eq!(find_part(&parsed.payload, &part_id).unwrap().body, b"%PDF");
}

#[test]
fn removing_a_header_keeps_the_rest_of_the_message() {
    let raw = b"To: b@example.com\r\nBcc: c@example.com,\r\n d@example.com\r\nSubject: Hi\r\n\r\nBody\r\n";

    let stripped = without_header(raw, "bcc");

    assert_eq!(
        stripped,
        b"To: b@example.com\r\nSubject: Hi\r\n\r\nBody\r\n"
    );
}
