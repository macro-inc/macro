//! WhatsApp JIDs as Macro stores them: a group (`<digits>[-<digits>]@g.us`), a
//! person by phone number (`<digits>@s.whatsapp.net`) or by LID
//! (`<digits>@lid`). Parsed once, with one length limit for every kind.

use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, take_while1},
    character::complete::char,
    combinator::{all_consuming, opt, recognize, value},
    sequence::{pair, preceded},
};

/// Longest user part (before `@`) Macro accepts.
const USER_LIMIT: usize = 64;

/// What a JID addresses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JidKind {
    /// A group or community.
    Group,
    /// A person, by phone number.
    Phone,
    /// A person, by WhatsApp's LID.
    Lid,
}

/// A parsed WhatsApp JID borrowed from its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Jid<'a> {
    /// The part before `@`.
    pub user: &'a str,
    /// What it addresses.
    pub kind: JidKind,
}

fn digits(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_ascii_digit())(input)
}

fn jid(input: &str) -> IResult<&str, Jid<'_>> {
    let group = pair(
        recognize(pair(digits, opt(preceded(char('-'), digits)))),
        value(JidKind::Group, tag("@g.us")),
    );
    let person = pair(
        digits,
        alt((
            value(JidKind::Phone, tag("@s.whatsapp.net")),
            value(JidKind::Lid, tag("@lid")),
        )),
    );
    all_consuming(alt((group, person)))
        .map(|(user, kind)| Jid { user, kind })
        .parse(input)
}

impl<'a> Jid<'a> {
    /// Parse a group, phone-number or LID JID; anything else is `None`.
    pub fn parse(text: &'a str) -> Option<Self> {
        jid(text)
            .ok()
            .map(|(_, jid)| jid)
            .filter(|jid| jid.user.len() <= USER_LIMIT)
    }

    /// A person (phone number or LID), not a group.
    pub fn is_person(self) -> bool {
        matches!(self.kind, JidKind::Phone | JidKind::Lid)
    }

    /// The phone number, `+<digits>`, of a phone-number JID.
    pub fn phone_number(self) -> Option<String> {
        (self.kind == JidKind::Phone).then(|| format!("+{}", self.user))
    }
}

/// A group JID.
pub fn is_group_jid(text: &str) -> bool {
    Jid::parse(text).is_some_and(|jid| jid.kind == JidKind::Group)
}

/// A phone-number or LID JID.
pub fn is_person_jid(text: &str) -> bool {
    Jid::parse(text).is_some_and(Jid::is_person)
}

/// `+<digits>` for a phone-number JID.
pub fn phone_number(text: &str) -> Option<String> {
    Jid::parse(text).and_then(Jid::phone_number)
}

#[cfg(test)]
mod test;
