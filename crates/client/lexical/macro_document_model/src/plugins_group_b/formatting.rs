//! Named application aliases for existing core formatting commands.
use lexical_model::{Command, Error};

pub(super) fn decode(name: &str, json: &str) -> Result<Option<Command>, Error> {
    let command = match name {
        "group-b.format-text" => Command::FormatText(serde_json::from_str(json)?),
        "group-b.format-element" => Command::FormatElement(serde_json::from_str(json)?),
        _ => return Ok(None),
    };
    Ok(Some(command))
}

#[cfg(test)]
mod test;
