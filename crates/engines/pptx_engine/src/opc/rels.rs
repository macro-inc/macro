//! Relationship parts (`_rels/*.rels`).

use crate::error::Result;
use crate::xml::XmlDoc;

/// Whether a relationship points inside the package.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetMode {
    /// A part in the same package.
    Internal,
    /// An external resource (URL, file path).
    External,
}

/// One relationship.
#[derive(Clone, Debug)]
pub struct Relationship {
    /// Relationship id, unique within its part (`rId3`).
    pub id: String,
    /// Relationship type URI.
    pub rel_type: String,
    /// Target as written (relative URI for internal targets).
    pub target: String,
    /// Internal or external.
    pub mode: TargetMode,
}

/// All relationships of one source part.
#[derive(Clone, Debug)]
pub struct Relationships {
    source: String,
    rels: Vec<Relationship>,
    /// Random ids for new relationships (collaborative editing).
    ids: Option<std::sync::Arc<super::IdSource>>,
}

impl Relationships {
    /// No relationships for `source`.
    pub fn empty(source: &str) -> Self {
        Self {
            source: source.to_owned(),
            rels: Vec::new(),
            ids: None,
        }
    }

    /// Parses the relationships part of `source`.
    pub fn parse(source: &str, bytes: &[u8]) -> Result<Self> {
        let doc = XmlDoc::parse(bytes, &super::rels_part_name(source))?;
        let rels = doc
            .children(doc.root())
            .filter(|&c| doc.local(c) == "Relationship")
            .filter_map(|c| {
                Some(Relationship {
                    id: doc.attr(c, "Id")?.to_owned(),
                    rel_type: doc.attr(c, "Type").unwrap_or_default().to_owned(),
                    target: doc.attr(c, "Target").unwrap_or_default().to_owned(),
                    mode: if doc
                        .attr(c, "TargetMode")
                        .is_some_and(|m| m.eq_ignore_ascii_case("External"))
                    {
                        TargetMode::External
                    } else {
                        TargetMode::Internal
                    },
                })
            })
            .collect();
        Ok(Self {
            source: source.to_owned(),
            rels,
            ids: None,
        })
    }

    /// New relationships take random ids from `ids` (see `Package::use_random_ids`).
    pub fn with_ids(mut self, ids: Option<std::sync::Arc<super::IdSource>>) -> Self {
        self.ids = ids;
        self
    }

    /// The source part these relationships belong to.
    pub fn source(&self) -> &str {
        &self.source
    }

    /// All relationships in order.
    pub fn iter(&self) -> impl Iterator<Item = &Relationship> {
        self.rels.iter()
    }

    /// Relationship by id.
    pub fn get(&self, id: &str) -> Option<&Relationship> {
        self.rels.iter().find(|r| r.id == id)
    }

    /// First relationship of a type.
    pub fn first_of_type(&self, rel_type: &str) -> Option<&Relationship> {
        self.rels.iter().find(|r| r.rel_type == rel_type)
    }

    /// Resolved part name of an internal relationship target.
    pub fn resolve(&self, rel: &Relationship) -> String {
        super::resolve_target(&self.source, &rel.target)
    }

    /// Resolved part name for relationship `id`, if internal.
    pub fn target_part(&self, id: &str) -> Option<String> {
        self.get(id)
            .filter(|r| r.mode == TargetMode::Internal)
            .map(|r| self.resolve(r))
    }

    /// Adds a relationship to an internal part and returns its new id.
    pub fn add_internal(&mut self, rel_type: &str, target_part: &str) -> String {
        let target = super::relative_target(&self.source, target_part);
        self.add(rel_type, &target, TargetMode::Internal)
    }

    /// Adds a relationship and returns its new id.
    pub fn add(&mut self, rel_type: &str, target: &str, mode: TargetMode) -> String {
        let id = match &self.ids {
            Some(ids) => loop {
                let id = format!("rId{}", ids.next_in(1_000_000..1_000_000_000));
                if self.get(&id).is_none() {
                    break id;
                }
            },
            None => (1..)
                .map(|n| format!("rId{n}"))
                .find(|id| self.get(id).is_none())
                .expect("unbounded search"),
        };
        self.rels.push(Relationship {
            id: id.clone(),
            rel_type: rel_type.to_owned(),
            target: target.to_owned(),
            mode,
        });
        id
    }

    /// Appends a relationship as given (keeping its id).
    pub fn push(&mut self, rel: Relationship) {
        self.rels.retain(|r| r.id != rel.id);
        self.rels.push(rel);
    }

    /// Removes relationship `id`.
    pub fn remove(&mut self, id: &str) {
        self.rels.retain(|r| r.id != id);
    }

    /// Serializes the relationships part.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = String::from(crate::xml::STANDARD_DECLARATION);
        out.push_str("<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
        for r in &self.rels {
            out.push_str("<Relationship Id=\"");
            push_escaped(&mut out, &r.id);
            out.push_str("\" Type=\"");
            push_escaped(&mut out, &r.rel_type);
            out.push_str("\" Target=\"");
            push_escaped(&mut out, &r.target);
            out.push('"');
            if r.mode == TargetMode::External {
                out.push_str(" TargetMode=\"External\"");
            }
            out.push_str("/>");
        }
        out.push_str("</Relationships>");
        out.into_bytes()
    }
}

fn push_escaped(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
}
