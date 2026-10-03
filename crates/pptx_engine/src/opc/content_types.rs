//! The `[Content_Types].xml` part.

use crate::error::Result;
use crate::xml::{Ns, XmlDoc};

/// Default (by extension) and override (by part name) content types.
#[derive(Clone, Debug)]
pub struct ContentTypes {
    doc: XmlDoc,
    defaults: Vec<(String, String)>,
    overrides: Vec<(String, String)>,
    dirty: bool,
}

impl Default for ContentTypes {
    fn default() -> Self {
        Self {
            doc: XmlDoc::new_root(Ns::CONTENT_TYPES, "Types"),
            defaults: Vec::new(),
            overrides: Vec::new(),
            dirty: true,
        }
    }
}

impl ContentTypes {
    /// Parses a `[Content_Types].xml` part.
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let doc = XmlDoc::parse(bytes, "[Content_Types].xml")?;
        let mut defaults = Vec::new();
        let mut overrides = Vec::new();
        for c in doc.children(doc.root()) {
            let ct = doc.attr(c, "ContentType").unwrap_or_default().to_owned();
            match doc.local(c) {
                "Default" => {
                    if let Some(ext) = doc.attr(c, "Extension") {
                        defaults.push((ext.to_ascii_lowercase(), ct));
                    }
                }
                "Override" => {
                    if let Some(name) = doc.attr(c, "PartName") {
                        overrides
                            .push((super::normalize_part_name(&super::percent_decode(name)), ct));
                    }
                }
                _ => {}
            }
        }
        Ok(Self {
            doc,
            defaults,
            overrides,
            dirty: false,
        })
    }

    /// Whether the content types changed since parsing.
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Content type for a normalized part name.
    pub fn lookup(&self, part: &str) -> Option<&str> {
        if let Some((_, ct)) = self
            .overrides
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(part))
        {
            return Some(ct);
        }
        let ext = part.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())?;
        self.defaults
            .iter()
            .find(|(e, _)| *e == ext)
            .map(|(_, ct)| ct.as_str())
    }

    /// The default content type registered for an extension.
    pub fn default_for(&self, ext: &str) -> Option<&str> {
        let ext = ext.to_ascii_lowercase();
        self.defaults
            .iter()
            .find(|(e, _)| *e == ext)
            .map(|(_, ct)| ct.as_str())
    }

    /// Registers (or replaces) an override for `part`.
    pub fn set_override(&mut self, part: &str, content_type: &str) {
        if self
            .overrides
            .iter()
            .any(|(n, ct)| n.eq_ignore_ascii_case(part) && ct == content_type)
        {
            return;
        }
        self.remove_override(part);
        self.overrides
            .push((part.to_owned(), content_type.to_owned()));
        let el = self.doc.create_element(Ns::CONTENT_TYPES, "Override");
        self.doc.set_attr(el, "PartName", part);
        self.doc.set_attr(el, "ContentType", content_type);
        let root = self.doc.root();
        self.doc.append_child(root, el);
        self.dirty = true;
    }

    /// Removes the override for `part`, if any.
    pub fn remove_override(&mut self, part: &str) {
        let before = self.overrides.len();
        self.overrides
            .retain(|(n, _)| !n.eq_ignore_ascii_case(part));
        if self.overrides.len() == before {
            return;
        }
        let root = self.doc.root();
        let doomed: Vec<_> = self
            .doc
            .children(root)
            .filter(|&c| {
                self.doc.local(c) == "Override"
                    && self.doc.attr(c, "PartName").is_some_and(|n| {
                        super::normalize_part_name(&super::percent_decode(n))
                            .eq_ignore_ascii_case(part)
                    })
            })
            .collect();
        for d in doomed {
            self.doc.detach(d);
        }
        self.dirty = true;
    }

    /// Registers a default for `ext` if none exists.
    pub fn ensure_default(&mut self, ext: &str, content_type: &str) {
        let ext = ext.to_ascii_lowercase();
        if self.defaults.iter().any(|(e, _)| *e == ext) {
            return;
        }
        self.defaults.push((ext.clone(), content_type.to_owned()));
        let el = self.doc.create_element(Ns::CONTENT_TYPES, "Default");
        self.doc.set_attr(el, "Extension", &ext);
        self.doc.set_attr(el, "ContentType", content_type);
        // Defaults conventionally precede overrides.
        let root = self.doc.root();
        let first_override = self
            .doc
            .children(root)
            .find(|&c| self.doc.local(c) == "Override");
        match first_override {
            Some(first_override) => self.doc.insert_before(first_override, el),
            None => self.doc.append_child(root, el),
        }
        self.dirty = true;
    }

    /// Serializes the part.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.doc.to_bytes()
    }
}
