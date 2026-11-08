//! JavaScript scalar serialization used by node exports.
use base64::{Engine, engine::general_purpose::STANDARD};
/// JavaScript Number.toString, sharing the model's canonical number writer.
pub fn js_number_to_string(number: f64) -> String {
    if number.is_nan() {
        return "NaN".to_owned();
    }
    if number.is_infinite() {
        return if number.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .to_owned();
    }
    lexical_model::to_js_json_string(&lexical_model::json::js_number(number))
}
/// Padded base64 of Latin-1 bytes; None for characters beyond U+00FF.
pub fn btoa(text: &str) -> Option<String> {
    text.chars()
        .map(|ch| u8::try_from(u32::from(ch)).ok())
        .collect::<Option<Vec<_>>>()
        .map(|bytes| STANDARD.encode(bytes))
}
/// Latin-1 base64 when possible; UTF-8 base64 for equations JavaScript would reject.
pub fn btoa_or_utf8(text: &str) -> String {
    btoa(text).unwrap_or_else(|| STANDARD.encode(text.as_bytes()))
}

/// JavaScript decodeURI for linkedom's anchor href setter; reserved escapes survive.
pub fn decode_uri(input: &str) -> crate::Result<String> {
    use nom::{
        Parser,
        bytes::complete::{take_till, take_while_m_n},
        character::complete::char,
        combinator::recognize,
        multi::many1,
    };
    let mut rest = input;
    let mut output = Vec::new();
    while !rest.is_empty() {
        let (tail, plain) = take_till::<_, _, nom::error::Error<_>>(|ch| ch == '%')
            .parse(rest)
            .map_err(|_| crate::Error::InvalidExport("invalid URI text"))?;
        output.extend_from_slice(plain.as_bytes());
        if tail.is_empty() {
            break;
        }
        let (tail, escapes) = many1(recognize((
            char::<_, nom::error::Error<_>>('%'),
            take_while_m_n(2, 2, |ch: char| ch.is_ascii_hexdigit()),
        )))
        .parse(tail)
        .map_err(|_| crate::Error::InvalidExport("malformed URI escape"))?;
        for escape in escapes {
            let digits = escape
                .get(1..)
                .ok_or(crate::Error::InvalidExport("malformed URI escape"))?;
            let byte = u8::from_str_radix(digits, 16)
                .map_err(|_| crate::Error::InvalidExport("malformed URI escape"))?;
            if b";/?:@&=+$,#".contains(&byte) {
                output.extend_from_slice(escape.as_bytes());
            } else {
                output.push(byte);
            }
        }
        rest = tail;
    }
    String::from_utf8(output).map_err(|_| crate::Error::InvalidExport("malformed URI UTF-8"))
}
