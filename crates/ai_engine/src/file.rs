//! The file a document was opened from: its objects, its pages, and the
//! resource dictionaries its objects name things in.

use crate::geom::{Affine, Rect};
use crate::pdf::{Dict, ObjRef, Object, Pdf};

/// Space between artboards placed side by side on the canvas.
pub const ARTBOARD_GAP: f64 = 40.0;

/// A page of the opened file.
#[derive(Clone, Debug)]
pub struct PageInfo {
    /// The page object.
    pub obj: ObjRef,
    /// The page dictionary, with inherited attributes filled in.
    pub dict: Dict,
    /// `MediaBox`, in page space.
    pub media_box: Rect,
    /// The artboard: `TrimBox`, else `CropBox`, else `MediaBox` (clipped
    /// to the media box), in page space.
    pub art_box: Rect,
    /// `Rotate`, in quarter turns clockwise.
    pub quarter_turns: u8,
    /// Where the artboard's top-left corner was on the canvas when read.
    pub origin: (f64, f64),
}

impl PageInfo {
    /// Reads a page's boxes.
    pub fn new(pdf: &Pdf, obj: ObjRef, dict: Dict) -> PageInfo {
        let rect = |key: &str| -> Option<Rect> {
            let v = pdf.resolve(dict.get(key)?);
            let n = v.as_numbers()?;
            (n.len() == 4)
                .then(|| Rect::new(n[0], n[1], n[2], n[3]))
                .filter(|r| !r.is_empty() && r.x0.is_finite() && r.y1.is_finite())
        };
        let media_box = rect("MediaBox").unwrap_or(Rect::new(0.0, 0.0, 612.0, 792.0));
        let art_box = rect("TrimBox")
            .or_else(|| rect("CropBox"))
            .map(|r| r.intersect(&media_box))
            .filter(|r| !r.is_empty())
            .unwrap_or(media_box);
        let rotate = dict
            .get("Rotate")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        PageInfo {
            obj,
            dict,
            media_box,
            art_box,
            quarter_turns: (rotate.rem_euclid(360) / 90) as u8,
            origin: (0.0, 0.0),
        }
    }

    /// Page space to canvas as the page was read.
    pub fn read_to_canvas(&self) -> Affine {
        self.to_canvas(self.origin)
    }

    /// The artboard's size as shown (rotation applied).
    pub fn shown_size(&self) -> (f64, f64) {
        let (w, h) = (self.art_box.width(), self.art_box.height());
        if self.quarter_turns % 2 == 1 {
            (h, w)
        } else {
            (w, h)
        }
    }

    /// Page space to canvas, for the artboard's top-left corner at
    /// `origin`.
    pub fn to_canvas(&self, origin: (f64, f64)) -> Affine {
        page_to_canvas(&self.art_box, self.quarter_turns, origin)
    }
}

/// Page space (y up) to canvas (y down) for a page whose `art_box` is
/// shown with its top-left corner at `origin`, turned clockwise by
/// `quarter_turns`.
pub fn page_to_canvas(art_box: &Rect, quarter_turns: u8, origin: (f64, f64)) -> Affine {
    let Rect { x0, y0, x1, y1 } = *art_box;
    let shown = match quarter_turns % 4 {
        0 => Affine([1.0, 0.0, 0.0, -1.0, -x0, y1]),
        1 => Affine([0.0, 1.0, 1.0, 0.0, -y0, -x0]),
        2 => Affine([-1.0, 0.0, 0.0, 1.0, x1, -y0]),
        _ => Affine([0.0, -1.0, -1.0, 0.0, y1, x1]),
    };
    shown.followed_by(&Affine::translate(origin.0, origin.1))
}

/// The file a document came from.
pub struct SourceFile {
    /// Its objects.
    pub pdf: Pdf,
    /// Its pages, in order.
    pub pages: Vec<PageInfo>,
    /// Resource dictionaries nodes' operators name things in
    /// ([`crate::model::Source::resources`]).
    pub resources: Vec<Dict>,
    /// Illustrator's own copy of the artwork was in it (`AIPrivateData`);
    /// saving leaves it out, so Illustrator reads the edited PDF instead.
    pub illustrator: bool,
    /// The application that made it (`Creator` of the info dictionary).
    pub creator: Option<String>,
    /// Fonts loaded while reading, kept for drawing.
    pub fonts: std::sync::Mutex<crate::interp::fonts::FontCache>,
}

impl std::fmt::Debug for SourceFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SourceFile")
            .field("pages", &self.pages.len())
            .field("resources", &self.resources.len())
            .field("illustrator", &self.illustrator)
            .field("creator", &self.creator)
            .finish()
    }
}

impl SourceFile {
    /// A resource dictionary by index.
    pub fn resources(&self, i: u32) -> &Dict {
        static EMPTY: std::sync::OnceLock<Dict> = std::sync::OnceLock::new();
        self.resources
            .get(i as usize)
            .unwrap_or_else(|| EMPTY.get_or_init(Dict::new))
    }
}

/// Whether a page has Illustrator's private data.
pub fn has_private_data(pdf: &Pdf, page: &Dict) -> bool {
    let Some(info) = page.get("PieceInfo").map(|v| pdf.resolve(v)) else {
        return false;
    };
    let Some(ai) = info
        .as_dict()
        .and_then(|d| d.get("Illustrator"))
        .map(|v| pdf.resolve(v))
    else {
        return false;
    };
    ai.as_dict().is_some_and(|d| d.contains("Private"))
}

/// The info dictionary's `Creator`.
pub fn creator(pdf: &Pdf) -> Option<String> {
    let info = pdf.resolve(pdf.trailer().get("Info")?);
    let creator = info.as_dict()?.get("Creator").map(|v| pdf.resolve(v))?;
    match creator {
        Object::String(s) => Some(crate::pdf::decode_text(&s)),
        _ => None,
    }
}
