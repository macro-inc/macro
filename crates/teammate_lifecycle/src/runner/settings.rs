//! `agent.env`: the settings the boot needs from it, read the way
//! `agent-env-setting` read them. Enrollment writes systemd environment
//! lines, `KEY="value"` with `\` and `"` escaped; the last line for a key
//! wins.

use std::collections::BTreeMap;

use nom::branch::alt;
use nom::bytes::complete::{is_not, tag, take_while1};
use nom::combinator::rest;
use nom::multi::fold_many0;
use nom::sequence::preceded;
use nom::{IResult, Parser as _};
use zeroize::Zeroizing;

use crate::boot::SettingsProblem;

/// The settings the boot uses. The repository token is checked present,
/// never kept: the credential helper reads it from the file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// The repository to clone, HTTP(S), no credentials in it.
    pub repo_url: String,
    /// The agent's email, its git author.
    pub email: String,
    /// The agent's name, its git author.
    pub name: String,
}

const REPO_URL: &str = "MACRO_REPO_URL";
const REPO_TOKEN: &str = "MACRO_REPO_TOKEN";
const USER_ID: &str = "MACRO_AGENT_USER_ID";
const NAME: &str = "MACRO_AGENT_NAME";

/// The settings in `contents`, checked as `start-agent` checked them.
pub fn settings(contents: &str) -> Result<Settings, SettingsProblem> {
    let values = values(contents);
    let value = |key: &'static str| -> Result<&str, SettingsProblem> {
        match values.get(key) {
            Some(value) if !value.is_empty() => Ok(value.as_str()),
            Some(_) | None => Err(SettingsProblem::Missing(key)),
        }
    };
    let repo_url = value(REPO_URL)?;
    value(REPO_TOKEN)?;
    let user_id = value(USER_ID)?;
    let name = value(NAME)?;

    let Some(email) =
        lazy_regex::regex_captures!(r"^macro\|(.+@.+)$", user_id).map(|(_, email)| email)
    else {
        return Err(SettingsProblem::UserIdWithoutEmail);
    };
    if !lazy_regex::regex_is_match!(r"^https?://[^/@]+/", repo_url) {
        return Err(SettingsProblem::RepoUrlNotHttp);
    }
    Ok(Settings {
        repo_url: repo_url.to_owned(),
        email: email.to_owned(),
        name: name.to_owned(),
    })
}

/// Every `KEY=value` line, the last per key winning, values unquoted.
pub fn values(contents: &str) -> BTreeMap<&str, Zeroizing<String>> {
    contents
        .lines()
        .filter_map(|line| line_parser(line).ok().map(|(_, pair)| pair))
        .collect()
}

fn line_parser(line: &str) -> IResult<&str, (&str, Zeroizing<String>)> {
    let key = take_while1(|character: char| character.is_ascii_alphanumeric() || character == '_');
    let (value, key) = (key, tag("=")).map(|(key, _)| key).parse(line)?;
    Ok(("", (key, Zeroizing::new(unquoted(value)))))
}

/// A value wrapped in `"` loses them and its escapes; any other is as is.
fn unquoted(value: &str) -> String {
    let quoted = value.len() >= 2 && value.starts_with('"') && value.ends_with('"');
    let Some(inner) = value
        .get(1..value.len().saturating_sub(1))
        .filter(|_| quoted)
    else {
        return value.to_owned();
    };
    match unescaped(inner) {
        Ok((_, text)) => text,
        Err(_) => inner.to_owned(),
    }
}

/// `\"` and `\\` become `"` and `\`; any other `\` stays.
fn unescaped(input: &str) -> IResult<&str, String> {
    let escape = preceded(tag("\\"), alt((tag("\""), tag("\\"))));
    let lone_backslash = tag("\\");
    let run = is_not("\\");
    let piece = alt((escape, lone_backslash, run));
    let (remaining, text) = fold_many0(piece, String::new, |mut text, piece: &str| {
        text.push_str(piece);
        text
    })
    .parse(input)?;
    // Every byte is one of the pieces, so nothing remains.
    let (remaining, tail) = rest.parse(remaining)?;
    Ok((remaining, text + tail))
}
