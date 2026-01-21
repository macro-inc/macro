A tool depends on dependencies that are injected via context. Dependencies
are usually things like connections to services, and databases. 

If a group of tools share the same dependencies and do similar things they should 
be grouped into a toolset. Toolsets are composable and may 

The toolset object is defined so that it can provide _subcontext_ (a small peice of 
a large context) to tools. The example in `lib.rs` demonstrates this by 
narrowing a context with 2 objects to a context with a single object. 

UI is created on the frontend for every tool. To support this, toolsets generate
schemas for all of their tools that the frontend transpiles into ts types. Any tool
added to the `all_tools` toolset (or nested in a subtoolset) will have types generated.

To write new tools:
1. Define the context (what does your tool need??)
2. Define your tool/s and toolset that depends on this context
3. Add to the parent context of `all_tool`
  - if a field of subtools is the context you need then your context is derivable
4. Add your toolset as a subtoolset to the `all_tools` toolset in `ai_tools`
5. Generate schemas by running the binary in `ai_tools` with `cargo run --bin gen_tool_schemas`
6. Generate the frontend types by running naving to `js/app` and running `bun gen-tools`. 
7. Use `bun check` will fail and tell you what you need to implement.
8. Implement the handlers / renderers and verify with `bun check`
