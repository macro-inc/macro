use std::{borrow::Cow, fmt::Display};

use serde::Serialize;
use serde_json::Value;

use crate::{QueryType, ToOpenSearchJson};

/// Enum representing the different flags that can be used with a RegexpQuery
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum RegexpQueryFlags {
    /// Enables all optional features (default behavior)
    All,
    /// Allows @ to match any string
    Anystring,
    /// Matches the complement of the language described by the regex
    Complement,
    /// Allows matching empty strings
    Empty,
    /// Enables intersection of multiple patterns
    Intersection,
    /// Enables interval arithmetic on character classes
    Interval,
    /// Disables all optional features (default behavior)
    #[default]
    None,
}

impl RegexpQueryFlags {
    /// Create a new RegexpQueryFlags with the All flag
    pub fn all() -> Vec<Self> {
        vec![Self::All]
    }
}

impl Display for RegexpQueryFlags {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RegexpQueryFlags::All => write!(f, "ALL"),
            RegexpQueryFlags::Anystring => write!(f, "ANYSTRING"),
            RegexpQueryFlags::Complement => write!(f, "COMPLEMENT"),
            RegexpQueryFlags::Empty => write!(f, "EMPTY"),
            RegexpQueryFlags::Intersection => write!(f, "INTERSECTION"),
            RegexpQueryFlags::Interval => write!(f, "INTERVAL"),
            RegexpQueryFlags::None => write!(f, "NONE"),
        }
    }
}

/// Regexp Query
#[derive(Debug, Clone, Serialize, Default)]
pub struct RegexpQuery<'a> {
    /// The field to search in
    #[serde(borrow)]
    pub field: Cow<'a, str>,
    /// The stringified regex pattern to match on
    #[serde(borrow)]
    pub value: Cow<'a, str>,
    /// The flags to use when matching the regular expression
    #[serde(borrow)]
    pub flags: Option<Cow<'a, [RegexpQueryFlags]>>,
}

impl<'a> RegexpQuery<'a> {
    /// Create a new RegexpQuery with a given field and value
    pub fn new(field: impl Into<Cow<'a, str>>, value: impl Into<Cow<'a, str>>) -> Self {
        Self {
            field: field.into(),
            value: value.into(),
            flags: None,
        }
    }

    /// Set the flags to use when matching the regular expression
    pub fn flags(mut self, flags: Cow<'a, [RegexpQueryFlags]>) -> Self {
        self.flags = Some(flags);
        self
    }

    /// Convert to an owned version with 'static lifetime
    pub fn to_owned(&self) -> RegexpQuery<'static> {
        RegexpQuery {
            field: Cow::Owned(self.field.to_string()),
            value: Cow::Owned(self.value.to_string()),
            flags: self.flags.as_ref().map(|f| Cow::Owned(f.to_vec())),
        }
    }
}

impl<'a> From<RegexpQuery<'a>> for QueryType<'a> {
    fn from(regexp_query: RegexpQuery<'a>) -> Self {
        QueryType::Regexp(regexp_query)
    }
}

impl<'a> ToOpenSearchJson for RegexpQuery<'a> {
    fn to_json(&self) -> Value {
        let mut json = serde_json::json!({
            "regexp": {
                self.field.as_ref(): {
                    "value": self.value.as_ref(),
                }
            }
        });

        if let Some(flags) = self.flags.as_ref()
            && !flags.is_empty()
        {
            // Join all flags with |
            json["regexp"][self.field.as_ref()]["flags"] = Value::String(
                flags
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join("|"),
            );
        }

        json
    }
}
