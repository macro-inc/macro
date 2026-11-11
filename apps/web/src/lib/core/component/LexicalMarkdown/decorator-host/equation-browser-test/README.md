# Equation decorator host

Equation and FloatingEquationMenu request published selection and equation
capabilities through `useEquationHost`. Source uses the Lexical wrapper, and
native uses the initialized Source registry component through the common adapter.

The native context reads the view mirror and DOM and validates the node key and
view generation. It retains the first registered menu callbacks across local
editability changes. Updates to existing equations use ordinary SessionEdit
admission, where session access governs the update.

The browser fixture creates its input through Source factories and gives both
engines the same serialized snapshot before decorator observation. It compares
literal model, DOM, and shadow DOM before and after inline and block edits. The
final edit checks retained menu callbacks after local editability becomes false.
Each edit also checks that the Insert action is absent.

The fixture pins the 369f seal and all five generated native files. Source runs
verify the app Vite cache maps and served module bodies for pristine Lexical
and code-core. Each run owns its dev server and closes its resources on setup
or assertion failure.

Run `source.browser.e2e.ts` for Source behavior and `native.browser.e2e.ts` for
raw parity in Chromium, Firefox, and WebKit. Set independent
`EQUATION_TEST_OUTPUT` and `EQUATION_TEST_REPORT` paths for each run.
