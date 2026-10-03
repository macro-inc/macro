use super::*;
use std::cell::RefCell;

struct Runner {
    calls: RefCell<Vec<String>>,
    existing: Option<String>,
    fail_add: bool,
}

impl SetupRunner for Runner {
    async fn run(&self, command: &SetupCommand) -> rootcause::Result<()> {
        self.calls.borrow_mut().push(command.program.clone());
        if self.fail_add && command.program == "add" {
            rootcause::bail!("configuration failed");
        }
        Ok(())
    }

    async fn configured_url(&self, _: &SetupCommand) -> rootcause::Result<Option<String>> {
        Ok(self.existing.clone())
    }
}

fn command(program: &str) -> SetupCommand {
    SetupCommand {
        program: program.to_owned(),
        args: Vec::new(),
        env: BTreeMap::new(),
        success_text: None,
    }
}

fn plan() -> SetupPlan {
    SetupPlan {
        commands: vec![command("add"), command("login")],
        existing_server: Some(command("get")),
        url: "https://gateway.macro.com/mcp".to_owned(),
    }
}

#[tokio::test]
async fn configures_before_authenticating_and_stops_on_failure() {
    let mut runner = Runner {
        calls: RefCell::new(Vec::new()),
        existing: None,
        fail_add: true,
    };
    assert!(plan().run(&runner).await.is_err());
    assert_eq!(*runner.calls.borrow(), ["add"]);
    runner.calls.borrow_mut().clear();
    runner.fail_add = false;
    plan().run(&runner).await.unwrap();
    assert_eq!(*runner.calls.borrow(), ["add", "login"]);
}

#[tokio::test]
async fn retries_authentication_for_existing_server_but_rejects_conflicts() {
    let mut runner = Runner {
        calls: RefCell::new(Vec::new()),
        existing: Some(plan().url),
        fail_add: false,
    };
    plan().run(&runner).await.unwrap();
    assert_eq!(*runner.calls.borrow(), ["login"]);
    runner.calls.borrow_mut().clear();
    runner.existing = Some("https://unrelated.example/mcp".to_owned());
    assert!(plan().run(&runner).await.is_err());
    assert!(runner.calls.borrow().is_empty());
}
