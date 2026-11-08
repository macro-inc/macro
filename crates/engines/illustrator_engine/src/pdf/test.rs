//! Reading PDF files built here: classic tables, cross-reference streams,
//! object streams, hybrid files, and incremental updates.

mod corpus;
mod damage;
mod pages;

use super::*;
use std::collections::BTreeMap;

/// A PDF assembled byte by byte: objects with their offsets recorded, and
/// whatever cross-reference a test writes.
pub(super) struct Builder {
    pub out: Vec<u8>,
    pub offsets: BTreeMap<u32, usize>,
}

impl Builder {
    pub fn new(version: &str) -> Builder {
        let mut out = format!("%PDF-{version}\n").into_bytes();
        out.extend_from_slice(b"%\xe2\xe3\xcf\xd3\n");
        Builder {
            out,
            offsets: BTreeMap::new(),
        }
    }

    /// Object `num` with `body` as its value.
    pub fn obj(&mut self, num: u32, body: &str) -> &mut Builder {
        self.obj_bytes(num, body.as_bytes())
    }

    pub fn obj_bytes(&mut self, num: u32, body: &[u8]) -> &mut Builder {
        self.offsets.insert(num, self.out.len());
        self.out
            .extend_from_slice(format!("{num} 0 obj\n").as_bytes());
        self.out.extend_from_slice(body);
        self.out.extend_from_slice(b"\nendobj\n");
        self
    }

    /// A stream object: `dict`'s entries (`Length` added) and `data`.
    pub fn stream(&mut self, num: u32, dict: &str, data: &[u8]) -> &mut Builder {
        let mut body = format!("<<{dict} /Length {}>>\nstream\n", data.len()).into_bytes();
        body.extend_from_slice(data);
        body.extend_from_slice(b"\nendstream");
        self.obj_bytes(num, &body)
    }

    pub fn raw(&mut self, bytes: &[u8]) -> &mut Builder {
        self.out.extend_from_slice(bytes);
        self
    }

    /// A classic table of `nums` (0 as the free list head) in subsections
    /// of consecutive numbers, `trailer`'s entries, and `startxref`.
    pub fn table(&mut self, nums: &[u32], trailer: &str) -> usize {
        let at = self.out.len();
        self.out.extend_from_slice(b"xref\n");
        let mut sorted = nums.to_vec();
        sorted.sort_unstable();
        let mut runs: Vec<Vec<u32>> = Vec::new();
        for n in sorted {
            match runs.last_mut() {
                Some(run) if run.last().is_some_and(|&l| l + 1 == n) => run.push(n),
                _ => runs.push(vec![n]),
            }
        }
        for run in runs {
            self.out
                .extend_from_slice(format!("{} {}\n", run[0], run.len()).as_bytes());
            for n in run {
                let line = match n {
                    0 => "0000000000 65535 f\r\n".to_string(),
                    n => format!("{:010} 00000 n\r\n", self.offsets[&n]),
                };
                self.out.extend_from_slice(line.as_bytes());
            }
        }
        self.out.extend_from_slice(
            format!("trailer\n<<{trailer}>>\nstartxref\n{at}\n%%EOF\n").as_bytes(),
        );
        at
    }

    /// A cross-reference stream object `num` (`W [1 4 2]`) with `rows`
    /// (type, field 2, field 3) for the subsections `index`, `extra`
    /// dictionary entries, and `startxref`. With `predictor`, rows are PNG
    /// Up-filtered and deflated.
    pub fn xref_stream(
        &mut self,
        num: u32,
        index: &[(u32, u32)],
        rows: &[(u8, u64, u64)],
        extra: &str,
        predictor: bool,
    ) -> usize {
        let at = self.out.len();
        let mut data = Vec::new();
        let mut prev = [0u8; 7];
        for &(kind, f2, f3) in rows {
            let mut row = [0u8; 7];
            row[0] = kind;
            row[1..5].copy_from_slice(&(f2 as u32).to_be_bytes());
            row[5..7].copy_from_slice(&(f3 as u16).to_be_bytes());
            if predictor {
                data.push(2);
                data.extend(row.iter().zip(prev).map(|(r, p)| r.wrapping_sub(p)));
                prev = row;
            } else {
                data.extend_from_slice(&row);
            }
        }
        let index: String = index.iter().map(|(a, b)| format!("{a} {b} ")).collect();
        let mut dict = format!("/Type /XRef /W [1 4 2] /Index [{index}] {extra}");
        if predictor {
            data = filter::deflate(&data);
            dict.push_str(" /Filter /FlateDecode /DecodeParms <</Predictor 12 /Columns 7>>");
        }
        self.stream(num, &dict, &data);
        self.out
            .extend_from_slice(format!("startxref\n{at}\n%%EOF\n").as_bytes());
        at
    }

    /// A plain object's cross-reference stream row.
    pub fn row(&self, num: u32) -> (u8, u64, u64) {
        (1, self.offsets[&num] as u64, 0)
    }

    pub fn bytes(&self) -> Arc<[u8]> {
        Arc::from(self.out.as_slice())
    }

    pub fn open(&self) -> Pdf {
        Pdf::open(self.bytes()).unwrap()
    }
}

/// Object stream data holding `objects`, and its dictionary's entries.
pub(super) fn objstm(objects: &[(u32, &str)]) -> (String, Vec<u8>) {
    let mut header = String::new();
    let mut body = String::new();
    for (num, src) in objects {
        header.push_str(&format!("{num} {} ", body.len()));
        body.push_str(src);
        body.push('\n');
    }
    let dict = format!("/Type /ObjStm /N {} /First {}", objects.len(), header.len());
    (dict, [header.into_bytes(), body.into_bytes()].concat())
}

/// Catalog 1, page tree 2, page 3, its content 4.
pub(super) fn one_page(b: &mut Builder) {
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>")
        .obj(
            2,
            "<</Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 200 100]>>",
        )
        .obj(3, "<</Type /Page /Parent 2 0 R /Contents 4 0 R>>")
        .stream(4, "", b"0 0 m 10 10 l S");
}

fn get(pdf: &Pdf, num: u32) -> Option<Object> {
    pdf.get(ObjRef::new(num, 0))
}

fn refs(nums: &[u32]) -> Vec<ObjRef> {
    nums.iter().map(|&n| ObjRef::new(n, 0)).collect()
}

#[test]
fn classic_table() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(5, "<</Title (Test) /Producer (\\376\\377\\000A)>>");
    b.table(&[0, 1, 2, 3, 4, 5], "/Size 6 /Root 1 0 R /Info 5 0 R");
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(pdf.version(), "1.4");
    assert_eq!(
        pdf.trailer().get("Root"),
        Some(&Object::Ref(ObjRef::new(1, 0)))
    );
    assert!(pdf.catalog().unwrap().is("Type", "Catalog"));
    assert_eq!(pdf.object_refs(), refs(&[1, 2, 3, 4, 5]));
    let info = get(&pdf, 5).unwrap();
    assert_eq!(
        info.as_dict()
            .unwrap()
            .get("Title")
            .and_then(Object::as_text)
            .as_deref(),
        Some("Test")
    );
    assert_eq!(
        info.as_dict()
            .unwrap()
            .get("Producer")
            .and_then(Object::as_text)
            .as_deref(),
        Some("A")
    );
    let Some(Object::Stream(content)) = get(&pdf, 4) else {
        panic!("not a stream");
    };
    assert_eq!(pdf.stream_data(&content).unwrap(), b"0 0 m 10 10 l S");
    assert_eq!(pdf.pages().len(), 1);
    assert_eq!(get(&pdf, 0), None);
    assert_eq!(get(&pdf, 6), None);
    // The generation is not checked.
    assert!(pdf.get(ObjRef::new(5, 3)).is_some());
    assert_eq!(pdf.bytes(), &b.out[..]);
}

#[test]
fn subsections_free_entries_and_odd_layouts() {
    let mut b = Builder::new("1.3");
    one_page(&mut b);
    b.obj(9, "(nine)");
    // Subsections out of order, a free entry, a deleted object 7 that is
    // still in the file, and an off-by-one first subsection (`1 n`
    // starting with the free head) as some writers make.
    let at = b.out.len();
    let o = |n: u32| b.offsets[&n];
    let table = format!(
        "xref\n1 5\n0000000000 65535 f\r\n{:010} 00000 n\r\n{:010} 00000 n\r\n{:010} 00000 n\r\n\
         {:010} 00000 n\r\n9 1\n{:010} 00000 n \n7 1\n0000000000 00001 f\r\n\
         trailer <</Size 10 /Root 1 0 R>>\nstartxref\n{at}\n%%EOF",
        o(1),
        o(2),
        o(3),
        o(4),
        o(9)
    );
    b.raw(table.as_bytes());
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(pdf.object_refs(), refs(&[1, 2, 3, 4, 9]));
    assert_eq!(get(&pdf, 9), Some(Object::String(b"nine".to_vec())));
    assert_eq!(get(&pdf, 7), None);
    assert_eq!(pdf.pages().len(), 1);
}

#[test]
fn table_quirks_are_not_damage() {
    // A free head with generation 65536, and an object marked in use at
    // offset 0 (deleted without being freed).
    let mut b = Builder::new("1.3");
    one_page(&mut b);
    let at = b.out.len();
    let o = |n: u32| b.offsets[&n];
    let table = format!(
        "xref\n0 6\n0000000000 65536 f \n{:010} 00000 n \n{:010} 00000 n \n{:010} 00000 n \n\
         {:010} 00000 n \n0000000000 00000 n \ntrailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n{at}\n%%EOF\n",
        o(1),
        o(2),
        o(3),
        o(4)
    );
    b.raw(table.as_bytes());
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(pdf.object_refs(), refs(&[1, 2, 3, 4]));
    assert_eq!(get(&pdf, 5), None);
}

#[test]
fn cross_reference_streams() {
    for predictor in [false, true] {
        let mut b = Builder::new("1.5");
        one_page(&mut b);
        // A free entry, then the objects; two subsections.
        let rows = [(0, 0, 65535), b.row(1), b.row(2), b.row(3), b.row(4)];
        b.xref_stream(
            5,
            &[(0, 3), (3, 2)],
            &rows,
            "/Size 6 /Root 1 0 R",
            predictor,
        );
        let pdf = b.open();
        assert!(!pdf.repaired(), "predictor {predictor}");
        assert_eq!(pdf.object_refs(), refs(&[1, 2, 3, 4]));
        assert_eq!(pdf.pages().len(), 1);
        // The cross-reference stream's own keys are not the trailer's.
        assert_eq!(pdf.trailer().get("W"), None);
        assert_eq!(pdf.trailer().get("Type"), None);
        assert_eq!(pdf.trailer().i64("Size"), Some(6));
    }
}

#[test]
fn object_streams() {
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>");
    let (dict, data) = objstm(&[
        (2, "<</Type /Pages /Kids [3 0 R] /Count 1>>"),
        (
            3,
            "<</Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources <</Font <</F1 4 0 R>>>>>>",
        ),
        (4, "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>"),
    ]);
    b.stream(
        10,
        &format!("{dict} /Filter /FlateDecode"),
        &filter::deflate(&data),
    );
    // An object stream that extends the first, holding a number and a string.
    let (dict, data) = objstm(&[(5, "42"), (6, "(six)")]);
    b.stream(11, &format!("{dict} /Extends 10 0 R"), &data);
    let rows = [
        b.row(1),
        (2, 10, 0),
        (2, 10, 1),
        (2, 10, 2),
        (2, 11, 0),
        // Index 0 is object 5: the entry's index is wrong, the number right.
        (2, 11, 0),
        b.row(10),
        b.row(11),
    ];
    b.xref_stream(12, &[(1, 6), (10, 2)], &rows, "/Size 13 /Root 1 0 R", true);
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(pdf.object_refs(), refs(&[1, 2, 3, 4, 5, 6, 10, 11]));
    assert_eq!(get(&pdf, 5), Some(Object::Int(42)));
    assert_eq!(get(&pdf, 6), Some(Object::String(b"six".to_vec())));
    let pages = pdf.pages();
    assert_eq!(pages.len(), 1);
    assert_eq!(pages[0].obj, ObjRef::new(3, 0));
    let font = pdf.resolve(&Object::Ref(ObjRef::new(4, 0)));
    assert!(font.as_dict().unwrap().is("BaseFont", "Helvetica"));
}

#[test]
fn hybrid_files() {
    // A classic table for the plain objects; a cross-reference stream
    // (`XRefStm`) for the ones in an object stream, which the table lists
    // as free.
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>");
    b.obj(2, "<</Type /Pages /Kids [3 0 R] /Count 1>>");
    let (dict, data) = objstm(&[(3, "<</Type /Page /Parent 2 0 R>>"), (4, "(compressed)")]);
    b.stream(5, &dict, &data);
    let stm_at = b.out.len();
    let rows = [(2, 5, 0), (2, 5, 1)];
    let index = "3 2";
    let mut body = Vec::new();
    for (kind, f2, f3) in rows {
        body.push(kind);
        body.extend_from_slice(&(f2 as u32).to_be_bytes());
        body.extend_from_slice(&(f3 as u16).to_be_bytes());
    }
    b.stream(
        6,
        &format!("/Type /XRef /W [1 4 2] /Index [{index}] /Size 7"),
        &body,
    );
    let o = |n: u32| b.offsets[&n];
    let at = b.out.len();
    let table = format!(
        "xref\n0 7\n0000000000 65535 f\r\n{:010} 00000 n\r\n{:010} 00000 n\r\n\
         0000000000 00000 f\r\n0000000000 00000 f\r\n{:010} 00000 n\r\n{:010} 00000 n\r\n\
         trailer\n<</Size 7 /Root 1 0 R /XRefStm {stm_at}>>\nstartxref\n{at}\n%%EOF\n",
        o(1),
        o(2),
        o(5),
        o(6)
    );
    b.raw(table.as_bytes());
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(get(&pdf, 4), Some(Object::String(b"compressed".to_vec())));
    assert_eq!(pdf.pages().len(), 1);
    assert_eq!(pdf.trailer().get("XRefStm"), None);
}

#[test]
fn incremental_updates() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(5, "<</Title (Old)>>").obj(6, "(to delete)");
    let first = b.table(
        &[0, 1, 2, 3, 4, 5, 6],
        "/Size 7 /Root 1 0 R /Info 5 0 R /ID [<01> <02>]",
    );
    // The update replaces the content and the info, deletes object 6, and
    // adds object 7; its trailer lacks `Info` and `ID`.
    b.stream(4, "", b"1 1 m 2 2 l S");
    b.obj(5, "<</Title (New)>>").obj(7, "(added)");
    let at = b.out.len();
    let o = |n: u32| b.offsets[&n];
    let update = format!(
        "xref\n4 4\n{:010} 00000 n\r\n{:010} 00000 n\r\n0000000000 00001 f\r\n\
         {:010} 00000 n\r\ntrailer\n<</Size 8 /Root 1 0 R /Prev {first}>>\nstartxref\n{at}\n%%EOF\n",
        o(4),
        o(5),
        o(7)
    );
    b.raw(update.as_bytes());
    let pdf = b.open();
    assert!(!pdf.repaired());
    let Some(Object::Stream(content)) = get(&pdf, 4) else {
        panic!("not a stream");
    };
    assert_eq!(pdf.stream_data(&content).unwrap(), b"1 1 m 2 2 l S");
    let info = get(&pdf, 5).unwrap();
    assert_eq!(
        info.as_dict()
            .unwrap()
            .get("Title")
            .and_then(Object::as_text)
            .as_deref(),
        Some("New")
    );
    assert_eq!(get(&pdf, 6), None);
    assert_eq!(get(&pdf, 7), Some(Object::String(b"added".to_vec())));
    assert_eq!(pdf.object_refs(), refs(&[1, 2, 3, 4, 5, 7]));
    // The newest trailer's entries, with older ones filling in.
    assert_eq!(pdf.trailer().i64("Size"), Some(8));
    assert!(pdf.trailer().contains("Info") && pdf.trailer().contains("ID"));
    assert_eq!(pdf.trailer().get("Prev"), None);
}

#[test]
fn updates_over_cross_reference_streams() {
    // A cross-reference stream file updated twice: an object in an object
    // stream superseded by plain objects.
    let mut b = Builder::new("1.5");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R>>");
    let (dict, data) = objstm(&[
        (2, "<</Type /Pages /Kids [3 0 R] /Count 1>>"),
        (3, "<</Type /Page>>"),
        (4, "1"),
    ]);
    b.stream(5, &dict, &data);
    let rows = [b.row(1), (2, 5, 0), (2, 5, 1), (2, 5, 2), b.row(5)];
    let first = b.xref_stream(6, &[(1, 5)], &rows, "/Size 7 /Root 1 0 R", false);
    b.obj(4, "2");
    let second = b.xref_stream(
        7,
        &[(4, 1)],
        &[b.row(4)],
        &format!("/Size 8 /Root 1 0 R /Prev {first}"),
        true,
    );
    b.obj(4, "3");
    let row = b.row(4);
    b.xref_stream(
        8,
        &[(4, 1)],
        &[row],
        &format!("/Size 9 /Root 1 0 R /Prev {second}"),
        false,
    );
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(get(&pdf, 4), Some(Object::Int(3)));
    assert_eq!(
        get(&pdf, 3),
        Some(Object::Dict(Dict(vec![(
            Name::new("Type"),
            Object::name("Page")
        )])))
    );
    assert_eq!(pdf.pages().len(), 1);
}

#[test]
fn prev_loops_end() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    let at = b.out.len();
    b.table(&[0, 1, 2, 3, 4], &format!("/Size 5 /Root 1 0 R /Prev {at}"));
    let pdf = b.open();
    assert!(!pdf.repaired());
    assert_eq!(pdf.pages().len(), 1);
}

#[test]
fn encrypted_files_are_refused() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(5, "<</Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4>>");
    b.table(&[0, 1, 2, 3, 4, 5], "/Size 6 /Root 1 0 R /Encrypt 5 0 R");
    assert!(matches!(Pdf::open(b.bytes()), Err(AiError::Encrypted)));
}

#[test]
fn not_pdf() {
    let ps = b"%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator(R) 8.0\n%%EndComments\n";
    assert!(matches!(Pdf::open(Arc::from(&ps[..])), Err(AiError::NotAi)));
    assert!(matches!(
        Pdf::open(Arc::from(&b""[..])),
        Err(AiError::NotAi)
    ));
    assert!(matches!(
        Pdf::open(Arc::from(&b"%PDF-1.4\n"[..])),
        Err(AiError::Corrupt(_))
    ));
}

#[test]
fn versions() {
    let mut b = Builder::new("1.4");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R /Version /1.7>>")
        .obj(2, "<</Type /Pages /Kids [] /Count 0>>");
    b.table(&[0, 1, 2], "/Size 3 /Root 1 0 R");
    assert_eq!(b.open().version(), "1.7");
    let mut b = Builder::new("1.6");
    b.obj(1, "<</Type /Catalog /Pages 2 0 R /Version /1.3>>")
        .obj(2, "<</Type /Pages /Kids [] /Count 0>>");
    b.table(&[0, 1, 2], "/Size 3 /Root 1 0 R");
    assert_eq!(b.open().version(), "1.6");
}

#[test]
fn resolve_follows_chains_and_stops_at_cycles() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.obj(5, "6 0 R").obj(6, "7 0 R").obj(7, "[1 2]");
    b.obj(8, "9 0 R").obj(9, "8 0 R");
    // A stream whose length is itself.
    b.obj(10, "<</Length 10 0 R>>\nstream\nabc\nendstream");
    b.table(&[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "/Size 11 /Root 1 0 R");
    let pdf = b.open();
    let r = |n| Object::Ref(ObjRef::new(n, 0));
    assert_eq!(
        pdf.resolve(&r(5)),
        Object::Array(vec![Object::Int(1), Object::Int(2)])
    );
    assert_eq!(pdf.resolve(&r(8)), Object::Null);
    assert_eq!(pdf.resolve(&r(99)), Object::Null);
    assert_eq!(pdf.resolve(&Object::Int(3)), Object::Int(3));
    let Some(Object::Stream(s)) = get(&pdf, 10) else {
        panic!("not a stream");
    };
    assert_eq!(&s.data[..], b"abc");
}

#[test]
fn streams_decode_through_references() {
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    let packed = filter::deflate(b"hello hello hello");
    let hex: String = packed.iter().map(|b| format!("{b:02x}")).collect();
    b.obj(5, "[/ASCIIHexDecode 6 0 R]").obj(6, "/FlateDecode");
    b.stream(7, "/Filter 5 0 R /Length1 3", hex.as_bytes());
    b.stream(8, "/Subtype /Image /Filter [/FlateDecode /DCTDecode] /DecodeParms [null <</ColorTransform 1>>]", &filter::deflate(b"\xff\xd8jpeg"));
    b.stream(9, "/Filter /NoSuchDecode", b"x");
    b.table(&[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "/Size 10 /Root 1 0 R");
    let pdf = b.open();
    let stream = |n| match get(&pdf, n) {
        Some(Object::Stream(s)) => s,
        o => panic!("{o:?}"),
    };
    assert_eq!(pdf.stream_data(&stream(7)).unwrap(), b"hello hello hello");
    let (data, codec) = pdf.decode_stream(&stream(8)).unwrap();
    assert_eq!(data, b"\xff\xd8jpeg");
    assert!(
        matches!(codec, Some(filter::ImageCodec::Dct(p)) if p.i64("ColorTransform") == Some(1))
    );
    assert!(pdf.stream_data(&stream(8)).is_err());
    assert!(pdf.decode_stream(&stream(9)).is_err());
    // Through the `Resolve` trait too.
    let r: &dyn Resolve = &pdf;
    assert_eq!(r.stream_data(&stream(7)).unwrap(), b"hello hello hello");
}

#[test]
fn pdf_is_send_and_sync() {
    fn check<T: Send + Sync>() {}
    check::<Pdf>();
    let mut b = Builder::new("1.4");
    one_page(&mut b);
    b.table(&[0, 1, 2, 3, 4], "/Size 5 /Root 1 0 R");
    let pdf = Arc::new(b.open());
    let threads: Vec<_> = (0..4)
        .map(|_| {
            let pdf = pdf.clone();
            std::thread::spawn(move || pdf.pages().len())
        })
        .collect();
    for t in threads {
        assert_eq!(t.join().unwrap(), 1);
    }
}
