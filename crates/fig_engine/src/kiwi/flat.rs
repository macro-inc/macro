//! Messages decoded in place, for reading a file's node changes.
//!
//! [`Decoder`](super::Decoder) builds an owned tree (boxed messages, copied
//! strings) that saving can patch. Opening a file only reads each node change
//! once, so it decodes into a [`Flat`] instead: scalars are read, strings and
//! byte arrays stay in the message they arrived in, and nested messages and
//! lists go to flat tables that are cleared and reused for the next node
//! change. Nothing is allocated per value once the tables have grown.
//!
//! Every field also remembers the bytes it was read from, so what is built
//! from a field can be shared between node changes whose field is encoded
//! the same ([`super::MsgRef::shared`]): instances of one component carry
//! identical overrides and derived layout, and most paints repeat.

use super::{Decoder, Field, Kind, MAX_DEPTH, Reader, Schema, Wire};
use crate::error::{Result, corrupt};
use std::any::{Any, TypeId};
use std::cell::RefCell;
use std::hash::Hasher;

/// A value of a [`Flat`] message: scalars, borrowed strings and bytes, and
/// indices into the flat tables.
#[derive(Clone, Copy, Debug)]
pub(crate) enum FlatVal<'d> {
    Bool(bool),
    Uint(u32),
    Int(i32),
    Float(f32),
    Uint64(u64),
    Int64(i64),
    Str(&'d str),
    Bytes(&'d [u8]),
    Enum(u32, u32),
    /// A message, by index into [`Flat::msgs`].
    Msg(u32),
    /// `(start, len)` in [`Flat::items`].
    List(u32, u32),
    /// `(start, len)` in [`Flat::floats`].
    Floats(u32, u32),
    /// `(start, len)` in [`Flat::uints`].
    Uints(u32, u32),
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct FlatField<'d> {
    /// Index into the definition's fields.
    pub index: u16,
    /// Where the value was read: `(start, end)` in the message bytes.
    pub span: (u32, u32),
    pub value: FlatVal<'d>,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct FlatMsg {
    pub def: u32,
    /// `(start, len)` in [`Flat::fields`], sorted by field index.
    pub start: u32,
    pub len: u32,
    /// Bit `index % 128` is set for every field present.
    pub present: u128,
}

/// Node changes decoded in place (see the module docs).
pub struct Flat<'d> {
    pub(crate) data: &'d [u8],
    pub(crate) msgs: Vec<FlatMsg>,
    pub(crate) fields: Vec<FlatField<'d>>,
    pub(crate) items: Vec<FlatVal<'d>>,
    pub(crate) floats: Vec<f32>,
    pub(crate) uints: Vec<u32>,
    /// Fields and list items of the messages being decoded; each message
    /// moves its own to `fields` and `items` when it is complete, so those
    /// stay contiguous per message and per list.
    field_stack: Vec<FlatField<'d>>,
    item_stack: Vec<FlatVal<'d>>,
    pub(crate) shared: RefCell<Shared>,
}

impl<'d> Flat<'d> {
    /// Empty tables for messages read from `data`.
    pub fn new(data: &'d [u8]) -> Self {
        Self {
            data,
            msgs: Vec::new(),
            fields: Vec::new(),
            items: Vec::new(),
            floats: Vec::new(),
            uints: Vec::new(),
            field_stack: Vec::new(),
            item_stack: Vec::new(),
            shared: RefCell::default(),
        }
    }

    /// Forgets the decoded messages (keeping the tables' memory, and what
    /// was shared).
    pub fn clear(&mut self) {
        self.msgs.clear();
        self.fields.clear();
        self.items.clear();
        self.floats.clear();
        self.uints.clear();
    }

    /// Decodes a struct or message of type `def` from `r` (a reader over
    /// this table's data); returns its index for [`super::MsgRef::flat`].
    pub fn decode(&mut self, schema: &Schema, r: &mut Reader<'d>, def: u32) -> Result<u32> {
        debug_assert!(std::ptr::eq(r.bytes, self.data));
        self.decode_at(schema, r, def, 0)
    }

    fn decode_at(
        &mut self,
        schema: &Schema,
        r: &mut Reader<'d>,
        def_index: u32,
        depth: u32,
    ) -> Result<u32> {
        if depth > MAX_DEPTH {
            return Err(corrupt("kiwi: nesting too deep"));
        }
        let def = schema.def(def_index);
        let mark = self.field_stack.len();
        match def.kind {
            Kind::Struct => {
                for (i, field) in def.fields.iter().enumerate() {
                    self.read_field(schema, r, i as u16, field, depth)?;
                }
            }
            Kind::Message => loop {
                let id = r.var_uint()?;
                if id == 0 {
                    break;
                }
                let index = def
                    .index_of_id(id)
                    .ok_or_else(|| corrupt(format!("kiwi: {} has no field {id}", def.name)))?;
                self.read_field(schema, r, index, &def.fields[index as usize], depth)?;
            },
            Kind::Enum => return Err(corrupt("kiwi: an enum is not a message")),
        }
        let own = &mut self.field_stack[mark..];
        // Lookups binary-search by field index. Writers emit fields in
        // declaration order, so this is almost always already true.
        if !own.is_sorted_by_key(|f| f.index) {
            own.sort_by_key(|f| f.index);
        }
        let present = own
            .iter()
            .fold(0u128, |bits, f| bits | (1u128 << (f.index & 127)));
        let start = self.fields.len() as u32;
        let len = own.len() as u32;
        self.fields.extend_from_slice(&self.field_stack[mark..]);
        self.field_stack.truncate(mark);
        self.msgs.push(FlatMsg {
            def: def_index,
            start,
            len,
            present,
        });
        Ok(self.msgs.len() as u32 - 1)
    }

    fn read_field(
        &mut self,
        schema: &Schema,
        r: &mut Reader<'d>,
        index: u16,
        field: &Field,
        depth: u32,
    ) -> Result<()> {
        if !field.keep {
            return Decoder::new(schema).skip_field(r, field, depth);
        }
        let start = r.at as u32;
        let value = self.field(schema, r, field, depth)?;
        self.field_stack.push(FlatField {
            index,
            span: (start, r.at as u32),
            value,
        });
        Ok(())
    }

    fn field(
        &mut self,
        schema: &Schema,
        r: &mut Reader<'d>,
        field: &Field,
        depth: u32,
    ) -> Result<FlatVal<'d>> {
        if !field.array {
            return self.value(schema, r, field.wire, depth);
        }
        let len = r.var_uint()? as usize;
        Ok(match field.wire {
            Wire::Byte => FlatVal::Bytes(r.take(len)?),
            Wire::Float => {
                let start = self.floats.len() as u32;
                for _ in 0..len {
                    self.floats.push(r.float()?);
                }
                FlatVal::Floats(start, len as u32)
            }
            Wire::Uint => {
                let start = self.uints.len() as u32;
                for _ in 0..len {
                    self.uints.push(r.var_uint()?);
                }
                FlatVal::Uints(start, len as u32)
            }
            wire => {
                let mark = self.item_stack.len();
                for _ in 0..len {
                    let v = self.value(schema, r, wire, depth)?;
                    self.item_stack.push(v);
                }
                let start = self.items.len() as u32;
                self.items.extend_from_slice(&self.item_stack[mark..]);
                self.item_stack.truncate(mark);
                FlatVal::List(start, len as u32)
            }
        })
    }

    fn value(
        &mut self,
        schema: &Schema,
        r: &mut Reader<'d>,
        wire: Wire,
        depth: u32,
    ) -> Result<FlatVal<'d>> {
        Ok(match wire {
            Wire::Bool => FlatVal::Bool(r.byte()? != 0),
            Wire::Byte => FlatVal::Uint(u32::from(r.byte()?)),
            Wire::Int => FlatVal::Int(r.var_int()?),
            Wire::Uint => FlatVal::Uint(r.var_uint()?),
            Wire::Float => FlatVal::Float(r.float()?),
            Wire::String => FlatVal::Str(r.string()?),
            Wire::Int64 => {
                let v = r.var_uint64()?;
                FlatVal::Int64(((v >> 1) as i64) ^ -((v & 1) as i64))
            }
            Wire::Uint64 => FlatVal::Uint64(r.var_uint64()?),
            Wire::Enum(i) => FlatVal::Enum(i, r.var_uint()?),
            Wire::Struct(i) | Wire::Message(i) => {
                FlatVal::Msg(self.decode_at(schema, r, i, depth + 1)?)
            }
        })
    }

    /// The field at `index` of message `slot`, if present.
    #[inline]
    pub(crate) fn field_of(&self, slot: u32, index: u16) -> Option<&FlatField<'d>> {
        let m = &self.msgs[slot as usize];
        if m.present & (1u128 << (index & 127)) == 0 {
            return None;
        }
        let fields = &self.fields[m.start as usize..(m.start + m.len) as usize];
        fields
            .binary_search_by_key(&index, |f| f.index)
            .ok()
            .map(|at| &fields[at])
    }
}

/// What was built from fields, by the bytes they were read from.
#[derive(Default)]
pub(crate) struct Shared {
    entries: super::FxMap<u64, Vec<SharedEntry>>,
}

struct SharedEntry {
    def: u32,
    index: u16,
    span: (u32, u32),
    value: Box<dyn Any>,
}

impl Shared {
    pub(crate) fn key<R: 'static>(def: u32, index: u16, bytes: &[u8]) -> u64 {
        let mut h = super::FxHasher::default();
        h.write(bytes);
        h.write_u32(def);
        h.write_u16(index);
        std::hash::Hash::hash(&TypeId::of::<R>(), &mut h);
        h.finish()
    }

    /// The value built from the field `index` of a `def` whose bytes are
    /// `data[span]`, if one was.
    pub(crate) fn get<R: Clone + 'static>(
        &self,
        key: u64,
        def: u32,
        index: u16,
        data: &[u8],
        span: (u32, u32),
    ) -> Option<R> {
        let bytes = &data[span.0 as usize..span.1 as usize];
        self.entries.get(&key)?.iter().find_map(|e| {
            (e.def == def
                && e.index == index
                && data[e.span.0 as usize..e.span.1 as usize] == *bytes)
                .then(|| e.value.downcast_ref::<R>().cloned())
                .flatten()
        })
    }

    pub(crate) fn insert<R: 'static>(
        &mut self,
        key: u64,
        def: u32,
        index: u16,
        span: (u32, u32),
        value: R,
    ) {
        self.entries.entry(key).or_default().push(SharedEntry {
            def,
            index,
            span,
            value: Box::new(value),
        });
    }
}
