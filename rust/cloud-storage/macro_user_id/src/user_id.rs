//! Module defines the [MacroUserId] and the methods to read the email
use std::ops::Deref;

use crate::{
    cowlike::{ArcCowStr, CowLike},
    email::{Email, email},
    error::ParseErr,
    lowercased::Lowercase,
};
use nom::{Finish, IResult, Parser, bytes::complete::tag, character::char};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(test)]
mod tests;

const MACRO_PREFIX: &str = "macro";

fn macro_user_id(input: &str) -> IResult<&str, MacroUserId<ArcCowStr<'_>>> {
    let (rest, ((prefix, pipe), email)) =
        tag(MACRO_PREFIX).and(char('|')).and(email).parse(input)?;
    let email_part = email.map(|_| ());
    // add 1 for the length of char
    let email_part_offset = prefix.len() + pipe.len_utf8();
    Ok((
        rest,
        MacroUserId {
            email_part,
            email_part_offset,
            user_id: ArcCowStr::Borrowed(input),
        },
    ))
}

/// A structure that encapsulates a macro user id
#[derive(Debug, Clone, Copy)]
pub struct MacroUserId<T> {
    email_part: Email<()>,
    email_part_offset: usize,
    user_id: T,
}

impl<T> PartialEq for MacroUserId<T>
where
    T: PartialEq,
{
    fn eq(&self, other: &Self) -> bool {
        // because T contains the full string, all other information is 'derived' from T
        // only compare these values
        self.user_id == other.user_id
    }
}

impl<T> Eq for MacroUserId<T> where T: Eq {}

impl<T> std::hash::Hash for MacroUserId<T>
where
    T: std::hash::Hash,
{
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.user_id.hash(state);
    }
}

/// The standard inner type for a [MacroUserId]
/// This is a value which is guaranteed to be unmodified from its original input
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(try_from = "String", into = "String")]
pub struct MacroUserIdStr<'a>(pub MacroUserId<ArcCowStr<'a>>);

impl<'a> doppleganger::Primitive for MacroUserIdStr<'a> {}

impl<'a> std::fmt::Display for MacroUserIdStr<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.as_ref())
    }
}

impl<'a> Deref for MacroUserIdStr<'a> {
    type Target = MacroUserId<ArcCowStr<'a>>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<'a> MacroUserIdStr<'a> {
    /// parse the inner value from the input string
    pub fn parse_from_str(s: &'a str) -> Result<Self, ParseErr> {
        MacroUserId::parse_from_str(s).map(MacroUserIdStr)
    }
}

impl TryFrom<String> for MacroUserIdStr<'static> {
    type Error = ParseErr;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        MacroUserId::parse_from_str(&value)
            .map(CowLike::into_owned)
            .map(MacroUserIdStr)
    }
}

impl<'a> From<MacroUserIdStr<'a>> for String {
    fn from(value: MacroUserIdStr<'a>) -> Self {
        value.0.as_ref().to_string()
    }
}

impl<'a> CowLike<'a> for MacroUserIdStr<'a> {
    type Owned<'b> = MacroUserIdStr<'b>;

    fn into_owned(self) -> Self::Owned<'static> {
        MacroUserIdStr(self.0.into_owned())
    }

    fn copied(&'a self) -> Self {
        MacroUserIdStr(self.0.copied())
    }
}

impl<T> MacroUserId<T> {
    fn map<F, U>(self, f: F) -> MacroUserId<U>
    where
        F: FnOnce(T) -> U,
    {
        MacroUserId {
            email_part: self.email_part,
            email_part_offset: self.email_part_offset,
            user_id: f(self.user_id),
        }
    }
}

impl<T> AsRef<str> for MacroUserId<T>
where
    T: AsRef<str>,
{
    fn as_ref(&self) -> &str {
        self.user_id.as_ref()
    }
}

impl<T> MacroUserId<T>
where
    T: AsRef<str>,
{
    /// return the [EmailParts] contained within self
    pub fn email_part<'a>(&'a self) -> Email<ArcCowStr<'a>> {
        let id_str = self.user_id.as_ref();
        let email_str = &id_str[self.email_part_offset..];
        self.email_part.map(|_| ArcCowStr::Borrowed(email_str))
    }
}

impl<'a, T> CowLike<'a> for MacroUserId<T>
where
    T: CowLike<'a>,
{
    type Owned<'b> = MacroUserId<T::Owned<'b>>;

    fn into_owned(self) -> MacroUserId<T::Owned<'static>> {
        self.map(CowLike::into_owned)
    }

    fn copied(&'a self) -> Self {
        MacroUserId {
            email_part: self.email_part,
            email_part_offset: self.email_part_offset,
            user_id: self.user_id.copied(),
        }
    }
}

impl<'a> MacroUserId<ArcCowStr<'a>> {
    /// attempt to create a borrowed version of self from an input string
    pub fn parse_from_str(input: &'a str) -> Result<Self, ParseErr> {
        let (_, out) = macro_user_id(input).finish().map_err(|e| e.cloned())?;
        Ok(out)
    }

    /// convert the inner email to unicode lowercase characters.
    /// This will not allocate if the inner email is already lowercase
    pub fn lowercase(self) -> MacroUserId<Lowercase<'a>> {
        self.map(Lowercase::new)
    }
}
