//! nom entity recognition, including legacy attribute ambiguity and numeric remapping.
use nom::{
    IResult, Parser,
    bytes::complete::{tag, take_till, take_until, take_while1},
    character::complete::{char, one_of},
    combinator::{opt, recognize},
};
use std::{collections::BTreeMap, sync::LazyLock};
static ENTITIES: LazyLock<Result<BTreeMap<String, String>, serde_json::Error>> =
    LazyLock::new(|| serde_json::from_str(include_str!("entities.json")));
fn invalid() -> lexical_html::Error {
    lexical_html::Error::InvalidExport("invalid entity token")
}
fn numeric(input: &str) -> IResult<&str, String> {
    let (rest, _) = tag("#").parse(input)?;
    let (rest, hex) = opt(one_of("xX")).parse(rest)?;
    let radix = if hex.is_some() { 16 } else { 10 };
    let (rest, digits) = take_while1(|ch: char| {
        if radix == 16 {
            ch.is_ascii_hexdigit()
        } else {
            ch.is_ascii_digit()
        }
    })
    .parse(rest)?;
    let (rest, _) = opt(char(';')).parse(rest)?;
    let value = u32::from_str_radix(digits, radix).unwrap_or(u32::MAX);
    let replacement = match value {
        0 => 0xfffd,
        0x80 => 0x20ac,
        0x82 => 0x201a,
        0x83 => 0x192,
        0x84 => 0x201e,
        0x85 => 0x2026,
        0x86 => 0x2020,
        0x87 => 0x2021,
        0x88 => 0x2c6,
        0x89 => 0x2030,
        0x8a => 0x160,
        0x8b => 0x2039,
        0x8c => 0x152,
        0x8e => 0x17d,
        0x91 => 0x2018,
        0x92 => 0x2019,
        0x93 => 0x201c,
        0x94 => 0x201d,
        0x95 => 0x2022,
        0x96 => 0x2013,
        0x97 => 0x2014,
        0x98 => 0x2dc,
        0x99 => 0x2122,
        0x9a => 0x161,
        0x9b => 0x203a,
        0x9c => 0x153,
        0x9e => 0x17e,
        0x9f => 0x178,
        _ => value,
    };
    Ok((
        rest,
        char::from_u32(replacement)
            .unwrap_or('\u{fffd}')
            .to_string(),
    ))
}
fn named(input: &str) -> IResult<&str, &str> {
    recognize((
        take_while1(|ch: char| ch.is_ascii_alphanumeric()),
        opt(char(';')),
    ))
    .parse(input)
}
pub(super) fn decode(input: &str, attribute: bool) -> lexical_html::Result<String> {
    Ok(chunks(input, attribute)?.join(""))
}
pub(super) fn chunks(input: &str, attribute: bool) -> lexical_html::Result<Vec<String>> {
    let entities = ENTITIES
        .as_ref()
        .map_err(|_| lexical_html::Error::InvalidExport("invalid generated HTML entities"))?;
    let mut out = Vec::new();
    let mut rest = input;
    while !rest.is_empty() {
        let (tail, text) = take_till::<_, _, nom::error::Error<_>>(|ch| ch == '&')
            .parse(rest)
            .map_err(|_| invalid())?;
        if !text.is_empty() {
            out.push(text.into());
        }
        if tail.is_empty() {
            break;
        }
        let (tail, _) = tag::<_, _, nom::error::Error<_>>("&")
            .parse(tail)
            .map_err(|_| invalid())?;
        rest = tail;
        if let Ok((tail, value)) = numeric(rest) {
            out.push(value);
            rest = tail;
            continue;
        }
        if let Ok((_, candidate)) = named(rest) {
            let mut found = None;
            for end in (1..=candidate.len()).rev() {
                let prefix = candidate.get(..end).ok_or_else(invalid)?;
                if let Some(value) = entities.get(prefix) {
                    found = Some((end, prefix, value));
                    break;
                }
            }
            if let Some((end, prefix, value)) = found {
                let tail = rest.get(end..).ok_or_else(invalid)?;
                let ambiguous = attribute
                    && !prefix.ends_with(';')
                    && tail
                        .as_bytes()
                        .first()
                        .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'=');
                if !ambiguous {
                    out.push(value.clone());
                    rest = tail;
                    continue;
                }
            }
        }
        out.push("&".into());
    }
    Ok(out)
}
/// htmlparser2 does not reconsume an ampersand that interrupts a title close prefix.
pub(super) fn title(input: &str) -> lexical_html::Result<String> {
    let mut output = String::new();
    let mut rest = input;
    while let Ok((tail, part)) = take_until::<_, _, nom::error::Error<_>>("<&").parse(rest) {
        output.push_str(&decode(part, false)?);
        output.push_str("<&");
        rest = tag::<_, _, nom::error::Error<_>>("<&")
            .parse(tail)
            .map_err(|_| invalid())?
            .0;
    }
    output.push_str(&decode(rest, false)?);
    Ok(output)
}
