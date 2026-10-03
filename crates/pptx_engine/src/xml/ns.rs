//! Namespace identifiers for the vocabularies the engine understands.
//!
//! Every element and attribute is resolved to a [`Ns`] at parse time, so code
//! never depends on the prefixes a particular producer chose. ISO 29500
//! "strict" namespace URIs resolve to the same identifiers as their
//! transitional counterparts.

/// An interned namespace URI. Values below [`Ns::FIRST_DYNAMIC`] are the
/// well-known namespaces listed here; others are document-specific.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Ns(pub u16);

impl Ns {
    /// No namespace (unprefixed attributes, or elements without a default namespace).
    pub const NONE: Ns = Ns(0);
    /// PresentationML main (`p:`).
    pub const P: Ns = Ns(1);
    /// DrawingML main (`a:`).
    pub const A: Ns = Ns(2);
    /// Office document relationships (`r:`).
    pub const R: Ns = Ns(3);
    /// Markup compatibility (`mc:`).
    pub const MC: Ns = Ns(4);
    /// DrawingML picture (`pic:`).
    pub const PIC: Ns = Ns(5);
    /// DrawingML chart (`c:`).
    pub const C: Ns = Ns(6);
    /// DrawingML diagram data (`dgm:`).
    pub const DGM: Ns = Ns(7);
    /// Diagram drawing (`dsp:`), the pre-laid-out SmartArt shapes.
    pub const DSP: Ns = Ns(8);
    /// Package relationships.
    pub const PKG_REL: Ns = Ns(9);
    /// Package content types.
    pub const CONTENT_TYPES: Ns = Ns(10);
    /// The reserved `xml:` namespace.
    pub const XML: Ns = Ns(11);
    /// VML (`v:`).
    pub const V: Ns = Ns(12);
    /// Office VML extensions (`o:`).
    pub const O: Ns = Ns(13);
    /// PowerPoint 2010 extensions (`p14:`).
    pub const P14: Ns = Ns(14);
    /// DrawingML 2010 extensions (`a14:`).
    pub const A14: Ns = Ns(15);
    /// PowerPoint 2013 extensions (`p15:`).
    pub const P15: Ns = Ns(16);
    /// Office 2016 SVG blip extension (`asvg:`).
    pub const ASVG: Ns = Ns(17);
    /// DrawingML 2016 extensions (`a16:`).
    pub const A16: Ns = Ns(18);
    /// Chart drawing (`cdr:`), user shapes over charts.
    pub const CDR: Ns = Ns(19);
    /// Core properties (`cp:`).
    pub const CP: Ns = Ns(20);
    /// Dublin Core elements (`dc:`).
    pub const DC: Ns = Ns(21);
    /// Extended (app) properties.
    pub const EXT_PROPS: Ns = Ns(22);
    /// Office 2010 chart extensions (`c14:`).
    pub const C14: Ns = Ns(23);
    /// Word processing shapes in drawings (`wps:`), seen in some exports.
    pub const WPS: Ns = Ns(24);
    /// First identifier assigned to namespaces not listed here.
    pub const FIRST_DYNAMIC: u16 = 64;
}

/// Well-known namespace URIs, their canonical identifier, and the prefix the
/// engine uses when it must declare the namespace itself.
pub(crate) const KNOWN: &[(&str, Ns, &str)] = &[
    ("http://schemas.openxmlformats.org/presentationml/2006/main", Ns::P, "p"),
    ("http://purl.oclc.org/ooxml/presentationml/main", Ns::P, "p"),
    ("http://schemas.openxmlformats.org/drawingml/2006/main", Ns::A, "a"),
    ("http://purl.oclc.org/ooxml/drawingml/main", Ns::A, "a"),
    ("http://schemas.openxmlformats.org/officeDocument/2006/relationships", Ns::R, "r"),
    ("http://purl.oclc.org/ooxml/officeDocument/relationships", Ns::R, "r"),
    ("http://schemas.openxmlformats.org/markup-compatibility/2006", Ns::MC, "mc"),
    ("http://schemas.openxmlformats.org/drawingml/2006/picture", Ns::PIC, "pic"),
    ("http://purl.oclc.org/ooxml/drawingml/picture", Ns::PIC, "pic"),
    ("http://schemas.openxmlformats.org/drawingml/2006/chart", Ns::C, "c"),
    ("http://purl.oclc.org/ooxml/drawingml/chart", Ns::C, "c"),
    ("http://schemas.openxmlformats.org/drawingml/2006/diagram", Ns::DGM, "dgm"),
    ("http://purl.oclc.org/ooxml/drawingml/diagram", Ns::DGM, "dgm"),
    ("http://schemas.microsoft.com/office/drawing/2008/diagram", Ns::DSP, "dsp"),
    ("http://schemas.openxmlformats.org/package/2006/relationships", Ns::PKG_REL, ""),
    ("http://schemas.openxmlformats.org/package/2006/content-types", Ns::CONTENT_TYPES, ""),
    ("http://www.w3.org/XML/1998/namespace", Ns::XML, "xml"),
    ("urn:schemas-microsoft-com:vml", Ns::V, "v"),
    ("urn:schemas-microsoft-com:office:office", Ns::O, "o"),
    ("http://schemas.microsoft.com/office/powerpoint/2010/main", Ns::P14, "p14"),
    ("http://schemas.microsoft.com/office/drawing/2010/main", Ns::A14, "a14"),
    ("http://schemas.microsoft.com/office/powerpoint/2012/main", Ns::P15, "p15"),
    ("http://schemas.microsoft.com/office/drawing/2016/SVG/main", Ns::ASVG, "asvg"),
    ("http://schemas.microsoft.com/office/drawing/2014/main", Ns::A16, "a16"),
    ("http://schemas.openxmlformats.org/drawingml/2006/chartDrawing", Ns::CDR, "cdr"),
    ("http://schemas.openxmlformats.org/package/2006/metadata/core-properties", Ns::CP, "cp"),
    ("http://purl.org/dc/elements/1.1/", Ns::DC, "dc"),
    ("http://schemas.openxmlformats.org/officeDocument/2006/extended-properties", Ns::EXT_PROPS, ""),
    ("http://schemas.microsoft.com/office/drawing/2007/8/2/chart", Ns::C14, "c14"),
    ("http://schemas.microsoft.com/office/word/2010/wordprocessingShape", Ns::WPS, "wps"),
];

/// The canonical URI and preferred prefix for a well-known namespace.
pub(crate) fn canonical(ns: Ns) -> Option<(&'static str, &'static str)> {
    KNOWN.iter().find(|(_, id, _)| *id == ns).map(|(uri, _, prefix)| (*uri, *prefix))
}
