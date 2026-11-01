import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEMO_BOOKING_URL } from '../core/navigation';
import { DemoBookingDialog } from './DemoBookingDialog';

const analytics = vi.hoisted(() => ({ track: vi.fn(), trackMeta: vi.fn() }));
vi.mock('../../../app/utils/utilAnalytic', () => ({ analytics }));

const BOOKING_PATH = new URL(DEMO_BOOKING_URL).pathname;

function renderSite() {
  render(() => (
    <>
      <a href={DEMO_BOOKING_URL} target="_blank" rel="noreferrer">
        <span>Talk to us</span>
      </a>
      <a href="/pricing">Pricing</a>
      <DemoBookingDialog />
    </>
  ));
  return screen.getByRole('link', { name: 'Talk to us' });
}

/** Clicks and reports whether the browser would go on to follow the link. */
function followsLink(element: HTMLElement, init?: MouseEventInit) {
  let followed = false;
  const record = (event: Event) => {
    followed = !event.defaultPrevented;
    // JSDOM cannot navigate; the answer is already recorded.
    event.preventDefault();
  };
  window.addEventListener('click', record, { once: true });
  fireEvent.click(element, init);
  return followed;
}

/** Opens the dialog from the link's inner text and returns its frame. */
async function openDialog() {
  const followed = followsLink(screen.getByText('Talk to us'));
  const frame = (await screen.findByTitle('Book a demo')) as HTMLIFrameElement;
  return { frame, followed };
}

/** Stands in for what the browser put in the frame once it finished loading. */
function finishLoading(
  frame: HTMLIFrameElement,
  location: () => { pathname: string }
) {
  Object.defineProperty(frame, 'contentWindow', {
    value: Object.defineProperty({}, 'location', { get: location }),
  });
  fireEvent.load(frame);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // JSDOM has no default animation-name; presence detection expects `none`.
  const styles = document.createElement('style');
  styles.textContent = '* { animation-name: none; }';
  styles.id = 'test-animation-default';
  document.head.append(styles);
});
afterEach(() => {
  cleanup();
  document.getElementById('test-animation-default')?.remove();
  vi.restoreAllMocks();
});

it('books in a dialog on the page and returns focus to the link when closed', async () => {
  const link = renderSite();
  expect(document.querySelector('iframe')).toBeNull();

  const { frame, followed } = await openDialog();
  expect(followed).toBe(false);
  expect(screen.getByRole('dialog', { name: 'Talk to us' })).toBeTruthy();
  expect(frame.getAttribute('src')).toBe(BOOKING_PATH);
  // The frame has no body yet, as while a real one loads; focus still lands.
  expect(frame.contentDocument?.body).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Close' })
    )
  );
  finishLoading(frame, () => ({ pathname: BOOKING_PATH }));
  expect(window.open).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(link));
});

it('opens for a link an analytics script has added tracking parameters to', async () => {
  const link = renderSite() as HTMLAnchorElement;
  link.href = `${DEMO_BOOKING_URL}?_gl=1*abc`;

  const { frame, followed } = await openDialog();

  expect(followed).toBe(false);
  expect(frame.getAttribute('src')).toBe(BOOKING_PATH);
});

it('leaves new-tab clicks and other links to the browser', () => {
  const link = renderSite();

  expect(followsLink(link, { metaKey: true })).toBe(true);
  expect(followsLink(link, { ctrlKey: true })).toBe(true);
  expect(followsLink(link, { button: 1 })).toBe(true);
  expect(followsLink(screen.getByRole('link', { name: 'Pricing' }))).toBe(true);

  expect(screen.queryByRole('dialog')).toBeNull();
});

it('sends the visitor to the booking page when the frame is refused', async () => {
  renderSite();
  const { frame } = await openDialog();

  // A refused frame holds a cross-origin error page, which cannot be read.
  finishLoading(frame, () => {
    throw new DOMException('Blocked a frame', 'SecurityError');
  });

  expect(window.open).toHaveBeenCalledWith(DEMO_BOOKING_URL, '_self');
});

it('reports a demo booked in the dialog to Meta, and only from its own frame', async () => {
  renderSite();
  const { frame } = await openDialog();
  const booked = (source: Window | null) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source,
        data: { type: 'macro:booking-made' },
      })
    );

  booked(window);
  expect(analytics.trackMeta).not.toHaveBeenCalled();

  booked(frame.contentWindow);
  expect(analytics.trackMeta).toHaveBeenCalledExactlyOnceWith(
    'CompleteRegistration',
    {
      content_name: 'demo_meeting',
      content_category: 'cal_booking',
      value: 100,
      currency: 'USD',
    }
  );
});
