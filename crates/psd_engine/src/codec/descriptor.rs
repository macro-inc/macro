//! Action descriptors: Photoshop's typed key–value structures (`Objc`,
//! lists, doubles with units, enums, strings, references, raw data), used
//! by effects, text, fills, smart objects, and newer adjustments.

use crate::error::Result;

/// A descriptor: a class and its items, in order.
#[derive(Clone, Debug, PartialEq)]
pub struct Descriptor {
    /// The class's display name.
    pub name: String,
    /// The class id (a four-character code or a longer string).
    pub class: String,
    /// Items, in file order.
    pub items: Vec<(String, Value)>,
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
    /// `UnFl`: floats with a unit.
    UnitFloats(String, Vec<f32>),
    /// `TEXT`.
    Text(String),
    /// `enum`: a type and a value.
    Enum(String, String),
    /// `long`.
    Integer(i32),
    /// `comp`.
    LargeInteger(i64),
    /// `bool`.
    Bool(bool),
    /// `type` or `GlbC`: a class (display name, class id).
    Class(String, String),
    /// `obj `: a reference, kept as stored.
    Reference(Vec<u8>),
    /// `alis`: an alias, kept as stored.
    Alias(Vec<u8>),
    /// `tdta`: raw data.
    RawData(Vec<u8>),
    /// `ObAr`: an object array, kept as stored.
    ObjectArray(Vec<u8>),
    /// `Pth `: a file path, kept as stored.
    Path(Vec<u8>),
}

impl Descriptor {
    /// The value of the first item with a key.
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.items.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

/// Reads a descriptor (without a version prefix).
pub fn read(data: &[u8]) -> Result<(Descriptor, usize)> {
    let _ = data;
    todo!("descriptor::read")
}

/// Writes a descriptor (without a version prefix).
pub fn write(descriptor: &Descriptor) -> Vec<u8> {
    let _ = descriptor;
    todo!("descriptor::write")
}
