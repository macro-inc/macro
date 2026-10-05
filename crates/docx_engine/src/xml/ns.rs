//! Namespace identifiers for the vocabularies a Word document uses.
//!
//! ISO 29500 "strict" URIs resolve to the same identifiers as their
//! transitional counterparts.

/// An interned namespace URI. Values below [`Ns::FIRST_DYNAMIC`] are the
/// well-known namespaces listed here; others are document-specific.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Ns(pub u16);

impl Ns {
    /// No namespace.
    pub const NONE: Ns = Ns(0);
    /// WordprocessingML main (`w:`).
    pub const W: Ns = Ns(1);
    /// Office document relationships (`r:`).
    pub const R: Ns = Ns(2);
    /// WordprocessingML drawing (`wp:`).
    pub const WP: Ns = Ns(3);
    /// DrawingML main (`a:`).
    pub const A: Ns = Ns(4);
    /// DrawingML picture (`pic:`).
    pub const PIC: Ns = Ns(5);
    /// Markup compatibility (`mc:`).
    pub const MC: Ns = Ns(6);
    /// Word 2010 extensions (`w14:`).
    pub const W14: Ns = Ns(7);
    /// Word 2012 extensions (`w15:`).
    pub const W15: Ns = Ns(8);
    /// Word processing shapes (`wps:`).
    pub const WPS: Ns = Ns(9);
    /// Word processing groups (`wpg:`).
    pub const WPG: Ns = Ns(10);
    /// Word processing canvas (`wpc:`).
    pub const WPC: Ns = Ns(11);
    /// VML (`v:`).
    pub const V: Ns = Ns(12);
    /// Office VML extensions (`o:`).
    pub const O: Ns = Ns(13);
    /// Word VML extensions (`w10:`).
    pub const W10: Ns = Ns(14);
    /// Office Math (`m:`).
    pub const M: Ns = Ns(15);
    /// DrawingML chart (`c:`).
    pub const C: Ns = Ns(16);
    /// The reserved `xml:` namespace.
    pub const XML: Ns = Ns(17);
    /// Word 2010 drawing extensions (`wp14:`).
    pub const WP14: Ns = Ns(18);
    /// Package relationships.
    pub const PKG_REL: Ns = Ns(19);
    /// Package content types.
    pub const CONTENT_TYPES: Ns = Ns(20);
    /// DrawingML diagram data (`dgm:`).
    pub const DGM: Ns = Ns(21);
    /// Word 2006 extensions (`wne:`).
    pub const WNE: Ns = Ns(22);
    /// DrawingML 2010 extensions (`a14:`).
    pub const A14: Ns = Ns(23);
    /// First identifier assigned to namespaces not listed here.
    pub const FIRST_DYNAMIC: u16 = 64;
}

/// Well-known namespace URIs and their identifiers.
const KNOWN: &[(&str, Ns)] = &[
    (
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
        Ns::W,
    ),
    ("http://purl.oclc.org/ooxml/wordprocessingml/main", Ns::W),
    (
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        Ns::R,
    ),
    (
        "http://purl.oclc.org/ooxml/officeDocument/relationships",
        Ns::R,
    ),
    (
        "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
        Ns::WP,
    ),
    (
        "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing",
        Ns::WP,
    ),
    (
        "http://schemas.openxmlformats.org/drawingml/2006/main",
        Ns::A,
    ),
    ("http://purl.oclc.org/ooxml/drawingml/main", Ns::A),
    (
        "http://schemas.openxmlformats.org/drawingml/2006/picture",
        Ns::PIC,
    ),
    ("http://purl.oclc.org/ooxml/drawingml/picture", Ns::PIC),
    (
        "http://schemas.openxmlformats.org/markup-compatibility/2006",
        Ns::MC,
    ),
    (
        "http://schemas.microsoft.com/office/word/2010/wordml",
        Ns::W14,
    ),
    (
        "http://schemas.microsoft.com/office/word/2012/wordml",
        Ns::W15,
    ),
    (
        "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
        Ns::WPS,
    ),
    (
        "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
        Ns::WPG,
    ),
    (
        "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
        Ns::WPC,
    ),
    ("urn:schemas-microsoft-com:vml", Ns::V),
    ("urn:schemas-microsoft-com:office:office", Ns::O),
    ("urn:schemas-microsoft-com:office:word", Ns::W10),
    (
        "http://schemas.openxmlformats.org/officeDocument/2006/math",
        Ns::M,
    ),
    ("http://purl.oclc.org/ooxml/officeDocument/math", Ns::M),
    (
        "http://schemas.openxmlformats.org/drawingml/2006/chart",
        Ns::C,
    ),
    ("http://purl.oclc.org/ooxml/drawingml/chart", Ns::C),
    ("http://www.w3.org/XML/1998/namespace", Ns::XML),
    (
        "http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing",
        Ns::WP14,
    ),
    (
        "http://schemas.openxmlformats.org/package/2006/relationships",
        Ns::PKG_REL,
    ),
    (
        "http://schemas.openxmlformats.org/package/2006/content-types",
        Ns::CONTENT_TYPES,
    ),
    (
        "http://schemas.openxmlformats.org/drawingml/2006/diagram",
        Ns::DGM,
    ),
    (
        "http://schemas.microsoft.com/office/word/2006/wordml",
        Ns::WNE,
    ),
    (
        "http://schemas.microsoft.com/office/drawing/2010/main",
        Ns::A14,
    ),
];

/// The identifier of a well-known namespace URI.
pub(super) fn known(uri: &str) -> Option<Ns> {
    KNOWN.iter().find(|(u, _)| *u == uri).map(|(_, ns)| *ns)
}

/// The canonical URI of a well-known namespace.
pub(super) fn uri_of(ns: Ns) -> Option<&'static str> {
    KNOWN.iter().find(|(_, n)| *n == ns).map(|(u, _)| *u)
}
