import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {statSync} from 'node:fs';
assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Node24 required');
const {loadConfig} = await import(pathToFileURL(process.argv[1]).href);
const config = loadConfig(name => process.env[name]);
const generation = process.argv[2];
assert.deepEqual(config.hosts, {
  storage:`https://storage.example.com/g${generation}`,
  auth:`https://auth.example.com/g${generation}`,
  cognition:`https://cognition.example.com/g${generation}`,
  agentHarness:`https://harness.example.com/g${generation}`,
  scheduledAction:`https://scheduled.example.com/g${generation}`,
  connection:`wss://connection.example.com/g${generation}`,
  mcp:`https://mcp.example.com/g${generation}`,
});
assert.ok(config.macroApiKey === `mak_${BigInt(generation).toString(16).padStart(64,'0')}`);
assert.ok(config.anthropicAuthToken === config.macroApiKey);
assert.ok(process.env.MACRO_REPO_TOKEN === `mrt_${BigInt(generation).toString(16).padStart(64,'0')}`);
assert.ok(process.env.MACRO_REPO_URL === `https://git.example.com/g${generation}/repo`);
assert.equal(statSync(process.argv[3]).mode & 0o777, 0o600);
