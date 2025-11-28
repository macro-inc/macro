//! Module defines the [Email] and methods to parse it from a string
use crate::{
    byte_range::ByteRange,
    cowlike::{ArcCowStr, CowLike},
    error::ParseErr,
    lowercased::Lowercase,
};
use nom::{
    Finish, IResult, Parser,
    bytes::complete::{is_not, take_till, take_while1},
    character::complete::char,
    combinator::{eof, recognize, verify},
    multi::separated_list1,
    sequence::delimited,
};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests;

// Parser for domain labels
fn domain_label(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_ascii_alphanumeric() || c == '-').parse(input)
}

// Parser for the domain part
fn domain(input: &str) -> IResult<&str, &str> {
    recognize(verify(
        separated_list1(char('.'), domain_label),
        // domain muse have at least 2 segments
        |out: &Vec<&str>| out.len() >= 2,
    ))
    .parse(input)
}

// Parser for local part (before @)
fn atom(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_ascii_alphanumeric() || "!#$%&'*+/=?^_`{|}~-".contains(c))
        .parse(input)
}

fn local(input: &str) -> IResult<&str, &str> {
    recognize(separated_list1(char('.'), atom)).parse(input)
}

fn upto_plus(input: &str) -> IResult<&str, &str> {
    take_till(|c| c == '+').parse(input)
}

fn between_plus_and_at_inclusive(input: &str) -> IResult<&str, &str> {
    delimited(char('+'), is_not("@"), char('@')).parse(input)
}

fn normalized(input: &str) -> IResult<&str, Normalized<'_>> {
    let (rest, before_plus) = upto_plus(input)?;
    if rest.is_empty() {
        // we didn't find a plus
        return Ok((rest, Normalized::AlreadyNormalized(before_plus)));
    }

    let (after_at, _discarded) = between_plus_and_at_inclusive(rest)?;

    Ok((
        "",
        Normalized::Segments {
            before_at: before_plus,
            after_at,
        },
    ))
}

/// contains the segments of a "normalized" email
/// That is to say any segment between '+' and '@' has been removed
enum Normalized<'a> {
    #[expect(dead_code)]
    AlreadyNormalized(&'a str),
    Segments {
        before_at: &'a str,
        after_at: &'a str,
    },
}

/// parses and returns an [EmailParts]
pub(crate) fn email(input: &str) -> IResult<&str, Email<&str>> {
    let (rest, (((local, _at), domain), _eof)) =
        local.and(char('@')).and(domain).and(eof).parse(input)?;
    let local_part = ByteRange::new_from(input, local);
    let domain_part = ByteRange::new_from(input, domain);

    Ok((
        rest,
        Email {
            local_part,
            domain_part,
            email: input,
        },
    ))
}

/// encapsulates the components of an email
#[derive(Debug, Clone, Copy)]
pub struct Email<T> {
    local_part: ByteRange,
    domain_part: ByteRange,
    email: T,
}

/// The standard wrapper type for a [Email]
/// This is a value which is guaranteed to be unmodified from its original input
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct EmailStr<'a>(pub Email<ArcCowStr<'a>>);

impl<'a> doppleganger::Primitive for EmailStr<'a> {}

impl<'a> EmailStr<'a> {
    /// parse the inner value from the input string
    pub fn parse_from_str(s: &'a str) -> Result<Self, ParseErr> {
        <Email<ArcCowStr>>::parse_from_str(s)
            .map(EmailStr)
            .map_err(ParseErr::from)
    }
}

impl TryFrom<String> for EmailStr<'static> {
    type Error = ParseErr;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Ok(<Email<ArcCowStr<'_>>>::parse_from_str(&value)
            .map(CowLike::into_owned)
            .map(EmailStr)?)
    }
}

impl<'a> From<EmailStr<'a>> for String {
    fn from(value: EmailStr<'a>) -> Self {
        value.0.as_ref().to_string()
    }
}

impl<'a> CowLike<'a> for EmailStr<'a> {
    type Owned<'b> = EmailStr<'b>;

    fn into_owned(self) -> Self::Owned<'static> {
        EmailStr(self.0.into_owned())
    }

    fn copied(&'a self) -> Self {
        EmailStr(self.0.copied())
    }
}

impl<T> Email<T> {
    pub(crate) fn map<F, U>(self, f: F) -> Email<U>
    where
        F: FnOnce(T) -> U,
    {
        Email {
            local_part: self.local_part,
            domain_part: self.domain_part,
            email: f(self.email),
        }
    }
}

/// trait which allows reading segments of a contained email
pub trait ReadEmailParts {
    /// returns the part of the email before the '@' char
    fn local_part(&self) -> &str;

    /// return the part of the email after the '@' char
    fn domain_part(&self) -> &str;

    /// return the fully qualifed email
    fn email_str(&self) -> &str;
}

impl<T> ReadEmailParts for Email<T>
where
    T: AsRef<str>,
{
    fn local_part(&self) -> &str {
        let email = self.email.as_ref();
        &email[self.local_part.range()]
    }

    fn domain_part(&self) -> &str {
        let email = self.email.as_ref();
        &email[self.domain_part.range()]
    }

    fn email_str(&self) -> &str {
        self.email.as_ref()
    }
}

impl<T> AsRef<str> for Email<T>
where
    T: AsRef<str>,
{
    fn as_ref(&self) -> &str {
        self.email.as_ref()
    }
}

impl<'a, T> CowLike<'a> for Email<T>
where
    T: CowLike<'a>,
{
    type Owned<'b> = Email<T::Owned<'b>>;

    fn into_owned(self) -> Email<T::Owned<'static>> {
        Email {
            local_part: self.local_part,
            domain_part: self.domain_part,
            email: self.email.into_owned(),
        }
    }

    fn copied(&'a self) -> Self {
        Email {
            local_part: self.local_part,
            domain_part: self.domain_part,
            email: self.email.copied(),
        }
    }
}

impl<'a> Email<ArcCowStr<'a>> {
    /// attempt to create a borrowed version of self from an input string
    pub fn parse_from_str(input: &'a str) -> Result<Self, nom::error::Error<String>> {
        let (_, out) = email(input).finish().map_err(|e| e.cloned())?;
        Ok(out.map(ArcCowStr::Borrowed))
    }

    /// convert the inner email to unicode lowercase characters.
    /// This will not allocate if the inner email is already lowercase
    pub fn lowercase(self) -> Email<Lowercase<'a>> {
        self.map(Lowercase::new)
    }

    /// Create a new [NormalizedEmail] from self
    pub fn normalize(self) -> Result<NormalizedEmail<Self>, nom::error::Error<String>> {
        NormalizedEmail::from_email(self)
    }
}

impl<'a> Email<Lowercase<'a>> {
    /// Create a new [NormalizedEmail] from self
    pub fn normalize(self) -> Result<NormalizedEmail<Self>, nom::error::Error<String>> {
        NormalizedEmail::from_lowercase_email(self)
    }
}

/// a guaranteed to be a valid "normalized" email.
/// The rules of a normalized email are as follows
///   1. All alphabet unicode chars are lowercase
///   2. any segment from the original input email which is strictly between the '+' and '@' chars has been removed
pub struct NormalizedEmail<T>(T);

impl<T> NormalizedEmail<T>
where
    T: AsRef<str>,
{
    /// attempt to create a new [NormalizedEmail] from an input [Email]
    fn internal_new(
        email: T,
        on_allocated_cb: impl FnOnce(String) -> Result<T, nom::error::Error<String>>,
    ) -> Result<Self, nom::error::Error<String>> {
        let (_, normalized_segments) = normalized(email.as_ref())
            .finish()
            .map_err(|e| e.cloned())?;
        match normalized_segments {
            Normalized::AlreadyNormalized(_) => Ok(Self(email)),
            Normalized::Segments {
                before_at,
                after_at,
            } => {
                let email = format!("{before_at}@{after_at}");
                Ok(Self(on_allocated_cb(email)?))
            }
        }
    }
}

impl<'a> NormalizedEmail<Email<Lowercase<'a>>> {
    /// create a new normalized email from a lowercased email
    pub fn from_lowercase_email(
        email: Email<Lowercase<'a>>,
    ) -> Result<Self, nom::error::Error<String>> {
        Self::internal_new(email, |string| {
            Ok(Email::parse_from_str(&string)?.lowercase().into_owned())
        })
    }
}

impl<'a> NormalizedEmail<Email<ArcCowStr<'a>>> {
    /// create a new normalized email from an input email
    pub fn from_email(email: Email<ArcCowStr<'a>>) -> Result<Self, nom::error::Error<String>> {
        Self::internal_new(email, |string| {
            Ok(Email::parse_from_str(&string)?.into_owned())
        })
    }
}

impl<'a, T> CowLike<'a> for NormalizedEmail<T>
where
    T: CowLike<'a>,
{
    type Owned<'b> = NormalizedEmail<T::Owned<'b>>;

    fn into_owned(self) -> NormalizedEmail<T::Owned<'static>> {
        NormalizedEmail(self.0.into_owned())
    }

    fn copied(&'a self) -> Self {
        NormalizedEmail(self.0.copied())
    }
}

impl<T> AsRef<str> for NormalizedEmail<T>
where
    T: AsRef<str>,
{
    fn as_ref(&self) -> &str {
        self.0.as_ref()
    }
}
