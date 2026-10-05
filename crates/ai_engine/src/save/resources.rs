//! A content stream's resources being written: what the operators name
//! (fonts, images, forms, graphics states, color spaces, patterns,
//! shadings, property lists), gathered from wherever the objects came
//! from and named again without clashes.

use super::objects::Objects;
use crate::pdf::content::Op;
use crate::pdf::{Dict, Name, Object, Pdf};
use std::collections::{BTreeMap, HashMap};

/// Resource categories and the prefix of the names given in each.
const CATEGORIES: [(&str, &str); 8] = [
    ("Font", "F"),
    ("XObject", "X"),
    ("ExtGState", "G"),
    ("ColorSpace", "C"),
    ("Pattern", "P"),
    ("Shading", "S"),
    ("Properties", "M"),
    ("ProcSet", "R"),
];

/// Color space names that are not resources.
const DEVICE_SPACES: [&str; 7] = [
    "DeviceGray",
    "DeviceRGB",
    "DeviceCMYK",
    "Pattern",
    "G",
    "RGB",
    "CMYK",
];

/// Resources of one content stream.
#[derive(Default)]
pub struct Resources {
    dicts: BTreeMap<&'static str, Dict>,
    names: HashMap<(&'static str, Vec<u8>), Name>,
    counts: HashMap<&'static str, usize>,
}

fn category(c: &str) -> Option<(&'static str, &'static str)> {
    CATEGORIES.iter().copied().find(|(k, _)| *k == c)
}

impl Resources {
    /// No resources.
    pub fn new() -> Resources {
        Resources::default()
    }

    /// Names a value already in the new file's numbering.
    pub fn name(&mut self, cat: &str, value: Object) -> Name {
        let Some((cat, prefix)) = category(cat) else {
            return Name::new("Unknown");
        };
        let mut key = Vec::new();
        crate::pdf::write::object(&value, &mut key);
        if let Some(n) = self.names.get(&(cat, key.clone())) {
            return n.clone();
        }
        let count = self.counts.entry(cat).or_default();
        *count += 1;
        let name = Name::new(&format!("{prefix}{count}"));
        self.dicts
            .entry(cat)
            .or_default()
            .0
            .push((name.clone(), value));
        self.names.insert((cat, key), name.clone());
        name
    }

    /// Names a value of the opened file (copied into the new one).
    pub fn copy(&mut self, objects: &mut Objects, pdf: &Pdf, cat: &str, value: &Object) -> Name {
        let copied = objects.copy(pdf, value);
        self.name(cat, copied)
    }

    /// The resource dictionary.
    pub fn into_dict(self) -> Dict {
        let mut d = Dict::new();
        for (cat, dict) in self.dicts {
            d.set(cat, Object::Dict(dict));
        }
        d
    }
}

/// A named resource of a category in a source resource dictionary, as
/// stored there.
fn lookup(pdf: &Pdf, source: &Dict, cat: &str, name: &Name) -> Option<Object> {
    let d = pdf.resolve(source.get(cat)?);
    d.as_dict()?
        .iter()
        .find(|(k, _)| k.as_bytes() == name.as_bytes())
        .map(|(_, v)| v.clone())
}

/// An operator from the opened file with the resources it names copied
/// and renamed.
pub fn rename(op: &Op, pdf: &Pdf, source: &Dict, res: &mut Resources, objects: &mut Objects) -> Op {
    let mut op = op.clone();
    op.span = 0..0;
    let mut swap = |op: &mut Op, i: usize, cat: &str| {
        let Some(Object::Name(n)) = op.operands.get(i) else {
            return;
        };
        let Some(value) = lookup(pdf, source, cat, n) else {
            return;
        };
        let new = res.copy(objects, pdf, cat, &value);
        op.operands[i] = Object::Name(new);
    };
    match op.operator.as_slice() {
        b"Tf" => swap(&mut op, 0, "Font"),
        b"Do" => swap(&mut op, 0, "XObject"),
        b"gs" => swap(&mut op, 0, "ExtGState"),
        b"sh" => swap(&mut op, 0, "Shading"),
        b"cs" | b"CS" => {
            if let Some(Object::Name(n)) = op.operands.first()
                && !DEVICE_SPACES.iter().any(|d| n == *d)
            {
                swap(&mut op, 0, "ColorSpace");
            }
        }
        b"scn" | b"SCN" => {
            let last = op.operands.len().saturating_sub(1);
            if matches!(op.operands.last(), Some(Object::Name(_))) {
                swap(&mut op, last, "Pattern");
            }
        }
        b"BDC" => swap(&mut op, 1, "Properties"),
        b"BI" => {
            if let Some(img) = &mut op.inline_image {
                for key in ["CS", "ColorSpace"] {
                    if let Some(Object::Name(n)) = img.dict.get(key)
                        && !DEVICE_SPACES.iter().any(|d| n == *d)
                        && !matches!(n.as_bytes(), b"I" | b"Indexed")
                        && let Some(value) = lookup(pdf, source, "ColorSpace", n)
                    {
                        let new = res.copy(objects, pdf, "ColorSpace", &value);
                        img.dict.set(key, Object::Name(new));
                    }
                }
            }
        }
        _ => {}
    }
    op
}
