//! Kiwi, the binary format Figma documents are written in.
//!
//! Every file carries its own schema, so documents written by any version of
//! Figma decode the same way: fields are looked up by name, and fields this
//! engine does not use are skipped without being materialized. A message is a
//! sequence of `(field id, value)` pairs ending in id 0; a struct is its
//! fields in order; integers are LEB128 varints (zigzag for signed); floats
//! are their IEEE bits rotated so small values encode in one byte.

use crate::error::{Result, corrupt};
use std::cell::Cell;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// FxHash: field names are short and trusted-shape, so a multiply-rotate
/// hash beats SipHash several times over on the lookups decoding does.
#[derive(Default)]
struct FxHasher(u64);

impl Hasher for FxHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        const K: u64 = 0x51_7c_c1_b7_27_22_0a_95;
        let mut chunks = bytes.chunks_exact(8);
        for c in &mut chunks {
            let v = u64::from_le_bytes(c.try_into().unwrap_or_default());
            self.0 = (self.0.rotate_left(5) ^ v).wrapping_mul(K);
        }
        for &b in chunks.remainder() {
            self.0 = (self.0.rotate_left(5) ^ u64::from(b)).wrapping_mul(K);
        }
    }

    #[inline]
    fn finish(&self) -> u64 {
        self.0
    }
}

type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

/// Ids below this are looked up in a dense table; Figma's are all small.
const DENSE_IDS: u32 = 2048;
const NO_FIELD: u16 = u16::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ty {
    Bool,
    Byte,
    Int,
    Uint,
    Float,
    String,
    Int64,
    Uint64,
    Def(u32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Enum,
    Struct,
    Message,
}

#[derive(Debug)]
pub struct Field {
    pub name: String,
    pub ty: Ty,
    pub array: bool,
    /// The field id in messages, the value in enums.
    pub id: u32,
    keep: bool,
}

#[derive(Debug)]
pub struct Def {
    pub name: String,
    pub kind: Kind,
    pub fields: Vec<Field>,
    /// Message field id (or enum value) → index into `fields`, dense for
    /// small ids, with `sparse_ids` for the rest.
    dense_ids: Vec<u16>,
    sparse_ids: HashMap<u32, u16>,
    by_name: FxMap<Box<str>, u16>,
    /// How many fields decoding keeps (bounds a message's field count).
    kept: u16,
}

#[derive(Debug)]
pub struct Schema {
    pub defs: Vec<Def>,
    by_name: HashMap<String, u32>,
    name_cache: Box<[Cell<NameCacheEntry>]>,
}

/// `((name address, name length, def), field index)`.
type NameCacheEntry = ((usize, usize, u32), Option<u16>);
const NAME_CACHE: usize = 1024;

/// A bounds-checked cursor over kiwi bytes.
pub struct Reader<'a> {
    pub bytes: &'a [u8],
    pub at: usize,
}

impl<'a> Reader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    #[inline]
    pub fn byte(&mut self) -> Result<u8> {
        let b = *self
            .bytes
            .get(self.at)
            .ok_or_else(|| corrupt("kiwi: unexpected end of data"))?;
        self.at += 1;
        Ok(b)
    }

    #[inline]
    pub fn var_uint(&mut self) -> Result<u32> {
        let mut shift = 0;
        let mut result: u32 = 0;
        loop {
            let byte = self.byte()?;
            result |= u32::from(byte & 127).wrapping_shl(shift);
            shift += 7;
            if byte & 128 == 0 || shift >= 35 {
                return Ok(result);
            }
        }
    }

    #[inline]
    pub fn var_int(&mut self) -> Result<i32> {
        let v = self.var_uint()?;
        Ok(((v >> 1) as i32) ^ -((v & 1) as i32))
    }

    #[inline]
    pub fn var_uint64(&mut self) -> Result<u64> {
        let mut shift = 0;
        let mut result: u64 = 0;
        loop {
            let byte = self.byte()?;
            result |= u64::from(byte & 127).wrapping_shl(shift);
            shift += 7;
            if byte & 128 == 0 || shift >= 70 {
                return Ok(result);
            }
        }
    }

    #[inline]
    pub fn float(&mut self) -> Result<f32> {
        let first = self.byte()?;
        if first == 0 {
            return Ok(0.0);
        }
        let rest = self
            .bytes
            .get(self.at..self.at + 3)
            .ok_or_else(|| corrupt("kiwi: truncated float"))?;
        self.at += 3;
        let bits = u32::from(first)
            | (u32::from(rest[0]) << 8)
            | (u32::from(rest[1]) << 16)
            | (u32::from(rest[2]) << 24);
        Ok(f32::from_bits(bits.rotate_left(23)))
    }

    pub fn string(&mut self) -> Result<&'a str> {
        let len = self.bytes[self.at..]
            .iter()
            .position(|&b| b == 0)
            .ok_or_else(|| corrupt("kiwi: unterminated string"))?;
        let s = &self.bytes[self.at..self.at + len];
        self.at += len + 1;
        // Figma writes UTF-8; anything else is replaced rather than rejected.
        Ok(std::str::from_utf8(s).unwrap_or("\u{fffd}"))
    }

    fn skip_string(&mut self) -> Result<()> {
        let len = self.bytes[self.at..]
            .iter()
            .position(|&b| b == 0)
            .ok_or_else(|| corrupt("kiwi: unterminated string"))?;
        self.at += len + 1;
        Ok(())
    }

    pub fn take(&mut self, len: usize) -> Result<&'a [u8]> {
        let s = self
            .bytes
            .get(self.at..self.at + len)
            .ok_or_else(|| corrupt("kiwi: truncated byte array"))?;
        self.at += len;
        Ok(s)
    }
}

impl Def {
    fn new(name: String, kind: Kind, fields: Vec<Field>) -> Def {
        let mut dense_ids = Vec::new();
        let mut sparse_ids = HashMap::new();
        let mut by_name = FxMap::default();
        for (i, f) in fields.iter().enumerate() {
            if f.id < DENSE_IDS {
                let at = f.id as usize;
                if dense_ids.len() <= at {
                    dense_ids.resize(at + 1, NO_FIELD);
                }
                dense_ids[at] = i as u16;
            } else {
                sparse_ids.insert(f.id, i as u16);
            }
            by_name.entry(f.name.as_str().into()).or_insert(i as u16);
        }
        let kept = fields.len().min(usize::from(u16::MAX)) as u16;
        Def {
            name,
            kind,
            fields,
            dense_ids,
            sparse_ids,
            by_name,
            kept,
        }
    }

    /// The index of the field with wire id (or enum value) `id`.
    #[inline]
    fn index_of_id(&self, id: u32) -> Option<u16> {
        if id < DENSE_IDS {
            match self.dense_ids.get(id as usize) {
                Some(&i) if i != NO_FIELD => Some(i),
                _ => None,
            }
        } else {
            self.sparse_ids.get(&id).copied()
        }
    }

    /// The index of the field named `name`.
    #[inline]
    pub fn index_of(&self, name: &str) -> Option<u16> {
        self.by_name.get(name).copied()
    }

    /// The message field with wire id `id`.
    pub fn field_by_id(&self, id: u32) -> Option<&Field> {
        self.index_of_id(id).map(|i| &self.fields[i as usize])
    }
}

impl Schema {
    /// Reads a binary kiwi schema.
    pub fn decode(bytes: &[u8]) -> Result<Schema> {
        let mut r = Reader::new(bytes);
        let count = r.var_uint()? as usize;
        let mut defs = Vec::with_capacity(count.min(4096));
        for _ in 0..count {
            let name = r.string()?.to_owned();
            let kind = match r.byte()? {
                0 => Kind::Enum,
                1 => Kind::Struct,
                2 => Kind::Message,
                k => return Err(corrupt(format!("kiwi: unknown definition kind {k}"))),
            };
            let field_count = r.var_uint()? as usize;
            let mut fields = Vec::with_capacity(field_count.min(1024));
            for _ in 0..field_count {
                let name = r.string()?.to_owned();
                let ty = match r.var_int()? {
                    -1 => Ty::Bool,
                    -2 => Ty::Byte,
                    -3 => Ty::Int,
                    -4 => Ty::Uint,
                    -5 => Ty::Float,
                    -6 => Ty::String,
                    -7 => Ty::Int64,
                    -8 => Ty::Uint64,
                    i if i >= 0 => Ty::Def(i as u32),
                    i => return Err(corrupt(format!("kiwi: unknown type {i}"))),
                };
                let array = r.byte()? != 0;
                let id = r.var_uint()?;
                fields.push(Field {
                    name,
                    ty,
                    array,
                    id,
                    keep: true,
                });
            }
            defs.push(Def::new(name, kind, fields));
        }
        for def in &defs {
            for field in &def.fields {
                if let Ty::Def(i) = field.ty
                    && i as usize >= defs.len()
                {
                    return Err(corrupt(format!(
                        "kiwi: {}.{} refers to a missing type",
                        def.name, field.name
                    )));
                }
            }
        }
        let by_name = defs
            .iter()
            .enumerate()
            .map(|(i, d)| (d.name.clone(), i as u32))
            .collect();
        let name_cache = (0..NAME_CACHE)
            .map(|_| Cell::new(((0, 0, u32::MAX), None)))
            .collect();
        Ok(Schema {
            defs,
            by_name,
            name_cache,
        })
    }

    pub fn def_index(&self, name: &str) -> Option<u32> {
        self.by_name.get(name).copied()
    }

    pub fn def(&self, index: u32) -> &Def {
        &self.defs[index as usize]
    }

    /// Decodes only the named fields of messages of type `def_name`; the
    /// rest are skipped. Unknown names are ignored, so one allowlist serves
    /// every schema version.
    pub fn keep_only(&mut self, def_name: &str, keep: &[&str]) {
        if let Some(&i) = self.by_name.get(def_name) {
            let def = &mut self.defs[i as usize];
            for field in &mut def.fields {
                field.keep = keep.contains(&field.name.as_str());
            }
            def.kept = def.fields.iter().filter(|f| f.keep).count() as u16;
        }
    }

    /// The index of `def`'s field named `name`. Callers pass the same
    /// literal names over and over, so a small cache keyed by the name's
    /// address answers most lookups without hashing the name.
    #[inline]
    pub fn field_index(&self, def: u32, name: &str) -> Option<u16> {
        let key = (name.as_ptr() as usize, name.len(), def);
        let slot = ((key.0 >> 3) ^ key.0 >> 11 ^ (def as usize).wrapping_mul(31)) % NAME_CACHE;
        let cached = self.name_cache[slot].get();
        if cached.0 == key {
            return cached.1;
        }
        let index = self.defs[def as usize].index_of(name);
        self.name_cache[slot].set((key, index));
        index
    }

    /// The name of an enum value, if the schema defines it.
    pub fn enum_name(&self, def: u32, value: u32) -> Option<&str> {
        let def = &self.defs[def as usize];
        def.index_of_id(value)
            .map(|i| def.fields[i as usize].name.as_str())
    }
}

/// A decoded kiwi value. Messages keep only the fields the schema keeps.
#[derive(Debug, Clone)]
pub enum Value {
    Bool(bool),
    Uint(u32),
    Int(i32),
    Float(f32),
    Uint64(u64),
    Int64(i64),
    Str(Box<str>),
    Bytes(Box<[u8]>),
    Enum(u32, u32),
    Msg(Box<Msg>),
    List(Vec<Value>),
    Floats(Box<[f32]>),
    Uints(Box<[u32]>),
}

#[derive(Debug, Clone)]
pub struct Msg {
    pub def: u32,
    /// `(index into the definition's fields, value)`, sorted by index.
    pub fields: Vec<(u16, Value)>,
    /// Bit `index % 128` is set for every field present: most lookups are
    /// for absent fields, and this answers them without touching `fields`.
    present: u128,
}

impl Msg {
    /// An empty message (or struct) of type `def`.
    pub fn new(def: u32) -> Msg {
        Msg {
            def,
            fields: Vec::new(),
            present: 0,
        }
    }

    #[inline]
    fn may_have(&self, index: u16) -> bool {
        self.present & (1u128 << (index & 127)) != 0
    }

    fn refresh_present(&mut self) {
        self.present = self
            .fields
            .iter()
            .fold(0u128, |bits, (i, _)| bits | (1u128 << (i & 127)));
    }

    /// Sets the field named `name`, replacing any value it had. Returns
    /// `false` when the type has no such field (older schemas).
    pub fn set(&mut self, schema: &Schema, name: &str, value: Value) -> bool {
        let Some(index) = schema.def(self.def).index_of(name) else {
            return false;
        };
        match self.fields.binary_search_by_key(&index, |(i, _)| *i) {
            Ok(at) => self.fields[at].1 = value,
            Err(at) => self.fields.insert(at, (index, value)),
        }
        self.refresh_present();
        true
    }

    /// Removes the field named `name`.
    pub fn remove(&mut self, schema: &Schema, name: &str) {
        if let Some(index) = schema.def(self.def).index_of(name) {
            self.fields.retain(|(i, _)| *i != index);
            self.refresh_present();
        }
    }

    /// The value of the field named `name`.
    pub fn get(&self, schema: &Schema, name: &str) -> Option<&Value> {
        let index = schema.def(self.def).index_of(name)?;
        self.fields
            .binary_search_by_key(&index, |(i, _)| *i)
            .ok()
            .map(|at| &self.fields[at].1)
    }
}

/// Writes kiwi primitives.
#[derive(Default)]
pub struct Writer {
    pub bytes: Vec<u8>,
}

impl Writer {
    pub fn byte(&mut self, b: u8) {
        self.bytes.push(b);
    }

    pub fn var_uint(&mut self, mut v: u32) {
        loop {
            let byte = (v & 127) as u8;
            v >>= 7;
            if v == 0 {
                self.byte(byte);
                return;
            }
            self.byte(byte | 128);
        }
    }

    pub fn var_uint64(&mut self, mut v: u64) {
        loop {
            let byte = (v & 127) as u8;
            v >>= 7;
            if v == 0 {
                self.byte(byte);
                return;
            }
            self.byte(byte | 128);
        }
    }

    pub fn var_int(&mut self, v: i32) {
        self.var_uint(((v << 1) ^ (v >> 31)) as u32);
    }

    pub fn float(&mut self, v: f32) {
        // The exponent lands in the low byte; a zero exponent (zero and
        // denormals) is written as a single zero byte, as kiwi does.
        let bits = v.to_bits().rotate_right(23);
        if bits & 255 == 0 {
            self.byte(0);
            return;
        }
        self.bytes.extend_from_slice(&bits.to_le_bytes());
    }

    pub fn string(&mut self, s: &str) {
        // Kiwi strings end at a zero byte, so one cannot contain it.
        self.bytes.extend(s.bytes().filter(|&b| b != 0));
        self.byte(0);
    }
}

impl Schema {
    /// Writes `msg` (a message or struct) in this schema.
    pub fn encode(&self, msg: &Msg, w: &mut Writer) {
        let def = self.def(msg.def);
        match def.kind {
            Kind::Struct => {
                for (i, field) in def.fields.iter().enumerate() {
                    match msg.fields.binary_search_by_key(&(i as u16), |(f, _)| *f) {
                        Ok(at) => self.encode_field(field, &msg.fields[at].1, w),
                        Err(_) => self.encode_zero(field, w),
                    }
                }
            }
            Kind::Message => {
                for (i, value) in &msg.fields {
                    let field = &def.fields[*i as usize];
                    w.var_uint(field.id);
                    self.encode_field(field, value, w);
                }
                w.var_uint(0);
            }
            Kind::Enum => {}
        }
    }

    fn encode_field(&self, field: &Field, value: &Value, w: &mut Writer) {
        if !field.array {
            self.encode_value(field.ty, value, w);
            return;
        }
        match value {
            Value::Bytes(b) => {
                w.var_uint(b.len() as u32);
                w.bytes.extend_from_slice(b);
            }
            Value::Floats(v) => {
                w.var_uint(v.len() as u32);
                for &f in v.iter() {
                    w.float(f);
                }
            }
            Value::Uints(v) => {
                w.var_uint(v.len() as u32);
                for &u in v.iter() {
                    w.var_uint(u);
                }
            }
            Value::List(items) => {
                w.var_uint(items.len() as u32);
                for item in items {
                    self.encode_value(field.ty, item, w);
                }
            }
            _ => w.var_uint(0),
        }
    }

    fn encode_value(&self, ty: Ty, value: &Value, w: &mut Writer) {
        match (ty, value) {
            (Ty::Bool, Value::Bool(b)) => w.byte(u8::from(*b)),
            (Ty::Byte, Value::Uint(v)) => w.byte(*v as u8),
            (Ty::Int, Value::Int(v)) => w.var_int(*v),
            (Ty::Uint, Value::Uint(v)) => w.var_uint(*v),
            (Ty::Float, Value::Float(v)) => w.float(*v),
            (Ty::String, Value::Str(s)) => w.string(s),
            (Ty::Int64, Value::Int64(v)) => w.var_uint64(((v << 1) ^ (v >> 63)) as u64),
            (Ty::Uint64, Value::Uint64(v)) => w.var_uint64(*v),
            (Ty::Def(_), Value::Enum(_, v)) => w.var_uint(*v),
            (Ty::Def(_), Value::Msg(m)) => self.encode(m, w),
            // A value of the wrong shape (a caller bug) writes as zero so
            // the stream stays well formed.
            (ty, _) => self.encode_zero_ty(ty, w),
        }
    }

    fn encode_zero(&self, field: &Field, w: &mut Writer) {
        if field.array {
            w.var_uint(0);
        } else {
            self.encode_zero_ty(field.ty, w);
        }
    }

    fn encode_zero_ty(&self, ty: Ty, w: &mut Writer) {
        match ty {
            Ty::Bool | Ty::Byte | Ty::Float | Ty::String => w.byte(0),
            Ty::Int | Ty::Uint | Ty::Int64 | Ty::Uint64 => w.var_uint(0),
            Ty::Def(i) => match self.def(i).kind {
                Kind::Enum => w.var_uint(0),
                _ => self.encode(&Msg::new(i), w),
            },
        }
    }

    /// An enum value by name, if `def_name` defines it.
    pub fn enum_value(&self, def_name: &str, value: &str) -> Option<Value> {
        let def = self.def_index(def_name)?;
        let field = self.def(def).fields.iter().find(|f| f.name == value)?;
        Some(Value::Enum(def, field.id))
    }

    /// The type of the field `name` of `def` (for building nested values).
    pub fn field_def(&self, def: u32, name: &str) -> Option<u32> {
        let i = self.def(def).index_of(name)?;
        match self.def(def).fields[i as usize].ty {
            Ty::Def(d) => Some(d),
            _ => None,
        }
    }

    /// Encodes the schema itself, in kiwi's binary schema format.
    pub fn encode_schema(&self) -> Vec<u8> {
        let mut w = Writer::default();
        w.var_uint(self.defs.len() as u32);
        for d in &self.defs {
            w.string(&d.name);
            w.byte(match d.kind {
                Kind::Enum => 0,
                Kind::Struct => 1,
                Kind::Message => 2,
            });
            w.var_uint(d.fields.len() as u32);
            for f in &d.fields {
                w.string(&f.name);
                w.var_int(match f.ty {
                    Ty::Bool => -1,
                    Ty::Byte => -2,
                    Ty::Int => -3,
                    Ty::Uint => -4,
                    Ty::Float => -5,
                    Ty::String => -6,
                    Ty::Int64 => -7,
                    Ty::Uint64 => -8,
                    Ty::Def(i) => i as i32,
                });
                w.byte(u8::from(f.array));
                w.var_uint(f.id);
            }
        }
        w.bytes
    }
}

/// Nesting deeper than this is treated as corruption (it would otherwise
/// overflow the stack on hostile input).
const MAX_DEPTH: u32 = 256;

pub struct Decoder<'s> {
    pub schema: &'s Schema,
}

impl<'s> Decoder<'s> {
    pub fn new(schema: &'s Schema) -> Self {
        Self { schema }
    }

    /// Decodes a struct or message of type `def`.
    pub fn decode(&self, r: &mut Reader, def: u32) -> Result<Msg> {
        self.decode_at(r, def, 0)
    }

    fn decode_at(&self, r: &mut Reader, def_index: u32, depth: u32) -> Result<Msg> {
        if depth > MAX_DEPTH {
            return Err(corrupt("kiwi: nesting too deep"));
        }
        let def = self.schema.def(def_index);
        // Most messages set a handful of their fields; start near that.
        let mut fields = Vec::with_capacity(usize::from(def.kept).min(12));
        match def.kind {
            Kind::Struct => {
                for (i, field) in def.fields.iter().enumerate() {
                    if field.keep {
                        fields.push((i as u16, self.field(r, field, depth)?));
                    } else {
                        self.skip_field(r, field, depth)?;
                    }
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
                let field = &def.fields[index as usize];
                if field.keep {
                    fields.push((index, self.field(r, field, depth)?));
                } else {
                    self.skip_field(r, field, depth)?;
                }
            },
            Kind::Enum => return Err(corrupt("kiwi: an enum is not a message")),
        }
        // Lookups binary-search by field index. Writers emit fields in
        // declaration order, so this is almost always already true.
        if !fields.is_sorted_by_key(|(i, _)| *i) {
            fields.sort_by_key(|(i, _)| *i);
        }
        let present = fields
            .iter()
            .fold(0u128, |bits, (i, _)| bits | (1u128 << (i & 127)));
        Ok(Msg {
            def: def_index,
            fields,
            present,
        })
    }

    pub fn field(&self, r: &mut Reader, field: &Field, depth: u32) -> Result<Value> {
        if !field.array {
            return self.value(r, field.ty, depth);
        }
        let len = r.var_uint()? as usize;
        match field.ty {
            Ty::Byte => Ok(Value::Bytes(r.take(len)?.into())),
            Ty::Float => {
                let mut v = Vec::with_capacity(len.min(r.bytes.len()));
                for _ in 0..len {
                    v.push(r.float()?);
                }
                Ok(Value::Floats(v.into()))
            }
            Ty::Uint => {
                let mut v = Vec::with_capacity(len.min(r.bytes.len()));
                for _ in 0..len {
                    v.push(r.var_uint()?);
                }
                Ok(Value::Uints(v.into()))
            }
            ty => {
                let mut v = Vec::with_capacity(len.min(r.bytes.len()));
                for _ in 0..len {
                    v.push(self.value(r, ty, depth)?);
                }
                Ok(Value::List(v))
            }
        }
    }

    fn value(&self, r: &mut Reader, ty: Ty, depth: u32) -> Result<Value> {
        Ok(match ty {
            Ty::Bool => Value::Bool(r.byte()? != 0),
            Ty::Byte => Value::Uint(u32::from(r.byte()?)),
            Ty::Int => Value::Int(r.var_int()?),
            Ty::Uint => Value::Uint(r.var_uint()?),
            Ty::Float => Value::Float(r.float()?),
            Ty::String => Value::Str(r.string()?.into()),
            Ty::Int64 => {
                let v = r.var_uint64()?;
                Value::Int64(((v >> 1) as i64) ^ -((v & 1) as i64))
            }
            Ty::Uint64 => Value::Uint64(r.var_uint64()?),
            Ty::Def(i) => match self.schema.def(i).kind {
                Kind::Enum => Value::Enum(i, r.var_uint()?),
                _ => Value::Msg(Box::new(self.decode_at(r, i, depth + 1)?)),
            },
        })
    }

    pub fn skip_field(&self, r: &mut Reader, field: &Field, depth: u32) -> Result<()> {
        if !field.array {
            return self.skip(r, field.ty, depth);
        }
        let len = r.var_uint()? as usize;
        if field.ty == Ty::Byte {
            r.take(len)?;
            return Ok(());
        }
        for _ in 0..len {
            self.skip(r, field.ty, depth)?;
        }
        Ok(())
    }

    pub fn skip(&self, r: &mut Reader, ty: Ty, depth: u32) -> Result<()> {
        match ty {
            Ty::Bool | Ty::Byte => {
                r.byte()?;
            }
            Ty::Int | Ty::Uint => {
                r.var_uint()?;
            }
            Ty::Float => {
                r.float()?;
            }
            Ty::String => r.skip_string()?,
            Ty::Int64 | Ty::Uint64 => {
                r.var_uint64()?;
            }
            Ty::Def(i) => {
                if depth > MAX_DEPTH {
                    return Err(corrupt("kiwi: nesting too deep"));
                }
                let def = self.schema.def(i);
                match def.kind {
                    Kind::Enum => {
                        r.var_uint()?;
                    }
                    Kind::Struct => {
                        for field in &def.fields {
                            self.skip_field(r, field, depth + 1)?;
                        }
                    }
                    Kind::Message => loop {
                        let id = r.var_uint()?;
                        if id == 0 {
                            break;
                        }
                        let index = def.index_of_id(id).ok_or_else(|| {
                            corrupt(format!("kiwi: {} has no field {id}", def.name))
                        })?;
                        self.skip_field(r, &def.fields[index as usize], depth + 1)?;
                    },
                }
            }
        }
        Ok(())
    }
}

/// Typed, by-name access to a decoded message.
#[derive(Clone, Copy)]
pub struct MsgRef<'a> {
    pub schema: &'a Schema,
    pub msg: &'a Msg,
}

/// A value together with the schema needed to interpret it.
#[derive(Clone, Copy)]
pub struct ValRef<'a> {
    pub schema: &'a Schema,
    pub value: &'a Value,
}

impl<'a> MsgRef<'a> {
    pub fn new(schema: &'a Schema, msg: &'a Msg) -> Self {
        Self { schema, msg }
    }

    pub fn get(&self, name: &str) -> Option<ValRef<'a>> {
        if self.msg.fields.is_empty() {
            return None;
        }
        let index = self.schema.field_index(self.msg.def, name)?;
        if !self.msg.may_have(index) {
            return None;
        }
        let fields = &self.msg.fields;
        fields
            .binary_search_by_key(&index, |(i, _)| *i)
            .ok()
            .map(|at| ValRef {
                schema: self.schema,
                value: &fields[at].1,
            })
    }

    pub fn has(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    pub fn def_name(&self) -> &'a str {
        &self.schema.def(self.msg.def).name
    }

    pub fn msg(&self, name: &str) -> Option<MsgRef<'a>> {
        self.get(name).and_then(|v| v.as_msg())
    }

    pub fn f32(&self, name: &str) -> Option<f32> {
        self.get(name).and_then(|v| v.as_f32())
    }

    pub fn u32(&self, name: &str) -> Option<u32> {
        self.get(name).and_then(|v| v.as_u32())
    }

    pub fn i32(&self, name: &str) -> Option<i32> {
        self.get(name).and_then(|v| v.as_i32())
    }

    pub fn bool(&self, name: &str) -> Option<bool> {
        self.get(name).and_then(|v| v.as_bool())
    }

    pub fn str(&self, name: &str) -> Option<&'a str> {
        self.get(name).and_then(|v| v.as_str())
    }

    pub fn enum_name(&self, name: &str) -> Option<&'a str> {
        self.get(name).and_then(|v| v.as_enum())
    }

    pub fn bytes(&self, name: &str) -> Option<&'a [u8]> {
        self.get(name).and_then(|v| v.as_bytes())
    }

    pub fn list(&self, name: &str) -> impl Iterator<Item = ValRef<'a>> + 'a {
        let schema = self.schema;
        self.get(name)
            .and_then(|v| match v.value {
                Value::List(items) => Some(items.iter()),
                _ => None,
            })
            .into_iter()
            .flatten()
            .map(move |value| ValRef { schema, value })
    }

    pub fn msgs(&self, name: &str) -> impl Iterator<Item = MsgRef<'a>> + 'a {
        self.list(name).filter_map(|v| v.as_msg())
    }

    pub fn floats(&self, name: &str) -> Option<&'a [f32]> {
        match self.get(name)?.value {
            Value::Floats(v) => Some(v),
            _ => None,
        }
    }

    pub fn uints(&self, name: &str) -> Option<&'a [u32]> {
        match self.get(name)?.value {
            Value::Uints(v) => Some(v),
            _ => None,
        }
    }
}

impl<'a> ValRef<'a> {
    pub fn as_msg(&self) -> Option<MsgRef<'a>> {
        match self.value {
            Value::Msg(m) => Some(MsgRef {
                schema: self.schema,
                msg: m,
            }),
            _ => None,
        }
    }

    pub fn as_f32(&self) -> Option<f32> {
        match *self.value {
            Value::Float(f) => Some(f),
            Value::Int(i) => Some(i as f32),
            Value::Uint(u) => Some(u as f32),
            _ => None,
        }
    }

    pub fn as_u32(&self) -> Option<u32> {
        match *self.value {
            Value::Uint(u) => Some(u),
            Value::Int(i) if i >= 0 => Some(i as u32),
            Value::Enum(_, v) => Some(v),
            _ => None,
        }
    }

    pub fn as_i32(&self) -> Option<i32> {
        match *self.value {
            Value::Int(i) => Some(i),
            Value::Uint(u) => i32::try_from(u).ok(),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match *self.value {
            Value::Uint64(u) => Some(u),
            Value::Uint(u) => Some(u64::from(u)),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match *self.value {
            Value::Bool(b) => Some(b),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&'a str> {
        match self.value {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_enum(&self) -> Option<&'a str> {
        match *self.value {
            Value::Enum(def, v) => self.schema.enum_name(def, v),
            _ => None,
        }
    }

    pub fn as_bytes(&self) -> Option<&'a [u8]> {
        match self.value {
            Value::Bytes(b) => Some(b),
            _ => None,
        }
    }
}

struct DefSpec {
    name: String,
    kind: Kind,
    fields: Vec<(String, String, bool)>,
}

fn parse_spec(text: &str) -> Vec<DefSpec> {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let mut words = line.split_whitespace();
            let kind = match words.next() {
                Some("enum") => Kind::Enum,
                Some("struct") => Kind::Struct,
                _ => Kind::Message,
            };
            let name = words.next().unwrap_or_default().to_owned();
            let fields = words
                .map(|w| match w.split_once(':') {
                    Some((field, ty)) => {
                        let array = ty.ends_with("[]");
                        (
                            field.to_owned(),
                            ty.trim_end_matches("[]").to_owned(),
                            array,
                        )
                    }
                    None => (w.to_owned(), String::new(), false),
                })
                .collect();
            DefSpec { name, kind, fields }
        })
        .collect()
}

/// Encodes a schema written in a compact text form, one type per line:
/// `enum Name A B C`, `struct Name field:type …`, or `message Name
/// field:type[] …`, where types are kiwi primitives or other type names.
pub fn schema_from_text(text: &str) -> Vec<u8> {
    let specs = parse_spec(text);
    let index = |name: &str| {
        specs
            .iter()
            .position(|d| d.name == name)
            .unwrap_or_else(|| panic!("unknown type {name}")) as i32
    };
    let mut w = Writer::default();
    w.var_uint(specs.len() as u32);
    for d in &specs {
        w.string(&d.name);
        w.byte(match d.kind {
            Kind::Enum => 0,
            Kind::Struct => 1,
            Kind::Message => 2,
        });
        w.var_uint(d.fields.len() as u32);
        for (i, (name, ty, array)) in d.fields.iter().enumerate() {
            w.string(name);
            w.var_int(match ty.as_str() {
                "" => 0,
                "bool" => -1,
                "byte" => -2,
                "int" => -3,
                "uint" => -4,
                "float" => -5,
                "string" => -6,
                "int64" => -7,
                "uint64" => -8,
                other => index(other),
            });
            w.byte(u8::from(*array));
            // Message field ids start at 1; enum values at 0.
            w.var_uint(if d.kind == Kind::Enum {
                i as u32
            } else {
                i as u32 + 1
            });
        }
    }
    w.bytes
}

#[cfg(test)]
mod test;
