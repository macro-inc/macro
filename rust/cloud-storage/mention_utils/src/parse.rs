use macro_user_id::user_id::{BorrowedUserIdStr, MacroUserIdStr};
use nom::{
    Finish, IResult, Parser,
    branch::alt,
    bytes::complete::{tag, tag_no_case, take_till1},
    character::complete::anychar,
    combinator::{eof, peek, recognize},
    multi::{many_till, many0},
    sequence::delimited,
};
use serde::Deserialize;
use std::borrow::Cow;

fn xml_tag(
    start_delimiter: &'static str,
    tag_name: &'static str,
) -> impl Fn(&str) -> IResult<&str, &str> {
    move |s: &str| delimited(tag(start_delimiter), tag_no_case(tag_name), tag(">")).parse(s)
}

fn xml_tag_open(tag_name: &'static str) -> impl Fn(&str) -> IResult<&str, &str> {
    move |s: &str| xml_tag("<", tag_name).parse(s)
}

fn xml_tag_close(tag_name: &'static str) -> impl Fn(&str) -> IResult<&str, &str> {
    move |s: &str| xml_tag("</", tag_name).parse(s)
}

fn tag_content(tag_name: &'static str) -> impl Fn(&str) -> IResult<&str, &str> {
    move |s: &str| {
        delimited(
            xml_tag_open(tag_name),
            recognize(many_till(anychar, peek(xml_tag_close(tag_name)))),
            xml_tag_close(tag_name),
        )
        .parse(s)
    }
}

pub trait XmlTaggedParsed<'de>: Deserialize<'de> {
    const TAG_NAME: &'static str;

    fn parse(s: &'de str) -> IResult<&'de str, Self> {
        tag_content(Self::TAG_NAME)
            .map_res(serde_json::from_str)
            .parse(s)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ParsedUserMention<'a> {
    #[serde(borrow)]
    pub user_id: BorrowedUserIdStr<'a>,
    #[serde(borrow)]
    pub email: Cow<'a, str>,
}

impl<'de> XmlTaggedParsed<'de> for ParsedUserMention<'de> {
    const TAG_NAME: &'static str = "m-user-mention";
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ParsedContactMention<'a> {
    #[serde(borrow)]
    pub name: Cow<'a, str>,
}

impl<'de> XmlTaggedParsed<'de> for ParsedContactMention<'de> {
    const TAG_NAME: &'static str = "m-contact-mention";
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ParsedDateMention<'a> {
    #[serde(borrow)]
    pub display_format: Cow<'a, str>,
}

impl<'de> XmlTaggedParsed<'de> for ParsedDateMention<'de> {
    const TAG_NAME: &'static str = "m-date-mention";
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ParsedDocumentMention<'a> {
    #[serde(borrow)]
    pub document_name: Cow<'a, str>,
}

impl<'de> XmlTaggedParsed<'de> for ParsedDocumentMention<'de> {
    const TAG_NAME: &'static str = "m-document-mention";
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ParsedLink<'a> {
    #[serde(borrow)]
    pub text: Cow<'a, str>,
    #[serde(borrow)]
    pub url: Cow<'a, str>,
}

impl<'de> XmlTaggedParsed<'de> for ParsedLink<'de> {
    const TAG_NAME: &'static str = "m-link";
}

#[derive(Debug)]
pub enum XmlTag<'de> {
    Link(ParsedLink<'de>),
    Document(ParsedDocumentMention<'de>),
    User(ParsedUserMention<'de>),
    Contact(ParsedContactMention<'de>),
    Date(ParsedDateMention<'de>),
}

fn parse_xml_tag(s: &str) -> IResult<&str, XmlTag<'_>> {
    alt((
        ParsedLink::parse.map(XmlTag::Link),
        ParsedDocumentMention::parse.map(XmlTag::Document),
        ParsedUserMention::parse.map(XmlTag::User),
        ParsedContactMention::parse.map(XmlTag::Contact),
        ParsedDateMention::parse.map(XmlTag::Date),
    ))
    .parse(s)
}

#[derive(Debug)]
pub enum TextSegment<'de> {
    Xml(XmlTag<'de>),
    Plain(&'de str),
}

#[non_exhaustive]
pub struct ParsedXmlText<'de>(pub Vec<TextSegment<'de>>);

#[derive(Debug, Error)]
#[error(transparent)]
pub struct ParseErr(#[from] nom::error::Error<String>);

impl<'de> ParsedXmlText<'de> {
    pub fn parse(s: &'de str) -> Result<Self, ParseErr> {
        let (_, (out, _)) = many0(alt((
            parse_xml_tag.map(TextSegment::Xml),
            take_till1(|c| c == '<').map(TextSegment::Plain),
        )))
        .and(eof)
        .parse(s)
        .finish()
        .map_err(|e| e.cloned())?;
        Ok(ParsedXmlText(out))
    }
}
