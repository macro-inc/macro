import ArrowRight from '@icon/system/regular/arrow-right.svg';
import CompanyIcon from '@icon/system/regular/building-office.svg';
import CommentIcon from '@icon/system/regular/chat-text.svg';
import EmailIcon from '@icon/system/regular/envelope.svg';
import TaskIcon from '@icon/system/regular/list-checks.svg';
import CallIcon from '@icon/system/regular/phone-call.svg';
import ClaudeIcon from '@icon/wide-claude.svg';
import SheetIcon from '@icon/wide-spreadsheet.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { homepagePeople } from '../../core/homepage-demo-people';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { createViewStepper } from '../../primitives/createViewStepper';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import { cellAddress, type SheetCursor, SheetGrid } from './SheetGrid';
import './sheet-stories.css';

type Person = keyof typeof homepagePeople;

function Avatar(props: { person: Person }) {
  return (
    <img class="sheet-avatar" src={homepagePeople[props.person].photo} alt="" />
  );
}

/** A sheet's title row: its name, and who is in it. */
function SheetTitle(props: { name: string; children?: JSX.Element }) {
  return (
    <div class="sheet-title">
      <SheetIcon aria-hidden="true" />
      <strong>{props.name}</strong>
      <span class="sheet-title-people">{props.children}</span>
    </div>
  );
}

/** Team, last quarter's spend, the forecast an agent writes, and its change. */
const budget = [
  ['Marketing', '42,000', '46,200', '+10%'],
  ['Engineering', '68,500', '71,900', '+5%'],
  ['Design', '18,200', '19,100', '+5%'],
  ['Sales', '31,000', '37,200', '+20%'],
  ['Events', '12,400', '9,900', '-20%'],
];
const budgetTotal = ['Total', '172,100', '184,300', '+7%'];
const FORECAST_FORMULA = '=SUM(C2:C6)';

/**
 * An agent builds next quarter's forecast in the sheet while a teammate works
 * beside it: its cursor moves cell to cell as the values appear.
 */
export function SheetAgentDemo(props: { compact?: boolean }) {
  let root!: HTMLDivElement;
  const [written, setWritten] = createStore<Record<string, string>>({});
  const [claude, setClaude] = createSignal({ row: 0, column: 2, rows: 1 });
  const [julia, setJulia] = createSignal({ row: 3, column: 1 });
  const [formula, setFormula] = createSignal('');

  const write = (address: string, value: string) => setWritten(address, value);
  const move = (row: number, column: number, rows = 1) => {
    setFormula('');
    setClaude({ row, column, rows });
  };
  const writeChanges = () => {
    budget.forEach((team, index) => write(`D${index + 2}`, team[3]));
    write('D7', budgetTotal[3]);
  };

  // Delays are the pause before each step.
  const forecast = [
    { delay: 1300, run: () => move(0, 2) },
    { delay: 320, run: () => write('C1', 'Q1 forecast') },
    ...budget.flatMap((team, index) => [
      { delay: 380, run: () => move(index + 1, 2) },
      { delay: 260, run: () => write(`C${index + 2}`, team[2]) },
    ]),
    {
      delay: 420,
      run: () => {
        move(6, 2);
        setJulia({ row: 5, column: 0 });
      },
    },
    ...demoTypingActions(
      FORECAST_FORMULA,
      (text) => {
        write('C7', text);
        setFormula(text);
      },
      260
    ),
    { delay: 520, run: () => write('C7', budgetTotal[2]) },
  ];
  // The narrow artboard has no room for the change column.
  const actions = props.compact
    ? forecast
    : [
        ...forecast,
        { delay: 600, run: () => move(0, 3) },
        { delay: 300, run: () => write('D1', 'Change') },
        { delay: 420, run: () => move(1, 3, 6) },
        { delay: 420, run: writeChanges },
        { delay: 700, run: () => move(6, 3) },
      ];

  createProductWalkthrough({
    root: () => root,
    steps: actions.length,
    loop: { hold: 6000 },
    reset: () => {
      setWritten(reconcile({}));
      setClaude({ row: 0, column: 2, rows: 1 });
      setJulia({ row: 3, column: 1 });
      setFormula('');
    },
    reduced: () => {
      write('C1', 'Q1 forecast');
      budget.forEach((team, index) => write(`C${index + 2}`, team[2]));
      write('C7', budgetTotal[2]);
      if (!props.compact) {
        write('D1', 'Change');
        writeChanges();
      }
      move(6, props.compact ? 2 : 3);
    },
    delay: (step) => actions[step - 1].delay,
    advance: (step) => actions[step - 1].run(),
  });

  const cell = (address: string, bold = false) => (
    <Show when={written[address]}>
      <span class="sheet-written" data-bold={bold}>
        {written[address]}
      </span>
    </Show>
  );
  const row = (cells: JSX.Element[]) =>
    props.compact ? cells.slice(0, 3) : cells;
  const rows = [
    row([<b>Team</b>, <b>Q4 spend</b>, cell('C1', true), cell('D1', true)]),
    ...budget.map((team, index) =>
      row([team[0], team[1], cell(`C${index + 2}`), cell(`D${index + 2}`)])
    ),
    row([
      <b>{budgetTotal[0]}</b>,
      <b>{budgetTotal[1]}</b>,
      cell('C7', true),
      cell('D7', true),
    ]),
  ];
  const cursors = (): SheetCursor[] => [
    { ...julia(), name: 'Julia', tone: 'person' },
    {
      ...claude(),
      name: 'Claude',
      tone: 'agent',
      icon: <ClaudeIcon aria-hidden="true" />,
    },
  ];
  const address = () => cellAddress(claude().row, claude().column);

  return (
    <div ref={root} class="sheet-story">
      <div class="sheet-frame">
        <SheetTitle name="Launch budget">
          <Avatar person="julia" />
          <span class="sheet-agent-badge">
            <ClaudeIcon aria-hidden="true" />
          </span>
        </SheetTitle>
        <div class="sheet-formula">
          <span>{address()}</span>
          <i>fx</i>
          <span>{formula() || written[address()]}</span>
        </div>
        <SheetGrid
          widths={props.compact ? [116, 96, 110] : [156, 112, 124, 112]}
          numeric={[1, 2, 3]}
          rows={rows}
          cursors={cursors()}
        />
      </div>
    </div>
  );
}

type Account = {
  id: string;
  company: string;
  contact: string;
  renewal: string;
  arr: string;
  stage: string;
  owner: Person;
  email: string;
  call: string;
  task: string;
};

/** Illustrative accounts; these are not real customers. */
const accounts: Account[] = [
  {
    id: 'lumen',
    company: 'Lumen',
    contact: 'Maya Lin',
    renewal: 'Dec 1',
    arr: '48,000',
    stage: 'Customer',
    owner: 'julia',
    email: 'Renewal terms · 2d ago',
    call: 'Renewal review · Thu 2 PM',
    task: 'Send the renewal quote',
  },
  {
    id: 'fieldnote',
    company: 'Fieldnote',
    contact: 'Owen Park',
    renewal: 'Dec 12',
    arr: '24,000',
    stage: 'Negotiation',
    owner: 'teo',
    email: 'Pricing questions · 5h ago',
    call: 'Pricing call · Fri 11 AM',
    task: 'Draft the new order form',
  },
  {
    id: 'harbor',
    company: 'Harbor',
    contact: 'Priya Shah',
    renewal: 'Jan 8',
    arr: '36,000',
    stage: 'Customer',
    owner: 'jacob',
    email: 'Seats for the new team · 1d ago',
    call: 'Check-in · Mon 9:30 AM',
    task: 'Add ten seats to the plan',
  },
  {
    id: 'kindred',
    company: 'Kindred',
    contact: 'Leo Martins',
    renewal: 'Jan 20',
    arr: '18,000',
    stage: 'Customer',
    owner: 'julia',
    email: 'Invoice received · 3d ago',
    call: 'No call scheduled',
    task: 'Confirm the billing contact',
  },
];
/** The card opens under its row, so only the first rows are stepped through. */
const steppedAccounts = accounts.slice(0, 3).map((account) => account.id);

/**
 * A renewals sheet whose company cells are CRM records: the selected company
 * shows its record card, with the stage, owner, and latest activity.
 */
export function SheetCrmGraphic(props: { compact?: boolean }) {
  let root!: HTMLDivElement;
  const { view: selected, choose } = createViewStepper(
    steppedAccounts,
    () => root
  );
  const account = () => accounts.find((item) => item.id === selected())!;
  const index = () => accounts.indexOf(account());
  const widths = () => (props.compact ? [126, 114, 82] : [160, 148, 100, 96]);
  const row = (cells: JSX.Element[]) =>
    props.compact ? [cells[0], cells[1], cells[3]] : cells;
  const rows = [
    row([<b>Company</b>, <b>Contact</b>, <b>Renewal</b>, <b>ARR</b>]),
    ...accounts.map((item) =>
      row([
        <button
          type="button"
          class="sheet-record-link"
          aria-pressed={selected() === item.id}
          aria-label={`Show ${item.company}`}
          disabled={!steppedAccounts.includes(item.id)}
          onClick={() => choose(item.id)}
        >
          <CompanyIcon aria-hidden="true" />
          <span>{item.company}</span>
        </button>,
        <span class="sheet-mention">@{item.contact}</span>,
        item.renewal,
        `$${item.arr}`,
      ])
    ),
  ];

  return (
    <div ref={root} class="sheet-story">
      <div class="sheet-frame">
        <SheetTitle name="Renewals">
          <Avatar person="julia" />
          <Avatar person="teo" />
        </SheetTitle>
        <SheetGrid
          widths={widths()}
          numeric={props.compact ? [2] : [3]}
          rows={rows}
          cursors={[{ row: index() + 1, column: 0, name: 'You', tone: 'self' }]}
        />
      </div>
      <div
        class="sheet-record sheet-popover"
        aria-live="polite"
        style={{ '--sheet-record-row': index() + 1 }}
      >
        <div class="sheet-record-head">
          <CompanyIcon aria-hidden="true" />
          <strong>{account().company}</strong>
          <span class="sheet-record-stage" data-stage={account().stage}>
            {account().stage}
          </span>
        </div>
        <dl>
          <div>
            <dt>Owner</dt>
            <dd>
              <Avatar person={account().owner} />
              {homepagePeople[account().owner].name}
            </dd>
          </div>
          <div>
            <dt>Last email</dt>
            <dd>
              <EmailIcon aria-hidden="true" />
              {account().email}
            </dd>
          </div>
          <div>
            <dt>Next call</dt>
            <dd>
              <CallIcon aria-hidden="true" />
              {account().call}
            </dd>
          </div>
          <div>
            <dt>Open task</dt>
            <dd>
              <TaskIcon aria-hidden="true" />
              {account().task}
            </dd>
          </div>
        </dl>
        <span class="sheet-record-open">
          Open in CRM
          <ArrowRight aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

/** A selected range charted beside the sheet, with a comment on one cell. */
export function SheetChartGraphic(props: { compact?: boolean }) {
  const top = Math.max(
    ...budget.map((team) => Number(team[1].replace(',', '')))
  );
  return (
    <div class="sheet-story" data-layout="chart">
      <div class="sheet-frame">
        <SheetTitle name="Launch budget">
          <Avatar person="teo" />
        </SheetTitle>
        <div class="sheet-formula">
          <span>B7</span>
          <i>fx</i>
          <span>=SUM(B2:B6)</span>
        </div>
        <div class="sheet-chart-layout">
          <SheetGrid
            widths={props.compact ? [190, 132] : [124, 100]}
            numeric={[1]}
            rows={[
              [<b>Team</b>, <b>Q4 spend</b>],
              ...budget.map((team) => [team[0], team[1]]),
              [<b>{budgetTotal[0]}</b>, <b>{budgetTotal[1]}</b>],
            ]}
            cursors={[
              { row: 1, column: 1, rows: 5, name: 'You', tone: 'self' },
            ]}
          />
          <figure class="sheet-chart">
            <figcaption>Q4 spend by team</figcaption>
            <div class="sheet-chart-bars">
              <For each={budget}>
                {(team) => (
                  <div>
                    <i
                      style={{
                        '--bar': Number(team[1].replace(',', '')) / top,
                      }}
                    />
                    <span>{team[0]}</span>
                  </div>
                )}
              </For>
            </div>
          </figure>
          <div class="sheet-comment sheet-popover">
            <div>
              <Avatar person="teo" />
              <strong>{homepagePeople.teo.shortName}</strong>
              <span>on B6</span>
            </div>
            <p>Is the events number final?</p>
            <span class="sheet-comment-replies">
              <CommentIcon aria-hidden="true" />2 replies
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * An uploaded Excel workbook as the app opens it: read-only under the notice
 * that offers an editable copy, with its sheets as tabs along the bottom.
 */
export function SheetImportGraphic(props: { compact?: boolean }) {
  return (
    <div class="sheet-story">
      <div class="sheet-frame">
        <SheetTitle name="Launch budget.xlsx" />
        <div class="sheet-upload">
          <span>
            Uploaded workbook · Convert to edit and collaborate. The original
            file stays available.
          </span>
          <span class="sheet-upload-action">Edit in Macro</span>
        </div>
        <SheetGrid
          widths={props.compact ? [116, 96, 110] : [156, 112, 124, 112]}
          numeric={[1, 2, 3]}
          rows={[
            (props.compact
              ? ['Team', 'Q4 spend', 'Q1 forecast']
              : ['Team', 'Q4 spend', 'Q1 forecast', 'Change']
            ).map((heading) => <b>{heading}</b>),
            ...[...budget, budgetTotal].map((row) =>
              row.slice(0, props.compact ? 3 : 4)
            ),
          ]}
        />
        <div class="sheet-tabs">
          <span data-active="true">Budget</span>
          <span>Forecast</span>
          <span>Vendors</span>
        </div>
      </div>
    </div>
  );
}
