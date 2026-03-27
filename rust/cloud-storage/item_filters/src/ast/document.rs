use crate::{DocumentFilters, ast::ExpandErr};
use document_sub_type::DocumentSubType;
use either::Either;
use filter_ast::{ExpandFrame, Expr, FoldTree, TryExpandNode};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_file_type::{
    Archive, Audio, Canvas, Code, Data, Database, Document, Executable, FileAssociation, FileType,
    Font, Image, Md, Media, Pdf, ThreeD, ValueError, Vector, Video, Vm, Write,
};
use nom::{
    IResult, Parser, branch::alt, bytes::complete::tag, combinator::eof, sequence::separated_pair,
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use strum::IntoEnumIterator;
use uuid::Uuid;

/// the literal type that can appear in the item filter ast
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum DocumentLiteral {
    /// this node value filters by [FileType]
    #[serde(rename = "ft")]
    FileType(FileType),
    /// this node value filters by document [Uuid]
    #[serde(rename = "id")]
    Id(Uuid),
    /// this node value filters by project [Uuid]
    #[serde(rename = "pid")]
    ProjectId(Uuid),
    /// this node value filters by document owner
    #[serde(rename = "o")]
    Owner(MacroUserIdStr<'static>),
    /// this node value filters by document importance. false short-circuits to match nothing.
    #[serde(rename = "imp")]
    Importance(bool),
    /// this node value filters by notification done state for the document.
    #[serde(rename = "nd")]
    NotificationDone(bool),
    /// this node value filters by notification seen state for the document.
    #[serde(rename = "ns")]
    NotificationSeen(bool),
    /// include tasks that are created by me, assigned to me, and not completed.
    #[serde(rename = "cbm")]
    IncludeCbmAtmNc(bool),
    /// this node value filters by document sub type
    #[serde(rename = "dst")]
    SubType(DocumentSubType),
    /// this node value filters by email attachment status
    #[serde(rename = "iea")]
    IsEmailAttachment(bool),
}

fn prefix(s: &str) -> IResult<&str, &str> {
    tag("assoc").parse(s)
}

fn assotiation<T: Default>(t: &'static str) -> impl Fn(&str) -> IResult<&str, T> {
    move |s| tag(t).and(eof).map(|(_, _)| T::default()).parse(s)
}

fn file_association(s: &str) -> IResult<&str, FileAssociation> {
    alt((
        assotiation::<Write>("write").map(FileAssociation::from),
        assotiation::<Pdf>("pdf").map(FileAssociation::from),
        assotiation::<Md>("md").map(FileAssociation::from),
        assotiation::<Canvas>("canvas").map(FileAssociation::from),
        assotiation::<Code>("code").map(FileAssociation::from),
        assotiation::<Image>("image").map(FileAssociation::from),
        assotiation::<Archive>("archive").map(FileAssociation::from),
        assotiation::<Executable>("executable").map(FileAssociation::from),
        assotiation::<Audio>("audio").map(FileAssociation::from),
        assotiation::<Video>("video").map(FileAssociation::from),
        assotiation::<Font>("font").map(FileAssociation::from),
        assotiation::<Document>("document").map(FileAssociation::from),
        assotiation::<Database>("database").map(FileAssociation::from),
        assotiation::<Data>("data").map(FileAssociation::from),
        assotiation::<Vector>("vector").map(FileAssociation::from),
        assotiation::<ThreeD>("3d").map(FileAssociation::from),
        assotiation::<Vm>("vm").map(FileAssociation::from),
        assotiation::<Media>("media").map(FileAssociation::from),
    ))
    .parse(s)
}

fn expand_file_association(association: FileAssociation) -> impl Iterator<Item = FileType> {
    FileType::iter().filter(move |ty| ty.macro_app_path().eq(&association))
}

/// other is defined as
/// not write,
/// not pdf,
/// not md,
/// not canvas,
/// not code
/// yes this is kinda weird
fn other(s: &str) -> IResult<&str, impl Iterator<Item = FileType>> {
    tag("other")
        .map(|_| {
            FileType::iter().filter(|ty| {
                let association = ty.macro_app_path();
                !matches!(
                    association,
                    FileAssociation::Write(_)
                        | FileAssociation::Pdf(_)
                        | FileAssociation::Md(_)
                        | FileAssociation::Canvas(_)
                        | FileAssociation::Code(_)
                )
            })
        })
        .parse(s)
}

fn format(s: &str) -> IResult<&str, impl Iterator<Item = FileType>> {
    let (rest, (_, out)) = separated_pair(
        prefix,
        tag(":"),
        alt((
            file_association
                .map(expand_file_association)
                .map(Either::Left),
            other.map(Either::Right),
        )),
    )
    .parse(s)?;
    Ok((rest, out))
}

/// Resolve a file type string to concrete [FileType] variants.
/// Handles both plain extensions (e.g. `"md"`, `"pdf"`) and `assoc:*` prefixes
/// (e.g. `"assoc:code"`, `"assoc:other"`). Returns an empty vec if the string
/// is not a recognized extension or association.
pub fn resolve_file_types(s: &str) -> Vec<FileType> {
    if let Ok(ft) = FileType::from_str(s) {
        return vec![ft];
    }
    match format(s) {
        Ok((_, iter)) => iter.collect(),
        Err(_) => vec![],
    }
}

fn create_file_iter(s: &str) -> impl Iterator<Item = Result<FileType, ValueError<FileType>>> {
    match FileType::from_str(s) {
        Ok(f) => Either::Left(Some(Ok(f)).into_iter()),
        Err(e) => {
            let Ok((_, file_types)) = format(s) else {
                return Either::Left(Some(Err(e)).into_iter());
            };
            Either::Right(file_types.map(Result::Ok))
        }
    }
}

impl ExpandFrame<DocumentLiteral> for DocumentFilters {
    type Err = ExpandErr;
    fn expand_ast(
        filter_request: DocumentFilters,
    ) -> Result<Option<Expr<DocumentLiteral>>, ExpandErr> {
        let DocumentFilters {
            file_types,
            document_ids,
            project_ids,
            owners,
            importance,
            notification_filters,
            task_filters,
            sub_types,
            is_email_attachment,
        } = filter_request;

        let file_types_node = file_types
            .iter()
            .flat_map(|s| create_file_iter(s))
            .try_expand(|r| r.map(DocumentLiteral::FileType), Expr::or)?;

        let document_id_nodes = document_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(DocumentLiteral::Id), Expr::or)?;

        let project_ids = project_ids
            .iter()
            .map(|s| Uuid::parse_str(s))
            .try_expand(|r| r.map(DocumentLiteral::ProjectId), Expr::or)?;

        let owners = owners
            .iter()
            .map(|s| MacroUserIdStr::parse_from_str(s).map(CowLike::into_owned))
            .try_expand(|r| r.map(DocumentLiteral::Owner), Expr::or)?;

        let importance_node = importance.map(|imp| Expr::Literal(DocumentLiteral::Importance(imp)));

        let notification_done_node = notification_filters
            .done
            .map(|done| Expr::Literal(DocumentLiteral::NotificationDone(done)));
        let notification_seen_node = notification_filters
            .seen
            .map(|seen| Expr::Literal(DocumentLiteral::NotificationSeen(seen)));

        let sub_types_node = sub_types
            .iter()
            .map(|s| DocumentSubType::from_str(s))
            .try_expand(|r| r.map(DocumentLiteral::SubType), Expr::or)?;

        let is_email_attachment_node =
            is_email_attachment.map(|v| Expr::Literal(DocumentLiteral::IsEmailAttachment(v)));

        let normal_expr = [
            file_types_node,
            document_id_nodes,
            project_ids,
            owners,
            importance_node,
            notification_done_node,
            notification_seen_node,
            sub_types_node,
            is_email_attachment_node,
        ]
        .into_iter()
        .fold_with(Expr::and);

        let include_cbm_expr = match task_filters.include_cbm_atm_nc {
            Some(true) => Some(Expr::Literal(DocumentLiteral::IncludeCbmAtmNc(true))),
            Some(false) | None => None,
        };

        Ok(match (normal_expr, include_cbm_expr) {
            (Some(normal), Some(include_cbm)) => Some(Expr::or(normal, include_cbm)),
            (Some(normal), None) => Some(normal),
            (None, Some(include_cbm)) => Some(include_cbm),
            (None, None) => None,
        })
    }
}
