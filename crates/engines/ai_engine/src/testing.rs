//! Files built in code for tests: PDFs with pages, resources, optional
//! content (layers), and forms.

use crate::pdf::{Dict, ObjRef, Object, Stream};

/// Builds a PDF.
pub struct PdfBuilder {
    objects: Vec<(ObjRef, Object)>,
    pages: Vec<ObjRef>,
    catalog: Dict,
    next: u32,
}

impl Default for PdfBuilder {
    fn default() -> Self {
        PdfBuilder::new()
    }
}

/// A name object.
pub fn name(s: &str) -> Object {
    Object::name(s)
}

/// A number array.
pub fn nums(v: &[f64]) -> Object {
    Object::Array(v.iter().map(|&x| Object::number(x)).collect())
}

/// A dictionary from pairs.
pub fn dict(pairs: Vec<(&str, Object)>) -> Dict {
    let mut d = Dict::new();
    for (k, v) in pairs {
        d.set(k, v);
    }
    d
}

impl PdfBuilder {
    /// An empty file (objects 1 and 2 are the catalog and page tree).
    pub fn new() -> PdfBuilder {
        PdfBuilder {
            objects: Vec::new(),
            pages: Vec::new(),
            catalog: Dict::new(),
            next: 3,
        }
    }

    /// Adds an object.
    pub fn add(&mut self, o: Object) -> ObjRef {
        let r = ObjRef {
            num: self.next,
            generation: 0,
        };
        self.next += 1;
        self.objects.push((r, o));
        r
    }

    /// Adds a stream with its content.
    pub fn stream(&mut self, d: Dict, data: &str) -> ObjRef {
        self.add(Object::Stream(Stream::new(d, data.as_bytes().to_vec())))
    }

    /// Adds an optional content group (a layer) named `name`.
    pub fn ocg(&mut self, layer: &str) -> ObjRef {
        self.add(Object::Dict(dict(vec![
            ("Type", name("OCG")),
            ("Name", Object::String(layer.as_bytes().to_vec())),
        ])))
    }

    /// Sets the optional content configuration: groups in panel order (top
    /// first), and those off.
    pub fn layers(&mut self, order: &[ObjRef], off: &[ObjRef]) {
        let refs = |v: &[ObjRef]| Object::Array(v.iter().map(|&r| Object::Ref(r)).collect());
        let config = dict(vec![("Order", refs(order)), ("OFF", refs(off))]);
        self.catalog.set(
            "OCProperties",
            Object::Dict(dict(vec![
                ("OCGs", refs(order)),
                ("D", Object::Dict(config)),
            ])),
        );
    }

    /// Adds a page of `w × h` points drawing `content` with `resources`.
    pub fn page(&mut self, w: f64, h: f64, content: &str, resources: Dict) -> ObjRef {
        let contents = self.stream(Dict::new(), content);
        let page = dict(vec![
            ("Type", name("Page")),
            (
                "Parent",
                Object::Ref(ObjRef {
                    num: 2,
                    generation: 0,
                }),
            ),
            ("MediaBox", nums(&[0.0, 0.0, w, h])),
            ("Resources", Object::Dict(resources)),
            ("Contents", Object::Ref(contents)),
        ]);
        let r = self.add(Object::Dict(page));
        self.pages.push(r);
        r
    }

    /// The file's bytes.
    pub fn finish(mut self) -> Vec<u8> {
        let kids = Object::Array(self.pages.iter().map(|&r| Object::Ref(r)).collect());
        let count = self.pages.len() as i64;
        self.objects.push((
            ObjRef {
                num: 2,
                generation: 0,
            },
            Object::Dict(dict(vec![
                ("Type", name("Pages")),
                ("Kids", kids),
                ("Count", Object::Int(count)),
            ])),
        ));
        let mut catalog = std::mem::take(&mut self.catalog);
        catalog.set("Type", name("Catalog"));
        catalog.set(
            "Pages",
            Object::Ref(ObjRef {
                num: 2,
                generation: 0,
            }),
        );
        self.objects.push((
            ObjRef {
                num: 1,
                generation: 0,
            },
            Object::Dict(catalog),
        ));
        let trailer = dict(vec![(
            "Root",
            Object::Ref(ObjRef {
                num: 1,
                generation: 0,
            }),
        )]);
        crate::pdf::write::file("1.7", &self.objects, &trailer)
    }
}

/// A Helvetica font dictionary (not embedded: drawn with a stand-in).
pub fn helvetica() -> Object {
    Object::Dict(dict(vec![
        ("Type", name("Font")),
        ("Subtype", name("Type1")),
        ("BaseFont", name("Helvetica")),
        ("Encoding", name("WinAnsiEncoding")),
    ]))
}

/// Straight RGBA of a document drawn at 1 pixel per point over its first
/// artboard.
pub fn draw(doc: &crate::model::Document) -> (u32, u32, Vec<u8>) {
    let a = &doc.artboards[0];
    let (w, h) = (a.rect.width() as u32, a.rect.height() as u32);
    let view = crate::render::View {
        x: a.rect.x0,
        y: a.rect.y0,
        scale: 1.0,
        width: w,
        height: h,
    };
    let rgba = crate::render::Renderer::new().render(
        doc,
        &view,
        &crate::render::Options {
            artboards: true,
            outline: false,
        },
    );
    (w, h, rgba)
}

/// The color of a pixel.
pub fn pixel(img: &(u32, u32, Vec<u8>), x: u32, y: u32) -> [u8; 4] {
    let i = ((y * img.0 + x) * 4) as usize;
    [img.2[i], img.2[i + 1], img.2[i + 2], img.2[i + 3]]
}
