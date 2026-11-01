// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow mediaconn.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// `Client.refreshMediaConn` is split into pure parts, tested alone: the cache
// check ([`media_conn_needs_refresh`]), the request ([`build_media_conn_iq`])
// and the response parsing ([`parse_media_conn`]).

//! The media hosts and upload auth token WhatsApp hands out over an IQ.

use chrono::{DateTime, TimeDelta, Utc};

use crate::binary::{ErrorList, Node, NodeContent};
use crate::client::Client;
use crate::errors::ClientError;
use crate::request::{InfoQuery, IqType};
use crate::types::SERVER_JID;

/// The namespace of the media connection IQ.
pub const MEDIA_CONN_NAMESPACE: &str = "w:m";
/// The type of the media connection IQ.
pub const MEDIA_CONN_IQ_TYPE: &str = "set";

/// A single host to download media from.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MediaConnHost {
    /// The host name, used as the URL host.
    pub hostname: String,
}

/// The WhatsApp servers attachments can be uploaded to and downloaded from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MediaConn {
    /// The upload auth token.
    pub auth: String,
    /// How long `auth` is valid, in seconds.
    pub auth_ttl: i64,
    /// How long this media connection is valid, in seconds.
    pub ttl: i64,
    /// The `max_buckets` attribute.
    pub max_buckets: i64,
    /// When the media connection was fetched.
    pub fetched_at: DateTime<Utc>,
    /// The hosts, in the order to try them.
    pub hosts: Vec<MediaConnHost>,
}

impl MediaConn {
    /// When the media connection expires.
    pub fn expiry(&self) -> DateTime<Utc> {
        self.fetched_at + TimeDelta::seconds(self.ttl)
    }
}

/// An unexpected media connection IQ response.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MediaConnError {
    /// The response's first child isn't `<media_conn>`.
    #[error("failed to query media connections: unexpected child tag")]
    UnexpectedChildTag,
    /// The `<media_conn>` attributes didn't parse.
    #[error("failed to parse media connections: {0}")]
    InvalidAttributes(ErrorList),
    /// A `<host>` had no `hostname`. Go prints the (empty) `<media_conn>`
    /// errors here; the port prints the host's.
    #[error("failed to parse media connection host: {0}")]
    InvalidHost(ErrorList),
}

/// Whether the cached media connection must be fetched again: there is none,
/// a refresh is forced, or it has expired at `now`. This is the condition in
/// Go's `Client.refreshMediaConn`, which then queries and caches a new one.
pub fn media_conn_needs_refresh(
    cache: Option<&MediaConn>,
    force: bool,
    now: DateTime<Utc>,
) -> bool {
    match cache {
        None => true,
        Some(media_conn) => force || now > media_conn.expiry(),
    }
}

/// The content of the media connection IQ: one empty `<media_conn>`.
pub fn media_conn_query_content() -> Vec<Node> {
    vec![Node {
        tag: "media_conn".to_owned(),
        ..Node::default()
    }]
}

/// The whole IQ `Client.queryMediaConn` sends, as Go's `sendIQ` builds it from
/// the info query: `<iq id=… xmlns="w:m" type="set" to="s.whatsapp.net">`
/// around [`media_conn_query_content`].
pub fn build_media_conn_iq(id: &str) -> Node {
    let mut node = Node {
        tag: "iq".to_owned(),
        content: Some(NodeContent::Nodes(media_conn_query_content())),
        ..Node::default()
    };
    node.attrs.insert("id".to_owned(), id.into());
    node.attrs
        .insert("xmlns".to_owned(), MEDIA_CONN_NAMESPACE.into());
    node.attrs
        .insert("type".to_owned(), MEDIA_CONN_IQ_TYPE.into());
    node.attrs.insert("to".to_owned(), (&*SERVER_JID).into());
    node
}

/// Parses the media connection IQ response, stamping it as fetched now.
/// Children of `<media_conn>` other than `<host>` are logged and skipped.
pub fn parse_media_conn(resp: &Node) -> Result<MediaConn, MediaConnError> {
    let resp_mc = match resp.get_children().first() {
        Some(child) if child.tag == "media_conn" => child,
        _ => return Err(MediaConnError::UnexpectedChildTag),
    };
    let fetched_at = Utc::now();
    let mut ag = resp_mc.attr_getter();
    let auth = ag.string("auth");
    let ttl = ag.int("ttl");
    let auth_ttl = ag.int("auth_ttl");
    let max_buckets = ag.int("max_buckets");
    ag.error().map_err(MediaConnError::InvalidAttributes)?;
    let mut hosts = Vec::new();
    for child in resp_mc.get_children() {
        if child.tag != "host" {
            tracing::warn!(node = %child, "unexpected child in media_conn element");
            continue;
        }
        let mut cag = child.attr_getter();
        hosts.push(MediaConnHost {
            hostname: cag.string("hostname"),
        });
        cag.error().map_err(MediaConnError::InvalidHost)?;
    }
    Ok(MediaConn {
        auth,
        auth_ttl,
        ttl,
        max_buckets,
        fetched_at,
        hosts,
    })
}

impl Client {
    /// The cached media connection, fetched again when missing, expired or
    /// `force`d (`refreshMediaConn`).
    pub(crate) async fn refresh_media_conn(&self, force: bool) -> Result<MediaConn, ClientError> {
        let mut cache = self.media_conn_cache.lock().await;
        if media_conn_needs_refresh(cache.as_ref(), force, Utc::now()) {
            *cache = Some(self.query_media_conn().await?);
        }
        cache
            .clone()
            .ok_or_else(|| ClientError::Other("media connection cache is empty".to_owned()))
    }

    async fn query_media_conn(&self) -> Result<MediaConn, ClientError> {
        let response = self
            .send_iq(InfoQuery {
                namespace: MEDIA_CONN_NAMESPACE,
                r#type: IqType::Set,
                to: SERVER_JID.clone(),
                content: Some(NodeContent::Nodes(media_conn_query_content())),
                ..Default::default()
            })
            .await
            .map_err(|error| error.wrap("failed to query media connections"))?;
        Ok(parse_media_conn(&response)?)
    }

    /// The media connection for a download or upload, with Go's error context.
    pub(crate) async fn media_conn_for_transfer(&self) -> Result<MediaConn, ClientError> {
        self.refresh_media_conn(false)
            .await
            .map_err(|error| error.wrap("failed to refresh media connections"))
    }

    /// The HTTP side of media transfers.
    pub(crate) fn media_http(&self) -> crate::download::MediaHttpClient {
        let http = crate::download::MediaHttpClient::new(
            self.config.media_http.clone(),
            String::new(),
            false,
        );
        match &self.config.media_base_url {
            Some(base_url) => http.with_base_url(base_url),
            None => http,
        }
    }
}

#[cfg(test)]
mod test;
