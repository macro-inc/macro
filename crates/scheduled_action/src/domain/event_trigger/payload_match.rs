//! Exact tests on a delivery's JSON payload, such as "this workflow's
//! conclusion is failure". They run for free at admission, before a run is
//! queued or a condition is asked, so a busy source costs nothing until one
//! of its deliveries matches.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

pub const MAX_PAYLOAD_CONDITIONS: usize = 16;
pub const MAX_PATH_SEGMENTS: usize = 16;
pub const MAX_SEGMENT_CHARS: usize = 128;
pub const MAX_VALUES: usize = 50;
pub const MAX_VALUE_CHARS: usize = 500;

/// Every listed test must pass. A payload that is absent, as for a GitHub
/// delivery too large to carry, passes none.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "Vec<PayloadCondition>", into = "Vec<PayloadCondition>")]
pub struct PayloadConditions(Vec<PayloadCondition>);

impl TryFrom<Vec<PayloadCondition>> for PayloadConditions {
    type Error = PayloadMatchError;

    fn try_from(mut conditions: Vec<PayloadCondition>) -> Result<Self, Self::Error> {
        if conditions.is_empty() || conditions.len() > MAX_PAYLOAD_CONDITIONS {
            return Err(PayloadMatchError::ConditionCount);
        }
        conditions.sort_unstable();
        conditions.dedup();
        Ok(Self(conditions))
    }
}

impl From<PayloadConditions> for Vec<PayloadCondition> {
    fn from(conditions: PayloadConditions) -> Self {
        conditions.0
    }
}

impl PayloadConditions {
    pub fn as_slice(&self) -> &[PayloadCondition] {
        &self.0
    }

    pub fn matches(&self, payload: Option<&Value>) -> bool {
        payload.is_some_and(|payload| self.0.iter().all(|condition| condition.matches(payload)))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum PayloadMatchError {
    #[error("expected between 1 and 16 payload tests")]
    ConditionCount,
    #[error("a payload path needs 1 to 16 nonblank segments of at most 128 characters")]
    Path,
    #[error("each payload test takes exactly one of equals, in, notIn, glob or exists")]
    Test,
    #[error("payload test values must be text, numbers, booleans or null, at most 50 of them")]
    Values,
    #[error("invalid glob pattern")]
    Glob,
}

/// One test on the values found at `path`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "PayloadConditionInput", into = "PayloadConditionInput")]
pub struct PayloadCondition {
    path: Vec<PathSegment>,
    test: PayloadTest,
}

/// `path` walks objects by key; `*` steps into every element of an array and
/// a number into one. Give exactly one test. `notIn` also passes when the
/// path finds nothing.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[schema(as = PayloadCondition)]
pub struct PayloadConditionInput {
    /// Keys from the payload's root, e.g. `["workflow_run", "conclusion"]`.
    pub path: Vec<String>,
    /// Some value found equals this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub equals: Option<PayloadScalar>,
    /// Some value found is one of these.
    #[serde(default, rename = "in", skip_serializing_if = "Option::is_none")]
    pub one_of: Option<Vec<PayloadScalar>>,
    /// No value found is one of these.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_in: Option<Vec<PayloadScalar>>,
    /// Some text found matches this glob; `*` matches any run of characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    /// Whether the path finds a non-null value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exists: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum PathSegment {
    Key(String),
    Index(usize),
    Every,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum PayloadTest {
    Equals(PayloadScalar),
    In(Vec<PayloadScalar>),
    NotIn(Vec<PayloadScalar>),
    Glob(glob::Pattern),
    Exists(bool),
}

/// A JSON text, number, boolean or null that payload values are compared with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(untagged)]
pub enum PayloadScalar {
    Null,
    Boolean(bool),
    #[schema(value_type = f64)]
    Number(serde_json::Number),
    Text(String),
}

impl PayloadScalar {
    fn value(&self) -> Value {
        match self {
            Self::Null => Value::Null,
            Self::Boolean(value) => Value::Bool(*value),
            Self::Number(number) => Value::Number(number.clone()),
            Self::Text(text) => Value::String(text.clone()),
        }
    }
}

/// Ordered by JSON text, so filters canonicalize.
impl Ord for PayloadScalar {
    fn cmp(&self, other: &Self) -> Ordering {
        self.value().to_string().cmp(&other.value().to_string())
    }
}

impl PartialOrd for PayloadScalar {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn scalar(value: PayloadScalar) -> Result<PayloadScalar, PayloadMatchError> {
    match &value {
        PayloadScalar::Text(text) if text.chars().count() > MAX_VALUE_CHARS => {
            Err(PayloadMatchError::Values)
        }
        _ => Ok(value),
    }
}

fn scalars(values: Vec<PayloadScalar>) -> Result<Vec<PayloadScalar>, PayloadMatchError> {
    if values.is_empty() || values.len() > MAX_VALUES {
        return Err(PayloadMatchError::Values);
    }
    let mut scalars = values
        .into_iter()
        .map(scalar)
        .collect::<Result<Vec<_>, _>>()?;
    scalars.sort_unstable();
    scalars.dedup();
    Ok(scalars)
}

impl TryFrom<String> for PathSegment {
    type Error = PayloadMatchError;

    fn try_from(segment: String) -> Result<Self, Self::Error> {
        if segment.trim().is_empty() || segment.chars().count() > MAX_SEGMENT_CHARS {
            return Err(PayloadMatchError::Path);
        }
        Ok(if segment == "*" {
            Self::Every
        } else if let Ok(index) = segment.parse::<usize>() {
            Self::Index(index)
        } else {
            Self::Key(segment)
        })
    }
}

impl From<&PathSegment> for String {
    fn from(segment: &PathSegment) -> Self {
        match segment {
            PathSegment::Key(key) => key.clone(),
            PathSegment::Index(index) => index.to_string(),
            PathSegment::Every => "*".to_owned(),
        }
    }
}

impl TryFrom<PayloadConditionInput> for PayloadCondition {
    type Error = PayloadMatchError;

    fn try_from(input: PayloadConditionInput) -> Result<Self, Self::Error> {
        if input.path.is_empty() || input.path.len() > MAX_PATH_SEGMENTS {
            return Err(PayloadMatchError::Path);
        }
        let path = input
            .path
            .into_iter()
            .map(PathSegment::try_from)
            .collect::<Result<Vec<_>, _>>()?;
        let test = match (
            input.equals,
            input.one_of,
            input.not_in,
            input.glob,
            input.exists,
        ) {
            (Some(value), None, None, None, None) => PayloadTest::Equals(scalar(value)?),
            (None, Some(values), None, None, None) => PayloadTest::In(scalars(values)?),
            (None, None, Some(values), None, None) => PayloadTest::NotIn(scalars(values)?),
            (None, None, None, Some(pattern), None) => {
                if pattern.chars().count() > MAX_VALUE_CHARS {
                    return Err(PayloadMatchError::Glob);
                }
                PayloadTest::Glob(
                    glob::Pattern::new(&pattern).map_err(|_| PayloadMatchError::Glob)?,
                )
            }
            (None, None, None, None, Some(exists)) => PayloadTest::Exists(exists),
            _ => return Err(PayloadMatchError::Test),
        };
        Ok(Self { path, test })
    }
}

impl From<PayloadCondition> for PayloadConditionInput {
    fn from(condition: PayloadCondition) -> Self {
        let path = condition.path.iter().map(String::from).collect();
        let values = Some;
        let mut input = Self {
            path,
            ..Self::default()
        };
        match condition.test {
            PayloadTest::Equals(value) => input.equals = Some(value),
            PayloadTest::In(scalars) => input.one_of = values(scalars),
            PayloadTest::NotIn(scalars) => input.not_in = values(scalars),
            PayloadTest::Glob(pattern) => input.glob = Some(pattern.as_str().to_owned()),
            PayloadTest::Exists(exists) => input.exists = Some(exists),
        }
        input
    }
}

impl PayloadCondition {
    fn matches(&self, payload: &Value) -> bool {
        let mut found = vec![payload];
        for segment in &self.path {
            found = found
                .into_iter()
                .flat_map(|value| step(value, segment))
                .collect();
        }
        match &self.test {
            PayloadTest::Equals(expected) => found.iter().any(|value| **value == expected.value()),
            PayloadTest::In(expected) => found
                .iter()
                .any(|value| expected.iter().any(|scalar| scalar.value() == **value)),
            PayloadTest::NotIn(excluded) => !found
                .iter()
                .any(|value| excluded.iter().any(|scalar| scalar.value() == **value)),
            PayloadTest::Glob(pattern) => found
                .iter()
                .any(|value| value.as_str().is_some_and(|text| pattern.matches(text))),
            PayloadTest::Exists(exists) => found.iter().any(|value| !value.is_null()) == *exists,
        }
    }

    /// How a reader would state the test, e.g. `workflow_run.conclusion in ["failure"]`.
    pub fn describe(&self) -> String {
        let path = self
            .path
            .iter()
            .map(String::from)
            .collect::<Vec<_>>()
            .join(".");
        let list = |scalars: &[PayloadScalar]| {
            let values = scalars
                .iter()
                .map(|s| s.value().to_string())
                .collect::<Vec<_>>();
            format!("[{}]", values.join(", "))
        };
        match &self.test {
            PayloadTest::Equals(value) => format!("{path} = {}", value.value()),
            PayloadTest::In(scalars) => format!("{path} in {}", list(scalars)),
            PayloadTest::NotIn(scalars) => format!("{path} not in {}", list(scalars)),
            PayloadTest::Glob(pattern) => format!("{path} matches {}", pattern.as_str()),
            PayloadTest::Exists(true) => format!("{path} is set"),
            PayloadTest::Exists(false) => format!("{path} is not set"),
        }
    }
}

fn step<'a>(value: &'a Value, segment: &PathSegment) -> Vec<&'a Value> {
    match (value, segment) {
        (Value::Object(fields), PathSegment::Key(key)) => fields.get(key).into_iter().collect(),
        (Value::Object(fields), PathSegment::Index(index)) => {
            fields.get(&index.to_string()).into_iter().collect()
        }
        (Value::Array(items), PathSegment::Index(index)) => items.get(*index).into_iter().collect(),
        (Value::Array(items), PathSegment::Every) => items.iter().collect(),
        _ => Vec::new(),
    }
}
