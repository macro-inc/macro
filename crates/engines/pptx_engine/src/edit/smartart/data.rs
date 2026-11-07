//! The SmartArt data model (`dgm:dataModel`): points (the doc, its nodes and
//! assistants, the transitions between them, and presentation points) and the
//! connections that make the node hierarchy.
//!
//! Structural edits work on a [`Tree`] of node ids and write it back with
//! [`write_tree`], which keeps every surviving node (its text, formatting, and
//! the transition points of its connection) and drops the presentation points,
//! so PowerPoint rebuilds the shapes from the layout definition when it opens
//! the file.

use crate::edit::xmlutil::{esc, new_guid};
use crate::error::{Error, Result};
use crate::opc::IdSource;
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::HashMap;

/// The diagram namespace URI.
pub(crate) const DGM_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
/// The DrawingML namespace URI.
pub(crate) const A_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";

/// Child order of `dgm:pt`.
const PT_ORDER: &[&str] = &["prSet", "spPr", "t", "extLst"];

/// A point's type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PtKind {
    /// The diagram itself (the root of the hierarchy).
    Doc,
    /// A node (one bullet of the text pane).
    Node,
    /// An assistant node (organization charts).
    Asst,
    /// The transition from a parent to a child.
    ParTrans,
    /// The transition from a node to its next sibling.
    SibTrans,
    /// A presentation point (one shape of the laid-out diagram).
    Pres,
}

impl PtKind {
    fn parse(v: Option<&str>) -> Self {
        match v {
            Some("doc") => Self::Doc,
            Some("asst") => Self::Asst,
            Some("parTrans") => Self::ParTrans,
            Some("sibTrans") => Self::SibTrans,
            Some("pres") => Self::Pres,
            _ => Self::Node,
        }
    }

    /// Whether points of this kind are nodes of the hierarchy (text pane bullets).
    pub fn is_node(self) -> bool {
        matches!(self, Self::Node | Self::Asst)
    }
}

/// One `dgm:pt`.
#[derive(Clone, Debug)]
pub(crate) struct Point {
    /// The element.
    pub el: NodeId,
    /// `modelId`.
    pub id: String,
    /// `type`.
    pub kind: PtKind,
    /// `cxnId` of a transition point.
    pub cxn: Option<String>,
}

/// A connection's type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CxnKind {
    /// Parent of (the hierarchy).
    ParOf,
    /// A node shown by a presentation point.
    PresOf,
    /// Presentation hierarchy.
    PresParOf,
    /// Anything else.
    Other,
}

/// One `dgm:cxn`.
#[derive(Clone, Debug)]
pub(crate) struct Cxn {
    /// The element.
    pub el: NodeId,
    /// `modelId`.
    pub id: String,
    /// `type`.
    pub kind: CxnKind,
    /// `srcId`.
    pub src: String,
    /// `destId`.
    pub dest: String,
    /// `srcOrd`.
    pub src_ord: u32,
    /// `destOrd`.
    pub dest_ord: u32,
}

/// The points and connections of a data model.
#[derive(Clone, Debug)]
pub(crate) struct Model {
    /// `dgm:ptLst`.
    pub pt_lst: NodeId,
    /// `dgm:cxnLst` (created when missing).
    pub cxn_lst: Option<NodeId>,
    /// Every point, in document order.
    pub points: Vec<Point>,
    /// Every connection, in document order.
    pub cxns: Vec<Cxn>,
}

impl Model {
    /// Reads the data model of a data part.
    pub fn read(doc: &XmlDoc) -> Result<Model> {
        let root = doc.root();
        let pt_lst = doc
            .child(root, Ns::DGM, "ptLst")
            .ok_or_else(|| Error::InvalidEdit("the SmartArt data has no point list".into()))?;
        let points = doc
            .children_named(pt_lst, Ns::DGM, "pt")
            .map(|el| Point {
                el,
                id: doc.attr(el, "modelId").unwrap_or_default().to_owned(),
                kind: PtKind::parse(doc.attr(el, "type")),
                cxn: doc.attr(el, "cxnId").map(str::to_owned),
            })
            .collect();
        let cxn_lst = doc.child(root, Ns::DGM, "cxnLst");
        let cxns = cxn_lst
            .map(|l| {
                doc.children_named(l, Ns::DGM, "cxn")
                    .map(|el| Cxn {
                        el,
                        id: doc.attr(el, "modelId").unwrap_or_default().to_owned(),
                        kind: match doc.attr(el, "type") {
                            None | Some("parOf") => CxnKind::ParOf,
                            Some("presOf") => CxnKind::PresOf,
                            Some("presParOf") => CxnKind::PresParOf,
                            Some(_) => CxnKind::Other,
                        },
                        src: doc.attr(el, "srcId").unwrap_or_default().to_owned(),
                        dest: doc.attr(el, "destId").unwrap_or_default().to_owned(),
                        src_ord: doc
                            .attr_i64(el, "srcOrd")
                            .unwrap_or(0)
                            .clamp(0, i64::from(u32::MAX)) as u32,
                        dest_ord: doc
                            .attr_i64(el, "destOrd")
                            .unwrap_or(0)
                            .clamp(0, i64::from(u32::MAX)) as u32,
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(Model {
            pt_lst,
            cxn_lst,
            points,
            cxns,
        })
    }

    /// The doc point.
    pub fn doc_point(&self) -> Option<&Point> {
        self.points.iter().find(|p| p.kind == PtKind::Doc)
    }

    /// The point with `id`.
    pub fn point(&self, id: &str) -> Option<&Point> {
        self.points.iter().find(|p| p.id == id)
    }

    /// The node hierarchy.
    pub fn tree(&self) -> Tree {
        let root = self.doc_point().map(|p| p.id.clone()).unwrap_or_default();
        let kinds: HashMap<String, PtKind> = self
            .points
            .iter()
            .filter(|p| p.kind.is_node() || p.kind == PtKind::Doc)
            .map(|p| (p.id.clone(), p.kind))
            .collect();
        let mut edges: Vec<&Cxn> = self
            .cxns
            .iter()
            .filter(|c| c.kind == CxnKind::ParOf)
            .filter(|c| kinds.contains_key(&c.src) && kinds.contains_key(&c.dest))
            .collect();
        edges.sort_by_key(|c| c.src_ord);
        let mut children: HashMap<String, Vec<String>> = HashMap::new();
        let mut seen = std::collections::HashSet::new();
        for c in edges {
            // A node has one parent; ignore duplicates and cycles back to the root.
            if c.dest == root || !seen.insert(c.dest.clone()) {
                continue;
            }
            children
                .entry(c.src.clone())
                .or_default()
                .push(c.dest.clone());
        }
        let mut tree = Tree {
            root,
            children,
            kinds,
        };
        tree.drop_unreachable();
        tree
    }

    /// The `presOf` connections into the presentation point `pres`, by `destOrd`.
    pub fn pres_sources(&self, pres: &str) -> Vec<&Cxn> {
        let mut v: Vec<&Cxn> = self
            .cxns
            .iter()
            .filter(|c| c.kind == CxnKind::PresOf && c.dest == pres)
            .collect();
        v.sort_by_key(|c| c.dest_ord);
        v
    }

    /// Whether presentation points carry custom sizes, positions, or
    /// formatting (the diagram was customized in PowerPoint), which a
    /// regenerated drawing would lose.
    pub fn customized(&self, doc: &XmlDoc) -> bool {
        self.points
            .iter()
            .filter(|p| p.kind == PtKind::Pres)
            .any(|p| {
                let custom_attrs = doc.child(p.el, Ns::DGM, "prSet").is_some_and(|s| {
                    doc.attrs(s)
                        .any(|a| a.local().starts_with("cust") && !matches!(a.local(), "custT"))
                });
                let custom_shape = doc
                    .child(p.el, Ns::DGM, "spPr")
                    .is_some_and(|s| doc.first_child(s).is_some());
                custom_attrs || custom_shape
            })
    }
}

/// The node hierarchy: the doc point and its descendants, by id.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Tree {
    /// The doc point's id.
    pub root: String,
    /// Children of each point, in order.
    pub children: HashMap<String, Vec<String>>,
    /// Kinds of the doc point and every node.
    pub kinds: HashMap<String, PtKind>,
}

impl Tree {
    /// Removes nodes that are not under the root (stray data in odd files).
    fn drop_unreachable(&mut self) {
        let keep: std::collections::HashSet<String> =
            self.preorder().into_iter().map(|(id, _)| id).collect();
        self.children
            .retain(|k, _| *k == self.root || keep.contains(k));
        for v in self.children.values_mut() {
            v.retain(|c| keep.contains(c));
        }
    }

    /// The children of `id`.
    pub fn kids(&self, id: &str) -> &[String] {
        self.children.get(id).map(Vec::as_slice).unwrap_or(&[])
    }

    /// The parent of `id`.
    pub fn parent(&self, id: &str) -> Option<&str> {
        self.children
            .iter()
            .find(|(_, v)| v.iter().any(|c| c == id))
            .map(|(k, _)| k.as_str())
    }

    /// Every node with its depth (1 = top level), in text-pane order.
    pub fn preorder(&self) -> Vec<(String, usize)> {
        let mut out = Vec::new();
        let mut stack: Vec<(String, usize)> = self
            .kids(&self.root)
            .iter()
            .rev()
            .map(|c| (c.clone(), 1))
            .collect();
        let mut guard = 0;
        while let Some((id, depth)) = stack.pop() {
            guard += 1;
            if guard > 100_000 {
                break;
            }
            for c in self.kids(&id).iter().rev() {
                stack.push((c.clone(), depth + 1));
            }
            out.push((id, depth));
        }
        out
    }

    /// Whether `id` is a node of the tree.
    pub fn contains(&self, id: &str) -> bool {
        id != self.root && self.kinds.contains_key(id) && self.parent(id).is_some()
    }

    fn require(&self, id: &str) -> Result<()> {
        if self.contains(id) {
            Ok(())
        } else {
            Err(Error::NotFound(format!("SmartArt node {id}")))
        }
    }

    fn position(&self, id: &str) -> Result<(String, usize)> {
        let parent = self
            .parent(id)
            .ok_or_else(|| Error::NotFound(format!("SmartArt node {id}")))?
            .to_owned();
        let index = self
            .kids(&parent)
            .iter()
            .position(|c| c == id)
            .unwrap_or_default();
        Ok((parent, index))
    }

    fn insert(&mut self, parent: &str, index: usize, id: &str, kind: PtKind) {
        let v = self.children.entry(parent.to_owned()).or_default();
        let index = index.min(v.len());
        v.insert(index, id.to_owned());
        self.kinds.insert(id.to_owned(), kind);
    }

    fn remove_from_parent(&mut self, id: &str) -> Option<(String, usize)> {
        let (parent, index) = self.position(id).ok()?;
        if let Some(v) = self.children.get_mut(&parent) {
            v.remove(index);
        }
        Some((parent, index))
    }

    /// Adds `new` after `id`, as its next sibling.
    pub fn add_after(&mut self, id: &str, new: &str) -> Result<()> {
        self.require(id)?;
        let (parent, index) = self.position(id)?;
        self.insert(&parent, index + 1, new, PtKind::Node);
        Ok(())
    }

    /// Adds `new` before `id`, as its previous sibling.
    pub fn add_before(&mut self, id: &str, new: &str) -> Result<()> {
        self.require(id)?;
        let (parent, index) = self.position(id)?;
        self.insert(&parent, index, new, PtKind::Node);
        Ok(())
    }

    /// Adds `new` in the place of `id`, which becomes its only child.
    pub fn add_above(&mut self, id: &str, new: &str) -> Result<()> {
        self.require(id)?;
        let (parent, index) = self.remove_from_parent(id).unwrap_or_default();
        self.insert(&parent, index, new, PtKind::Node);
        self.insert(
            new,
            0,
            id,
            self.kinds.get(id).copied().unwrap_or(PtKind::Node),
        );
        Ok(())
    }

    /// Adds `new` as the last child of `id`.
    pub fn add_below(&mut self, id: &str, new: &str) -> Result<()> {
        self.require(id)?;
        let n = self.kids(id).len();
        self.insert(id, n, new, PtKind::Node);
        Ok(())
    }

    /// Adds `new` as an assistant of `id` (before its other children).
    pub fn add_assistant(&mut self, id: &str, new: &str) -> Result<()> {
        self.require(id)?;
        let n = self
            .kids(id)
            .iter()
            .take_while(|c| self.kinds.get(*c) == Some(&PtKind::Asst))
            .count();
        self.insert(id, n, new, PtKind::Asst);
        Ok(())
    }

    /// Adds `new` as the last top-level node.
    pub fn add_last(&mut self, new: &str) {
        let root = self.root.clone();
        let n = self.kids(&root).len();
        self.insert(&root, n, new, PtKind::Node);
    }

    /// Deletes `id`; its children take its place.
    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.require(id)?;
        let kids = self.children.remove(id).unwrap_or_default();
        let (parent, index) = self.remove_from_parent(id).unwrap_or_default();
        let v = self.children.entry(parent).or_default();
        for (k, c) in kids.into_iter().enumerate() {
            v.insert((index + k).min(v.len()), c);
        }
        self.kinds.remove(id);
        Ok(())
    }

    /// Moves `id` one level up (Shift+Tab in the text pane): it becomes the
    /// next sibling of its parent and adopts its following siblings.
    pub fn promote(&mut self, id: &str) -> Result<()> {
        self.require(id)?;
        let (parent, index) = self.position(id)?;
        if parent == self.root {
            return Err(Error::InvalidEdit(
                "a top-level SmartArt node cannot be promoted".into(),
            ));
        }
        let (grand, parent_index) = self.position(&parent)?;
        let following: Vec<String> = self
            .children
            .get_mut(&parent)
            .map(|v| v.split_off(index + 1))
            .unwrap_or_default();
        self.remove_from_parent(id);
        self.children
            .entry(id.to_owned())
            .or_default()
            .extend(following);
        if self.kinds.get(id) == Some(&PtKind::Asst) {
            self.kinds.insert(id.to_owned(), PtKind::Node);
        }
        self.insert(
            &grand,
            parent_index + 1,
            id,
            self.kinds.get(id).copied().unwrap_or(PtKind::Node),
        );
        Ok(())
    }

    /// Moves `id` one level down (Tab in the text pane): it becomes the last
    /// child of its previous sibling, with its own children.
    pub fn demote(&mut self, id: &str) -> Result<()> {
        self.require(id)?;
        let (parent, index) = self.position(id)?;
        if index == 0 {
            return Err(Error::InvalidEdit(
                "the first SmartArt node at its level cannot be demoted".into(),
            ));
        }
        let previous = self.kids(&parent)[index - 1].clone();
        self.remove_from_parent(id);
        let n = self.kids(&previous).len();
        self.insert(
            &previous,
            n,
            id,
            self.kinds.get(id).copied().unwrap_or(PtKind::Node),
        );
        Ok(())
    }

    /// Swaps `id` with its previous (`up`) or next sibling.
    pub fn move_by(&mut self, id: &str, up: bool) -> Result<()> {
        self.require(id)?;
        let (parent, index) = self.position(id)?;
        let v = self.children.entry(parent).or_default();
        let other = if up {
            index.checked_sub(1)
        } else {
            (index + 1 < v.len()).then_some(index + 1)
        };
        match other {
            Some(o) => {
                v.swap(index, o);
                Ok(())
            }
            None => Err(Error::InvalidEdit(format!(
                "the SmartArt node cannot move {}",
                if up { "up" } else { "down" }
            ))),
        }
    }

    /// Ids of every node.
    pub fn node_ids(&self) -> Vec<String> {
        self.preorder().into_iter().map(|(id, _)| id).collect()
    }
}

/// Makes new GUID model ids that do not collide with a model's.
pub(crate) struct IdGen<'a> {
    ids: Option<&'a IdSource>,
    seed: String,
    taken: Vec<String>,
}

impl<'a> IdGen<'a> {
    /// Ids for the data part `part`, avoiding the ids in `doc`.
    pub fn new(ids: Option<&'a IdSource>, part: &str, doc: &XmlDoc) -> Self {
        let taken = doc
            .descendants(doc.root())
            .into_iter()
            .filter_map(|n| doc.attr(n, "modelId").map(str::to_owned))
            .collect();
        Self {
            ids,
            seed: part.to_owned(),
            taken,
        }
    }

    /// Ids avoiding nothing yet (new diagrams).
    pub fn fresh(ids: Option<&'a IdSource>, seed: &str) -> Self {
        Self {
            ids,
            seed: seed.to_owned(),
            taken: Vec::new(),
        }
    }

    /// A new id.
    pub fn next(&mut self) -> String {
        let seed = format!("{}|{}", self.seed, self.taken.len());
        let id = new_guid(self.ids, &seed, &self.taken);
        self.taken.push(id.clone());
        id
    }
}

/// The XML of a `dgm:t` text body holding `text` (`\n` separates
/// paragraphs, `\u{b}` is a line break).
pub(crate) fn text_xml(text: &str) -> String {
    let mut s = String::from("<dgm:t><a:bodyPr/><a:lstStyle/>");
    for line in text.split('\n') {
        s.push_str("<a:p>");
        for (k, seg) in line.split('\u{b}').enumerate() {
            if k > 0 {
                s.push_str("<a:br><a:rPr lang=\"en-US\"/></a:br>");
            }
            if !seg.is_empty() {
                s.push_str(&format!(
                    "<a:r><a:rPr lang=\"en-US\" dirty=\"0\"/><a:t>{}</a:t></a:r>",
                    esc(seg)
                ));
            }
        }
        s.push_str("<a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p>");
    }
    s.push_str("</dgm:t>");
    s
}

/// The XML of a node point.
pub(crate) fn node_point_xml(id: &str, kind: PtKind, text: Option<&str>) -> String {
    let ty = if kind == PtKind::Asst {
        " type=\"asst\""
    } else {
        ""
    };
    let (pr_set, body) = match text {
        Some(t) if !t.is_empty() => ("<dgm:prSet/>".to_owned(), text_xml(t)),
        _ => ("<dgm:prSet phldrT=\"[Text]\"/>".to_owned(), text_xml("")),
    };
    format!("<dgm:pt modelId=\"{id}\"{ty}>{pr_set}<dgm:spPr/>{body}</dgm:pt>")
}

/// The XML of a transition point.
pub(crate) fn trans_point_xml(id: &str, kind: &str, cxn: &str) -> String {
    format!(
        "<dgm:pt modelId=\"{id}\" type=\"{kind}\" cxnId=\"{cxn}\"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\"/></a:p></dgm:t></dgm:pt>"
    )
}

/// The XML of a parent-of connection.
pub(crate) fn par_of_xml(
    id: &str,
    src: &str,
    dest: &str,
    ord: usize,
    par: &str,
    sib: &str,
) -> String {
    format!(
        "<dgm:cxn modelId=\"{id}\" srcId=\"{src}\" destId=\"{dest}\" srcOrd=\"{ord}\" destOrd=\"0\" parTransId=\"{par}\" sibTransId=\"{sib}\"/>"
    )
}

/// Parses an XML fragment in the diagram and DrawingML namespaces and imports it into `doc`.
pub(crate) fn import(doc: &mut XmlDoc, xml: &str) -> Result<NodeId> {
    let wrapped = format!("<w xmlns:dgm=\"{DGM_URI}\" xmlns:a=\"{A_URI}\">{xml}</w>");
    let frag = XmlDoc::parse(wrapped.as_bytes(), "SmartArt fragment")?;
    let first = frag
        .first_child(frag.root())
        .ok_or_else(|| Error::InvalidEdit("empty fragment".into()))?;
    Ok(doc.import(&frag, first))
}

/// New nodes for [`write_tree`]: id → text (`None` for an empty placeholder node).
pub(crate) type NewNodes = HashMap<String, Option<String>>;

/// Writes `tree` back into the data model: surviving nodes keep their
/// points, connections, and transitions; removed nodes lose theirs; `new`
/// nodes get points, connections, and transition points. Presentation points
/// and their connections are dropped (they belong to the old arrangement).
pub(crate) fn write_tree(
    doc: &mut XmlDoc,
    tree: &Tree,
    new: &NewNodes,
    ids: &mut IdGen<'_>,
) -> Result<()> {
    let model = Model::read(doc)?;
    drop_presentation(doc, &model);
    let model = Model::read(doc)?;
    let cxn_lst = match model.cxn_lst {
        Some(l) => l,
        None => {
            let l = doc.create_element(Ns::DGM, "cxnLst");
            doc.insert_after(model.pt_lst, l);
            l
        }
    };
    let alive: std::collections::HashSet<String> = tree.node_ids().into_iter().collect();
    // Removed nodes: their points, connections, and transitions.
    let removed: Vec<&Point> = model
        .points
        .iter()
        .filter(|p| p.kind.is_node() && !alive.contains(&p.id))
        .collect();
    let mut doomed_cxns: Vec<String> = Vec::new();
    for p in &removed {
        doc.detach(p.el);
        for c in model
            .cxns
            .iter()
            .filter(|c| c.kind == CxnKind::ParOf && c.dest == p.id)
        {
            doomed_cxns.push(c.id.clone());
        }
    }
    // Connections whose child is now under another parent are rewritten in
    // place; edges that no longer exist are removed.
    let mut by_dest: HashMap<String, &Cxn> = HashMap::new();
    for c in model.cxns.iter().filter(|c| c.kind == CxnKind::ParOf) {
        if !doomed_cxns.contains(&c.id) {
            by_dest.entry(c.dest.clone()).or_insert(c);
        }
    }
    let mut kept_cxns: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut parents: Vec<String> = vec![tree.root.clone()];
    parents.extend(tree.node_ids());
    for parent in &parents {
        for (ord, child) in tree.kids(parent).iter().enumerate() {
            match by_dest.get(child) {
                Some(c) => {
                    doc.set_attr(c.el, "srcId", parent);
                    doc.set_attr(c.el, "srcOrd", &ord.to_string());
                    kept_cxns.insert(c.id.clone());
                }
                None => {
                    let (cid, par, sib) = (ids.next(), ids.next(), ids.next());
                    let el = import(doc, &par_of_xml(&cid, parent, child, ord, &par, &sib))?;
                    doc.append_child(cxn_lst, el);
                    for (tid, kind) in [(&par, "parTrans"), (&sib, "sibTrans")] {
                        let t = import(doc, &trans_point_xml(tid, kind, &cid))?;
                        doc.append_child(model.pt_lst, t);
                    }
                    kept_cxns.insert(cid);
                }
            }
        }
    }
    for c in model.cxns.iter().filter(|c| c.kind == CxnKind::ParOf) {
        if !kept_cxns.contains(&c.id) {
            doc.detach(c.el);
            doomed_cxns.push(c.id.clone());
        }
    }
    // Transition points of removed connections.
    for p in model
        .points
        .iter()
        .filter(|p| matches!(p.kind, PtKind::ParTrans | PtKind::SibTrans))
    {
        if p.cxn.as_ref().is_some_and(|c| doomed_cxns.contains(c)) {
            doc.detach(p.el);
        }
    }
    // Points of new nodes, and kinds that changed (assistants promoted).
    for id in tree.node_ids() {
        let kind = tree.kinds.get(&id).copied().unwrap_or(PtKind::Node);
        match model.point(&id) {
            Some(p) => {
                if p.kind != kind {
                    match kind {
                        PtKind::Asst => doc.set_attr(p.el, "type", "asst"),
                        _ => doc.remove_attr(p.el, "type"),
                    }
                }
            }
            None => {
                let text = new.get(&id).cloned().flatten();
                let el = import(doc, &node_point_xml(&id, kind, text.as_deref()))?;
                doc.append_child(model.pt_lst, el);
            }
        }
    }
    Ok(())
}

/// Removes presentation points and the connections that refer to them.
pub(crate) fn drop_presentation(doc: &mut XmlDoc, model: &Model) {
    for p in model.points.iter().filter(|p| p.kind == PtKind::Pres) {
        doc.detach(p.el);
    }
    for c in model
        .cxns
        .iter()
        .filter(|c| matches!(c.kind, CxnKind::PresOf | CxnKind::PresParOf))
    {
        doc.detach(c.el);
    }
}

/// The `dgm:t` element of a point, created when missing.
pub(crate) fn ensure_text(doc: &mut XmlDoc, pt: NodeId) -> Result<NodeId> {
    if let Some(t) = doc.child(pt, Ns::DGM, "t") {
        return Ok(t);
    }
    let t = import(doc, &text_xml(""))?;
    doc.insert_in_order(pt, t, PT_ORDER);
    Ok(t)
}

/// The plain text of a text body (`\n` between paragraphs, `\u{b}` for line breaks).
pub(crate) fn plain_text(doc: &XmlDoc, body: NodeId) -> String {
    doc.children_named(body, Ns::A, "p")
        .map(|p| paragraph_text(doc, p))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The text of one `a:p`.
pub(crate) fn paragraph_text(doc: &XmlDoc, p: NodeId) -> String {
    let mut s = String::new();
    for c in doc.children(p) {
        match doc.local(c) {
            "r" | "fld" => {
                if let Some(t) = doc.child(c, Ns::A, "t") {
                    s.push_str(&doc.text(t));
                }
            }
            "br" => s.push('\u{b}'),
            _ => {}
        }
    }
    s
}

/// The text of a node point.
pub(crate) fn node_text(doc: &XmlDoc, pt: NodeId) -> String {
    doc.child(pt, Ns::DGM, "t")
        .map(|t| plain_text(doc, t))
        .unwrap_or_default()
}

/// The `prSet` attribute `name` of the doc point.
pub(crate) fn doc_attr(doc: &XmlDoc, model: &Model, name: &str) -> Option<String> {
    let p = model.doc_point()?;
    let set = doc.child(p.el, Ns::DGM, "prSet")?;
    doc.attr(set, name).map(str::to_owned)
}

/// Sets `prSet` attributes of the doc point.
pub(crate) fn set_doc_attrs(doc: &mut XmlDoc, model: &Model, attrs: &[(&str, &str)]) -> Result<()> {
    let p = model
        .doc_point()
        .ok_or_else(|| Error::InvalidEdit("the SmartArt data has no doc point".into()))?
        .el;
    let set = doc.ensure_child(p, Ns::DGM, "prSet", PT_ORDER);
    for (k, v) in attrs {
        doc.set_attr(set, k, v);
    }
    Ok(())
}

#[cfg(test)]
mod test;
