// this uses a shared instance of Intl.DateTimeFormat which is costly to create (100ms+)
// see: https://github.com/moment/luxon/issues/352
const relativeDateFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeStyle: 'short',
});
export function relativeTime(date: string) {
  if (date.length === 0) return '';
  return relativeDateFormat.format(new Date(date.split(',')[0]));
}
