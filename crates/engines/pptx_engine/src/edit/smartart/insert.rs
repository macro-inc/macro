//! New SmartArt graphics (Insert ▸ SmartArt): the five parts, their
//! relationships and content types, and the graphic frame.

use super::catalog::{self, Kind, find_layout};
use super::data::{self, A_URI, DGM_URI, IdGen, NewNodes, PtKind, Tree};
use super::drawing::DSP_URI;
use super::{colors, content_types, layout_def, quick_style, rels};
use crate::edit::ops::SmartArtItem;
use crate::edit::xmlutil::esc;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::units::pt_to_emu;
use crate::xml::{STANDARD_DECLARATION, XmlDoc};
use std::collections::HashMap;

/// What `addShape` was asked to create.
#[derive(Clone, Copy, Debug)]
pub(crate) struct NewSmartArt<'a> {
    /// Layout id, short id, or name.
    pub layout: &'a str,
    /// The text outline (the layout's sample nodes when omitted).
    pub items: Option<&'a [SmartArtItem]>,
    /// Color variation.
    pub colors: Option<&'a str>,
    /// Style.
    pub style: Option<&'a str>,
}

/// Writes a new part named `{prefix}{n}.xml`; returns its name.
pub(crate) fn write_part(
    pres: &mut Presentation,
    prefix: &str,
    bytes: Vec<u8>,
    content_type: &str,
) -> String {
    let name = pres.pkg.unique_part_name(prefix, ".xml");
    pres.pkg.write(&name, bytes, Some(content_type));
    name
}

/// The sample nodes PowerPoint inserts for a layout: (level, assistant).
pub(crate) fn sample(kind: Kind) -> Vec<(u8, bool)> {
    let top = |n: usize| vec![(1, false); n];
    match kind {
        Kind::BlockList | Kind::Cycle => top(5),
        Kind::Process | Kind::Chevron | Kind::Venn | Kind::Pyramid => top(3),
        Kind::VerticalBullets => vec![(1, false), (2, false), (1, false), (2, false)],
        Kind::HorizontalBullets => [(1, false), (2, false), (2, false)].repeat(3),
        Kind::Radial => vec![(1, false), (2, false), (2, false), (2, false), (2, false)],
        Kind::Hierarchy => vec![
            (1, false),
            (2, false),
            (3, false),
            (3, false),
            (2, false),
            (3, false),
        ],
        Kind::OrgChart => vec![(1, false), (2, true), (2, false), (2, false), (2, false)],
    }
}

/// Rebuilds `tree` from a flat outline, reusing the ids of its nodes in
/// order; new ids go into `new` with their text. Returns every node's id
/// and text.
pub(crate) fn outline_tree(
    tree: &mut Tree,
    items: &[SmartArtItem],
    idgen: &mut IdGen<'_>,
    new: &mut NewNodes,
) -> Result<Vec<(String, String)>> {
    let entries: Vec<(u8, bool, String)> = items
        .iter()
        .map(|i| (i.level, false, i.text.clone()))
        .collect();
    build(tree, &entries, idgen, new)
}

fn build(
    tree: &mut Tree,
    entries: &[(u8, bool, String)],
    idgen: &mut IdGen<'_>,
    new: &mut NewNodes,
) -> Result<Vec<(String, String)>> {
    let existing = tree.node_ids();
    let root = tree.root.clone();
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    children.insert(root.clone(), Vec::new());
    let mut kinds: HashMap<String, PtKind> = HashMap::new();
    kinds.insert(root.clone(), PtKind::Doc);
    // The last node at each level (stack[0] is the root).
    let mut stack: Vec<String> = vec![root];
    let mut out = Vec::new();
    for (k, (level, asst, text)) in entries.iter().enumerate() {
        let level = usize::from((*level).max(1)).min(stack.len());
        stack.truncate(level);
        let parent = stack[level - 1].clone();
        let id = match existing.get(k) {
            Some(id) => id.clone(),
            None => {
                let id = idgen.next();
                new.insert(id.clone(), (!text.is_empty()).then(|| text.clone()));
                id
            }
        };
        let kind = if *asst {
            PtKind::Asst
        } else {
            match tree.kinds.get(&id) {
                Some(PtKind::Asst) if level > 1 => PtKind::Asst,
                _ => PtKind::Node,
            }
        };
        children.entry(parent).or_default().push(id.clone());
        children.entry(id.clone()).or_default();
        kinds.insert(id.clone(), kind);
        stack.push(id.clone());
        out.push((id, text.clone()));
    }
    if out.is_empty() {
        return Err(Error::InvalidEdit(
            "a SmartArt graphic needs at least one node".into(),
        ));
    }
    tree.children = children;
    tree.kinds = kinds;
    Ok(out)
}

/// Adds a drawing part for the data part `data` (laid out as `doc`).
pub(crate) fn add_drawing(
    pres: &mut Presentation,
    slide_part: &str,
    data: &str,
    doc: XmlDoc,
) -> Result<()> {
    let name = write_part(
        pres,
        "/ppt/diagrams/drawing",
        doc.to_bytes(),
        content_types::DRAWING,
    );
    let rid = pres
        .rels_mut(slide_part)?
        .add_internal(rel_type::DIAGRAM_DRAWING, &name);
    let data_doc = pres.xml_mut(data)?;
    let root = data_doc.root();
    let ext = data_doc
        .descendants(root)
        .into_iter()
        .find(|&n| data_doc.local(n) == "dataModelExt");
    match ext {
        Some(e) => data_doc.set_attr(e, "relId", &rid),
        None => {
            let list = match data_doc.child(root, crate::xml::Ns::DGM, "extLst") {
                Some(l) => l,
                None => {
                    let l = data::import(data_doc, "<dgm:extLst/>")?;
                    data_doc.append_child(root, l);
                    l
                }
            };
            let wrapped = format!(
                "<w xmlns:a=\"{A_URI}\"><a:ext uri=\"http://schemas.microsoft.com/office/drawing/2008/diagram\"><dsp:dataModelExt xmlns:dsp=\"{DSP_URI}\" relId=\"{rid}\" minVer=\"{DGM_URI}\"/></a:ext></w>"
            );
            let frag = XmlDoc::parse(wrapped.as_bytes(), "data model extension")?;
            if let Some(first) = frag.first_child(frag.root()) {
                let e = data_doc.import(&frag, first);
                data_doc.append_child(list, e);
            }
        }
    }
    Ok(())
}

/// Creates a SmartArt graphic's parts, related from `slide_part`, and
/// returns the XML of its graphic frame (`id`, named `Diagram {n}`) at
/// `rect` (points). Its drawing is laid out when the batch re-fits.
pub(crate) fn create(
    pres: &mut Presentation,
    slide_part: &str,
    id: u32,
    n: u32,
    spec: &NewSmartArt<'_>,
    [x, y, w, h]: [f32; 4],
) -> Result<String> {
    let info = find_layout(spec.layout)
        .filter(|l| l.kind.is_some())
        .ok_or_else(|| {
            Error::InvalidEdit(format!(
                "unknown or unsupported SmartArt layout `{}`",
                spec.layout
            ))
        })?;
    let kind = info.kind.unwrap_or(Kind::BlockList);
    let colors_key = spec.colors.unwrap_or(catalog::DEFAULT_COLORS);
    let (colors_info, colors_xml) = colors::builtin_xml(colors_key)
        .ok_or_else(|| Error::InvalidEdit(format!("unknown SmartArt colors `{colors_key}`")))?;
    let style_key = spec.style.unwrap_or(catalog::DEFAULT_STYLE);
    let (style_info, style_xml) = quick_style::builtin_xml(style_key)
        .ok_or_else(|| Error::InvalidEdit(format!("unknown SmartArt style `{style_key}`")))?;

    let layout_name = write_part(
        pres,
        "/ppt/diagrams/layout",
        layout_def::xml(info).into_bytes(),
        content_types::LAYOUT,
    );
    let style_name = write_part(
        pres,
        "/ppt/diagrams/quickStyle",
        style_xml.into_bytes(),
        content_types::STYLE,
    );
    let colors_name = write_part(
        pres,
        "/ppt/diagrams/colors",
        colors_xml.into_bytes(),
        content_types::COLORS,
    );
    let drawing_name = write_part(
        pres,
        "/ppt/diagrams/drawing",
        format!(
            "{STANDARD_DECLARATION}<dsp:drawing xmlns:dgm=\"{DGM_URI}\" xmlns:dsp=\"{DSP_URI}\" xmlns:a=\"{A_URI}\"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id=\"0\" name=\"\"/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/></dsp:spTree></dsp:drawing>"
        )
        .into_bytes(),
        content_types::DRAWING,
    );
    let data_name = pres.pkg.unique_part_name("/ppt/diagrams/data", ".xml");
    let (dm, lo, qs, cs, dr) = {
        let r = pres.rels_mut(slide_part)?;
        (
            r.add_internal(rels::DATA, &data_name),
            r.add_internal(rels::LAYOUT, &layout_name),
            r.add_internal(rels::STYLE, &style_name),
            r.add_internal(rels::COLORS, &colors_name),
            r.add_internal(rel_type::DIAGRAM_DRAWING, &drawing_name),
        )
    };

    // The data model: the doc point, then the nodes.
    let ids = pres.pkg.ids().cloned();
    let mut idgen = IdGen::fresh(ids.as_deref(), &data_name);
    let doc_id = idgen.next();
    let skeleton = format!(
        "{STANDARD_DECLARATION}<dgm:dataModel xmlns:dgm=\"{DGM_URI}\" xmlns:a=\"{A_URI}\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><dgm:ptLst><dgm:pt modelId=\"{doc_id}\" type=\"doc\"><dgm:prSet loTypeId=\"{}\" loCatId=\"{}\" qsTypeId=\"{}\" qsCatId=\"simple\" csTypeId=\"{}\" csCatId=\"{}\" phldr=\"1\"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\"/></a:p></dgm:t></dgm:pt></dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri=\"http://schemas.microsoft.com/office/drawing/2008/diagram\"><dsp:dataModelExt xmlns:dsp=\"{DSP_URI}\" relId=\"{dr}\" minVer=\"{DGM_URI}\"/></a:ext></dgm:extLst></dgm:dataModel>",
        esc(&info.id()),
        info.categories[0],
        esc(&style_info.id()),
        esc(&colors_info.id()),
        esc(&colors_info.category),
    );
    let mut doc = XmlDoc::parse(skeleton.as_bytes(), &data_name)?;
    let mut tree = Tree {
        root: doc_id.clone(),
        children: HashMap::new(),
        kinds: HashMap::from([(doc_id, PtKind::Doc)]),
    };
    let entries: Vec<(u8, bool, String)> = match spec.items {
        Some(items) if !items.is_empty() => items
            .iter()
            .map(|i| (i.level, false, i.text.clone()))
            .collect(),
        _ => sample(kind)
            .into_iter()
            .map(|(l, a)| (l, a, String::new()))
            .collect(),
    };
    let mut new = NewNodes::new();
    build(&mut tree, &entries, &mut idgen, &mut new)?;
    data::write_tree(&mut doc, &tree, &new, &mut idgen)?;
    pres.pkg
        .write(&data_name, doc.to_bytes(), Some(content_types::DATA));

    let emu = |pt: f32| pt_to_emu(f64::from(pt.max(0.0)));
    Ok(format!(
        "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"{id}\" name=\"Diagram {n}\"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></p:xfrm><a:graphic><a:graphicData uri=\"{DGM_URI}\"><dgm:relIds xmlns:dgm=\"{DGM_URI}\" r:dm=\"{dm}\" r:lo=\"{lo}\" r:qs=\"{qs}\" r:cs=\"{cs}\"/></a:graphicData></a:graphic></p:graphicFrame>",
        pt_to_emu(f64::from(x)),
        pt_to_emu(f64::from(y)),
        emu(w),
        emu(h),
    ))
}
