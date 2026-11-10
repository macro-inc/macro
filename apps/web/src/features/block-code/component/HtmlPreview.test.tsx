import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DocumentBuildResponse,
  UserExecutionReceipt,
} from '../queries/document-programs';
import { HtmlPreview, ProgramFrame } from './HtmlPreview';

const harness = vi.hoisted(() => ({
  runDocumentProgram: vi.fn(),
  getDocumentBuild: vi.fn(),
}));

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: harness,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true, loading: false }),
}));
vi.mock('../code-mode/event-host', () => ({ attachEventHost: () => () => {} }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    span: (
      _name: string,
      operation: (span: { setAttr: () => void; error: () => void }) => unknown
    ) => operation({ setAttr: () => {}, error: () => {} }),
  },
}));

const failed = (error: string): UserExecutionReceipt => ({
  status: 'failed',
  activity: [],
  activityTruncated: false,
  error,
});

function frameToken() {
  const frame = screen.getByTitle('HTML preview') as HTMLIFrameElement;
  const srcdoc = frame.getAttribute('srcdoc') ?? '';
  return {
    frame,
    token: /\}\)\(parent, "([^"]+)"\)/.exec(srcdoc)?.[1],
  };
}

/** Send a message as the preview frame's page would. */
function postFromPage(data: (token: string | undefined) => unknown) {
  const { frame, token } = frameToken();
  window.dispatchEvent(
    new MessageEvent('message', {
      data: data(token),
      source: frame.contentWindow,
    })
  );
}

function renderFrame() {
  render(() => (
    <ProgramFrame
      documentId="doc"
      html="<p>Page</p>"
      sourceHash="hash"
      onStale={() => {}}
    />
  ));
}

describe('ProgramFrame', () => {
  afterEach(() => {
    cleanup();
    harness.runDocumentProgram.mockReset();
  });

  it('shows the latest failed run until dismissed', async () => {
    harness.runDocumentProgram
      .mockResolvedValueOnce(ok(failed('tasks is not a function')))
      .mockResolvedValueOnce(ok(failed('The program timed out.')));
    renderFrame();
    expect(screen.queryByRole('alert')).toBeNull();

    postFromPage((token) => ({
      type: 'macro:run',
      token,
      id: 1,
      program: 'tasks',
      arguments: {},
    }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'tasks is not a function'
    );

    postFromPage((token) => ({
      type: 'macro:run',
      token,
      id: 2,
      program: 'tasks',
      arguments: {},
    }));
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'The program timed out.'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes a page that starts to navigate away', async () => {
    renderFrame();

    postFromPage((token) => ({ type: 'macro:leaving', token }));

    await vi.waitFor(() =>
      expect(screen.queryByTitle('HTML preview')).toBeNull()
    );
  });

  it('closes a page whose frame loads a second document', async () => {
    renderFrame();
    const { frame } = frameToken();

    fireEvent.load(frame);
    expect(screen.queryByTitle('HTML preview')).not.toBeNull();
    fireEvent.load(frame);

    await vi.waitFor(() =>
      expect(screen.queryByTitle('HTML preview')).toBeNull()
    );
  });
});

describe('HtmlPreview', () => {
  afterEach(() => {
    cleanup();
    harness.getDocumentBuild.mockReset();
  });

  it('builds only once the editor’s save has landed, and again after the next', async () => {
    const built = (html: string): DocumentBuildResponse => ({
      status: 'built',
      sourceHash: html,
      html,
      programs: ['tasks'],
    });
    harness.getDocumentBuild
      .mockResolvedValueOnce(ok(built('<p>first</p>')))
      .mockResolvedValueOnce(ok(built('<p>second</p>')));
    const [saving, setSaving] = createSignal(true);
    const [savedVersion, setSavedVersion] = createSignal(0);
    const client = new QueryClient();
    render(() => (
      <QueryClientProvider client={client}>
        <HtmlPreview
          text="<p>raw</p>"
          documentId="doc"
          saving={saving()}
          savedVersion={savedVersion()}
        />
      </QueryClientProvider>
    ));

    expect(harness.getDocumentBuild).not.toHaveBeenCalled();

    setSavedVersion(1);
    setSaving(false);
    await vi.waitFor(() =>
      expect(frameToken().frame.getAttribute('srcdoc')).toContain('first')
    );

    setSavedVersion(2);
    await vi.waitFor(() =>
      expect(frameToken().frame.getAttribute('srcdoc')).toContain('second')
    );
    expect(harness.getDocumentBuild).toHaveBeenCalledTimes(2);
  });

  it('shows a page without programs as it is', async () => {
    harness.getDocumentBuild.mockResolvedValueOnce(
      ok({ status: 'plain', sourceHash: 'hash' })
    );
    const client = new QueryClient();
    render(() => (
      <QueryClientProvider client={client}>
        <HtmlPreview text="<p>raw</p>" documentId="doc" />
      </QueryClientProvider>
    ));

    await vi.waitFor(() =>
      expect(frameToken().frame.getAttribute('srcdoc')).toBe('<p>raw</p>')
    );
  });
});
