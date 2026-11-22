//! Bounded protocol framing and closed error conversion shared by mail transports.
use super::IO_TIMEOUT;
use crate::domain::models::Error;
use crate::outbound::network::{ResponseLimit, ResponseReader};
use async_imap::types::Flag;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    time::timeout,
};

pub(super) fn flag_name(f: Flag<'_>) -> String {
    match f {
        Flag::Seen => "\\Seen".into(),
        Flag::Answered => "\\Answered".into(),
        Flag::Flagged => "\\Flagged".into(),
        Flag::Deleted => "\\Deleted".into(),
        Flag::Draft => "\\Draft".into(),
        Flag::Recent => "\\Recent".into(),
        Flag::MayCreate => "\\*".into(),
        Flag::Custom(s) => s.into_owned(),
    }
}
pub(super) fn quoted(value: &str) -> Result<String, Error> {
    if value.chars().any(char::is_control) {
        return Err(Error::Invalid);
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}
pub(super) fn imap_error(e: async_imap::error::Error, login: bool) -> Error {
    match e {
        async_imap::error::Error::No(response) => {
            if login {
                super::login::login_failure(&response)
            } else {
                Error::Forbidden
            }
        }
        async_imap::error::Error::Bad(_) => Error::Invalid,
        _ => Error::ConnectionUnavailable,
    }
}
pub(super) fn address(s: &str) -> bool {
    s.len() <= 320
        && s.contains('@')
        && !s
            .chars()
            .any(|c| c.is_control() || matches!(c, '<' | '>' | ' ' | ',' | ';'))
}
pub(super) async fn line<S: AsyncRead + Unpin>(s: &mut S) -> Result<Vec<u8>, Error> {
    timeout(IO_TIMEOUT, async {
        let mut bytes = Vec::new();
        loop {
            let b = s
                .read_u8()
                .await
                .map_err(|_| Error::ConnectionUnavailable)?;
            bytes.push(b);
            if bytes.len() > 32768 {
                return Err(Error::ConnectionUnavailable);
            }
            if bytes.ends_with(b"\r\n") {
                return Ok(bytes);
            }
        }
    })
    .await
    .map_err(|_| Error::ConnectionUnavailable)?
}
pub(super) async fn response<S: ResponseReader>(s: &mut S) -> Result<(u16, Vec<u8>), Error> {
    s.begin_response(ResponseLimit::Reply);
    let mut lines = Vec::new();
    let mut expected = None;
    for _ in 0..100 {
        let bytes = line(s).await?;
        use nom::{IResult, Parser, character::complete::digit1, combinator::map_res};
        let parsed: IResult<&[u8], u16> = map_res(digit1, |b: &[u8]| {
            std::str::from_utf8(b)
                .ok()
                .and_then(|s| s.parse::<u16>().ok())
                .ok_or(())
        })
        .parse(bytes.as_slice());
        let (rest, code) = parsed.map_err(|_| Error::ConnectionUnavailable)?;
        if expected.is_some_and(|v| v != code) {
            return Err(Error::ConnectionUnavailable);
        }
        expected = Some(code);
        lines.extend_from_slice(&bytes);
        match rest.first() {
            Some(b' ') => return Ok((code, lines)),
            Some(b'-') => {}
            _ => return Err(Error::ConnectionUnavailable),
        }
    }
    Err(Error::ConnectionUnavailable)
}
pub(super) async fn command<S: ResponseReader + AsyncWrite>(
    s: &mut S,
    bytes: &[u8],
    expected: u16,
) -> Result<(), Error> {
    s.write_all(bytes)
        .await
        .map_err(|_| Error::ConnectionUnavailable)?;
    let code = response(s).await?.0;
    if code == expected {
        Ok(())
    } else if code >= 500 {
        Err(Error::SendRejected)
    } else {
        Err(Error::ConnectionUnavailable)
    }
}
pub(super) fn without_bcc(mime: &[u8]) -> Result<String, Error> {
    let (headers, offset) = mailparse::parse_headers(mime).map_err(|_| Error::Invalid)?;
    let mut wire = String::new();
    for header in headers {
        if matches!(
            header.get_key().to_ascii_lowercase().as_str(),
            "bcc" | "resent-bcc"
        ) {
            continue;
        }
        wire.push_str(std::str::from_utf8(header.get_key_raw()).map_err(|_| Error::Invalid)?);
        wire.push_str(": ");
        wire.push_str(std::str::from_utf8(header.get_value_raw()).map_err(|_| Error::Invalid)?);
        wire.push_str("\r\n");
    }
    wire.push_str("\r\n");
    wire.push_str(
        std::str::from_utf8(mime.get(offset..).ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?,
    );
    Ok(wire)
}
