use super::*;

/// A one-page PDF encrypted with the standard security handler under a user
/// password, which pdfium cannot open without it.
fn password_protected_pdf() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        concat!(
            "<< /Filter /Standard /V 1 /R 2 /P -4 ",
            "/O <0000000000000000000000000000000000000000000000000000000000000000> ",
            "/U <0000000000000000000000000000000000000000000000000000000000000000> >>",
        ),
    ];

    let mut pdf = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n{object}\nendobj\n", index + 1).bytes());
    }
    let xref = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        pdf.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    pdf.extend(
        format!(
            concat!(
                "trailer\n<< /Size {} /Root 1 0 R /Encrypt 4 0 R ",
                "/ID [<00000000000000000000000000000000> <00000000000000000000000000000000>] >>\n",
                "startxref\n{}\n%%EOF\n",
            ),
            objects.len() + 1,
            xref,
        )
        .bytes(),
    );
    pdf
}

#[test]
fn test_pdfs_pdfium_cannot_open_are_unreadable() {
    for (name, content) in [
        ("password protected", password_protected_pdf()),
        ("not a pdf", b"not a pdf".to_vec()),
    ] {
        let pages = parse_pdf_pages(content).expect("an unreadable pdf is not an error");
        assert!(pages.is_none(), "{name}");
    }
}

#[test]
fn test_readable_pdfs_parse_into_pages() {
    let content = std::fs::read("fixtures/example.pdf").expect("the fixture exists");

    let pages = parse_pdf_pages(content)
        .expect("the fixture parses")
        .expect("the fixture is readable");

    assert!(!pages.is_empty());
}
