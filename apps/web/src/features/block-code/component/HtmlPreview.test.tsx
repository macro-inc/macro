import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok, type Result } from 'neverthrow';
import { batch, createSignal, Show } from 'solid-js';
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
    harness.runDocumentProgram.mockReset();
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

    const { frame } = frameToken();
    setSaving(true);
    setSavedVersion(2);
    expect(frameToken().frame).toBe(frame);
    expect(harness.getDocumentBuild).toHaveBeenCalledTimes(1);
    setSaving(false);
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

  it('does not mount a cached frame when returning to Render during a save', async () => {
    const built = (sourceHash: string): DocumentBuildResponse => ({
      status: 'built',
      sourceHash,
      html: `<p>${sourceHash}</p>`,
      programs: ['tasks'],
    });
    harness.getDocumentBuild.mockResolvedValueOnce(ok(built('old')));
    const [show, setShow] = createSignal(true);
    const [saving, setSaving] = createSignal(false);
    const [version, setVersion] = createSignal(0);
    const client = new QueryClient();
    render(() => (
      <QueryClientProvider client={client}>
        <Show when={show()}>
          <HtmlPreview
            text="<p>edited</p>"
            documentId="doc"
            saving={saving()}
            savedVersion={version()}
          />
        </Show>
      </QueryClientProvider>
    ));
    await screen.findByTitle('HTML preview');
    setShow(false);
    setSaving(true);
    setShow(true);
    expect(screen.queryByTitle('HTML preview')).toBeNull();
    expect(harness.getDocumentBuild).toHaveBeenCalledTimes(1);

    let finishBuild: (value: Result<DocumentBuildResponse, never>) => void =
      () => {
        throw new Error('build not requested');
      };
    harness.getDocumentBuild.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishBuild = resolve;
        })
    );
    batch(() => {
      setVersion(1);
      setSaving(false);
    });
    await vi.waitFor(() =>
      expect(harness.getDocumentBuild).toHaveBeenCalledTimes(2)
    );
    expect(screen.queryByTitle('HTML preview')).toBeNull();
    finishBuild(ok(built('new')));
    await vi.waitFor(() =>
      expect(frameToken().frame.getAttribute('srcdoc')).toContain('<p>new</p>')
    );
    client.clear();
  });

  const renderPreview = (text: string) => {
    const client = new QueryClient();
    render(() => (
      <QueryClientProvider client={client}>
        <HtmlPreview text={text} documentId="doc" />
      </QueryClientProvider>
    ));
    return client;
  };

  it('keeps the frame when a refetch returns the same build', async () => {
    const built: DocumentBuildResponse = {
      status: 'built',
      sourceHash: 'same',
      html: '<p>page</p>',
      programs: ['tasks'],
    };
    harness.getDocumentBuild.mockResolvedValue(ok({ ...built }));
    const client = renderPreview('<p>raw</p>');
    await vi.waitFor(() => expect(frameToken().token).toBeDefined());
    const { frame, token } = frameToken();

    await client.refetchQueries();

    expect(harness.getDocumentBuild).toHaveBeenCalledTimes(2);
    expect(frameToken().frame).toBe(frame);
    expect(frameToken().token).toBe(token);
  });

  it('says why a page with programs over the build’s size doesn’t run', async () => {
    harness.getDocumentBuild.mockResolvedValue(
      err([{ code: 'BUILD_TOO_LARGE', message: 'too large' }])
    );
    renderPreview(
      '<script type="text/macro" id="tasks" lang="ts">export default () => 1;</script>'
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'over 2 MiB'
    );
    expect(screen.queryByTitle('HTML preview')).toBeNull();
  });

  it('shows a plain page over the build’s size as it is', async () => {
    harness.getDocumentBuild.mockResolvedValue(
      err([{ code: 'BUILD_TOO_LARGE', message: 'too large' }])
    );
    renderPreview('<p>raw</p>');

    await vi.waitFor(() =>
      expect(frameToken().frame.getAttribute('srcdoc')).toBe('<p>raw</p>')
    );
  });

  it('tells the viewer to retry after a stale run reloads the page', async () => {
    const build = (sourceHash: string): DocumentBuildResponse => ({
      status: 'built',
      sourceHash,
      html: `<p>${sourceHash}</p>`,
      programs: ['tasks'],
    });
    harness.getDocumentBuild
      .mockResolvedValueOnce(ok(build('before')))
      .mockResolvedValueOnce(ok(build('after')));
    harness.runDocumentProgram.mockResolvedValueOnce(
      err([{ code: 'DOCUMENT_CHANGED', message: 'This page changed.' }])
    );
    renderPreview('<p>raw</p>');
    await vi.waitFor(() =>
      expect(frameToken().frame.getAttribute('srcdoc')).toContain('before')
    );

    postFromPage((token) => ({
      type: 'macro:run',
      token,
      id: 1,
      program: 'tasks',
      arguments: {},
    }));

    await vi.waitFor(() =>
      expect(frameToken().frame.getAttribute('srcdoc')).toContain('after')
    );
    expect(screen.getByRole('alert').textContent).toContain('Try that again');
  });
});
