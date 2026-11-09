//! Native scalar wrappers and typed recursive JSON-shaped data.
use crate::*;

/// Both clocks sampled once before admitting a host input.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiNow {
    /// Session-relative monotonic milliseconds.
    pub mono_ms: u64,
    /// Unix wall-clock milliseconds.
    pub wall_ms: i64,
}
impl From<FfiNow> for Now {
    fn from(value: FfiNow) -> Self {
        Self {
            mono: Millis(value.mono_ms),
            wall: UnixMillis(value.wall_ms),
        }
    }
}
uniffi::custom_type!(NodeKey,KeyParts,{remote,lower:|k|k.parts(),try_lift:|p|Ok(NodeKey::from_parts(p))});
uniffi::custom_type!(Utf16Offset,u32,{remote,lower:|v|v.0,try_lift:|v|Ok(Utf16Offset(v))});
uniffi::custom_type!(ChildIndex,u32,{remote,lower:|v|v.0,try_lift:|v|Ok(ChildIndex(v))});
uniffi::custom_type!(TextFormat,u32,{remote,lower:|v|v.bits(),try_lift:|v|TextFormat::from_bits(v).ok_or_else(||invalid("invalid format bits").into())});
uniffi::custom_type!(TextDetail,u32,{remote,lower:|v|v.bits(),try_lift:|v|TextDetail::from_bits(v).ok_or_else(||invalid("invalid text detail bits").into())});
uniffi::custom_type!(NodeTypeIndex,u16,{remote,lower:|v|v.get(),try_lift:|v|Ok(NodeTypeIndex::from_raw(v))});
uniffi::custom_type!(Millis,u64,{remote,lower:|v|v.0,try_lift:|v|Ok(Millis(v))});
uniffi::custom_type!(UnixMillis,i64,{remote,lower:|v|v.0,try_lift:|v|Ok(UnixMillis(v))});
uniffi::custom_type!(SessionId,String,{remote,lower:|v|v.0.to_string(),try_lift:|v|serde_json::from_value(serde_json::Value::String(v)).map_err(|e|invalid(e).into())});
uniffi::custom_type!(UserKey,String,{remote,lower:|v|v.0,try_lift:|v|Ok(UserKey(v))});
uniffi::custom_type!(WalSeq,u64,{remote,lower:|v|v.0,try_lift:|v|Ok(WalSeq(v))});
uniffi::custom_type!(SyncDocId,String,{remote,lower:|v|v.to_string(),try_lift:|v|SyncDocId::new(v).map_err(|e|invalid(e).into())});
uniffi::custom_type!(SyncToken,String,{remote,lower:|v|v.expose_secret().to_owned(),try_lift:|v|Ok(SyncToken::new(v))});
uniffi::custom_type!(StorageOpId,u32,{remote,lower:|v|v.0,try_lift:|v|Ok(StorageOpId(v))});
uniffi::custom_type!(RequestId,u32,{remote,lower:|v|v.0,try_lift:|v|Ok(RequestId(v))});
uniffi::custom_type!(ConnId,u32,{remote,lower:|v|v.0,try_lift:|v|Ok(ConnId(v))});
/// An exact durable owner prefix covered by a snapshot.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiWalCover {
    /// Owner whose rows are covered.
    pub owner: SessionId,
    /// Inclusive covered sequence number.
    pub seq: WalSeq,
}
/// Native snapshot coverage tuple.
pub type WalCover = (SessionId, WalSeq);
uniffi::custom_type!(WalCover,FfiWalCover,{remote,lower:|v|FfiWalCover{owner:v.0,seq:v.1},try_lift:|v|Ok((v.owner,v.seq))});
/// Recursive typed document values; no transport serialization is used.
#[derive(Clone, Debug, uniffi::Enum)]
pub enum FfiValue {
    /// Null scalar.
    Null,
    /// Boolean scalar.
    Bool {
        /// Scalar value.
        value: bool,
    },
    /// Finite floating point scalar.
    Number {
        /// Scalar value.
        value: f64,
    },
    /// Exact decimal JSON number outside the host numeric representation.
    NumberLiteral {
        /// JSON numeric literal, validated when lifted.
        value: String,
    },
    /// Exact signed integer.
    Int {
        /// Scalar value.
        value: i64,
    },
    /// Exact unsigned JSON integer.
    Unsigned {
        /// Scalar value.
        value: u64,
    },
    /// Existing native container reference.
    ContainerId {
        /// Stable container identity.
        value: String,
    },
    /// UTF-8 text.
    Text {
        /// Scalar value.
        value: String,
    },
    /// Opaque bytes.
    Bytes {
        /// Scalar value.
        value: Vec<u8>,
    },
    /// Ordered scalar sequence.
    Array {
        /// Child values.
        values: Vec<FfiValue>,
    },
    /// Scalar map.
    Map {
        /// Entries; JSON property order is preserved.
        entries: Vec<FfiValueEntry>,
    },
    /// Attached container creation marker, allowed only at insertion roots.
    NewContainer {
        /// Native container kind.
        kind: ContainerKind,
    },
}
/// One ordered value-map entry.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiValueEntry {
    /// Entry name.
    pub key: String,
    /// Entry contents.
    pub value: FfiValue,
}
impl From<DocValue> for FfiValue {
    fn from(v: DocValue) -> Self {
        match v {
            DocValue::Null => Self::Null,
            DocValue::Bool(value) => Self::Bool { value },
            DocValue::Number(value) => Self::Number { value },
            DocValue::Int(value) => Self::Int { value },
            DocValue::String(value) => Self::Text { value },
            DocValue::Bytes(value) => Self::Bytes { value },
            DocValue::List(values) => Self::Array {
                values: values.into_iter().map(Into::into).collect(),
            },
            DocValue::Map(values) => Self::Map {
                entries: values
                    .into_iter()
                    .map(|(key, value)| FfiValueEntry {
                        key,
                        value: value.into(),
                    })
                    .collect(),
            },
            DocValue::NewContainer(kind) => Self::NewContainer { kind },
        }
    }
}
impl TryFrom<FfiValue> for DocValue {
    type Error = FfiSessionError;
    fn try_from(v: FfiValue) -> Result<Self, Self::Error> {
        Ok(match v {
            FfiValue::Null => Self::Null,
            FfiValue::Bool { value } => Self::Bool(value),
            FfiValue::Number { value } if value.is_finite() => Self::Number(value),
            FfiValue::Number { .. } => return Err(invalid("non-finite number")),
            FfiValue::Int { value } => Self::Int(value),
            FfiValue::Unsigned { value } => Self::Int(i64::try_from(value).map_err(invalid)?),
            FfiValue::NumberLiteral { .. } => {
                return Err(invalid("JSON number is not a document scalar"));
            }
            FfiValue::ContainerId { .. } => {
                return Err(invalid("existing container is not a plain value"));
            }
            FfiValue::Text { value } => Self::String(value),
            FfiValue::Bytes { value } => Self::Bytes(value),
            FfiValue::Array { values } => Self::List(
                values
                    .into_iter()
                    .map(TryInto::try_into)
                    .collect::<Result<_, _>>()?,
            ),
            FfiValue::Map { entries } => {
                let mut result = BTreeMap::new();
                for e in entries {
                    if result.insert(e.key, e.value.try_into()?).is_some() {
                        return Err(invalid("duplicate map entry"));
                    }
                }
                Self::Map(result)
            }
            FfiValue::NewContainer { kind } => Self::NewContainer(kind),
        })
    }
}
uniffi::custom_type!(DocValue,FfiValue,{remote,lower:|v|v.into(),try_lift:|v|v.try_into().map_err(Into::into)});
/// A stable native container identity.
pub type ContainerId = loro::ContainerID;
uniffi::custom_type!(ContainerId,String,{remote,lower:|v|v.to_string(),try_lift:|v|ContainerId::try_from(v.as_str()).map_err(|_|invalid("invalid container id").into())});

/// A JSON scalar/composite used by exported model properties.
pub type JsonValue = serde_json::Value;
impl From<JsonValue> for FfiValue {
    fn from(v: JsonValue) -> Self {
        match v {
            JsonValue::Null => Self::Null,
            JsonValue::Bool(value) => Self::Bool { value },
            JsonValue::Number(value) => {
                if let Some(value) = value.as_i64() {
                    Self::Int { value }
                } else if let Some(value) = value.as_u64() {
                    Self::Unsigned { value }
                } else if let Some(value) = value.as_f64() {
                    Self::Number { value }
                } else {
                    Self::NumberLiteral {
                        value: value.to_string(),
                    }
                }
            }
            JsonValue::String(value) => Self::Text { value },
            JsonValue::Array(values) => Self::Array {
                values: values.into_iter().map(Into::into).collect(),
            },
            JsonValue::Object(values) => Self::Map {
                entries: values
                    .into_iter()
                    .map(|(key, value)| FfiValueEntry {
                        key,
                        value: value.into(),
                    })
                    .collect(),
            },
        }
    }
}
impl TryFrom<FfiValue> for JsonValue {
    type Error = FfiSessionError;
    fn try_from(v: FfiValue) -> Result<Self, Self::Error> {
        Ok(match v {
            FfiValue::Null => Self::Null,
            FfiValue::Bool { value } => Self::Bool(value),
            FfiValue::Int { value } => Self::Number(value.into()),
            FfiValue::Unsigned { value } => Self::Number(value.into()),
            FfiValue::Number { value } => Self::Number(
                serde_json::Number::from_f64(value)
                    .ok_or_else(|| invalid("non-finite JSON number"))?,
            ),
            FfiValue::NumberLiteral { value } => Self::Number(value.parse().map_err(invalid)?),
            FfiValue::Text { value } => Self::String(value),
            FfiValue::Array { values } => Self::Array(
                values
                    .into_iter()
                    .map(TryInto::try_into)
                    .collect::<Result<_, _>>()?,
            ),
            FfiValue::Map { entries } => {
                let mut map = serde_json::Map::new();
                for e in entries {
                    if map.insert(e.key, e.value.try_into()?).is_some() {
                        return Err(invalid("duplicate JSON entry"));
                    }
                }
                Self::Object(map)
            }
            _ => return Err(invalid("not a JSON value")),
        })
    }
}
uniffi::custom_type!(JsonValue,FfiValue,{remote,lower:|v|v.into(),try_lift:|v|v.try_into().map_err(Into::into)});
uniffi::custom_type!(SerializedNode,Vec<FfiValueEntry>,{remote,lower:|v|v.into_iter().map(|(key,value)|FfiValueEntry{key,value:value.into()}).collect(),try_lift:|v|{let value=JsonValue::try_from(FfiValue::Map{entries:v})?;match value{JsonValue::Object(map)=>Ok(map),_=>Err(invalid("expected object").into())}}});
/// Native Loro value used by presence and text attributes.
pub type NativeValue = loro::LoroValue;
impl From<NativeValue> for FfiValue {
    fn from(v: NativeValue) -> Self {
        match v {
            NativeValue::Null => Self::Null,
            NativeValue::Bool(value) => Self::Bool { value },
            NativeValue::I64(value) => Self::Int { value },
            NativeValue::Double(value) => Self::Number { value },
            NativeValue::String(value) => Self::Text {
                value: value.to_string(),
            },
            NativeValue::Binary(value) => Self::Bytes {
                value: value.to_vec(),
            },
            NativeValue::List(values) => Self::Array {
                values: values.iter().cloned().map(Into::into).collect(),
            },
            NativeValue::Map(values) => {
                let mut entries: Vec<_> = values
                    .iter()
                    .map(|(key, value)| FfiValueEntry {
                        key: key.clone(),
                        value: value.clone().into(),
                    })
                    .collect();
                entries.sort_by(|left, right| left.key.cmp(&right.key));
                Self::Map { entries }
            }
            NativeValue::Container(id) => Self::ContainerId {
                value: id.to_string(),
            },
        }
    }
}
fn native_value(value: FfiValue) -> Result<NativeValue, FfiSessionError> {
    Ok(match value {
        FfiValue::Null => NativeValue::Null,
        FfiValue::Bool { value } => NativeValue::Bool(value),
        FfiValue::Int { value } => NativeValue::I64(value),
        FfiValue::Unsigned { value } => NativeValue::I64(i64::try_from(value).map_err(invalid)?),
        FfiValue::Number { value } if value.is_finite() => NativeValue::Double(value),
        FfiValue::Text { value } => NativeValue::String(value.into()),
        FfiValue::Bytes { value } => NativeValue::Binary(value.into()),
        FfiValue::Array { values } => NativeValue::List(
            values
                .into_iter()
                .map(native_value)
                .collect::<Result<Vec<_>, _>>()?
                .into(),
        ),
        FfiValue::Map { entries } => {
            let mut map = HashMap::new();
            for e in entries {
                if map.insert(e.key, native_value(e.value)?).is_some() {
                    return Err(invalid("duplicate map entry"));
                }
            }
            NativeValue::Map(map.into())
        }
        FfiValue::ContainerId { value } => NativeValue::Container(
            ContainerId::try_from(value.as_str()).map_err(|_| invalid("invalid container id"))?,
        ),
        _ => return Err(invalid("not a native scalar value")),
    })
}
uniffi::custom_type!(NativeValue,FfiValue,{remote,lower:|v|v.into(),try_lift:|v|native_value(v).map_err(Into::into)});

uniffi::custom_type!(WallDuration,i64,{remote,lower:|v|v.0,try_lift:|v|Ok(WallDuration(v))});
/// A validated native presence identity.
pub type NativeUserId = macro_user_id::user_id::MacroUserIdStr<'static>;
uniffi::custom_type!(NativeUserId,String,{remote,lower:|v|v.to_string(),try_lift:|v|NativeUserId::try_from(v).map_err(|e|invalid(e).into())});
/// Durable relative node cursor; bytes use Loro's own cursor format.
#[derive(Clone, Debug, uniffi::Record)]
pub struct FfiNodeCursor {
    /// Application-defined persistent node id.
    pub node_id: String,
    /// Opaque native CRDT cursor, independent of the session ABI.
    pub relative: Vec<u8>,
}
/// Native indexed relative cursor.
pub type NativeCursor = lexical_loro::NodeCursor;
uniffi::custom_type!(NativeCursor,FfiNodeCursor,{remote,lower:|v|FfiNodeCursor{node_id:v.node_id,relative:v.cursor.encode()},try_lift:|v|Ok(NativeCursor{node_id:v.node_id,cursor:loro::cursor::Cursor::decode(&v.relative).map_err(invalid)?})});
