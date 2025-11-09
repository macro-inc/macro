import { withAnalytics } from '@coparse/analytics';

const { track, TrackingEvents } = withAnalytics();

const frameTitle = 'printf';
let frame = document.createElement('iframe');
let src = '';

export async function doPrint(blob?: Blob | null) {
  if (!blob) return console.error('No blob to print');
  track(TrackingEvents.BLOCKPDF.FILEMENU.PRINT);
  // workaround to make this fn idempotent
  frame.remove();
  URL.revokeObjectURL(src);
  // end workaround

  frame = document.createElement('iframe');
  src = URL.createObjectURL(blob);
  frame.src = src;
  frame.title = frameTitle;
  frame.id = frameTitle;
  frame.name = frameTitle;
  frame.style.setProperty('display', 'hidden');
  frame.width = '0';
  frame.height = '0';
  const prom = new Promise((resolve) => {
    frame.onload = resolve;
  });
  document.body.appendChild(frame);
  await prom;
  const { contentWindow } = frame;
  if (!contentWindow)
    return console.error('frame created without contentWindow');
  contentWindow.focus();
  contentWindow.print();
  // TODO once electron onafterprint event is fixed
  // free the string and iframe
}
