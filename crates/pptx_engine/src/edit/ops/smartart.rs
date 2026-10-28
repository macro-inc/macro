//! Values the SmartArt operations take (`addShape` with `smartArt`,
//! `editSmartArt`, and `convertSmartArt`).

use super::nullable;
use serde::{Deserialize, Serialize};

/// One bullet of a SmartArt graphic's text: a node and its outline level.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SmartArtItem {
    /// The node's text (`""` leaves the "[Text]" prompt; `\u{b}` is a line break).
    pub text: String,
    /// Outline level: 1 for top-level shapes, 2 for their sub-bullets (or
    /// child shapes in hierarchies), and so on. The first item must be at
    /// level 1, and each item at most one level below the one before it.
    /// Omitted (or null) means 1.
    #[serde(default, deserialize_with = "nullable")]
    pub level: u8,
}

/// Where `addNode` puts the new node, relative to the given one
/// (PowerPoint's Add Shape After/Before/Above/Below/Add Assistant).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum SmartArtPosition {
    /// The next sibling at the same level (the default).
    #[default]
    After,
    /// The previous sibling at the same level.
    Before,
    /// In the node's place, one level up: the node becomes its child.
    Above,
    /// A new last child of the node, one level down.
    Below,
    /// An assistant of the node (organization charts).
    Assistant,
}

/// One change to a SmartArt graphic.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "action",
    deny_unknown_fields
)]
pub enum SmartArtEdit {
    /// Replaces a node's text, keeping the formatting of its first run
    /// (`\n` separates paragraphs inside the node, `\u{b}` is a line break).
    SetText {
        /// Node id (from the outline's `smartArt.nodes`).
        node: String,
        /// New text.
        text: String,
    },
    /// Adds a node (PowerPoint's Add Shape).
    AddNode {
        /// The node to add next to; omit to add a last top-level node.
        #[serde(default)]
        node: Option<String>,
        /// Where to add it (`after` when omitted).
        #[serde(default, deserialize_with = "nullable")]
        position: SmartArtPosition,
        /// Text of the new node (empty: the "[Text]" prompt).
        #[serde(default, deserialize_with = "nullable")]
        text: String,
    },
    /// Deletes a node; its children move up into its place.
    DeleteNode {
        /// Node id.
        node: String,
    },
    /// Moves a node one level up (Promote, Shift+Tab in the text pane).
    /// Its following siblings become its children.
    Promote {
        /// Node id.
        node: String,
    },
    /// Moves a node one level down (Demote, Tab in the text pane): it
    /// becomes the last child of its previous sibling, with its children.
    Demote {
        /// Node id.
        node: String,
    },
    /// Swaps a node (with its children) with its previous sibling.
    MoveUp {
        /// Node id.
        node: String,
    },
    /// Swaps a node (with its children) with its next sibling.
    MoveDown {
        /// Node id.
        node: String,
    },
    /// Replaces all the text: one node per item, as typed in the text pane.
    /// Existing nodes are reused in order, keeping their formatting.
    SetNodes {
        /// The bullets, in order.
        items: Vec<SmartArtItem>,
    },
    /// Changes the layout (PowerPoint's Layouts gallery), keeping the text.
    SetLayout {
        /// Layout: `default` (Basic Block List), `vList2` (Vertical Bullet
        /// List), `hList1` (Horizontal Bullet List), `process1` (Basic
        /// Process), `chevron1` (Basic Chevron Process), `cycle2` (Basic
        /// Cycle), `radial1` (Basic Radial), `hierarchy1` (Hierarchy),
        /// `orgChart1` (Organization Chart), `venn1` (Basic Venn), or
        /// `pyramid1` (Basic Pyramid); a full id
        /// (`urn:microsoft.com/office/officeart/2005/8/layout/process1`) or
        /// the display name also works.
        layout: String,
    },
    /// Changes the colors (PowerPoint's Change Colors).
    SetColors {
        /// Color variation: `accent0_1` Dark 1 Outline, `accent0_2` Dark 2
        /// Outline, `accent0_3` Dark 2 Fill, `colorful1` Colorful - Accent
        /// Colors, `colorful2`-`colorful5` Colorful Range - Accent Colors
        /// 2 to 3 ... 5 to 6, and for accent N = 1-6: `accentN_1` Colored
        /// Outline, `accentN_2` Colored Fill (PowerPoint's default
        /// `accent1_2`), `accentN_3` Gradient Range, `accentN_4` Gradient
        /// Loop, `accentN_5` Transparent Gradient Range. Full ids
        /// (`urn:microsoft.com/office/officeart/2005/8/colors/colorful1`)
        /// and display names also work.
        colors: String,
    },
    /// Changes the SmartArt style (PowerPoint's SmartArt Styles gallery).
    SetStyle {
        /// Style: `simple1` Simple Fill (the default), `simple2` White
        /// Outline, `simple3` Subtle Effect, `simple4` Moderate Effect, or
        /// `simple5` Intense Effect (or a full id or display name).
        style: String,
    },
    /// Reset Graphic: discards changes to the shapes' sizes, positions, and
    /// formatting, keeping the text, layout, colors, and style.
    Reset,
}

/// What `convertSmartArt` turns a SmartArt graphic into.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub enum SmartArtTarget {
    /// A group of ordinary shapes that look the same (Convert to Shapes).
    Shapes,
    /// A text box with the nodes as a bulleted list (Convert to Text).
    Text,
}
