//! The objects of a file being written, and objects copied into it from
//! the opened file (renumbered, without Illustrator's private data).

use crate::pdf::{Dict, ObjRef, Object, Pdf, Stream};
use std::collections::HashMap;

/// Keys left out of copied dictionaries: Illustrator's private data, and
/// links back into the old page tree and structure tree.
const DROPPED: [&str; 5] = ["PieceInfo", "Parent", "P", "StructParent", "StructParents"];

/// Deepest nesting of copied objects followed.
const MAX_DEPTH: usize = 96;

/// Objects of the file being written.
#[derive(Default)]
pub struct Objects {
    /// The objects.
    pub list: Vec<(ObjRef, Object)>,
    next: u32,
    copied: HashMap<u32, ObjRef>,
}

impl Objects {
    /// No objects yet.
    pub fn new() -> Objects {
        Objects {
            list: Vec::new(),
            next: 1,
            copied: HashMap::new(),
        }
    }

    /// A number for an object set later.
    pub fn reserve(&mut self) -> ObjRef {
        let r = ObjRef {
            num: self.next,
            generation: 0,
        };
        self.next += 1;
        r
    }

    /// Sets a reserved object.
    pub fn set(&mut self, r: ObjRef, o: Object) {
        self.list.push((r, o));
    }

    /// Adds an object.
    pub fn add(&mut self, o: Object) -> ObjRef {
        let r = self.reserve();
        self.set(r, o);
        r
    }

    /// A value of the opened file, with what it refers to copied (once).
    pub fn copy(&mut self, pdf: &Pdf, o: &Object) -> Object {
        self.copy_at(pdf, o, 0)
    }

    fn copy_at(&mut self, pdf: &Pdf, o: &Object, depth: usize) -> Object {
        if depth > MAX_DEPTH {
            return Object::Null;
        }
        match o {
            Object::Ref(r) => {
                if let Some(&new) = self.copied.get(&r.num) {
                    return Object::Ref(new);
                }
                let new = self.reserve();
                self.copied.insert(r.num, new);
                let value = pdf.get(*r).unwrap_or(Object::Null);
                let value = self.copy_at(pdf, &value, depth + 1);
                self.set(new, value);
                Object::Ref(new)
            }
            Object::Array(a) => {
                Object::Array(a.iter().map(|v| self.copy_at(pdf, v, depth + 1)).collect())
            }
            Object::Dict(d) => Object::Dict(self.copy_dict(pdf, d, depth)),
            Object::Stream(s) => Object::Stream(Stream {
                dict: self.copy_dict(pdf, &s.dict, depth),
                data: s.data.clone(),
            }),
            other => other.clone(),
        }
    }

    fn copy_dict(&mut self, pdf: &Pdf, d: &Dict, depth: usize) -> Dict {
        let mut out = Dict::new();
        for (k, v) in d.iter() {
            if DROPPED.iter().any(|x| k.as_bytes() == x.as_bytes()) {
                continue;
            }
            let v = self.copy_at(pdf, v, depth + 1);
            out.0.push((k.clone(), v));
        }
        out
    }
}
