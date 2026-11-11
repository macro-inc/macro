use channel_sender::ChannelSender;
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::PathBuf,
};

fn next(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

#[test]
#[ignore]
fn differential_sender_parser() {
    let output = PathBuf::from(std::env::var("CGC_OUTPUT_DIR").expect("output dir"));
    let mut file =
        BufWriter::new(File::create(output.join("senders.jsonl")).expect("sender output"));
    let mut seed = std::env::var("CGC_SEED")
        .expect("seed")
        .parse::<u64>()
        .expect("numeric seed");
    if seed == 0 {
        seed = 1;
    }
    let adversarial = [
        "",
        "macro|",
        "bot|",
        "guest|",
        "participant:",
        "participant:00000000-0000-0000-0000-000000000001",
        "participant:00000000-0000-0000-0000-000000000001 ",
        "participant:00000000-0000-0000-0000-00000000000A",
        "guest|00000000-0000-0000-0000-000000000001",
        "macro|user@example.com",
        "bot|00000000-0000-0000-0000-000000000001",
        "macro|participant:00000000-0000-0000-0000-000000000001@example.com",
    ];
    for (index, value) in adversarial.into_iter().enumerate() {
        write_case(&mut file, index, value);
    }
    let alphabet = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789|-:@._/ \n";
    for index in adversarial.len()..20_000 {
        let variant = next(&mut seed) % 7;
        let value = match variant {
            0 => format!(
                "participant:{}",
                uuid::Uuid::from_u128(next(&mut seed) as u128)
            ),
            1 => format!("guest|{}", uuid::Uuid::from_u128(next(&mut seed) as u128)),
            2 => format!("bot|{}", uuid::Uuid::from_u128(next(&mut seed) as u128)),
            3 => format!("macro|fuzz{}@example.com", next(&mut seed)),
            _ => {
                let length = (next(&mut seed) % 90) as usize;
                (0..length)
                    .map(|_| alphabet[(next(&mut seed) as usize) % alphabet.len()] as char)
                    .collect()
            }
        };
        write_case(&mut file, index, &value);
    }
}

fn write_case(file: &mut impl Write, index: usize, value: &str) {
    let parsed = ChannelSender::parse_from_str(value);
    let kind = match parsed {
        Ok(ref sender) if sender.as_user().is_some() => "user",
        Ok(ref sender) if sender.as_bot().is_some() => "bot",
        Ok(ref sender) if sender.is_guest() => "guest",
        Ok(_) => "participant",
        Err(_) => "error",
    };
    let canonical_participant = value
        .strip_prefix("participant:")
        .and_then(|raw| {
            uuid::Uuid::parse_str(raw)
                .ok()
                .map(|id| id.to_string() == raw)
        })
        .unwrap_or(false);
    let row = serde_json::json!({"key": format!("sender:{index}"), "value": {"kind": kind, "canonical_participant": canonical_participant}});
    writeln!(file, "{row}").expect("write sender result");
}
