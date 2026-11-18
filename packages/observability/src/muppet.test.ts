import { expect, test } from "vitest";
import type { MacroTelemetry } from "../../../agent-teammates/muppet/packages/lib/utilities/telemetry/framework.ts";
import { Telemetry } from "./index";

// Agent teammates built on muppet (agent-teammates/muppet) record their wakes
// through this package, but muppet sits outside the workspace and cannot
// import it: it declares the part of `Telemetry` it uses as `MacroTelemetry`,
// and an agent passes the class in. This assignment is the only thing that
// holds the two together, so a change to `Telemetry` or `Span` that breaks
// muppet fails this package's type-check.
const fits: MacroTelemetry = Telemetry;

test("Telemetry fits the part of it muppet wake telemetry uses", () => {
	expect(fits).toBe(Telemetry);
});
