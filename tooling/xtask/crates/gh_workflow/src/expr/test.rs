use super::typed::{always, github, input, needs, steps};
use super::{canonicalize, check, parse, Ast, Op, CONTEXTS};

#[test]
fn canonical_spelling_survives_a_reparse() {
    let sources = [
        "github.event_name=='push'&&( github.ref == 'refs/heads/main' || inputs.force )",
        "!cancelled() && needs.path-check.outputs.should_run == 'true'",
        "fromJson( needs.setup.outputs.matrix ).services[0].name",
        "format('{0} [{1}]', inputs.ref, 'it''s')",
        "!(a == b) && !!c",
        "a || b && c",
        "(a || b) && c",
        "steps.find.outputs.ami || steps.publish.outputs.ami",
        "toJSON(github.event.*.labels)",
        "x >= 0x1F && y < -1.5e3",
    ];

    for source in sources {
        let ast = parse(source).unwrap();
        let canonical = ast.to_string();
        assert_eq!(parse(&canonical).unwrap(), ast, "{source} -> {canonical}");
        assert_eq!(canonical, parse(&canonical).unwrap().to_string(), "stable");
    }
}

#[test]
fn spacing_and_redundant_parentheses_are_normalized() {
    assert_eq!(
        parse("github.event_name=='push'&&(a||b)")
            .unwrap()
            .to_string(),
        "github.event_name == 'push' && (a || b)"
    );
    assert_eq!(parse("( a ) || b&&c").unwrap().to_string(), "(a) || b && c");
    assert_eq!(parse("!( x )").unwrap().to_string(), "!(x)");
    assert_eq!(
        parse("(a || b) && c").unwrap().meaning(),
        parse("((a || b)) && (c)").unwrap().meaning()
    );
    assert_eq!(
        parse("contains( github.event.pull_request.labels.*.name ,'ci' )")
            .unwrap()
            .to_string(),
        "contains(github.event.pull_request.labels.*.name, 'ci')"
    );
}

#[test]
fn precedence_matches_github() {
    assert_eq!(
        parse("a || b && c == d").unwrap().meaning(),
        Ast::Binary(
            Op::Or,
            Box::new(Ast::Context("a".into())),
            Box::new(Ast::Binary(
                Op::And,
                Box::new(Ast::Context("b".into())),
                Box::new(Ast::Binary(
                    Op::Eq,
                    Box::new(Ast::Context("c".into())),
                    Box::new(Ast::Context("d".into())),
                )),
            )),
        )
    );
    assert_eq!(
        parse("!a == b").unwrap().meaning(),
        Ast::Binary(
            Op::Eq,
            Box::new(Ast::Not(Box::new(Ast::Context("a".into())))),
            Box::new(Ast::Context("b".into())),
        )
    );
}

#[test]
fn templates_rewrite_only_the_expressions() {
    assert_eq!(
        canonicalize(
            "pr-ci-${{github.event.pull_request.number}}-${{ inputs.x=='y' && 'a' || github.run_id }}",
            CONTEXTS,
            false,
        )
        .unwrap(),
        "pr-ci-${{ github.event.pull_request.number }}-${{ inputs.x == 'y' && 'a' || github.run_id }}"
    );
    assert_eq!(
        canonicalize("echo '}}' ${{ '}}' }}", CONTEXTS, false).unwrap(),
        "echo '}}' ${{ '}}' }}"
    );
    assert_eq!(
        canonicalize("github.ref=='x'", CONTEXTS, true).unwrap(),
        "github.ref == 'x'"
    );
}

#[test]
fn unknown_or_unavailable_names_are_rejected() {
    assert_eq!(
        check(&parse("sekrets.TOKEN").unwrap(), CONTEXTS),
        Err("unknown context `sekrets`".to_string())
    );
    assert_eq!(
        check(&parse("frobnicate(1)").unwrap(), CONTEXTS),
        Err("unknown function `frobnicate`".to_string())
    );
    assert!(check(&parse("startsWith(a)").unwrap(), CONTEXTS).is_err());
    assert_eq!(
        check(&parse("secrets.TOKEN != ''").unwrap(), &["github", "needs"]),
        Err("context `secrets` is not available here (only github, needs)".to_string())
    );
    assert!(check(&parse("fromjson('[]')").unwrap(), CONTEXTS).is_ok());
    assert!(canonicalize("${{ github.sha", CONTEXTS, false).is_err());
}

#[test]
fn scopes_follow_the_context_availability_table() {
    let job_if = super::scope::at(&["jobs", "build", "if"]).unwrap();
    assert!(job_if.whole_expression);
    assert!(!job_if.contexts.contains(&"secrets"));
    assert!(!job_if.contexts.contains(&"matrix"));

    let step_env = super::scope::at(&["jobs", "build", "steps", "[]", "env", "TOKEN"]).unwrap();
    assert!(step_env.contexts.contains(&"secrets"));
    assert!(!super::scope::at(&["jobs", "build", "steps", "[]", "if"])
        .unwrap()
        .contexts
        .contains(&"secrets"));

    assert_eq!(super::scope::at(&["name"]), None);
    assert_eq!(
        super::scope::at(&["jobs", "build", "steps", "[]", "uses"]),
        None
    );
}

#[test]
fn typed_builders_render_the_canonical_text() {
    let gated = needs("path-check")
        .output("should_run")
        .is_true()
        .and(github().event_name().ne("pull_request"))
        .or(!always());
    assert_eq!(
        gated.condition().0,
        "(needs.path-check.outputs.should_run == 'true' && github.event_name != 'pull_request') || !always()"
    );

    let ami = steps("publish")
        .output("ami")
        .or_else(steps("find").output("ami"));
    assert_eq!(
        ami.to_string(),
        "${{ steps.publish.outputs.ami || steps.find.outputs.ami }}"
    );

    let environment = input::<super::typed::Bool>("prod").then_else("prod", "dev");
    assert_eq!(
        environment.to_string(),
        "${{ inputs.prod && 'prod' || 'dev' }}"
    );
}

#[test]
fn rendering_rejects_a_context_its_key_does_not_offer() {
    let workflow = crate::Workflow::new("CI").add_job(
        "build",
        crate::Job::new("Build").add_step(
            crate::Step::new("Deploy")
                .run("deploy")
                .if_condition(crate::Expression::new("secrets.TOKEN != ''")),
        ),
    );

    let error = workflow.to_string().unwrap_err().to_string();
    assert!(
        error.starts_with(
            "expression at `jobs.build.steps.[].if`: context `secrets` is not available here"
        ),
        "{error}"
    );
}

#[test]
fn a_star_segment_reads_every_item() {
    let labels = github().event::<super::typed::Json>("pull_request.labels.*.name");
    assert_eq!(
        labels.ast(),
        &parse("github.event.pull_request.labels.*.name").unwrap()
    );
}

#[test]
fn output_handles_read_and_name_the_same_output() {
    use super::typed::{Flag, JobOutput, StepOutput};

    const SHOULD_RUN: JobOutput<Flag> = JobOutput::new("path-check", "should_run");
    const CHANGED: StepOutput<Flag> = StepOutput::new("filter", "changed");

    assert_eq!(SHOULD_RUN.job(), "path-check");
    assert_eq!(SHOULD_RUN.name(), "should_run");
    assert_eq!(
        SHOULD_RUN.read().is_set().condition().0,
        "needs.path-check.outputs.should_run == 'true'"
    );
    assert_eq!(
        CHANGED.read().is_unset().to_string(),
        "${{ steps.filter.outputs.changed != 'true' }}"
    );
}

#[test]
fn handles_carry_the_id_and_typed_outputs() {
    use super::typed::{Flag, JobHandle, JobOutput, StepHandle, StepOutput};

    struct PathCheckOutputs {
        should_run: JobOutput<Flag>,
    }
    const PATH_CHECK: JobHandle<PathCheckOutputs> = JobHandle::new(
        "path-check",
        PathCheckOutputs {
            should_run: JobOutput::new("path-check", "should_run"),
        },
    );
    struct FilterOutputs {
        changed: StepOutput<Flag>,
    }
    const FILTER: StepHandle<FilterOutputs> = StepHandle::new(
        "filter",
        FilterOutputs {
            changed: StepOutput::new("filter", "changed"),
        },
    );

    assert_eq!(PATH_CHECK.to_string(), "path-check");
    assert_eq!(
        PATH_CHECK.outputs.should_run.read().is_set().condition().0,
        "needs.path-check.outputs.should_run == 'true'"
    );
    assert_eq!(
        PATH_CHECK.result().to_string(),
        "${{ needs.path-check.result }}"
    );
    assert_eq!(FILTER.id(), "filter");
    assert_eq!(
        FILTER.outputs.changed.read().to_string(),
        "${{ steps.filter.outputs.changed }}"
    );
    assert_eq!(FILTER.outcome().to_string(), "${{ steps.filter.outcome }}");
}

#[test]
fn rendering_rejects_an_expression_inside_a_script() {
    let workflow = crate::Workflow::new("CI").add_job(
        "build",
        crate::Job::new("Build")
            .add_step(crate::Step::new("Echo").run("echo ${{ github.event.pull_request.title }}")),
    );

    let error = workflow.to_string().unwrap_err().to_string();
    assert!(
        error.starts_with("expression at `jobs.build.steps.[].run`: GitHub pastes"),
        "{error}"
    );
}
