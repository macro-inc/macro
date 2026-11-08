//! Generated development callback wire types, independent of JS class objects.
use serde::{Deserialize, Serialize};
use specta::Type;

/// One model-owned mutable node operation dispatched to a JS class.
#[derive(Serialize, Deserialize, Type)]
pub struct HostNodeMutation<Node, Arg> {
    /// Index in the model-derived ForeignHook enum.
    pub hook: u8,
    /// Captured node handle encoded by the shared host identity store.
    pub node: Node,
    /// Positional upstream method arguments encoded for the development host.
    pub args: Vec<Arg>,
}
