//! Generated development callback wire types, independent of JS class objects.
use serde::{Deserialize, Serialize};
use specta::Type;

/// One model-owned mutable node operation dispatched to a JS class.
#[derive(Serialize, Deserialize, Type)]
pub struct HostNodeMutation<Node, Arg> {
    /// Index in the model-derived ForeignHook enum.
    pub hook: u8,
    /// Captured node handle, or null for a static import factory without an instance.
    pub node: Node,
    /// Positional upstream method arguments encoded for the development host.
    pub args: Vec<Arg>,
}

/// A clone under construction, distinct from any installed node handle.
#[derive(Serialize, Deserialize, Type)]
pub struct HostCloneNode<Fields> {
    /// Owned initialization metadata, not authority to edit the source graph.
    #[serde(rename = "$clone")]
    pub staging: HostCloneStage<Fields>,
}

/// Framework identity and own fields supplied to a staged constructor.
#[derive(Serialize, Deserialize, Type)]
pub struct HostCloneStage<Fields> {
    /// Destination key, equal to the original for a writable clone.
    pub key: String,
    /// Registered serialized type of the original node.
    #[serde(rename = "type")]
    pub type_name: String,
    /// Copied own payload fields; the class bridge returns the initialized fields.
    pub fields: Fields,
}
