use std::borrow::Cow;

use crate::AgentError;
#[derive(Debug)]
pub struct Model<'a> {
    pub provider: Cow<'a, str>,
    pub name: Cow<'a, str>,
}

impl<'a> Model<'a> {
    pub fn provider(&self) -> &str {
        &self.provider
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

impl<'a> TryFrom<&'a str> for Model<'a> {
    type Error = crate::error::AgentError;

    fn try_from(value: &'a str) -> Result<Self, Self::Error> {
        value
            .trim()
            .split_once("/")
            .ok_or_else(|| AgentError::MalformedModel(value.to_string()))
            .map(|(provider, name)| Self {
                provider: Cow::Borrowed(provider),
                name: Cow::Borrowed(name),
            })
    }
}

impl<'a> std::fmt::Display for Model<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}/{}", self.provider, self.name)
    }
}
