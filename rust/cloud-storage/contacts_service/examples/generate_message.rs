// Small utility to generate a sample connections message to send to the SQS service
use contacts::domain::models::messages::ContactsMessage;
use std::env;

async fn genmsg_add_user_to_group() {
    let mut users: Vec<String> = [
        "FF038D36-1AEF-461A-8AA8-34001FA1ABAD",
        "5AB8C770-F2CB-4C6C-BC08-AE64569E324C",
        "D44CAADA-98C0-49EB-AB20-6851B824983A",
        "79A5557B-7827-4E2E-A6AE-F0935CDB762E",
        "C3F4D826-F8FD-478A-AA66-B5B6BB370CBC",
        "C3B1970F-18EE-4DFA-B5FB-E8240E28E51D",
        "9EFFE035-BB12-4FCC-B479-800E1C2551A8",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    users.push("AE2C090C-E478-4454-A001-3DF458BF1FE4".to_string());

    println!(
        "{}",
        serde_json::to_string(&ContactsMessage { users }).unwrap()
    );
}

async fn genmsg_add_paul() {
    let mut users: Vec<String> = [
        "fake|zeus@olympus.mountain",
        "fake|athena@olympus.mountain",
        "fake|apollo@olympus.mountain",
        "fake|hermes@olympus.mountain",
        "fake|poseidon@olympus.mountain",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    users.push("macro|paul@macro.com".to_string());

    println!(
        "{}",
        serde_json::to_string(&ContactsMessage { users }).unwrap()
    );
}

async fn genmsg_create_group() {
    let users: Vec<String> = [
        "fake|jupiter@olympus.mountain",
        "fake|athena@olympus.mountain",
        "fake|mercury@olympus.mountain",
        "fake|neptune@olympus.mountain",
        "macro|paul@macro.com",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    println!(
        "{}",
        serde_json::to_string(&ContactsMessage { users }).unwrap()
    );
}

async fn genmsg_add_participants() {
    let users: Vec<String> = [
        "fake|an@uruk.place",
        "fake|enlil@nippur.place",
        "fake|enki@eridu.place",
        "fake|marduk@babylon.place",
        "macro|paul@macro.com",
        "fake|poseidon@olympus.mountain",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    println!(
        "{}",
        serde_json::to_string(&ContactsMessage { users }).unwrap()
    );
}

#[tokio::main]
async fn main() {
    let mut args = env::args();
    dbg!(args.len());
    if args.len() < 2 {
        panic!("enter a command");
    }
    let cmd = args.nth(1).unwrap();
    match cmd.as_str() {
        "add_user_to_group" => genmsg_add_user_to_group().await,
        "add_paul" => genmsg_add_paul().await,
        "create_group" => genmsg_create_group().await,
        "add_participants" => genmsg_add_participants().await,
        _ => panic!("could not find command '{}'", cmd),
    }
}
