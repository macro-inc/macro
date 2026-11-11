import { readFileSync } from "node:fs";

type Assertion = { fullName: string; status: string };
type Suite = {
  name: string;
  status: string;
  assertionResults: Assertion[];
};
type VitestReport = { testResults: Suite[] };

function results(path: string) {
  const report = JSON.parse(readFileSync(path, "utf8")) as VitestReport;
  const statuses = new Map<string, string>();
  for (const suite of report.testResults) {
    const marker = "/apps/web/";
    const index = suite.name.lastIndexOf(marker);
    const suiteName =
      index < 0 ? suite.name : suite.name.slice(index + marker.length);
    if (suite.assertionResults.length === 0) {
      statuses.set(`${suiteName} :: suite`, suite.status);
      continue;
    }
    for (const assertion of suite.assertionResults) {
      statuses.set(`${suiteName} :: ${assertion.fullName}`, assertion.status);
    }
  }
  return statuses;
}

const [oldPath, newPath] = process.argv.slice(2);
if (!oldPath || !newPath) {
  throw new Error(
    "Usage: bun compare-vitest.ts /tmp/main.json /tmp/branch.json",
  );
}
const oldResults = results(oldPath);
const newResults = results(newPath);
const differences = [...new Set([...oldResults.keys(), ...newResults.keys()])]
  .sort()
  .flatMap((name) => {
    const oldStatus = oldResults.get(name) ?? "absent";
    const newStatus = newResults.get(name) ?? "absent";
    return oldStatus === newStatus ? [] : [{ name, oldStatus, newStatus }];
  });

function counts(statuses: Map<string, string>) {
  const result: Record<string, number> = {};
  for (const status of statuses.values()) {
    result[status] = (result[status] ?? 0) + 1;
  }
  return result;
}

console.log(
  JSON.stringify(
    {
      old: counts(oldResults),
      current: counts(newResults),
      differences,
    },
    null,
    2,
  ),
);
if (
  differences.some(
    (item) => item.oldStatus === "passed" && item.newStatus === "failed",
  )
) {
  process.exitCode = 1;
}
