//! Adding Figma's types and fields to a file's schema when an edit writes
//! some the file lacks (designs made in Macro carry a subset). Existing
//! types keep their indices and field ids, so the file's records read the
//! same.

use crate::error::Result;
use crate::kiwi::{Kind, Schema, Ty, Writer};
use std::collections::HashMap;

/// A field's type: a primitive (kiwi's negative type codes) or a type by name.
pub(super) enum FieldType {
    Prim(i32),
    Named(&'static str),
}

pub(super) const FLOAT: FieldType = FieldType::Prim(-5);
pub(super) const STRING: FieldType = FieldType::Prim(-6);
pub(super) const BOOL: FieldType = FieldType::Prim(-1);

/// A field: name, type, and whether it is an array.
pub(super) type NewField = (&'static str, FieldType, bool);

/// A type: name, kind, and fields (an enum's values, in order).
pub(super) type NewType = (&'static str, Kind, Vec<NewField>);

/// `bytes` (a schema) with `fields` added to the types they name where
/// those lack them, and the `types` it does not have yet; `None` when it
/// has every field already.
pub(super) fn extend(
    bytes: &[u8],
    fields: Vec<(&'static str, Vec<NewField>)>,
    types: Vec<NewType>,
) -> Result<Option<Vec<u8>>> {
    let schema = Schema::decode(bytes)?;
    let fields: Vec<(u32, Vec<NewField>)> = fields
        .into_iter()
        .filter_map(|(ty, list)| {
            let def = schema.def_index(ty)?;
            let missing: Vec<NewField> = list
                .into_iter()
                .filter(|(name, _, _)| schema.def(def).index_of(name).is_none())
                .collect();
            (!missing.is_empty()).then_some((def, missing))
        })
        .collect();
    if fields.is_empty() {
        return Ok(None);
    }
    let added: Vec<NewType> = types
        .into_iter()
        .filter(|(name, _, _)| schema.def_index(name).is_none())
        .collect();
    let mut index: HashMap<&str, i32> = HashMap::new();
    let count = schema.defs.len();
    for (k, (name, _, _)) in added.iter().enumerate() {
        index.insert(name, (count + k) as i32);
    }
    let resolve = |t: &FieldType| match t {
        FieldType::Prim(p) => Some(*p),
        FieldType::Named(n) => index
            .get(n)
            .copied()
            .or_else(|| schema.def_index(n).map(|d| d as i32)),
    };
    let ty = |t: Ty| match t {
        Ty::Bool => -1,
        Ty::Byte => -2,
        Ty::Int => -3,
        Ty::Uint => -4,
        Ty::Float => -5,
        Ty::String => -6,
        Ty::Int64 => -7,
        Ty::Uint64 => -8,
        Ty::Def(i) => i as i32,
    };
    let kind = |k: Kind| match k {
        Kind::Enum => 0,
        Kind::Struct => 1,
        Kind::Message => 2,
    };
    // Fields whose types this schema cannot name are left out.
    let resolved = |fields: &[NewField]| -> Vec<(&'static str, i32, bool)> {
        fields
            .iter()
            .filter_map(|(name, t, array)| Some((*name, resolve(t)?, *array)))
            .collect()
    };
    let extra: HashMap<u32, Vec<(&'static str, i32, bool)>> = fields
        .iter()
        .map(|(def, list)| (*def, resolved(list)))
        .collect();
    let mut w = Writer::default();
    w.var_uint((count + added.len()) as u32);
    for (k, d) in schema.defs.iter().enumerate() {
        w.string(&d.name);
        w.byte(kind(d.kind));
        let more = extra.get(&(k as u32)).map_or(&[][..], Vec::as_slice);
        w.var_uint((d.fields.len() + more.len()) as u32);
        for f in &d.fields {
            w.string(&f.name);
            w.var_int(ty(f.ty));
            w.byte(u8::from(f.array));
            w.var_uint(f.id);
        }
        let mut next = d.fields.iter().map(|f| f.id).max().unwrap_or(0);
        for (name, t, array) in more {
            next += 1;
            w.string(name);
            w.var_int(*t);
            w.byte(u8::from(*array));
            w.var_uint(next);
        }
    }
    for (name, k, fields) in &added {
        let fields = if *k == Kind::Enum {
            fields.iter().map(|(n, _, _)| (*n, 0, false)).collect()
        } else {
            resolved(fields)
        };
        w.string(name);
        w.byte(kind(*k));
        w.var_uint(fields.len() as u32);
        for (i, (field, t, array)) in fields.iter().enumerate() {
            w.string(field);
            w.var_int(*t);
            w.byte(u8::from(*array));
            // Enum values are their own ids; message fields count from 1.
            w.var_uint(if *k == Kind::Enum {
                i as u32
            } else {
                i as u32 + 1
            });
        }
    }
    Ok(Some(w.bytes))
}
