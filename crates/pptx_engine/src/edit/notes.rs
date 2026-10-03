//! Speaker notes: reading and replacing the notes text of a slide, creating
//! the notes slide (and a notes master) when the deck has none.

use super::slides::{PML_NAMESPACES, PRESENTATION_ORDER, TREE_HEADER};
use super::text;
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::shape::{placeholder_of, sp_tree, tree_children};
use crate::opc::{Relationships, rel_type};
use crate::xml::{NodeId, Ns, STANDARD_DECLARATION, XmlDoc};

const NOTES_SLIDE_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const NOTES_MASTER_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml";
const THEME_TYPE: &str = "application/vnd.openxmlformats-officedocument.theme+xml";

/// The notes body placeholder of a notes slide.
fn notes_body(doc: &XmlDoc) -> Option<NodeId> {
    let tree = sp_tree(doc)?;
    tree_children(doc, tree)
        .into_iter()
        .find(|&n| doc.local(n) == "sp" && placeholder_of(doc, n).is_some_and(|p| p.kind == "body"))
}

fn notes_part(pres: &mut Presentation, slide_part: &str) -> Result<Option<String>> {
    let rels = pres.part_rels(slide_part)?;
    Ok(rels
        .first_of_type(rel_type::NOTES_SLIDE)
        .map(|r| rels.resolve(r))
        .and_then(|n| pres.pkg.canonical_name(&n).map(str::to_owned)))
}

/// The speaker notes of a slide (`\n` between paragraphs), if it has any.
pub fn notes_text(pres: &mut Presentation, slide: u32) -> Result<Option<String>> {
    let part = pres.slide_part(slide)?;
    let Some(notes) = notes_part(pres, &part)? else {
        return Ok(None);
    };
    let doc = pres.xml(&notes)?;
    let Some(body) =
        notes_body(&doc).and_then(|n| doc.children(n).find(|&c| doc.local(c) == "txBody"))
    else {
        return Ok(None);
    };
    let paras: Vec<String> = text::paragraphs(&doc, body)
        .iter()
        .map(|&p| text::para_text(&doc, p))
        .collect();
    let joined = paras.join("\n");
    Ok((!joined.trim().is_empty()).then_some(joined))
}

/// Replaces the speaker notes of a slide.
pub fn set_notes(pres: &mut Presentation, slide: u32, value: &str) -> Result<()> {
    let part = pres.slide_part(slide)?;
    let notes = match notes_part(pres, &part)? {
        Some(n) => n,
        None => create_notes_slide(pres, &part)?,
    };
    let doc = pres.xml_mut(&notes)?;
    let shape = match notes_body(doc) {
        Some(s) => s,
        None => {
            let tree = sp_tree(doc)
                .ok_or_else(|| Error::InvalidEdit("notes slide has no shape tree".into()))?;
            let id = super::xmlutil::max_shape_id(doc) + 1;
            let sp = super::xmlutil::import_fragment(doc, &notes_placeholder_xml(id))?;
            doc.append_child(tree, sp);
            sp
        }
    };
    let body = super::shapes::ensure_tx_body(doc, shape)?;
    text::set_text(doc, body, value)
}

fn notes_placeholder_xml(id: u32) -> String {
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Notes Placeholder {}\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr><p:ph type=\"body\" idx=\"1\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang=\"en-US\" dirty=\"0\"/></a:p></p:txBody></p:sp>",
        id - 1
    )
}

fn create_notes_slide(pres: &mut Presentation, slide_part: &str) -> Result<String> {
    let master = ensure_notes_master(pres)?;
    let part = pres
        .pkg
        .unique_part_name("/ppt/notesSlides/notesSlide", ".xml");
    let xml = format!(
        "{STANDARD_DECLARATION}<p:notes {PML_NAMESPACES}><p:cSld><p:spTree>{TREE_HEADER}<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Slide Image Placeholder 1\"/><p:cNvSpPr><a:spLocks noGrp=\"1\" noRot=\"1\" noChangeAspect=\"1\"/></p:cNvSpPr><p:nvPr><p:ph type=\"sldImg\"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>",
        notes_placeholder_xml(3)
    );
    pres.pkg
        .write(&part, xml.into_bytes(), Some(NOTES_SLIDE_TYPE));
    let mut rels = Relationships::empty(&part);
    rels.add_internal(rel_type::NOTES_MASTER, &master);
    rels.add_internal(rel_type::SLIDE, slide_part);
    pres.put_rels(rels);
    pres.rels_mut(slide_part)?
        .add_internal(rel_type::NOTES_SLIDE, &part);
    Ok(part)
}

/// The notes master, created (with a copy of the deck's theme) when missing.
fn ensure_notes_master(pres: &mut Presentation) -> Result<String> {
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main)?;
    if let Some(existing) = rels
        .first_of_type(rel_type::NOTES_MASTER)
        .map(|r| rels.resolve(r))
        && pres.pkg.has_part(&existing)
    {
        return Ok(existing);
    }
    // The notes master gets its own theme, as PowerPoint writes it.
    let source_theme = rels
        .first_of_type(rel_type::THEME)
        .map(|r| rels.resolve(r))
        .ok_or_else(|| {
            Error::InvalidEdit("the presentation has no theme to base notes on".into())
        })?;
    let theme_bytes = pres.pkg.read(&source_theme)?.into_owned();
    let theme = pres.pkg.unique_part_name("/ppt/theme/theme", ".xml");
    pres.pkg.write(&theme, theme_bytes, Some(THEME_TYPE));

    let master = pres
        .pkg
        .unique_part_name("/ppt/notesMasters/notesMaster", ".xml");
    pres.pkg.write(
        &master,
        notes_master_xml().into_bytes(),
        Some(NOTES_MASTER_TYPE),
    );
    let mut master_rels = Relationships::empty(&master);
    master_rels.add_internal(rel_type::THEME, &theme);
    pres.put_rels(master_rels);

    let rid = pres
        .rels_mut(&main)?
        .add_internal(rel_type::NOTES_MASTER, &master);
    let doc = pres.xml_mut(&main)?;
    let root = doc.root();
    let list = doc.ensure_child(root, Ns::P, "notesMasterIdLst", PRESENTATION_ORDER);
    let id = doc.create_element(Ns::P, "notesMasterId");
    doc.set_attr_ns(id, Ns::R, "id", &rid);
    doc.append_child(list, id);
    Ok(master)
}

fn notes_master_xml() -> String {
    let level = |n: u32| {
        format!(
            "<a:lvl{n}pPr marL=\"{}\" algn=\"l\" defTabSz=\"914400\" rtl=\"0\" eaLnBrk=\"1\" latinLnBrk=\"0\" hangingPunct=\"1\"><a:defRPr sz=\"1200\" kern=\"1200\"><a:solidFill><a:schemeClr val=\"tx1\"/></a:solidFill><a:latin typeface=\"+mn-lt\"/><a:ea typeface=\"+mn-ea\"/><a:cs typeface=\"+mn-cs\"/></a:defRPr></a:lvl{n}pPr>",
            (n - 1) * 457_200
        )
    };
    let styles: String = (1..=9).map(level).collect();
    format!(
        "{STANDARD_DECLARATION}<p:notesMaster {PML_NAMESPACES}><p:cSld><p:bg><p:bgRef idx=\"1001\"><a:schemeClr val=\"bg1\"/></p:bgRef></p:bg><p:spTree>{TREE_HEADER}<p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Slide Image Placeholder 1\"/><p:cNvSpPr><a:spLocks noGrp=\"1\" noRot=\"1\" noChangeAspect=\"1\"/></p:cNvSpPr><p:nvPr><p:ph type=\"sldImg\" idx=\"2\"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"685800\" y=\"1143000\"/><a:ext cx=\"5486400\" cy=\"3086100\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln w=\"12700\"><a:solidFill><a:prstClr val=\"black\"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Notes Placeholder 2\"/><p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr><p:nvPr><p:ph type=\"body\" sz=\"quarter\" idx=\"3\"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"685800\" y=\"4400550\"/><a:ext cx=\"5486400\" cy=\"3600450\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert=\"horz\" lIns=\"91440\" tIns=\"45720\" rIns=\"91440\" bIns=\"45720\" rtlCol=\"0\"/><a:lstStyle/><a:p><a:pPr lvl=\"0\"/><a:r><a:rPr lang=\"en-US\"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/><p:notesStyle>{styles}</p:notesStyle></p:notesMaster>"
    )
}
