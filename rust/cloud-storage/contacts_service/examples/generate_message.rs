// Small utility to generate a sample connections message to send to the SQS service
use contacts_service::queue::add_user_to_group;
use model::contacts::{AddParticipantsMessageBody, CreateGroupMessageBody, Message};
use std::env;

pub async fn create_group(group: &[String]) -> String {
    let body: CreateGroupMessageBody = CreateGroupMessageBody {
        group: group.to_vec(),
        group_id: None,
    };
    let msg = Message::CreateGroup(body);
    serde_json::to_string(&msg).unwrap()
}

pub async fn add_participants(participants: &[String], group: &[String]) -> String {
    let body = AddParticipantsMessageBody {
        participants: participants.to_vec(),
        group: group.to_vec(),
        group_id: None,
    };
    let msg = Message::AddParticipants(body);
    serde_json::to_string(&msg).unwrap()
}

async fn genmsg_add_user_to_group() {
    let group: Vec<String> = [
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

    let new_user = "AE2C090C-E478-4454-A001-3DF458BF1FE4";

    let msg = add_user_to_group(&group, new_user).await;
    println!("{}", msg);
}

async fn genmsg_add_paul() {
    let group: Vec<String> = [
        "fake|zeus@olympus.mountain",
        "fake|athena@olympus.mountain",
        "fake|apollo@olympus.mountain",
        "fake|hermes@olympus.mountain",
        "fake|poseidon@olympus.mountain",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let new_user = "macro|paul@macro.com";

    let msg = add_user_to_group(&group, new_user).await;
    println!("{}", msg);
}

async fn genmsg_create_group() {
    let group: Vec<String> = [
        "fake|jupiter@olympus.mountain",
        "fake|athena@olympus.mountain",
        "fake|mercury@olympus.mountain",
        "fake|neptune@olympus.mountain",
        "macro|paul@macro.com",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let msg = create_group(&group).await;
    println!("{}", msg);
}

async fn genmsg_add_participants() {
    let group: Vec<String> = [
        "fake|an@uruk.place",
        "fake|enlil@nippur.place",
        "fake|enki@eridu.place",
        "fake|marduk@babylon.place",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let participants: Vec<String> = ["macro|paul@macro.com", "fake|poseidon@olympus.mountain"]
        .iter()
        .map(|s| s.to_string())
        .collect();

    let msg = add_participants(&participants, &group).await;
    println!("{}", msg);
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
