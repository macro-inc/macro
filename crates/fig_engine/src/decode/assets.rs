//! Resolves library variable references to the copies embedded in this file.

use crate::error::{Result, corrupt};
use crate::kiwi::{Decoder, Flat, MsgRef, Reader, Schema, Ty};
use crate::model::Guid;
use std::collections::HashMap;

#[cfg(test)]
mod test;

#[derive(Default)]
pub(crate) struct AssetIds(HashMap<String, Guid>);

impl AssetIds {
    /// Read only identity and library keys, before decoding any references.
    /// This also works when a referenced asset occurs after its consumer.
    pub(crate) fn read(schema_bytes: &[u8], data: &[u8]) -> Result<Self> {
        let mut schema = Schema::decode(schema_bytes)?;
        schema.keep_only("NodeChange", &["guid", "key", "phase"]);
        let root = schema
            .def_index("Message")
            .ok_or_else(|| corrupt("the schema has no Message type"))?;
        let decoder = Decoder::new(&schema);
        let mut reader = Reader::new(data);
        let mut flat = Flat::new(data);
        let mut ids = Self::default();
        loop {
            let id = reader.var_uint()?;
            if id == 0 {
                break;
            }
            let field = schema
                .def(root)
                .field_by_id(id)
                .ok_or_else(|| corrupt(format!("kiwi: Message has no field {id}")))?;
            if let ("nodeChanges", Ty::Def(def), true) =
                (field.name.as_str(), field.ty, field.array)
            {
                for _ in 0..reader.var_uint()? {
                    flat.clear();
                    let slot = flat.decode(&schema, &mut reader, def)?;
                    let m = MsgRef::flat(&schema, &flat, slot);
                    if !super::is_removed(&m)
                        && let Some(key) = m.str("key")
                        && let Some(guid) = m.msg("guid").and_then(super::guid)
                    {
                        ids.0.insert(key.to_owned(), guid);
                    }
                }
            } else {
                decoder.skip_field(&mut reader, field, 0)?;
            }
        }
        Ok(ids)
    }

    pub(crate) fn resolve(&self, reference: MsgRef) -> Option<Guid> {
        reference.msg("guid").and_then(super::guid).or_else(|| {
            let key = reference.msg("assetRef")?.str("key")?;
            self.0.get(key).copied()
        })
    }
}
