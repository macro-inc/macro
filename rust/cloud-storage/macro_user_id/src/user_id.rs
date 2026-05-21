//! Module defines the [MacroUserId] and the methods to read the email
use crate::{
    cowlike::{ArcCowStr, CowLike},
    email::{Email, email},
    error::ParseErr,
    lowercased::Lowercase,
};
use nom::{Finish, IResult, Parser, bytes::complete::tag, character::complete::char};
use serde::{Deserialize, Serialize};
use std::ops::Deref;

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
#[derive(Clone, Copy)]
pub struct MacroUserId<T> {
    email_part: Email<()>,
    email_part_offset: usize,
    user_id: T,
}

impl<T> std::fmt::Debug for MacroUserId<T>
where
    T: AsRef<str>,
{
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.user_id.as_ref())
    }
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
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(try_from = "String", into = "String")]
pub struct MacroUserIdStr<'a>(pub MacroUserId<Lowercase<'a>>);

#[cfg(feature = "schema")]
impl<'a> utoipa::ToSchema for MacroUserIdStr<'a> {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("MacroUserIdStr")
    }
}

#[cfg(feature = "schema")]
impl<'a> utoipa::PartialSchema for MacroUserIdStr<'a> {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        String::schema()
    }
}

impl<'a> std::fmt::Debug for MacroUserIdStr<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.as_ref())
    }
}

/// Deserialize a MacroUserId to a guaranteed borrowed lifetime from the 'de argument
#[derive(Clone, Deserialize)]
#[serde(try_from = "&str")]
pub struct BorrowedUserIdStr<'a>(#[serde(borrow)] pub MacroUserId<ArcCowStr<'a>>);

impl<'a> std::fmt::Debug for BorrowedUserIdStr<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.as_ref())
    }
}

impl<'a> doppleganger::Primitive for MacroUserIdStr<'a> {}

impl<'a> std::fmt::Display for MacroUserIdStr<'a> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.as_ref())
    }
}

impl<'a> Deref for MacroUserIdStr<'a> {
    type Target = MacroUserId<Lowercase<'a>>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<'a> MacroUserIdStr<'a> {
    /// parse the inner value from the input string
    pub fn parse_from_str(s: &'a str) -> Result<Self, ParseErr> {
        MacroUserId::parse_from_str(s)
            .map(|id| id.lowercase())
            .map(MacroUserIdStr)
    }
}

impl<'a> From<MacroUserIdStr<'a>> for MacroUserId<String> {
    fn from(value: MacroUserIdStr<'a>) -> Self {
        MacroUserId {
            email_part: value.email_part,
            email_part_offset: value.email_part_offset,
            user_id: value.0.user_id.as_ref().into(),
        }
    }
}

impl MacroUserIdStr<'static> {
    /// Create a MacroUserIdStr from an email address by prepending "macro|"
    pub fn try_from_email(email: &str) -> Result<Self, ParseErr> {
        Self::try_from(format!("{}|{}", MACRO_PREFIX, email))
    }
}

impl TryFrom<String> for MacroUserIdStr<'static> {
    type Error = ParseErr;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        MacroUserId::parse_from_str(&value)
            .map(CowLike::into_owned)
            .map(|i| i.lowercase())
            .map(MacroUserIdStr)
    }
}

impl<'a> TryFrom<&'a str> for BorrowedUserIdStr<'a> {
    type Error = ParseErr;

    fn try_from(value: &'a str) -> Result<Self, Self::Error> {
        MacroUserId::parse_from_str(value).map(BorrowedUserIdStr)
    }
}

impl<'a> From<MacroUserIdStr<'a>> for String {
    fn from(value: MacroUserIdStr<'a>) -> Self {
        value.0.as_ref().to_string()
    }
}

#[cfg(feature = "sqlx")]
impl<'a> sqlx::Type<sqlx::Postgres> for MacroUserIdStr<'a> {
    fn type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::Type<sqlx::Postgres>>::type_info()
    }

    fn compatible(ty: &sqlx::postgres::PgTypeInfo) -> bool {
        <String as sqlx::Type<sqlx::Postgres>>::compatible(ty)
    }
}

#[cfg(feature = "sqlx")]
impl<'a> sqlx::postgres::PgHasArrayType for MacroUserIdStr<'a> {
    fn array_type_info() -> sqlx::postgres::PgTypeInfo {
        <String as sqlx::postgres::PgHasArrayType>::array_type_info()
    }
}

#[cfg(feature = "sqlx")]
impl<'q> sqlx::Encode<'q, sqlx::Postgres> for MacroUserIdStr<'q> {
    fn encode_by_ref(
        &self,
        buf: &mut sqlx::postgres::PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        <&str as sqlx::Encode<sqlx::Postgres>>::encode_by_ref(&self.as_ref(), buf)
    }

    fn size_hint(&self) -> usize {
        <&str as sqlx::Encode<sqlx::Postgres>>::size_hint(&self.as_ref())
    }
}

#[cfg(feature = "sqlx")]
impl<'r> sqlx::Decode<'r, sqlx::Postgres> for MacroUserIdStr<'static> {
    fn decode(value: sqlx::postgres::PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let value = <String as sqlx::Decode<sqlx::Postgres>>::decode(value)?;
        MacroUserIdStr::try_from(value).map_err(Into::into)
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
        let email_str = self.email_str();
        self.email_part.map(|_| ArcCowStr::Borrowed(email_str))
    }

    /// return the email as a string slice
    pub fn email_str(&self) -> &str {
        let id_str = self.user_id.as_ref();
        &id_str[self.email_part_offset..]
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
    #[tracing::instrument(err, level = "warn")]
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
