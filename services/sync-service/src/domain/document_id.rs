use derive_more::{AsRef, Display, From};

#[derive(
    Debug, Clone, PartialEq, Eq, Hash, Display, AsRef, From, serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[display("{_0}")]
#[as_ref(str)]
pub struct DocumentId(pub String);

impl DocumentId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

// derive_more's `From` covers `From<String>`; keep the `&str` conversion for
// string literals (tests) and borrowed path params.
impl From<&str> for DocumentId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}
