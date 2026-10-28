import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AlertCatalog } from '../stacks/monitoring/monitors/catalog';

const catalog: AlertCatalog = JSON.parse(
  readFileSync(join(__dirname, 'rules.json'), 'utf8')
);
const repoRoot = join(__dirname, '../..');

test('rule ids are unique kebab-case', () => {
  const ids = catalog.rules.map((rule) => rule.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('warning thresholds sit before critical in the direction of the comparison', () => {
  for (const rule of catalog.rules) {
    const { warning, critical } = rule.thresholds;
    expect(['above', 'below']).toContain(rule.comparison);
    expect(typeof critical).toBe('number');
    if (warning === undefined) continue;
    if (rule.comparison === 'above') expect(warning).toBeLessThan(critical);
    else expect(warning).toBeGreaterThan(critical);
  }
});

test('each Datadog query ends with its rule comparison and critical threshold', () => {
  for (const rule of catalog.rules) {
    const operators = rule.comparison === 'above' ? '(>|>=)' : '(<|<=)';
    const ending = new RegExp(
      ` ${operators} ${String(rule.thresholds.critical).replace('.', '\\.')}$`
    );
    expect({ id: rule.id, query: rule.datadog.query }).toEqual({
      id: rule.id,
      query: expect.stringMatching(ending),
    });
  }
});

test('each Datadog query evaluates over the rule window', () => {
  for (const rule of catalog.rules) {
    const forecast = rule.datadog.query.includes('forecast(');
    const timeframe = `(${forecast ? 'next' : 'last'}_${rule.window})`;
    expect({ id: rule.id, query: rule.datadog.query }).toEqual({
      id: rule.id,
      query: expect.stringContaining(timeframe),
    });
  }
});

test('only anomaly rules carry threshold windows, matching their alert window', () => {
  for (const rule of catalog.rules) {
    const alertWindow = rule.datadog.query.match(/alert_window='([^']+)'/);
    if (!rule.datadog.query.includes('anomalies(')) {
      expect({ id: rule.id, windows: rule.datadog.thresholdWindows }).toEqual({
        id: rule.id,
        windows: undefined,
      });
      continue;
    }
    expect(alertWindow).not.toBeNull();
    expect(rule.datadog.thresholdWindows?.triggerWindow).toBe(alertWindow?.[1]);
  }
});

test('each rule has a Grafana query or names the gap, and pages from a side that evaluates it', () => {
  for (const rule of catalog.rules) {
    const hasQuery = 'cloudwatch' in rule.grafana;
    const hasGap = 'gap' in rule.grafana;
    expect({ id: rule.id, either: hasQuery !== hasGap }).toEqual({
      id: rule.id,
      either: true,
    });
    expect(['datadog', 'grafana']).toContain(rule.pager);
    if (rule.pager === 'grafana') expect(hasQuery).toBe(true);
  }
});

test('each runbook link points at an existing heading', () => {
  for (const rule of catalog.rules) {
    const [path, anchor] = rule.runbook.split('#');
    const file = join(repoRoot, path);
    expect({ id: rule.id, exists: existsSync(file) }).toEqual({
      id: rule.id,
      exists: true,
    });
    const anchors = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) =>
        line
          .slice(3)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, '')
          .replace(/ /g, '-')
      );
    expect({ id: rule.id, anchors }).toEqual({
      id: rule.id,
      anchors: expect.arrayContaining([anchor]),
    });
  }
});
