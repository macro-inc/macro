use super::*;
use crate::model::{RoutineProgram, Step};

#[test]
fn every_starter_is_a_valid_routine_with_a_sentence() {
    for starter in STARTERS.iter() {
        let program = RoutineProgram {
            steps: vec![Step::Code(starter.step.clone())],
            mcp_servers: Vec::new(),
            single_agent_task: false,
            sdk: None,
            dangerously_operate_as_user: false,
        };
        program
            .validate()
            .unwrap_or_else(|error| panic!("{}: {error}", starter.key));
        assert!(starter.step.sentence.is_some(), "{}", starter.key);
    }
}
