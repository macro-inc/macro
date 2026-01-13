## Development Commands
- `bun run test`: run tests 
- `bun run check`: check typescript changes 
- `bun run lint`: lint with biome 
- `bun run format`: format changes with biome 

## Developments Notes
1. **Follow existing code styles** - check neighboring files for patterns.
2. **Composability** - Write small testable pure function when possible.
3. **Simplicity** - Prioritize the simplest correct solution, over introducing complexity.
4. **Testing** - Write tests for your changes. When fixing bugs or regressions, identify the issue with a test before fixing it.
5. **Decoupling** - Decouple pure business logic from UI and network layer.
6. **Type-driven design** - Let types guide function composition. **DO NOT USE `any`**

## Verifying Changes & Debugging
- Write and run tests incrementally for business logic using `bun run test`.
- You can use the playwright MCP to debug and verify UI changes and general app behavior.
- Delegate to the user to run the app locally and authenticate.
- The app will likely run on `localhost:3000/app`
- You can use `console.trace` to debug state and changes in the ui and logic.
- When building out UI features, use playwright to verify UI behavior.

## Code Styles
1. Avoid using `blockSignals`, `blockMemos`, `blockResources` etc... They are deprecated.
2. Primitive UI components should be pure, and prefer composition over props vs complex global state or context.
3. Use semantic color tokens instead of default tailwind styles for colors.
4. Going forward, all network calls to serice clients should be done through Tanstack query in the `queries` package. **DO NOT** introduce code that calls any client from `service-clients` outside of the queries package.
5. For exaustive switch statements use `match` from `ts-pattern`.
6. When reaching for solid related utilities always check if a sufficient `solid-primitive` exists first (https://github.com/solidjs-community/solid-primitives).
