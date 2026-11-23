import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import type { ImportRun, NotionImportReport } from '@service-cognition/import';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { ImportJobsContext } from '../context/contracts';
import { ImportJobsProvider } from '../context/import-jobs-context';
import { ImportJobsTrayView } from '../views/import-jobs-tray';

// The real tray over in-memory runs and reports. The buttons move a Notion
// import through planning, writing and done, and fail a Jira one.
const [runs, setRuns] = createSignal<readonly ImportRun[]>([]);
const [notionReport, setNotionReport] = createSignal<NotionImportReport>();
const [opened, setOpened] = createSignal('');

const REPORT: NotionImportReport = {
  status: 'running',
  onTeam: false,
  pages: 0,
  dataSources: 0,
  copy: 0,
  tasks: 0,
  skip: 0,
  hand: 0,
  documents: 0,
  databases: 0,
  databaseRows: 0,
  taskRows: 0,
  imported: 0,
  waiting: 0,
  writing: 0,
};

function setRun(run: ImportRun) {
  setRuns((previous) => [
    ...previous.filter((other) => other.source !== run.source),
    run,
  ]);
}

const context: ImportJobsContext = {
  createRuns: () => ({ runs, slackChannelsImporting: () => 0 }),
  createReport: (source) => () =>
    source === 'notion' ? notionReport() : undefined,
  openSession: (sessionId) => setOpened(sessionId),
};

function scanNotion() {
  setNotionReport(REPORT);
  setRun({
    source: 'notion',
    status: 'running',
    updated_at: new Date().toISOString(),
    scanned: { pages: 120, dataSources: 4 },
  });
}

function writeNotion() {
  setNotionReport({
    ...REPORT,
    status: 'importing',
    pages: 120,
    dataSources: 4,
    imported: 31,
    waiting: 90,
    writing: 3,
  });
  setRun({
    source: 'notion',
    status: 'importing',
    updated_at: new Date().toISOString(),
    review_session_id: 'notion-session',
  });
}

function finishNotion() {
  setNotionReport({ ...REPORT, status: 'completed', imported: 124 });
  setRun({
    source: 'notion',
    status: 'completed',
    updated_at: new Date().toISOString(),
    review_session_id: 'notion-session',
  });
}

function failJira() {
  setRun({
    source: 'jira',
    status: 'failed',
    error: 'Jira refused the request',
    updated_at: new Date().toISOString(),
    review_session_id: 'jira-session',
  });
}

function Fixture() {
  return (
    <ImportJobsProvider context={context}>
      <main class="flex min-h-screen flex-col items-start gap-2 bg-page p-6">
        <Button variant="secondary" onClick={scanNotion}>
          Scan Notion
        </Button>
        <Button variant="secondary" onClick={writeNotion}>
          Write Notion
        </Button>
        <Button variant="secondary" onClick={finishNotion}>
          Finish Notion
        </Button>
        <Button variant="secondary" onClick={failJira}>
          Fail Jira
        </Button>
        <output aria-label="Opened session" class="text-xs text-ink-muted">
          {opened()}
        </output>
      </main>
      <div class="fixed bottom-5 right-5 flex w-[380px] flex-col items-stretch pointer-events-none">
        <ImportJobsTrayView />
      </div>
    </ImportJobsProvider>
  );
}

applyTheme(
  new URLSearchParams(location.search).get('theme') === 'light'
    ? 'Macro Light'
    : 'Macro Dark'
);
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);
