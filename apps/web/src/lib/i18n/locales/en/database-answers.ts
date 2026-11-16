export default {
  // A saved database query's answer card in a document, and its inline chip.
  databaseAnswer: 'Database answer',
  database: 'Database',
  details: 'Details',
  closeDatabaseAnswer: 'Close database answer',
  answerTitle: 'Answer title',
  doubleClickToRename: 'Double-click to rename',
  // The card's title as a tooltip, when it can be renamed.
  titleDoubleClickToRename: '{{title}} · Double-click to rename',
  resizeDatabaseAnswer: 'Resize database answer',
  // Screen-reader label while the card's answer loads.
  loadingAnswer: 'Loading answer',
  // The chip's value while its answer loads.
  loadingAnswerValue: 'Loading answer…',
  answerUnavailable: 'Answer unavailable',
  recordCount: {
    one: '{{count}} record',
    other: '{{count}} records',
  },

  // The answer itself.
  questionResults: 'Question results',
  partialAnswer:
    'Partial answer: {{tables}} exceeded the data limit. Totals may be incomplete.',
  noMatchingRecords: 'No matching records. Try a broader question.',
  showingFirstResults: 'Showing 100 of {{count}} results',
  viewData: 'View data',
  empty: 'Empty',
  true: 'True',
  false: 'False',
  // A select option deleted since the answer was read.
  unknownOption: 'Unknown option',

  // How many items a cell references, when their names are unknown.
  peopleCount: { one: '{{count}} person', other: '{{count}} people' },
  documentCount: { one: '{{count}} document', other: '{{count}} documents' },
  taskCount: { one: '{{count}} task', other: '{{count}} tasks' },
  channelCount: { one: '{{count}} channel', other: '{{count}} channels' },
  projectCount: { one: '{{count}} project', other: '{{count}} projects' },
  chatCount: { one: '{{count}} chat', other: '{{count}} chats' },
  emailCount: { one: '{{count}} email', other: '{{count}} emails' },
  companyCount: { one: '{{count}} company', other: '{{count}} companies' },
  contactCount: { one: '{{count}} contact', other: '{{count}} contacts' },
  callCount: { one: '{{count}} call', other: '{{count}} calls' },
  eventCount: { one: '{{count}} event', other: '{{count}} events' },
  linkedRecordCount: {
    one: '{{count}} linked record',
    other: '{{count}} linked records',
  },
  itemCount: { one: '{{count}} item', other: '{{count}} items' },

  // Charts.
  chartTitle: '{{values}} by {{label}}',
  chartTitleSplit: '{{values}} by {{label}} and {{split}}',
  chartOther: 'Other',
  chartOtherTip: {
    one: 'Other ({{count}} category)',
    other: 'Other ({{count}} categories)',
  },
  chartOmitted: {
    one: '{{count}} record without a {{column}} isn’t shown.',
    other: '{{count}} records without a {{column}} aren’t shown.',
  },
  chartNeedsColumns: 'A chart needs a label column and a number column.',
  chartNoRecords: 'There are no matching records to chart.',
  chartColumnsUnavailable:
    'This chart’s columns are unavailable. Update the question or view the result table.',
  chartTooManyCategories:
    'This result has more than 20 categories. Choose Bar or ask for fewer groups.',
  chartTooManyPoints:
    'This result has more than 300 points. Ask for a summary or a smaller date range.',
  chartNeedsNumbers:
    'A chart needs numeric values. View the table or ask for a numeric summary.',
  chartNoNumbers: 'There are no numeric values to chart.',
  pieNeedsOneSeries:
    'A pie chart needs one series of nonnegative values. Choose Bar to compare these values.',
  pieNeedsPositive: 'A pie chart needs at least one value greater than zero.',
  chartFailed: 'The chart could not load. View the data below.',
  chartTooManyGroups:
    'This chart splits into more than {{max}} groups. Ask for fewer groups or view the table.',

  // The card's Details popover for readers.
  databaseQuestion: 'Database question',
  findingAnswer: 'Finding your answer…',
  viewSql: 'View SQL',
  refresh: 'Refresh',
};
