//! Read native identities through imap-proto's RFC8474/Gmail parser.
use super::*;
use imap_proto::{AttributeValue, Response, Status};
use std::collections::BTreeMap;

pub(super) async fn fetch_native(
    session: &mut Session<Stream>,
    uids: &str,
    gmail: bool,
    objectid: bool,
) -> Result<BTreeMap<u32, (Option<String>, Option<String>, Option<Vec<String>>)>, Error> {
    if !gmail && !objectid {
        return Ok(BTreeMap::new());
    }
    let fields = if gmail {
        "UID X-GM-MSGID X-GM-THRID X-GM-LABELS"
    } else {
        "UID EMAILID THREADID"
    };
    // `uids` is built exclusively from typed u32 values, never an inbound string.
    let tag = session
        .limit_response(ResponseLimit::Metadata)
        .run_command(format!("UID FETCH {uids} ({fields})"))
        .await
        .map_err(|e| imap_error(e, false))?;
    let mut values = BTreeMap::new();
    for _ in 0..2000 {
        let response = session
            .read_response()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?
            .ok_or(Error::ConnectionUnavailable)?;
        match response.parsed() {
            Response::Fetch(_, attributes) => {
                let mut uid = None;
                let mut message = None;
                let mut thread = None;
                let mut labels = None;
                for attribute in attributes {
                    match attribute {
                        AttributeValue::GmailLabels(value) => {
                            labels = Some(
                                value
                                    .iter()
                                    .map(|v| super::folder_roles::display_path(v))
                                    .collect(),
                            )
                        }
                        AttributeValue::Uid(value) => uid = Some(*value),
                        AttributeValue::GmailMsgId(value) => message = Some(format!("g:{value:x}")),
                        AttributeValue::GmailThrId(value) => thread = Some(format!("g:{value:x}")),
                        AttributeValue::EmailId(value) => {
                            message = Some(format!(
                                "o:{}",
                                base64::engine::general_purpose::URL_SAFE_NO_PAD
                                    .encode(value.as_bytes())
                            ))
                        }
                        AttributeValue::ThreadId(Some(value)) => {
                            thread = Some(format!(
                                "o:{}",
                                base64::engine::general_purpose::URL_SAFE_NO_PAD
                                    .encode(value.as_bytes())
                            ))
                        }
                        _ => {}
                    }
                }
                if let Some(uid) = uid {
                    values.insert(uid, (message, thread, labels));
                }
            }
            Response::Done {
                tag: response_tag,
                status,
                ..
            } if *response_tag == tag => {
                return if *status == Status::Ok {
                    Ok(values)
                } else {
                    Err(Error::ConnectionUnavailable)
                };
            }
            _ => {}
        }
    }
    Err(Error::Throttled)
}

pub(super) async fn transfer(
    session: &mut Session<Stream>,
    uid: u32,
    destination: &str,
    moving: bool,
) -> Result<Option<(u32, u32)>, Error> {
    use imap_proto::{ResponseCode, rfc4315::UidSetMember};
    let verb = if moving { "MOVE" } else { "COPY" };
    let tag = session
        .limit_response(ResponseLimit::Metadata)
        .run_command(format!("UID {verb} {uid} {}", quoted(destination)?))
        .await
        .map_err(|e| imap_error(e, false))?;
    let mut mapped = None;
    for _ in 0..2000 {
        let response = session
            .read_response()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?
            .ok_or(Error::ConnectionUnavailable)?;
        let (code, done, status) = match response.parsed() {
            Response::Data { outcome, status } => (outcome.code.as_ref(), false, Some(status)),
            Response::Done {
                tag: response_tag,
                outcome,
                status,
            } if *response_tag == tag => (outcome.code.as_ref(), true, Some(status)),
            _ => (None, false, None),
        };
        if let Some(ResponseCode::CopyUid(epoch, source, target)) = code {
            let single = |members: &[UidSetMember]| match members {
                [UidSetMember::Uid(value)] => Some(*value),
                [UidSetMember::UidRange(range)] if range.start() == range.end() => {
                    Some(*range.start())
                }
                _ => None,
            };
            if single(source) == Some(uid) {
                mapped = single(target).map(|uid| (*epoch, uid));
            }
        }
        if done {
            return if status == Some(&Status::Ok) {
                Ok(mapped)
            } else {
                Err(Error::Conflict)
            };
        }
    }
    Err(Error::Throttled)
}

/// Drain a STORE completion without discarding RFC7162's MODIFIED refusal code.
pub(super) async fn store(
    session: &mut Session<Stream>,
    uid: u32,
    query: &str,
) -> Result<(), Error> {
    let tag = session
        .limit_response(ResponseLimit::Metadata)
        .run_command(format!("UID STORE {uid} {query}"))
        .await
        .map_err(|e| imap_error(e, false))?;
    for _ in 0..2000 {
        let response = session
            .read_response()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?
            .ok_or(Error::ConnectionUnavailable)?;
        if let Response::Done {
            tag: done,
            status,
            outcome,
        } = response.parsed()
        {
            if *done != tag {
                continue;
            }
            // imap-proto preserves unrecognized response codes as information, including MODIFIED.
            if outcome
                .information
                .as_deref()
                .and_then(|v| v.split_ascii_whitespace().next())
                .is_some_and(|v| v.eq_ignore_ascii_case("[MODIFIED"))
            {
                return Err(Error::Conflict);
            }
            return if *status == Status::Ok {
                Ok(())
            } else {
                Err(Error::Forbidden)
            };
        }
    }
    Err(Error::Throttled)
}
