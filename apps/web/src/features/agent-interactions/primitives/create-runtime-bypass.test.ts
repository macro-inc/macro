/** @vitest-environment jsdom */
import type { PendingPermission } from '@service-agent-fold/generated/types';
import type { RuntimeBypassOfferDto } from '@service-agent-harness/generated/schemas';
import { err, ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InteractionResponse } from '../context/interaction';
import { createRuntimeBypass } from './create-runtime-bypass';

const queries = vi.hoisted(() => ({
  offer: undefined as (() => RuntimeBypassOfferDto | null) | undefined,
  stopAskingOnRuntime: vi.fn(),
}));

vi.mock('@queries/agent-session/runtime-bypass', () => ({
  useRuntimeBypassOfferQuery: () => ({
    get isPending() {
      return false;
    },
    get data() {
      return queries.offer?.();
    },
  }),
  stopAskingOnRuntime: queries.stopAskingOnRuntime,
}));

const request = {
  requestId: 7,
  turn: 2,
  toolCall: 'tool',
  options: [
    { id: 'once', name: 'Allow once', kind: 'allow_once' },
    { id: 'always', name: 'Always allow cargo test', kind: 'allow_always' },
    { id: 'reject', name: 'Reject', kind: 'reject_once' },
  ],
} satisfies PendingPermission;

function setup() {
  const [offer, setOffer] = createSignal<RuntimeBypassOfferDto | null>({
    harnessId: '0190a8f2-7a4c-7000-8000-000000000001',
    enablesAgentAutoAccept: true,
  });
  queries.offer = offer;
  const order: string[] = [];
  queries.stopAskingOnRuntime.mockImplementation(async () => {
    order.push('stop');
    return ok({
      harnessId: '0190a8f2-7a4c-7000-8000-000000000001',
      agent: 'setToBypass',
    });
  });
  const respond = vi.fn(async (response: InteractionResponse) => {
    order.push(`respond:${JSON.stringify(response)}`);
    return true;
  });
  const confirm = vi.fn(async (_: { alsoSetsAgent: boolean }) => true);
  const onFailure = vi.fn();
  const { runtimeBypass, dispose } = createRoot((dispose) => ({
    runtimeBypass: createRuntimeBypass({
      sessionId: () => 'session-a',
      enabled: () => true,
      respond,
      confirm,
      onFailure,
    }),
    dispose,
  }));
  return {
    runtimeBypass,
    dispose,
    setOffer,
    order,
    respond,
    confirm,
    onFailure,
  };
}

const allowed = {
  kind: 'permission',
  requestId: 7,
  turn: 2,
  answer: { kind: 'selected', optionId: 'once' },
} satisfies InteractionResponse;

describe('stopping the runtime asking', () => {
  beforeEach(() => {
    queries.stopAskingOnRuntime.mockReset();
  });

  it('is offered only when the server offers it and Allow once is unambiguous', () => {
    const { runtimeBypass, setOffer, dispose } = setup();
    expect(runtimeBypass.action(request)).toBeDefined();
    expect(
      runtimeBypass.action({
        ...request,
        options: [
          { id: 'once', name: 'Allow this file', kind: 'allow_once' },
          { id: 'dir', name: 'Allow this folder', kind: 'allow_once' },
        ],
      })
    ).toBeUndefined();
    setOffer(null);
    expect(runtimeBypass.action(request)).toBeUndefined();
    dispose();
  });

  it('turns bypass on before answering Allow once', async () => {
    const { runtimeBypass, order, confirm, onFailure, dispose } = setup();
    await runtimeBypass.stopAsking(request);
    expect(confirm).toHaveBeenCalledWith({ alsoSetsAgent: true });
    expect(queries.stopAskingOnRuntime).toHaveBeenCalledWith('session-a');
    expect(order).toEqual(['stop', `respond:${JSON.stringify(allowed)}`]);
    expect(onFailure).not.toHaveBeenCalled();
    dispose();
  });

  it('changes nothing and answers nothing when the confirmation is declined', async () => {
    const { runtimeBypass, confirm, respond, dispose } = setup();
    confirm.mockResolvedValueOnce(false);
    await runtimeBypass.stopAsking(request);
    expect(queries.stopAskingOnRuntime).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    dispose();
  });

  it('still allows, and says so, when bypass could not be turned on', async () => {
    const { runtimeBypass, respond, onFailure, dispose } = setup();
    queries.stopAskingOnRuntime.mockResolvedValueOnce(
      err([{ code: 'HTTP_ERROR', message: 'forbidden' }])
    );
    await runtimeBypass.stopAsking(request);
    expect(respond).toHaveBeenCalledWith(allowed);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toMatch(/wasn't turned on/);
    dispose();
  });

  it('says the agent still asks when only the runtime changed', async () => {
    const { runtimeBypass, respond, onFailure, dispose } = setup();
    queries.stopAskingOnRuntime.mockResolvedValueOnce(
      ok({
        harnessId: '0190a8f2-7a4c-7000-8000-000000000001',
        agent: 'stillAsks',
      })
    );
    await runtimeBypass.stopAsking(request);
    expect(respond).toHaveBeenCalledWith(allowed);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toMatch(/Bypass is on for this runtime/);
    dispose();
  });
});
