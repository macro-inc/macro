use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::BorrowedUserIdStr;
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
use std::{
    borrow::Cow,
    fmt::{Formatter, Write},
    marker::PhantomData,
};
use thiserror::Error;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ParsedGroupMention<'a> {
    #[serde(borrow)]
    pub group_alias: Cow<'a, str>,
}

impl<'de> XmlTaggedParsed<'de> for ParsedGroupMention<'de> {
    const TAG_NAME: &'static str = "m-group-mention";
}

#[derive(Debug)]
pub enum XmlTag<'de> {
    Link(ParsedLink<'de>),
    Document(ParsedDocumentMention<'de>),
    User(ParsedUserMention<'de>),
    Contact(ParsedContactMention<'de>),
    Date(ParsedDateMention<'de>),
    Group(ParsedGroupMention<'de>),
}

fn parse_xml_tag(s: &str) -> IResult<&str, XmlTag<'_>> {
    alt((
        ParsedLink::parse.map(XmlTag::Link),
        ParsedDocumentMention::parse.map(XmlTag::Document),
        ParsedUserMention::parse.map(XmlTag::User),
        ParsedContactMention::parse.map(XmlTag::Contact),
        ParsedDateMention::parse.map(XmlTag::Date),
        ParsedGroupMention::parse.map(XmlTag::Group),
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

pub struct ReformattedXmlText<T>(pub String, PhantomData<T>);

pub trait XmlFormatter: Sized {
    fn format_plain_text(s: &str, f: &mut Formatter<'_>) -> std::fmt::Result;
    fn format_link(link: &ParsedLink<'_>, f: &mut Formatter<'_>) -> std::fmt::Result;
    fn format_doc(doc: &ParsedDocumentMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result;
    fn format_user(user: &ParsedUserMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result;
    fn format_contact(
        contact: &ParsedContactMention<'_>,
        f: &mut Formatter<'_>,
    ) -> std::fmt::Result;
    fn format_date(date: &ParsedDateMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result;
    fn format_group(group: &ParsedGroupMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result;

    fn format_xml_text(text: ParsedXmlText<'_>) -> ReformattedXmlText<Self> {
        use std::fmt::Display;

        struct Adapter<F>(F);
        impl<F: Fn(&mut Formatter<'_>) -> std::fmt::Result> Display for Adapter<F> {
            fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
                (self.0)(f)
            }
        }

        let s = text.0.into_iter().fold(String::new(), |mut acc, cur| {
            let _ = match cur {
                TextSegment::Xml(XmlTag::Link(l)) => {
                    write!(
                        acc,
                        "{}",
                        Adapter(|f: &mut Formatter<'_>| Self::format_link(&l, f))
                    )
                }
                TextSegment::Xml(XmlTag::Document(d)) => {
                    write!(
                        acc,
                        "{}",
                        Adapter(|f: &mut Formatter<'_>| Self::format_doc(&d, f))
                    )
                }
                TextSegment::Xml(XmlTag::User(u)) => {
                    write!(
                        acc,
                        "{}",
                        Adapter(|f: &mut Formatter<'_>| Self::format_user(&u, f))
                    )
                }
                TextSegment::Xml(XmlTag::Contact(c)) => {
                    write!(
                        acc,
                        "{}",
                        Adapter(|f: &mut Formatter<'_>| Self::format_contact(&c, f))
                    )
                }
                TextSegment::Xml(XmlTag::Date(d)) => {
                    write!(
                        acc,
                        "{}",
                        Adapter(|f: &mut Formatter<'_>| Self::format_date(&d, f))
                    )
                }
                TextSegment::Xml(XmlTag::Group(g)) => {
                    write!(
                        acc,
                        "{}",
                        Adapter(|f: &mut Formatter<'_>| Self::format_group(&g, f))
                    )
                }
                TextSegment::Plain(s) => {
                    write!(
                        acc,
                        "{}",
                        Adapter(|f: &mut Formatter<'_>| Self::format_plain_text(s, f))
                    )
                }
            };
            acc
        });
        ReformattedXmlText(s, PhantomData)
    }
}

/// xml formatter which converts xml tags to their plain text representation
pub struct PlainTextFormatter;

impl XmlFormatter for PlainTextFormatter {
    fn format_plain_text(s: &str, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{s}")
    }

    fn format_link(link: &ParsedLink<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", link.text)
    }

    fn format_doc(doc: &ParsedDocumentMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", doc.document_name)
    }

    fn format_user(user: &ParsedUserMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", user.user_id.0.email_part().email_str())
    }

    fn format_contact(
        contact: &ParsedContactMention<'_>,
        f: &mut Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", contact.name)
    }

    fn format_date(date: &ParsedDateMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", date.display_format)
    }

    fn format_group(group: &ParsedGroupMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "@{}", group.group_alias)
    }
}

/// xml formatter which completely removes the inner text of all xml tags
pub struct NullXmlFormatter;

impl XmlFormatter for NullXmlFormatter {
    fn format_plain_text(s: &str, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{s}")
    }

    fn format_link(_link: &ParsedLink<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "")
    }

    fn format_doc(_doc: &ParsedDocumentMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "")
    }

    fn format_user(_user: &ParsedUserMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "")
    }

    fn format_contact(
        _contact: &ParsedContactMention<'_>,
        f: &mut Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "")
    }

    fn format_date(_date: &ParsedDateMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "")
    }

    fn format_group(_group: &ParsedGroupMention<'_>, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "")
    }
}
