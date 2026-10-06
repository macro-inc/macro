//! Font dictionaries read into [`FontSpec`]s, and the fonts loaded from
//! them, kept per document.

use crate::font::{
    CMapSpec, CidSpec, CidToGid, EncodingSpec, Font, FontSpec, FontSubtype, Program, ProgramKind,
};
use crate::pdf::{Dict, Object, Resolve};
use std::collections::HashMap;
use std::sync::Arc;

/// Fonts loaded from a document, by key (`obj:<number>` for indirect font
/// dictionaries).
#[derive(Default)]
pub struct FontCache {
    fonts: HashMap<String, Arc<LoadedFont>>,
}

/// A loaded font with what the interpreter needs beside it.
pub struct LoadedFont {
    /// Its key.
    pub key: String,
    /// The font.
    pub font: Font,
    /// Type 3: glyph procedures by name, the font matrix, and resources.
    pub type3: Option<Type3>,
}

/// A Type 3 font's glyph procedures.
pub struct Type3 {
    /// Glyph space to text space.
    pub matrix: [f64; 6],
    /// Glyph name to content stream.
    pub procs: HashMap<String, Vec<u8>>,
    /// The resources its glyphs use.
    pub resources: Dict,
}

impl FontCache {
    /// The font a resource value names (loaded once per key).
    pub fn load(&mut self, pdf: &dyn Resolve, value: &Object) -> Option<Arc<LoadedFont>> {
        let key = match value {
            Object::Ref(r) => format!("obj:{}", r.num),
            _ => format!("direct:{:p}", value),
        };
        if let Some(f) = self.fonts.get(&key) {
            return Some(f.clone());
        }
        let dict = pdf.resolve(value);
        let dict = dict.as_dict()?;
        let spec = spec_from_dict(pdf, dict);
        let type3 = (spec.subtype == FontSubtype::Type3).then(|| type3(pdf, dict));
        let loaded = Arc::new(LoadedFont {
            key: key.clone(),
            font: Font::load(spec),
            type3,
        });
        self.fonts.insert(key, loaded.clone());
        Some(loaded)
    }

    /// A loaded font by key.
    pub fn get(&self, key: &str) -> Option<Arc<LoadedFont>> {
        self.fonts.get(key).cloned()
    }
}

fn numbers(pdf: &dyn Resolve, value: Option<&Object>) -> Vec<f32> {
    value
        .map(|v| pdf.resolve(v))
        .and_then(|v| {
            v.as_array().map(|a| {
                a.iter()
                    .map(|x| pdf.resolve(x).as_f64().unwrap_or(0.0) as f32)
                    .collect()
            })
        })
        .unwrap_or_default()
}

fn name_of(pdf: &dyn Resolve, value: Option<&Object>) -> Option<String> {
    value
        .map(|v| pdf.resolve(v))
        .and_then(|v| v.as_name().map(|n| n.as_str().into_owned()))
}

fn stream_bytes(pdf: &dyn Resolve, value: Option<&Object>) -> Option<Vec<u8>> {
    let v = pdf.resolve(value?);
    let s = v.as_stream()?;
    pdf.stream_data(s).ok()
}

fn encoding(pdf: &dyn Resolve, value: Option<&Object>) -> Option<EncodingSpec> {
    let v = pdf.resolve(value?);
    if let Some(n) = v.as_name() {
        return Some(EncodingSpec {
            base: Some(n.as_str().into_owned()),
            differences: Vec::new(),
        });
    }
    let d = v.as_dict()?;
    let mut differences = Vec::new();
    if let Some(list) = d.get("Differences").map(|x| pdf.resolve(x)) {
        let mut code = 0u32;
        for item in list.as_array().unwrap_or_default() {
            match pdf.resolve(item) {
                Object::Int(i) => code = i.max(0) as u32,
                Object::Real(r) => code = r.max(0.0) as u32,
                Object::Name(n) => {
                    differences.push((code, n.as_str().into_owned()));
                    code += 1;
                }
                _ => {}
            }
        }
    }
    Some(EncodingSpec {
        base: name_of(pdf, d.get("BaseEncoding")),
        differences,
    })
}

fn program(pdf: &dyn Resolve, descriptor: &Dict) -> Option<Program> {
    let (key, default_kind) = [
        ("FontFile", ProgramKind::Type1),
        ("FontFile2", ProgramKind::TrueType),
        ("FontFile3", ProgramKind::Type1C),
    ]
    .into_iter()
    .find(|(k, _)| descriptor.contains(k))?;
    let v = pdf.resolve(descriptor.get(key)?);
    let s = v.as_stream()?;
    let data = pdf.stream_data(s).ok()?;
    let kind = match (
        key,
        s.dict
            .name("Subtype")
            .map(|n| n.as_str().into_owned())
            .as_deref(),
    ) {
        ("FontFile3", Some("CIDFontType0C")) => ProgramKind::CidType0C,
        ("FontFile3", Some("OpenType")) => ProgramKind::OpenType,
        _ => default_kind,
    };
    let len = |k: &str| {
        s.dict
            .get(k)
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_i64())
            .and_then(|n| usize::try_from(n).ok())
    };
    Some(Program {
        kind,
        data: data.into(),
        length1: len("Length1"),
        length2: len("Length2"),
    })
}

fn descriptor_fields(pdf: &dyn Resolve, spec: &mut FontSpec, descriptor: Option<Dict>) {
    let Some(d) = descriptor else { return };
    let num = |k: &str| d.get(k).map(|v| pdf.resolve(v)).and_then(|v| v.as_f64());
    spec.flags = num("Flags").unwrap_or(0.0) as u32;
    spec.italic_angle = num("ItalicAngle").unwrap_or(0.0) as f32;
    spec.weight = num("FontWeight").or_else(|| num("StemV")).map(|v| v as f32);
    spec.missing_width = num("MissingWidth").unwrap_or(0.0) as f32;
    spec.program = program(pdf, &d);
}

fn dict_of(pdf: &dyn Resolve, value: Option<&Object>) -> Option<Dict> {
    pdf.resolve(value?).as_dict().cloned()
}

/// What a font dictionary says.
pub fn spec_from_dict(pdf: &dyn Resolve, dict: &Dict) -> FontSpec {
    let subtype = match name_of(pdf, dict.get("Subtype")).as_deref() {
        Some("TrueType") => FontSubtype::TrueType,
        Some("Type3") => FontSubtype::Type3,
        Some("Type0") => FontSubtype::Type0,
        Some("MMType1") => FontSubtype::MmType1,
        _ => FontSubtype::Type1,
    };
    let mut spec = FontSpec {
        subtype,
        base_font: name_of(pdf, dict.get("BaseFont")).unwrap_or_default(),
        ..FontSpec::default()
    };
    spec.to_unicode = stream_bytes(pdf, dict.get("ToUnicode"));
    if subtype == FontSubtype::Type0 {
        spec.cmap = match dict.get("Encoding").map(|v| pdf.resolve(v)) {
            Some(Object::Name(n)) => Some(CMapSpec::Named(n.as_str().into_owned())),
            Some(Object::Stream(s)) => pdf.stream_data(&s).ok().map(CMapSpec::Embedded),
            _ => Some(CMapSpec::Named("Identity-H".into())),
        };
        let descendant = dict
            .get("DescendantFonts")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
            .and_then(|v| pdf.resolve(&v).as_dict().cloned());
        if let Some(cid) = descendant {
            let cff = name_of(pdf, cid.get("Subtype")).as_deref() == Some("CIDFontType0");
            let mut widths = Vec::new();
            if let Some(w) = cid.get("W").map(|v| pdf.resolve(v)) {
                let items: Vec<Object> = w
                    .as_array()
                    .unwrap_or_default()
                    .iter()
                    .map(|x| pdf.resolve(x))
                    .collect();
                let mut k = 0;
                while k < items.len() {
                    let first = items[k].as_f64().unwrap_or(0.0).max(0.0) as u32;
                    match items.get(k + 1) {
                        Some(Object::Array(list)) => {
                            let ws = list
                                .iter()
                                .map(|x| pdf.resolve(x).as_f64().unwrap_or(0.0) as f32)
                                .collect();
                            widths.push((first, ws));
                            k += 2;
                        }
                        Some(last) => {
                            let last = last.as_f64().unwrap_or(0.0).max(0.0) as u32;
                            let w = items.get(k + 2).and_then(Object::as_f64).unwrap_or(0.0) as f32;
                            if last >= first && last - first < 65_536 {
                                widths.push((first, vec![w; (last - first + 1) as usize]));
                            }
                            k += 3;
                        }
                        None => break,
                    }
                }
            }
            let cid_to_gid = match cid.get("CIDToGIDMap").map(|v| pdf.resolve(v)) {
                Some(Object::Stream(s)) => pdf
                    .stream_data(&s)
                    .ok()
                    .map(|d| {
                        CidToGid::Map(
                            d.chunks_exact(2)
                                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                                .collect(),
                        )
                    })
                    .unwrap_or_default(),
                _ => CidToGid::Identity,
            };
            let collection = dict_of(pdf, cid.get("CIDSystemInfo")).map(|info| {
                let text = |k: &str| {
                    info.get(k)
                        .map(|v| pdf.resolve(v))
                        .and_then(|v| v.as_text())
                        .unwrap_or_default()
                };
                (text("Registry"), text("Ordering"))
            });
            spec.cid = Some(CidSpec {
                cff,
                default_width: cid
                    .get("DW")
                    .map(|v| pdf.resolve(v))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1000.0) as f32,
                widths,
                cid_to_gid,
                collection,
            });
            if spec.base_font.is_empty() {
                spec.base_font = name_of(pdf, cid.get("BaseFont")).unwrap_or_default();
            }
            descriptor_fields(pdf, &mut spec, dict_of(pdf, cid.get("FontDescriptor")));
        }
        return spec;
    }
    spec.first_char = dict
        .get("FirstChar")
        .map(|v| pdf.resolve(v))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        .max(0) as u32;
    spec.widths = numbers(pdf, dict.get("Widths"));
    spec.encoding = encoding(pdf, dict.get("Encoding"));
    if subtype == FontSubtype::Type3 {
        let m: Vec<f64> = numbers(pdf, dict.get("FontMatrix"))
            .iter()
            .map(|&v| f64::from(v))
            .collect();
        spec.font_matrix = m.as_slice().try_into().ok();
    }
    descriptor_fields(pdf, &mut spec, dict_of(pdf, dict.get("FontDescriptor")));
    spec
}

fn type3(pdf: &dyn Resolve, dict: &Dict) -> Type3 {
    let matrix: Vec<f64> = numbers(pdf, dict.get("FontMatrix"))
        .iter()
        .map(|&v| f64::from(v))
        .collect();
    let mut procs = HashMap::new();
    if let Some(cp) = dict_of(pdf, dict.get("CharProcs")) {
        for (name, value) in cp.iter() {
            if let Some(data) = stream_bytes(pdf, Some(value)) {
                procs.insert(name.as_str().into_owned(), data);
            }
        }
    }
    Type3 {
        matrix: matrix
            .as_slice()
            .try_into()
            .unwrap_or([0.001, 0.0, 0.0, 0.001, 0.0, 0.0]),
        procs,
        resources: dict_of(pdf, dict.get("Resources")).unwrap_or_default(),
    }
}
