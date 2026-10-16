//! Action descriptors: Photoshop's typed key–value structures (`Objc`,
//! lists, doubles with units, enums, strings, references, raw data), used
//! by effects, text, fills, smart objects, and newer adjustments.
//!
//! Reading and then writing a descriptor gives back its bytes: ids remember
//! whether they were stored as four-character codes or as strings, and
//! references, aliases, object arrays, and paths are kept as stored (they
//! are parsed only to find where they end).

use crate::binary::{Reader, Writer};
use crate::error::{PsdError, Result};
use std::fmt;
use std::ops::Deref;

/// How deep objects and lists may nest.
const MAX_DEPTH: usize = 64;

/// The version blocks write before a descriptor.
pub const VERSION: u32 = 16;

/// A key, class id, or enumeration id, as stored: a four-character code
/// (`Clr `) or a string id (`masterFXSwitch`). Photoshop also stores some
/// four-letter string ids (`warp`) with a length, which an [`Id`] keeps.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Id {
    text: String,
    long: bool,
}

impl Id {
    /// An id stored the usual way: a four-character code when it has four
    /// characters, a string id otherwise.
    pub fn new(text: impl Into<String>) -> Id {
        let text = text.into();
        let long = text.chars().count() != 4;
        Id { text, long }
    }

    /// A string id, stored with its length even when it has four characters.
    pub fn string(text: impl Into<String>) -> Id {
        Id {
            text: text.into(),
            long: true,
        }
    }

    /// The id's characters.
    pub fn as_str(&self) -> &str {
        &self.text
    }

    /// Whether it is stored as a four-character code.
    pub fn is_code(&self) -> bool {
        !self.long
    }
}

impl Deref for Id {
    type Target = str;

    fn deref(&self) -> &str {
        &self.text
    }
}

impl From<&str> for Id {
    fn from(text: &str) -> Id {
        Id::new(text)
    }
}

impl From<String> for Id {
    fn from(text: String) -> Id {
        Id::new(text)
    }
}

impl PartialEq<str> for Id {
    fn eq(&self, other: &str) -> bool {
        self.text == other
    }
}

impl PartialEq<&str> for Id {
    fn eq(&self, other: &&str) -> bool {
        self.text == *other
    }
}

impl fmt::Debug for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.long && self.text.chars().count() == 4 {
            write!(f, "string {:?}", self.text)
        } else {
            write!(f, "{:?}", self.text)
        }
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.text)
    }
}

/// A descriptor: a class and its items, in order.
#[derive(Clone, Debug, PartialEq)]
pub struct Descriptor {
    /// The class's display name.
    pub name: String,
    /// The class id.
    pub class: Id,
    /// Items, in file order.
    pub items: Vec<(Id, Value)>,
}

/// A descriptor value.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// `Objc`: a nested descriptor.
    Descriptor(Descriptor),
    /// `GlbO`: a global object.
    GlobalObject(Descriptor),
    /// `VlLs`: a list.
    List(Vec<Value>),
    /// `doub`.
    Double(f64),
    /// `UntF`: a double with a unit (`#Pxl`, `#Prc`, `#Ang`, `#Pnt`, …).
    UnitDouble(String, f64),
    /// `UnFl`: doubles with a unit.
    UnitFloats(String, Vec<f64>),
    /// `TEXT`.
    Text(String),
    /// `enum`: a type and a value.
    Enum(Id, Id),
    /// `long`.
    Integer(i32),
    /// `comp`.
    LargeInteger(i64),
    /// `bool`.
    Bool(bool),
    /// `type`: a class (display name, class id).
    Class(String, Id),
    /// `GlbC`: a global class (display name, class id).
    GlobalClass(String, Id),
    /// `obj `: a reference, kept as stored (everything after the type).
    Reference(Vec<u8>),
    /// `alis`: an alias's data.
    Alias(Vec<u8>),
    /// `tdta`: raw data.
    RawData(Vec<u8>),
    /// `ObAr`: an object array, kept as stored (everything after the type).
    ObjectArray(Vec<u8>),
    /// `Pth `: a file path's data.
    Path(Vec<u8>),
}

impl Value {
    /// The four-character type code the value is stored with.
    pub fn type_code(&self) -> &'static [u8; 4] {
        match self {
            Value::Descriptor(_) => b"Objc",
            Value::GlobalObject(_) => b"GlbO",
            Value::List(_) => b"VlLs",
            Value::Double(_) => b"doub",
            Value::UnitDouble(..) => b"UntF",
            Value::UnitFloats(..) => b"UnFl",
            Value::Text(_) => b"TEXT",
            Value::Enum(..) => b"enum",
            Value::Integer(_) => b"long",
            Value::LargeInteger(_) => b"comp",
            Value::Bool(_) => b"bool",
            Value::Class(..) => b"type",
            Value::GlobalClass(..) => b"GlbC",
            Value::Reference(_) => b"obj ",
            Value::Alias(_) => b"alis",
            Value::RawData(_) => b"tdta",
            Value::ObjectArray(_) => b"ObAr",
            Value::Path(_) => b"Pth ",
        }
    }

    /// A number: a double, an integer, or a unit double's value.
    pub fn as_number(&self) -> Option<f64> {
        match self {
            Value::Double(v) | Value::UnitDouble(_, v) => Some(*v),
            Value::Integer(v) => Some(f64::from(*v)),
            Value::LargeInteger(v) => Some(*v as f64),
            _ => None,
        }
    }

    /// A unit double's unit and value.
    pub fn as_unit(&self) -> Option<(&str, f64)> {
        match self {
            Value::UnitDouble(unit, v) => Some((unit, *v)),
            _ => None,
        }
    }

    /// A nested descriptor (an object or a global object).
    pub fn as_descriptor(&self) -> Option<&Descriptor> {
        match self {
            Value::Descriptor(d) | Value::GlobalObject(d) => Some(d),
            _ => None,
        }
    }

    /// A nested descriptor, to change.
    pub fn as_descriptor_mut(&mut self) -> Option<&mut Descriptor> {
        match self {
            Value::Descriptor(d) | Value::GlobalObject(d) => Some(d),
            _ => None,
        }
    }

    /// A list's values.
    pub fn as_list(&self) -> Option<&[Value]> {
        match self {
            Value::List(v) => Some(v),
            _ => None,
        }
    }

    /// An enumeration's value.
    pub fn as_enum(&self) -> Option<&str> {
        match self {
            Value::Enum(_, v) => Some(v),
            _ => None,
        }
    }

    /// A string.
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Value::Text(v) => Some(v),
            _ => None,
        }
    }

    /// A boolean.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(v) => Some(*v),
            _ => None,
        }
    }
}

impl Descriptor {
    /// An empty descriptor of a class, with no display name.
    pub fn new(class: impl Into<Id>) -> Descriptor {
        Descriptor {
            name: String::new(),
            class: class.into(),
            items: Vec::new(),
        }
    }

    /// The descriptor with an item added (for building descriptors).
    pub fn with(mut self, key: impl Into<Id>, value: Value) -> Descriptor {
        self.items.push((key.into(), value));
        self
    }

    /// The value of the first item with a key.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.items.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// The value of the first item with a key, to change.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Value> {
        self.items
            .iter_mut()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
    }

    /// Whether an item has the key.
    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Replaces the value of the first item with the key (keeping its
    /// place), or adds the item at the end.
    pub fn set(&mut self, key: impl Into<Id>, value: Value) {
        let key = key.into();
        match self.items.iter_mut().find(|(k, _)| k.text == key.text) {
            Some(item) => item.1 = value,
            None => self.items.push((key, value)),
        }
    }

    /// Removes every item with a key; returns the first one's value.
    pub fn remove(&mut self, key: &str) -> Option<Value> {
        let at = self.items.iter().position(|(k, _)| k == key)?;
        let value = self.items.remove(at).1;
        self.items.retain(|(k, _)| k != key);
        Some(value)
    }

    /// A number item (a double, an integer, or a unit double's value).
    pub fn number(&self, key: &str) -> Option<f64> {
        self.get(key)?.as_number()
    }

    /// A unit double item's unit and value.
    pub fn unit(&self, key: &str) -> Option<(&str, f64)> {
        self.get(key)?.as_unit()
    }

    /// A boolean item.
    pub fn bool(&self, key: &str) -> Option<bool> {
        self.get(key)?.as_bool()
    }

    /// An enumeration item's value.
    pub fn enumeration(&self, key: &str) -> Option<&str> {
        self.get(key)?.as_enum()
    }

    /// A string item.
    pub fn text(&self, key: &str) -> Option<&str> {
        self.get(key)?.as_text()
    }

    /// A nested descriptor item.
    pub fn object(&self, key: &str) -> Option<&Descriptor> {
        self.get(key)?.as_descriptor()
    }

    /// A nested descriptor item, to change.
    pub fn object_mut(&mut self, key: &str) -> Option<&mut Descriptor> {
        self.get_mut(key)?.as_descriptor_mut()
    }

    /// A list item's values.
    pub fn list(&self, key: &str) -> Option<&[Value]> {
        self.get(key)?.as_list()
    }
}

/// Reads a descriptor (without a version prefix); returns it and the bytes
/// it took.
pub fn read(data: &[u8]) -> Result<(Descriptor, usize)> {
    let mut r = Reader::new(data);
    let descriptor = read_descriptor(&mut r, 0)?;
    Ok((descriptor, r.pos()))
}

/// Reads a descriptor after its version (16); returns it and the bytes both
/// took.
pub fn read_versioned(data: &[u8]) -> Result<(Descriptor, usize)> {
    let mut r = Reader::new(data);
    let version = r.u32()?;
    if version != VERSION {
        return Err(PsdError::Unsupported(format!(
            "descriptor version {version}"
        )));
    }
    let descriptor = read_descriptor(&mut r, 0)?;
    Ok((descriptor, r.pos()))
}

/// Writes a descriptor (without a version prefix).
pub fn write(descriptor: &Descriptor) -> Vec<u8> {
    let mut w = Writer::new();
    write_descriptor(&mut w, descriptor);
    w.into_bytes()
}

/// Writes a descriptor after its version (16).
pub fn write_versioned(descriptor: &Descriptor) -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(VERSION);
    write_descriptor(&mut w, descriptor);
    w.into_bytes()
}

/// Writes a descriptor to a writer.
pub(crate) fn write_to(w: &mut Writer, descriptor: &Descriptor) {
    write_descriptor(w, descriptor);
}

fn too_deep() -> PsdError {
    PsdError::corrupt("descriptors nested too deeply")
}

/// Bytes as Latin-1 characters (ids and units are ASCII in practice; this
/// keeps any byte).
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

/// Latin-1 characters as bytes (others become `?`).
fn to_latin1(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?'))
        .collect()
}

fn read_id(r: &mut Reader<'_>) -> Result<Id> {
    let n = r.u32()? as usize;
    if n == 0 {
        Ok(Id {
            text: latin1(r.bytes(4)?),
            long: false,
        })
    } else {
        Ok(Id {
            text: latin1(r.bytes(n)?),
            long: true,
        })
    }
}

fn write_id(w: &mut Writer, id: &Id) {
    let bytes = to_latin1(&id.text);
    if !id.long && bytes.len() == 4 {
        w.u32(0);
    } else {
        w.u32(bytes.len() as u32);
    }
    w.bytes(&bytes);
}

fn read_descriptor(r: &mut Reader<'_>, depth: usize) -> Result<Descriptor> {
    if depth > MAX_DEPTH {
        return Err(too_deep());
    }
    let name = r.unicode()?;
    let class = read_id(r)?;
    let count = r.u32()? as usize;
    // Every item takes at least a key length and a type.
    if count > r.remaining() / 8 {
        return Err(PsdError::corrupt("descriptor item count out of range"));
    }
    let mut items = Vec::with_capacity(count);
    for _ in 0..count {
        let key = read_id(r)?;
        let ty = r.sig()?;
        let value = read_value(r, &ty, depth)?;
        items.push((key, value));
    }
    Ok(Descriptor { name, class, items })
}

fn write_descriptor(w: &mut Writer, d: &Descriptor) {
    w.unicode_nul(&d.name);
    write_id(w, &d.class);
    w.u32(d.items.len() as u32);
    for (key, value) in &d.items {
        write_id(w, key);
        w.sig(value.type_code());
        write_value(w, value);
    }
}

fn read_value(r: &mut Reader<'_>, ty: &[u8; 4], depth: usize) -> Result<Value> {
    Ok(match ty {
        b"Objc" => Value::Descriptor(read_descriptor(r, depth + 1)?),
        b"GlbO" => Value::GlobalObject(read_descriptor(r, depth + 1)?),
        b"VlLs" => {
            if depth >= MAX_DEPTH {
                return Err(too_deep());
            }
            let count = r.u32()? as usize;
            if count > r.remaining() / 4 {
                return Err(PsdError::corrupt("descriptor list length out of range"));
            }
            let mut items = Vec::with_capacity(count);
            for _ in 0..count {
                let ty = r.sig()?;
                items.push(read_value(r, &ty, depth + 1)?);
            }
            Value::List(items)
        }
        b"doub" => Value::Double(r.f64()?),
        b"UntF" => {
            let unit = latin1(&r.sig()?);
            Value::UnitDouble(unit, r.f64()?)
        }
        b"UnFl" => {
            let unit = latin1(&r.sig()?);
            let count = r.u32()? as usize;
            if count > r.remaining() / 8 {
                return Err(PsdError::corrupt("unit float count out of range"));
            }
            let mut values = Vec::with_capacity(count);
            for _ in 0..count {
                values.push(r.f64()?);
            }
            Value::UnitFloats(unit, values)
        }
        b"TEXT" => Value::Text(r.unicode()?),
        b"enum" => {
            let ty = read_id(r)?;
            Value::Enum(ty, read_id(r)?)
        }
        b"long" => Value::Integer(r.i32()?),
        b"comp" => Value::LargeInteger(r.i64()?),
        b"bool" => Value::Bool(r.u8()? != 0),
        b"type" => {
            let name = r.unicode()?;
            Value::Class(name, read_id(r)?)
        }
        b"GlbC" => {
            let name = r.unicode()?;
            Value::GlobalClass(name, read_id(r)?)
        }
        b"obj " => {
            let start = r.pos();
            skip_reference(r)?;
            Value::Reference(r.data()[start..r.pos()].to_vec())
        }
        b"alis" => Value::Alias(read_length_data(r)?),
        b"tdta" => Value::RawData(read_length_data(r)?),
        b"Pth " => Value::Path(read_length_data(r)?),
        b"ObAr" => {
            let start = r.pos();
            r.u32()?;
            read_descriptor(r, depth + 1)?;
            Value::ObjectArray(r.data()[start..r.pos()].to_vec())
        }
        _ => {
            return Err(PsdError::corrupt(format!(
                "unknown descriptor type {:?}",
                latin1(ty)
            )));
        }
    })
}

fn read_length_data(r: &mut Reader<'_>) -> Result<Vec<u8>> {
    let n = r.u32()? as usize;
    Ok(r.bytes(n)?.to_vec())
}

/// Moves past a reference's items.
fn skip_reference(r: &mut Reader<'_>) -> Result<()> {
    let count = r.u32()? as usize;
    if count > r.remaining() / 4 {
        return Err(PsdError::corrupt("reference item count out of range"));
    }
    for _ in 0..count {
        let form = r.sig()?;
        match &form {
            b"prop" => {
                r.unicode()?;
                read_id(r)?;
                read_id(r)?;
            }
            b"Clss" => {
                r.unicode()?;
                read_id(r)?;
            }
            b"Enmr" => {
                r.unicode()?;
                read_id(r)?;
                read_id(r)?;
                read_id(r)?;
            }
            b"rele" => {
                r.unicode()?;
                read_id(r)?;
                r.u32()?;
            }
            b"Idnt" | b"indx" => {
                r.u32()?;
            }
            b"name" => {
                r.unicode()?;
                read_id(r)?;
                r.unicode()?;
            }
            _ => {
                return Err(PsdError::corrupt(format!(
                    "unknown reference form {:?}",
                    latin1(&form)
                )));
            }
        }
    }
    Ok(())
}

fn write_value(w: &mut Writer, value: &Value) {
    match value {
        Value::Descriptor(d) | Value::GlobalObject(d) => write_descriptor(w, d),
        Value::List(items) => {
            w.u32(items.len() as u32);
            for item in items {
                w.sig(item.type_code());
                write_value(w, item);
            }
        }
        Value::Double(v) => w.f64(*v),
        Value::UnitDouble(unit, v) => {
            write_unit(w, unit);
            w.f64(*v);
        }
        Value::UnitFloats(unit, values) => {
            write_unit(w, unit);
            w.u32(values.len() as u32);
            for v in values {
                w.f64(*v);
            }
        }
        Value::Text(s) => w.unicode_nul(s),
        Value::Enum(ty, v) => {
            write_id(w, ty);
            write_id(w, v);
        }
        Value::Integer(v) => w.i32(*v),
        Value::LargeInteger(v) => w.i64(*v),
        Value::Bool(v) => w.u8(u8::from(*v)),
        Value::Class(name, id) | Value::GlobalClass(name, id) => {
            w.unicode_nul(name);
            write_id(w, id);
        }
        Value::Reference(bytes) | Value::ObjectArray(bytes) => w.bytes(bytes),
        Value::Alias(bytes) | Value::RawData(bytes) | Value::Path(bytes) => {
            w.u32(bytes.len() as u32);
            w.bytes(bytes);
        }
    }
}

/// A unit is always four bytes.
fn write_unit(w: &mut Writer, unit: &str) {
    let mut code = [b' '; 4];
    for (slot, b) in code.iter_mut().zip(to_latin1(unit)) {
        *slot = b;
    }
    w.sig(&code);
}

#[cfg(test)]
mod test;
