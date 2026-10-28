//! The deck's table styles part (`ppt/tableStyles.xml`). PowerPoint refers
//! to its built-in table styles by GUID and writes the definition of each
//! one a deck uses into this part; edits that apply a built-in style do the
//! same, so other applications render the table as PowerPoint does.

use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::model::table_style::{DEFAULT_TABLE_STYLE, builtin_style, builtin_style_xml};
use crate::opc::rel_type;
use crate::xml::{STANDARD_DECLARATION, XmlDoc};

const TABLE_STYLES_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml";

/// The deck's table styles part, if it has one.
fn styles_part(pres: &mut Presentation) -> Result<Option<String>> {
    let main = pres.main_part.clone();
    let rels = pres.part_rels(&main)?;
    Ok(rels
        .first_of_type(rel_type::TABLE_STYLES)
        .map(|r| rels.resolve(r))
        .filter(|n| pres.pkg.has_part(n)))
}

/// The style id as the deck's table styles part writes it, if it defines `id`.
fn defined_id(doc: &XmlDoc, id: &str) -> Option<String> {
    doc.children(doc.root())
        .filter(|&c| doc.local(c) == "tblStyle")
        .filter_map(|c| doc.attr(c, "styleId"))
        .find(|s| s.trim().eq_ignore_ascii_case(id))
        .map(|s| s.trim().to_owned())
}

/// Creates the table styles part, related from the presentation part.
fn create_part(pres: &mut Presentation) -> Result<String> {
    let name = if pres.pkg.has_part("/ppt/tableStyles.xml") {
        pres.pkg.unique_part_name("/ppt/tableStyles", ".xml")
    } else {
        "/ppt/tableStyles.xml".to_owned()
    };
    let xml = format!(
        "{STANDARD_DECLARATION}<a:tblStyleLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" def=\"{DEFAULT_TABLE_STYLE}\"/>"
    );
    pres.pkg
        .write(&name, xml.into_bytes(), Some(TABLE_STYLES_TYPE));
    let main = pres.main_part.clone();
    pres.rels_mut(&main)?
        .add_internal(rel_type::TABLE_STYLES, &name);
    Ok(name)
}

/// Makes table style `id` available to the deck's tables and returns the id
/// to write: a style the deck defines, or a built-in one, whose definition
/// is added to the table styles part (created when missing) as PowerPoint
/// does.
pub fn define(pres: &mut Presentation, id: &str) -> Result<String> {
    let id = id.trim();
    let part = styles_part(pres)?;
    if let Some(p) = &part
        && let Some(found) = defined_id(&*pres.xml(p)?, id)
    {
        return Ok(found);
    }
    let (Some(builtin), Some(xml)) = (builtin_style(id), builtin_style_xml(id)) else {
        return Err(Error::InvalidEdit(format!(
            "unknown table style `{id}` (use a style id from the deck outline's tableStyles)"
        )));
    };
    let part = match part {
        Some(p) => p,
        None => create_part(pres)?,
    };
    let style = XmlDoc::parse(xml.as_bytes(), "table style")?;
    let doc = pres.xml_mut(&part)?;
    let node = doc.import(&style, style.root());
    let root = doc.root();
    doc.append_child(root, node);
    Ok(builtin.id.to_owned())
}
