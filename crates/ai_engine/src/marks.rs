//! Marked content the engine writes so a saved file reads back as it was
//! edited: groups (`/MacroGroup`), edited text (`/MacroText`, written as
//! outlines that other applications draw), and hidden objects (inside an
//! optional content group that is off and marked `/MacroHidden`).

use crate::geom::Affine;
use crate::model::TextNode;
use crate::pdf::{Dict, Object, Resolve};

/// The tag of a group's marked content.
pub const GROUP: &str = "MacroGroup";
/// The tag of edited text's marked content.
pub const TEXT: &str = "MacroText";
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

/// The property list of edited text: the text node (without the file's
/// glyph runs) and its transform to page space.
pub fn text_props(text: &TextNode, to_page: &Affine) -> Dict {
    let mut node = text.clone();
    node.runs = None;
    let json = serde_json::to_string(&node).unwrap_or_default();
    let mut d = Dict::new();
    d.set("Data", Object::String(json.into_bytes()));
    d.set(
        "Matrix",
        Object::Array(to_page.0.iter().map(|&v| Object::number(v)).collect()),
    );
    d
}

/// Reads edited text's property list: the text node and its transform to
/// page space.
pub fn read_text(pdf: &dyn Resolve, props: Option<&Object>) -> Option<(TextNode, Affine)> {
    let d = pdf.resolve(props?);
    let d = d.as_dict()?;
    let data = pdf.resolve(d.get("Data")?);
    let node: TextNode = serde_json::from_slice(data.as_bytes()?).ok()?;
    let matrix = pdf
        .resolve(d.get("Matrix")?)
        .as_numbers()
        .and_then(|m| Affine::from_slice(&m))?;
    Some((node, matrix))
}

/// Whether an optional content group holds hidden objects.
pub fn is_hidden_group(pdf: &dyn Resolve, ocg: &Dict) -> bool {
    ocg.get(HIDDEN)
        .map(|v| pdf.resolve(v))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}
