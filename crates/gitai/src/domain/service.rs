use super::ports::{IndexStore, ObjectStore};

/// The git-ai use cases. Inbound adapters call it; it reaches storage only
/// through its ports.
pub struct GitaiService<Objects, Index> {
    #[expect(dead_code, reason = "read by the ingest use cases")]
    objects: Objects,
    #[expect(dead_code, reason = "read by the ingest and read use cases")]
    index: Index,
}

impl<Objects: ObjectStore, Index: IndexStore> GitaiService<Objects, Index> {
    /// A service over the given storage adapters.
    pub fn new(objects: Objects, index: Index) -> Self {
        Self { objects, index }
    }
}
