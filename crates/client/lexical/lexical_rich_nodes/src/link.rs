//! Links, automatic links and their model transforms.
pub mod node;
pub mod toggle;
pub mod transform;
use lexical_model::*;
pub use node::*;
pub use toggle::*;
type Result<T> = std::result::Result<T, Error>;
fn link_id(st: &impl Read, key: NodeKey) -> Result<Id<LinkNode>> {
    st.view().cast(key).ok_or(Error::NodeTypeMismatch(key))
}


