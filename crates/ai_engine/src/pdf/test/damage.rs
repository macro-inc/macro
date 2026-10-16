//! Damaged files: cross-references repaired by scanning, and bytes that
//! must never make the reader panic.

use super::*;

fn open(bytes: &[u8]) -> Pdf {
    Pdf::open(Arc::from(bytes)).unwrap()
}

/// Everything a reader does with a file: pages, every object, every
/// stream decoded, every page's content parsed.
pub(super) fn walk(bytes: &[u8]) {
    let Ok(pdf) = Pdf::open(Arc::from(bytes)) else {
        return;
    };
    let _ = pdf.version();
    let _ = pdf.catalog();
    for page in pdf.pages() {
        let contents = page.dict.get("Contents").map(|c| pdf.resolve(c));
        let streams = match contents {
            Some(Object::Array(a)) => a.iter().map(|c| pdf.resolve(c)).collect(),
            Some(o) => vec![o],
            None => Vec::new(),
        };
        for s in streams {
            if let Object::Stream(s) = s
                && let Ok(data) = pdf.stream_data(&s)
            {
                let _ = content::parse(&data);
            }
        }
    }
    for r in pdf.object_refs() {
        if let Some(Object::Stream(s)) = pdf.get(r) {
            let _ = pdf.decode_stream(&s);
        }
    }
}

/// `bytes` with the first `from` replaced by `to`.
fn replace(bytes: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
    let at = lexer::find(bytes, from, 0).unwrap();
    [&bytes[..at], to, &bytes[at + from.len()..]].concat()
}

#[test]
fn wrong_startxref() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    let at = b.table(&[0, 1, 2, 3, 4], "/Size 5 /Root 1 0 R");
    let fixed = replace(
        &b.out,
        format!("startxref\n{at}").as_bytes(),
        b"startxref\n17",
    );
    let pdf = open(&fixed);
    assert!(pdf.repaired());
    assert_eq!(pdf.pages().len(), 1);
    assert_eq!(
        pdf.trailer().get("Root"),
        Some(&Object::Ref(ObjRef::new(1, 0)))
    );
}

#[test]
fn no_cross_reference_at_all() {
    // Objects only: the catalog is found by its type.
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    let pdf = open(&b.out);
    assert!(pdf.repaired());
    assert_eq!(
        pdf.trailer().get("Root"),
        Some(&Object::Ref(ObjRef::new(1, 0)))
    );
    assert_eq!(pdf.trailer().i64("Size"), Some(5));
    assert_eq!(pdf.pages().len(), 1);
}

#[test]
fn shifted_offsets() {
    // Bytes inserted after the header leave every offset short.
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.table(&[0, 1, 2, 3, 4], "/Size 5 /Root 1 0 R /Info 9 0 R");
    let mut bytes = b.out.clone();
    bytes.splice(15..15, b"% inserted junk\n".iter().copied());
    let pdf = open(&bytes);
    assert!(pdf.repaired());
    assert!(pdf.trailer().contains("Info"));
    let Some(Object::Stream(s)) = pdf.get(ObjRef::new(4, 0)) else {
        panic!("no content");
    };
    assert_eq!(pdf.stream_data(&s).unwrap(), b"0 0 m 10 10 l S");
}

#[test]
fn line_endings_converted() {
    // LF to CRLF: offsets and stream lengths are all off.
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.stream(5, "", b"line one\nline two");
    b.table(&[0, 1, 2, 3, 4, 5], "/Size 6 /Root 1 0 R");
    let converted: Vec<u8> = b
        .out
        .iter()
        .flat_map(|&c| {
            if c == b'\n' {
                vec![b'\r', b'\n']
            } else {
                vec![c]
            }
        })
        .collect();
    let pdf = open(&converted);
    assert!(pdf.repaired());
    assert_eq!(pdf.pages().len(), 1);
    let Some(Object::Stream(s)) = pdf.get(ObjRef::new(5, 0)) else {
        panic!("no stream");
    };
    assert_eq!(&s.data[..], b"line one\r\nline two");
}

#[test]
fn truncated_file() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(
        5,
        "<</Title (A long title that will be cut off somewhere)>>",
    );
    b.table(&[0, 1, 2, 3, 4, 5], "/Size 6 /Root 1 0 R");
    let cut = b.offsets[&5] + 20;
    let pdf = open(&b.out[..cut]);
    assert!(pdf.repaired());
    assert_eq!(pdf.pages().len(), 1);
    assert!(pdf.get(ObjRef::new(5, 0)).is_some());
}

#[test]
fn newest_definition_wins_when_scanning() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(5, "(old)").obj(5, "(new)");
    b.raw(b"trailer\n<</Size 6 /Root 1 0 R /Info 5 0 R>>\n");
    b.raw(b"trailer\n<</Size 6 /ID [<00> <01>]>>\n%%EOF");
    let pdf = open(&b.out);
    assert!(pdf.repaired());
    assert_eq!(
        pdf.get(ObjRef::new(5, 0)),
        Some(Object::String(b"new".to_vec()))
    );
    // Trailers merge, newest first.
    assert!(pdf.trailer().contains("Info") && pdf.trailer().contains("ID"));
    assert_eq!(
        pdf.trailer().get("Root"),
        Some(&Object::Ref(ObjRef::new(1, 0)))
    );
}

#[test]
fn a_wrong_root_is_replaced_by_the_catalog() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(5, "(not a catalog)");
    b.table(&[0, 1, 2, 3, 4, 5], "/Size 6 /Root 5 0 R");
    let pdf = b.open();
    assert!(pdf.repaired());
    assert_eq!(
        pdf.trailer().get("Root"),
        Some(&Object::Ref(ObjRef::new(1, 0)))
    );
    assert_eq!(pdf.pages().len(), 1);
}

#[test]
fn repair_opens_object_streams() {
    // A cross-reference stream file whose `startxref` is gone: the scan
    // finds the object streams; the older of two versions of object 4 (in
    // a superseded object stream) loses to the newer.
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>");
    let (dict, data) = objstm(&[(4, "(old)")]);
    b.stream(10, &dict, &data);
    let (dict, data) = objstm(&[
        (2, "<</Type /Pages /Kids [3 0 R] /Count 1>>"),
        (3, "<</Type /Page>>"),
        (4, "(new)"),
    ]);
    b.stream(
        11,
        &format!("{dict} /Filter /FlateDecode"),
        &filter::deflate(&data),
    );
    let rows = [
        b.row(1),
        (2, 11, 0),
        (2, 11, 1),
        (2, 11, 2),
        b.row(10),
        b.row(11),
    ];
    b.xref_stream(
        12,
        &[(1, 4), (10, 2)],
        &rows,
        "/Size 13 /Root 1 0 R /Info 1 0 R",
        true,
    );
    let end = lexer::rfind(&b.out, b"startxref", usize::MAX).unwrap();
    let pdf = open(&b.out[..end]);
    assert!(pdf.repaired());
    assert_eq!(
        pdf.get(ObjRef::new(4, 0)),
        Some(Object::String(b"new".to_vec()))
    );
    assert_eq!(pdf.pages().len(), 1);
    // The cross-reference stream's dictionary served as the trailer.
    assert!(pdf.trailer().contains("Info"));
    assert!(!pdf.trailer().contains("W"));
}

#[test]
fn broken_stream_lengths() {
    // A wrong `Length`, and a stream that never ends followed by an object
    // that must still be found.
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(5, "<</Length 999>>\nstream\nabc\nendstream");
    b.obj(6, "<</Length 3>>\nstream\nxyz");
    b.obj(7, "(after)");
    let pdf = open(&b.out);
    assert!(pdf.repaired());
    let Some(Object::Stream(s)) = pdf.get(ObjRef::new(5, 0)) else {
        panic!("no stream");
    };
    assert_eq!(&s.data[..], b"abc");
    assert_eq!(
        pdf.get(ObjRef::new(7, 0)),
        Some(Object::String(b"after".to_vec()))
    );
}

#[test]
fn offsets_at_whitespace_are_not_damage() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    for offset in b.offsets.values_mut() {
        *offset -= 1;
    }
    b.table(&[0, 1, 2, 3, 4], "/Size 5 /Root 1 0 R");
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(pdf.pages().len(), 1);
}

#[test]
fn huge_counts_are_bounded() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    let at = b.out.len();
    let o = |n: u32| b.offsets[&n];
    let table = format!(
        "xref\n0 4000000000\n0000000000 65535 f\r\n{:010} 00000 n\r\n{:010} 00000 n\r\n\
         {:010} 00000 n\r\n{:010} 00000 n\r\ntrailer\n<</Size 4000000000 /Root 1 0 R>>\n\
         startxref\n{at}\n%%EOF\n",
        o(1),
        o(2),
        o(3),
        o(4)
    );
    b.raw(table.as_bytes());
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(pdf.object_refs().len(), 4);
    // A cross-reference stream claiming billions of entries and objects.
    let mut b = Builder::new("1.5");
    one_page(&mut b);
    let rows = [b.row(1), b.row(2), b.row(3), b.row(4)];
    b.xref_stream(
        5,
        &[(1, 4_000_000_000), (4_000_000_000, 5)],
        &rows,
        "/Size 4000000005 /Root 1 0 R",
        false,
    );
    assert_eq!(b.open().pages().len(), 1);
    // An object stream claiming as much.
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>")
        .obj(2, "<</Type /Pages /Kids [] /Count 0>>");
    b.stream(3, "/Type /ObjStm /N 4000000000 /First 4", b"4 0 (x)");
    let rows = [b.row(1), b.row(2), b.row(3), (2, 3, 0)];
    b.xref_stream(5, &[(1, 4)], &rows, "/Size 6 /Root 1 0 R", false);
    assert_eq!(
        b.open().get(ObjRef::new(4, 0)),
        Some(Object::String(b"x".to_vec()))
    );
}

#[test]
fn extreme_numbers_never_panic() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(u32::MAX, "(last)");
    b.raw(b"999999999999 0 obj (too big) endobj 6 99999 obj (generation too big) endobj");
    let pdf = open(&b.out);
    assert!(pdf.repaired());
    assert_eq!(
        pdf.get(ObjRef::new(u32::MAX, 0)),
        Some(Object::String(b"last".to_vec()))
    );
    assert_eq!(pdf.get(ObjRef::new(6, 0)), None);
    let update = [(ObjRef::new(u32::MAX, 0), Object::Int(1))];
    walk(&write::incremental(&b.out, &update, pdf.trailer()));
    walk(&write::file("1.4", &update, pdf.trailer()));
}

/// A small file with a bit of everything, to damage.
fn specimen() -> Vec<u8> {
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R /Names <</Dests 9 0 R>>>>");
    let (dict, data) = objstm(&[
        (
            2,
            "<</Type /Pages /Kids [3 0 R 5 0 R] /Count 2 /MediaBox [0 0 612 792]>>",
        ),
        (
            3,
            "<</Type /Page /Parent 2 0 R /Contents [4 0 R 6 0 R] /Resources <</Font <</F1 7 0 R>>>>>>",
        ),
        (
            5,
            "<</Type /Page /Parent 2 0 R /Contents 6 0 R /Rotate 90>>",
        ),
        (
            7,
            "<</Type /Font /Subtype /Type1 /BaseFont /Times#20Roman /Widths [250 333 408]>>",
        ),
        (
            9,
            "<</Names [(a) [3 0 R /XYZ 0 792 null] (b) [5 0 R /Fit]]>>",
        ),
    ]);
    b.stream(
        8,
        &format!("{dict} /Filter /FlateDecode"),
        &filter::deflate(&data),
    );
    let content =
        b"q 1 0 0 1 72 720 cm BT /F1 12 Tf (Hello \\(world\\)) Tj [<0041> -20 (B)] TJ ET \
        BI /W 2 /H 2 /BPC 8 /CS /G ID \x00\xffEI EI Q";
    b.stream(4, "/Filter /FlateDecode", &filter::deflate(content));
    let hex: String = b"0 0 m 100 100 l S"
        .iter()
        .map(|c| format!("{c:02X}"))
        .collect();
    b.stream(6, "/Filter [/ASCIIHexDecode]", hex.as_bytes());
    let rows = [
        b.row(1),
        (2, 8, 0),
        (2, 8, 1),
        b.row(4),
        (2, 8, 2),
        b.row(6),
        (2, 8, 3),
        b.row(8),
        (2, 8, 4),
    ];
    b.xref_stream(10, &[(1, 9)], &rows, "/Size 11 /Root 1 0 R", true);
    b.out
}

#[test]
fn specimen_reads() {
    let bytes = specimen();
    let pdf = open(&bytes);
    assert!(!pdf.repaired());
    let pages = pdf.pages();
    assert_eq!(pages.len(), 2);
    assert_eq!(pages[1].dict.i64("Rotate"), Some(90));
    walk(&bytes);
}

/// A tiny deterministic generator.
pub(super) struct Rng(pub u64);

impl Rng {
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

#[test]
fn damaged_bytes_never_panic() {
    let base = specimen();
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    const INTERESTING: &[u8] = b"()<>[]{}/%\\ \n\r0123456789.-+RobjendstreamxrefEI#";
    for _ in 0..400 {
        let mut bytes = base.clone();
        for _ in 0..1 + rng.below(4) {
            let at = rng.below(bytes.len());
            match rng.below(4) {
                0 => bytes[at] = rng.next() as u8,
                1 => bytes[at] = INTERESTING[rng.below(INTERESTING.len())],
                2 => {
                    bytes.remove(at);
                }
                _ => bytes.insert(at, INTERESTING[rng.below(INTERESTING.len())]),
            }
        }
        walk(&bytes);
    }
}

#[test]
fn truncation_never_panics() {
    let base = specimen();
    for cut in (0..base.len()).step_by(7) {
        walk(&base[..cut]);
    }
}
