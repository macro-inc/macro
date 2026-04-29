// Small utility to generate a sample connections message to send to the SQS service
use contacts::domain::models::messages::ContactsNodes;
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::HashSet, env};

fn print_contacts_message(users: HashSet<MacroUserIdStr<'static>>) {
    println!(
        "{}",
        serde_json::to_string(&ContactsNodes { users }).unwrap()
    );
}

async fn genmsg_add_user_to_group() {
    let mut users: HashSet<MacroUserIdStr<'static>> = [
        "macro|alice@macro.com",
        "macro|bob@macro.com",
        "macro|carol@macro.com",
        "macro|dave@macro.com",
        "macro|eve@macro.com",
        "macro|frank@macro.com",
        "macro|grace@macro.com",
    ]
    .iter()
    .map(|s| MacroUserIdStr::try_from(s.to_string()).unwrap())
    .collect();
    users.insert(MacroUserIdStr::try_from("macro|henry@macro.com".to_string()).unwrap());
    print_contacts_message(users);
}

async fn genmsg_add_paul() {
    let mut users: HashSet<MacroUserIdStr<'static>> = [
        "macro|zeus@olympus.mountain",
        "macro|athena@olympus.mountain",
        "macro|apollo@olympus.mountain",
        "macro|hermes@olympus.mountain",
        "macro|poseidon@olympus.mountain",
    ]
    .iter()
    .map(|s| MacroUserIdStr::try_from(s.to_string()).unwrap())
    .collect();
    users.insert(MacroUserIdStr::try_from("macro|paul@macro.com".to_string()).unwrap());
    print_contacts_message(users);
}

async fn genmsg_create_group() {
    let users: HashSet<MacroUserIdStr<'static>> = [
        "macro|jupiter@olympus.mountain",
        "macro|athena@olympus.mountain",
        "macro|mercury@olympus.mountain",
        "macro|neptune@olympus.mountain",
        "macro|paul@macro.com",
    ]
    .iter()
    .map(|s| MacroUserIdStr::try_from(s.to_string()).unwrap())
    .collect();
    print_contacts_message(users);
}

async fn genmsg_add_participants() {
    let users: HashSet<MacroUserIdStr<'static>> = [
        "macro|an@uruk.place",
        "macro|enlil@nippur.place",
        "macro|enki@eridu.place",
        "macro|marduk@babylon.place",
        "macro|paul@macro.com",
        "macro|poseidon@olympus.mountain",
    ]
    .iter()
    .map(|s| MacroUserIdStr::try_from(s.to_string()).unwrap())
    .collect();
    print_contacts_message(users);
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
