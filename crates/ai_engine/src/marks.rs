//! Marked content the engine writes so a saved file reads back as it was
//! edited: groups (`/MacroGroup`), edited text (`/MacroText`, written as
//! outlines that other applications draw), paths whose gradients have
//! transparent stops (`/MacroPath`, drawn under soft masks), and hidden
//! objects (inside an optional content group that is off and marked
//! `/MacroHidden`).

use crate::geom::Affine;
use crate::model::{PathNode, TextNode};
use crate::pdf::{Dict, Object, Resolve};
use serde::Serialize;
use serde::de::DeserializeOwned;

/// The tag of a group's marked content.
pub const GROUP: &str = "MacroGroup";
/// The tag of edited text's marked content.
pub const TEXT: &str = "MacroText";
/// The tag of a path drawn under soft masks.
pub const PATH: &str = "MacroPath";
/// The key marking the optional content group of hidden objects.
pub const HIDDEN: &str = "MacroHidden";

/// What a group's marked content says.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GroupMark {
    /// The group's name.
    pub name: String,
    /// The group's first clipping path is its clip.
    pub clip: bool,
}

/// The property list of a group.
pub fn group_props(mark: &GroupMark) -> Dict {
    let mut d = Dict::new();
    d.set("Name", Object::String(crate::pdf::encode_text(&mark.name)));
    d.set("Clip", Object::Bool(mark.clip));
    d
}

/// Reads a group's property list.
pub fn read_group(pdf: &dyn Resolve, props: Option<&Object>) -> GroupMark {
    let Some(d) = props.map(|p| pdf.resolve(p)) else {
        return GroupMark::default();
    };
    let Some(d) = d.as_dict() else {
        return GroupMark::default();
    };
    GroupMark {
        name: d
            .get("Name")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_text())
            .unwrap_or_default(),
        clip: d
            .get("Clip")
            .map(|v| pdf.resolve(v))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

/// A property list holding an object's content (JSON) and its transform
/// to page space.
fn content_props(content: &impl Serialize, to_page: &Affine) -> Dict {
    let json = serde_json::to_string(content).unwrap_or_default();
    let mut d = Dict::new();
    d.set("Data", Object::String(json.into_bytes()));
    d.set(
        "Matrix",
        Object::Array(to_page.0.iter().map(|&v| Object::number(v)).collect()),
    );
    d
}

/// Reads a property list [`content_props`] wrote.
fn read_content<T: DeserializeOwned>(
    pdf: &dyn Resolve,
    props: Option<&Object>,
) -> Option<(T, Affine)> {
    let d = pdf.resolve(props?);
    let d = d.as_dict()?;
    let data = pdf.resolve(d.get("Data")?);
    let content: T = serde_json::from_slice(data.as_bytes()?).ok()?;
    let matrix = pdf
        .resolve(d.get("Matrix")?)
        .as_numbers()
        .and_then(|m| Affine::from_slice(&m))?;
    Some((content, matrix))
}

/// The property list of edited text: the text node (without the file's
/// glyph runs) and its transform to page space.
pub fn text_props(text: &TextNode, to_page: &Affine) -> Dict {
    let mut node = text.clone();
    node.runs = None;
    content_props(&node, to_page)
}

/// Reads edited text's property list: the text node and its transform to
/// page space.
pub fn read_text(pdf: &dyn Resolve, props: Option<&Object>) -> Option<(TextNode, Affine)> {
    read_content(pdf, props)
}

/// The property list of a path drawn under soft masks: the path and its
/// transform to page space.
pub fn path_props(path: &PathNode, to_page: &Affine) -> Dict {
    content_props(path, to_page)
}

/// Reads a masked path's property list.
pub fn read_path(pdf: &dyn Resolve, props: Option<&Object>) -> Option<(PathNode, Affine)> {
    read_content(pdf, props)
}

/// Whether an optional content group holds hidden objects.
pub fn is_hidden_group(pdf: &dyn Resolve, ocg: &Dict) -> bool {
    ocg.get(HIDDEN)
        .map(|v| pdf.resolve(v))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}
