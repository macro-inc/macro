import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type CacheTelemetryObservation,
  CacheTelemetryRecorder,
} from '../../src/lib/graphql-cache/telemetry';
import {
  buildWp12Report,
  computeMeasuredSourceDigest,
  evaluateAlert,
  listMeasuredSourceInputs,
  recorderErrorRate,
  rollbackDecision,
  validateDashboardSpec,
  validateTestMatrix,
  validateWp12BrowserEvidence,
  type Wp12BrowserEvidence,
} from './report';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const dashboardPath = resolve(import.meta.dirname, '../../ops/graphql-cache-wp12-dashboard.json');
const matrixPath = resolve(import.meta.dirname, '../../ops/graphql-cache-wp12-test-matrix.json');
const revision = 'ukyrkmnlolqutzpuyxywqplnxnxmqywr';
const sourceDigest = 'c'.repeat(64);
const wasmSha256 = 'a'.repeat(64);
const executableSha256 = 'b'.repeat(64);
const now = new Date('2026-08-15T00:30:00.000Z');

const evidence = (family: 'chromium' | 'firefox'): Wp12BrowserEvidence => {
  const basename = 'cache_wasm_bg-abc123.wasm';
  const origin = 'http://127.0.0.1:4189' as const;
  const executablePath = `/nix/store/browser/${family}`;
  return {
    schemaVersion: 5,
    measuredAt: '2026-08-15T00:00:00.000Z',
    measuredRevisionChangeId: revision,
    measuredSourceDigest: sourceDigest,
    source: 'local-playwright-finalizer',
    project: `${family}-production`,
    mode: 'production',
    finalizer: {
      kind: 'playwright-after-all',
      requiredTests: [
        'lifecycle',
        'real-standby',
        'logout',
        'production-default-off',
        'posthog-treatment',
        'mutating-termination',
        'recovery-test-artifact',
      ],
      completedTests: [
        'lifecycle',
        'real-standby',
        'logout',
        'production-default-off',
        'posthog-treatment',
        'mutating-termination',
        'recovery-test-artifact',
      ],
    },
    runner: { playwrightVersion: '1.62.0', executablePath, executableSha256 },
    browser: {
      family,
      executableVersion: family === 'chromium' ? '145.0.7632.6' : '151.0',
      userAgent: family === 'chromium' ? 'Mozilla/5.0 Chrome/145.0.7632.6 Safari/537.36' : 'Mozilla/5.0 Firefox/151.0',
    },
    origin,
    exactProductionHost: true,
    exactProductionWorker: true,
    liveS3CloudFrontVerified: false,
    scenarios: {
      harnessControlLazyResourceEvidence: true,
      treatmentLazyResources: true,
      navigationResourceGate: true,
      productionGraphqlSoupDefaultOffNoResources: true,
      posthogTreatmentOverrideExactResources: true,
      nextNavigationEmergencyDisableNoResources: true,
      posthogNetworkSuppressed: true,
      samePageStandbyHostCloseOwnerStable: true,
      realStandbyTabCloseOwnerStable: true,
      cleanOwnerRestartOfflineHit: true,
      identityChangeReset: true,
      realLogoutReset: true,
      gracefulPreserve: true,
      abruptLossWipe: true,
      crossOriginIsolationNotRequired: true,
      sharedArrayBufferNotCreated: true,
      admittedMutatingRpcTerminationWipesNoReplay: true,
      incompatibleNamespaceRecovery: true,
      corruptQueuePayloadRecovery: true,
      queueDiagnosticsTelemetry: true,
      initializationRecoveryOutcomeTelemetry: true,
      workerMemoryApiUnavailableWithoutIsolation: true,
    },
    resources: {
      wasm: {
        basename,
        url: `${origin}/app/assets/${basename}`,
        expectedProductionUrl: `${origin}/app/assets/${basename}`,
        sha256: wasmSha256,
      },
      engineWorkerUrls: [`${origin}/app/assets/cache.engine-worker-abc.js`],
      coordinatorWorkerUrls: [`${origin}/app/assets/cache.coordinator.shared-worker-abc.js`],
    },
    testArtifacts: {
      recoveryHooks: {
        classification: 'real-browser-test-artifact',
        productionArtifact: false,
        cargoFeature: 'browser-test-hooks',
        wasm: {
          basename: 'cache_wasm_browser_test_hooks_bg-hooks123.wasm',
          url: `${origin}/app/assets/cache_wasm_browser_test_hooks_bg-hooks123.wasm`,
          sha256: 'd'.repeat(64),
        },
      },
    },
    navigation: { controlDurationMs: 10, treatmentDurationMs: 11 },
  };
};

const validationContext = {
  now,
  expectedRevisionChangeId: revision,
  expectedSourceDigest: sourceDigest,
  expectedWasmSha256: wasmSha256,
  executableSha256ByPath: {
    '/nix/store/browser/chromium': executableSha256,
    '/nix/store/browser/firefox': executableSha256,
  },
};
const clone = <T>(value: T): T => structuredClone(value);

describe('WP-12 operations specifications', () => {
  it('hashes the complete tracked transitive input inventory', async () => {
    const inputs = listMeasuredSourceInputs();
    for (const input of [
      'Cargo.lock',
      'Cargo.toml',
      'bun.lock',
      'bunfig.toml',
      'package.json',
      'rust-toolchain.toml',
      '.cargo/config.toml',
      'apps/web/index.html',
      'apps/web/package.json',
      'apps/web/playwright.config.ts',
      'apps/web/vite-ci.config.ts',
      'apps/web/src/index.tsx',
      'apps/web/scripts/cache-wasm/cli.ts',
      'apps/web/scripts/cache-wp12/report.ts',
      'apps/web/ops/graphql-cache-wp12-dashboard.json',
      'packages/observability/package.json',
      'packages/observability/src/telemetry.ts',
      'crates/client/cache-core/src/codec.rs',
      'crates/maybe_send/src/lib.rs',
      'crates/client/cache-turso/src/lib.rs',
      'crates/client/cache-wasm/src/lib.rs',
      'crates/client/turso-opfs/src/lib.rs',
    ]) {
      expect(inputs).toContain(input);
    }
    const trackedCrates = execFileSync('git', ['ls-files', '--', 'crates'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .toSorted();
    expect(inputs.filter((input) => input.startsWith('crates/'))).toEqual(
      trackedCrates
    );
    expect(
      inputs.some(
        (input) =>
          !input.startsWith('crates/') &&
          /(?:^|\/)(?:measurements|docs?|\.?dist)(?:\/|$)/.test(input)
      )
    ).toBe(false);
  });

  it('changes the digest when an indirect tracked input changes', async () => {
    const repositoryRoot = await mkdtemp(
      resolve(tmpdir(), 'wp12-source-digest-')
    );
    const indirectPath = 'crates/maybe_send/src/lib.rs';
    try {
      await mkdir(
        resolve(repositoryRoot, 'crates/maybe_send/src'),
        { recursive: true }
      );
      await writeFile(resolve(repositoryRoot, indirectPath), 'first');
      const first = await computeMeasuredSourceDigest(repositoryRoot, [
        indirectPath,
      ]);
      await writeFile(resolve(repositoryRoot, indirectPath), 'second');
      const second = await computeMeasuredSourceDigest(repositoryRoot, [
        indirectPath,
      ]);
      expect(first).toMatch(/^[a-f0-9]{64}$/);
      expect(second).not.toBe(first);
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });

  it('validates canonical provider-neutral formulas and strict thresholds', async () => {
    const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8'));
    expect(() => validateDashboardSpec(dashboard)).not.toThrow();
    expect(evaluateAlert(dashboard, 'transaction-failure', 0.5, 99).state).toBe('insufficient-data');
    expect(evaluateAlert(dashboard, 'transaction-failure', 0.004, 100).state).toBe('normal');
    expect(evaluateAlert(dashboard, 'transaction-failure', 0.005, 100).state).toBe('warning');
    expect(evaluateAlert(dashboard, 'transaction-failure', 0.019, 100).state).toBe('critical');
    expect(rollbackDecision(dashboard, ['transaction-failure'])).toMatchObject({
      action: 'trip-kill-switch',
      target: 'disable-browser-turso-cache',
      mutationPerformed: false,
      requiresExternalExecutor: true,
    });
  });

  it('flushes the current denominator before evaluating raw errors', async () => {
    const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8'));
    const observations: CacheTelemetryObservation[] = [];
    const recorder = new CacheTelemetryRecorder({
      emit: (observation) => observations.push(observation),
    });
    for (let index = 0; index < 149; index++) {
      recorder.record({
        name: 'graphql_cache.transaction',
        operationCategory: 'transaction',
        outcome: 'success',
        durationMs: 1,
      });
    }
    for (let index = 0; index < 2; index++) {
      recorder.record({
        name: 'graphql_cache.transaction',
        operationCategory: 'transaction',
        outcome: 'error',
        errorCode: 'opfs-io',
      });
    }

    expect(
      observations.filter(
        (observation) =>
          observation.name === 'graphql_cache.aggregate' &&
          observation.outcome === 'error'
      )
    ).toEqual([]);
    const rate = recorderErrorRate(observations, 'graphql_cache.transaction');
    expect(rate).toEqual({ observedValue: 2 / 151, eventCount: 151 });
    const evaluation = evaluateAlert(
      dashboard,
      'transaction-failure',
      rate.observedValue,
      rate.eventCount
    );
    expect(evaluation.state).toBe('warning');
    expect(evaluation.state).not.toBe('critical');
  });

  it('validates the exact matrix and reports only a local subset', async () => {
    const [dashboard, matrix] = await Promise.all(
      [dashboardPath, matrixPath].map(async (path) => JSON.parse(await readFile(path, 'utf8')))
    );
    expect(validateTestMatrix(matrix)).toBeGreaterThan(0);
    const chromium = evidence('chromium');
    const firefox = evidence('firefox');
    const report = buildWp12Report({
      evidence: [chromium, firefox],
      dashboard,
      matrix,
      expectedRevisionChangeId: revision,
      expectedSourceDigest: sourceDigest,
      expectedWasmSha256: wasmSha256,
      executableSha256ByPath: validationContext.executableSha256ByPath,
      now,
    });
    expect(report).toMatchObject({
      schemaVersion: 5,
      measuredSourceDigest: sourceDigest,
      status: 'candidate-local-subset-pass-exposure-blocked',
      exposurePercent: 0,
      claims: {
        allLocalGatesPassed: false,
        productionWrapperDefaultOffBrowserVerified: true,
        realStandbyTabCloseVerified: true,
        realLogoutResetVerified: true,
        posthogTreatmentOverrideVerified: true,
        nextNavigationEmergencyDisableVerified: true,
        posthogNetworkRequestsObserved: false,
        admittedMutatingRpcTerminationVerified: true,
        incompatibleNamespaceRecoveryVerified: true,
        corruptQueuePayloadRecoveryVerified: true,
        queueDiagnosticsTelemetryVerified: true,
        initializationRecoveryOutcomeTelemetryVerified: true,
        totalWorkerMemoryTelemetryImplemented: false,
      },
    });
  });

  it('closes browser evidence recursively and binds revision/source/browser/executables/artifacts', () => {
    const base = evidence('chromium');
    expect(() => validateWp12BrowserEvidence(base, validationContext)).not.toThrow();
    const attacks: Array<[unknown, string]> = [
      [{ ...base, measuredSourceDigest: 'd'.repeat(64) }, 'source digest'],
      [{ ...base, measuredRevisionChangeId: 'wrong' }, 'revision'],
      [{ ...base, measuredAt: '2026-08-12T00:00:00.000Z' }, 'timestamp'],
      [{ ...base, runner: { ...base.runner, executableSha256: 'e'.repeat(64) } }, 'executable'],
      [{ ...base, browser: { ...base.browser, userAgent: 'Chrome/999.0' } }, 'user-agent'],
      [{ ...base, resources: { ...base.resources, wasm: { ...base.resources.wasm, sha256: 'f'.repeat(64) } } }, 'WASM'],
      [{ ...base, resources: { ...base.resources, engineWorkerUrls: ['http://evil/worker.js'] } }, 'worker URL'],
      [{ ...base, scenarios: { ...base.scenarios, gracefulPreserve: false } }, 'scenario'],
      [{ ...base, finalizer: { ...base.finalizer, completedTests: base.finalizer.completedTests.slice(1) } }, 'every required test'],
      [{ ...base, testArtifacts: { recoveryHooks: { ...base.testArtifacts.recoveryHooks, wasm: { ...base.testArtifacts.recoveryHooks.wasm, sha256: wasmSha256 } } } }, 'recovery-hook WASM'],
      [{ ...base, nested: { allowedLooking: true } }, 'unknown or missing keys'],
    ];
    for (const [attack, message] of attacks) {
      expect(() => validateWp12BrowserEvidence(attack, validationContext)).toThrow(message);
    }
    for (const field of ['email', 'authorization', 'authToken', 'scope', 'entityId', 'graphqlDocument', 'recordBytes']) {
      expect(() => validateWp12BrowserEvidence({ ...base, runner: { ...base.runner, nested: { [field]: 'private' } } }, validationContext)).toThrow('privacy-forbidden');
    }
  });

  it('rejects unknown dashboard fields, duplicate inventories, bad bounds, and fabricated definitions', async () => {
    const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8'));
    const unknown = clone(dashboard);
    unknown.rollback.fabricated = true;
    expect(() => validateDashboardSpec(unknown)).toThrow('unknown or missing keys');

    const identityDimension = clone(dashboard);
    identityDimension.telemetryContract.dimensions.push('userId');
    expect(() => validateDashboardSpec(identityDimension)).toThrow('exactly match');

    const fabricatedQuery = clone(dashboard);
    fabricatedQuery.queries[0].selector = "email='private@example.com'";
    expect(() => validateDashboardSpec(fabricatedQuery)).toThrow('not canonical');

    const invalidAlert = clone(dashboard);
    invalidAlert.alerts[0].minimumEvents = 0;
    expect(() => validateDashboardSpec(invalidAlert)).toThrow('invalid canonical');

    const impossibleThreshold = clone(dashboard);
    impossibleThreshold.alerts[0].warning =
      impossibleThreshold.alerts[0].critical + 1;
    expect(() => validateDashboardSpec(impossibleThreshold)).toThrow(
      'invalid canonical'
    );

    for (const [field, value] of [
      ['windowMinutes', 16],
      ['minimumEvents', 101],
      ['warning', 0.011],
      ['critical', 0.031],
    ] as const) {
      const alteredAlert = clone(dashboard);
      alteredAlert.alerts[0][field] = value;
      expect(() => validateDashboardSpec(alteredAlert)).toThrow(
        'alert safety policy values'
      );
    }

    const duplicateQuery = clone(dashboard);
    duplicateQuery.queries.push(clone(duplicateQuery.queries[0]));
    expect(() => validateDashboardSpec(duplicateQuery)).toThrow('duplicate IDs');

    const duplicateAlert = clone(dashboard);
    duplicateAlert.alerts.push(clone(duplicateAlert.alerts[0]));
    expect(() => validateDashboardSpec(duplicateAlert)).toThrow('duplicate IDs');

    const duplicatePanel = clone(dashboard);
    duplicatePanel.panels.push(clone(duplicatePanel.panels[0]));
    expect(() => validateDashboardSpec(duplicatePanel)).toThrow('duplicate IDs');

    const fabricatedPanel = clone(dashboard);
    fabricatedPanel.panels.push({
      id: 'fabricated-private-panel',
      queryIds: ['db-ready-error-rate'],
      statistics: ['count'],
    });
    expect(() => validateDashboardSpec(fabricatedPanel)).toThrow(
      'inventory is not canonical'
    );

    const invalidQueryReference = clone(dashboard);
    invalidQueryReference.panels[0].queryIds = ['fabricated-query'];
    expect(() => validateDashboardSpec(invalidQueryReference)).toThrow();

    const invalidPercent = clone(dashboard);
    invalidPercent.rollout.stages[0].maximumPercent = 101;
    expect(() => validateDashboardSpec(invalidPercent)).toThrow('exceeds 100');

    const invalidSoak = clone(dashboard);
    invalidSoak.rollout.stages[0].minimumSoakHours = -1;
    expect(() => validateDashboardSpec(invalidSoak)).toThrow(
      'finite non-negative'
    );

    const zeroSoak = clone(dashboard);
    zeroSoak.rollout.stages[0].minimumSoakHours = 0;
    expect(() => validateDashboardSpec(zeroSoak)).toThrow(
      'stage safety policy values'
    );

    const alteredStagePercent = clone(dashboard);
    alteredStagePercent.rollout.stages[0].maximumPercent = 2;
    expect(() => validateDashboardSpec(alteredStagePercent)).toThrow(
      'stage safety policy values'
    );

    const negativeRetention = clone(dashboard);
    negativeRetention.rollback.priorVersionRetention.minimumReleases = -1;
    expect(() => validateDashboardSpec(negativeRetention)).toThrow(
      'rollback safety policy values'
    );

    for (const field of [
      'executor',
      'failureMode',
      'activeSessionBehavior',
      'maximumEmergencyEffectDelay',
    ]) {
      const arbitraryPolicy = clone(dashboard);
      arbitraryPolicy.rollback[field] = 'arbitrary-policy-string';
      expect(() => validateDashboardSpec(arbitraryPolicy)).toThrow(
        'rollback safety policy values'
      );
    }

    const missingPromotionGate = clone(dashboard);
    missingPromotionGate.rollout.promotionRequires.pop();
    expect(() => validateDashboardSpec(missingPromotionGate)).toThrow(
      'promotion gates'
    );
  });

  it('rejects duplicate matrix IDs, status promotion, and swapped evidence mappings', async () => {
    const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
    const removed = clone(matrix);
    removed.sections[2].cases.pop();
    expect(() => validateTestMatrix(removed)).toThrow('inventory is not canonical');

    const duplicateSection = clone(matrix);
    duplicateSection.sections.push(clone(duplicateSection.sections[0]));
    expect(() => validateTestMatrix(duplicateSection)).toThrow('duplicate IDs');

    const duplicateCase = clone(matrix);
    duplicateCase.sections[0].cases.push(
      clone(duplicateCase.sections[0].cases[0])
    );
    expect(() => validateTestMatrix(duplicateCase)).toThrow('duplicate IDs');

    const promoted = clone(matrix);
    promoted.sections[2].cases.find((entry: { id: string }) => entry.id === '10.3.10d').coverage.chromium = 'verified-real-browser';
    expect(() => validateTestMatrix(promoted)).toThrow('status floor');

    const swappedEvidence = clone(matrix);
    const firstEvidence = swappedEvidence.sections[0].cases[2].evidence;
    swappedEvidence.sections[0].cases[2].evidence =
      swappedEvidence.sections[0].cases[3].evidence;
    swappedEvidence.sections[0].cases[3].evidence = firstEvidence;
    expect(() => validateTestMatrix(swappedEvidence)).toThrow(
      'requirement/evidence mappings'
    );

    const badReference = clone(matrix);
    badReference.sections[0].cases[0].evidence = [
      'apps/web/does-not-exist.test.ts',
    ];
    expect(() => validateTestMatrix(badReference)).toThrow(
      'invalid evidence reference'
    );
  });
});
