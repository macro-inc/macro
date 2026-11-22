/** Background jobs an agent left running: their cards, chip and events. */
export default {
  inBackground: 'Running in the background',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timedOut: 'Timed out',
  interrupted: 'Stopped: outcome unknown',
  outcomeUnknown: 'Stopped: outcome unknown',
  didNotRun: "Didn't run",
  cancel: 'Cancel',
  cancelJob: 'Cancel job',
  actions: 'Background job actions',
  running: {
    one: '{{count}} job running',
    other: '{{count}} jobs running',
  },
  settledDone: '{{title}} finished',
  settledFailed: '{{title}} failed',
  settledCancelled: '{{title}} cancelled',
  settledTimedOut: '{{title}} ran out of time',
  settledInterrupted: '{{title}} was interrupted',
  settledDidNotRun: "{{title}} didn't run",
};
