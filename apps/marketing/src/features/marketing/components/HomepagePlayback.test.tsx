import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DemoInteractionBoundary } from './DemoInteractionBoundary';
import HomepageCrm from './HomepageCrm';
import HomepageEmailCompose from './HomepageEmailCompose';

let observers: Map<Element, IntersectionObserverCallback>;
beforeEach(() => {
  observers = new Map();
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(element: Element) {
        observers.set(element, this.callback);
      }
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function show(element: Element, intersectionRatio: number) {
  observers.get(element)!(
    [
      {
        target: element,
        isIntersecting: true,
        intersectionRatio,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver
  );
}

it('waits for the email body to be visible and pauses again below its threshold', () => {
  const view = render(() => <HomepageEmailCompose />);
  const composer = view.container.querySelector('[data-generation]')!;
  const body = view.getByRole('textbox', { name: 'Email body' });
  show(composer, 0.05);
  vi.advanceTimersByTime(5000);
  expect(body.textContent).toBe('');
  show(composer, 0.2);
  vi.advanceTimersByTime(1100);
  expect(body.textContent).not.toBe('');
  const partial = body.textContent;
  show(composer, 0.05);
  vi.advanceTimersByTime(5000);
  expect(body.textContent).toBe(partial);
  show(composer, 0.2);
  vi.advanceTimersByTime(5000);
  expect(body.textContent).toContain('Thanks for joining the demo');
});

it('waits for the CRM scene before moving a company and pauses below its threshold', () => {
  const view = render(() => <HomepageCrm />);
  expect(view.queryByRole('button', { name: /CRM walkthrough/ })).toBeNull();
  const scene = view.getByRole('img', {
    name: /Claude moves Keystone Mechanical/,
  });
  const northwind = () =>
    view.container.querySelector('[data-crm-company="northwind"]')!;
  show(scene, 0.05);
  vi.advanceTimersByTime(15000);
  expect(northwind().getAttribute('data-crm-stage')).toBe('Qualified');
  show(scene, 0.3);
  vi.advanceTimersByTime(5200);
  expect(northwind().getAttribute('data-crm-stage')).toBe('Proposal');
  show(scene, 0.05);
  vi.advanceTimersByTime(15000);
  expect(
    view.container
      .querySelector('[data-crm-company="lumen"]')!
      .getAttribute('data-crm-stage')
  ).toBe('Proposal');
  show(scene, 0.3);
  vi.advanceTimersByTime(10000);
  expect(
    view.container
      .querySelector('[data-crm-company="lumen"]')!
      .getAttribute('data-crm-stage')
  ).toBe('Closed won');
});

it('stops generating email on preview activation and preserves the visitor draft', () => {
  const view = render(() => (
    <DemoInteractionBoundary>
      <HomepageEmailCompose />
    </DemoInteractionBoundary>
  ));
  const composer = view.container.querySelector('[data-generation]')!;
  const body = view.getByRole('textbox', { name: 'Email body' });
  show(composer, 1);
  vi.advanceTimersByTime(1100);
  view.container
    .querySelector('.demo-interaction-boundary')!
    .dispatchEvent(new CustomEvent('macro-demo-interaction'));
  body.textContent = 'My follow-up draft';
  show(composer, 0);
  show(composer, 1);
  vi.advanceTimersByTime(10000);
  expect(body.textContent).toBe('My follow-up draft');
  expect(composer.getAttribute('data-generation')).toBe('complete');
});

it('pauses the restored CRM illustration when the visitor enters it', () => {
  const view = render(() => (
    <DemoInteractionBoundary>
      <HomepageCrm />
    </DemoInteractionBoundary>
  ));
  const scene = view.getByRole('img', {
    name: /Claude moves Keystone Mechanical/,
  });
  show(scene, 1);
  view.container
    .querySelector('.demo-interaction-boundary')!
    .dispatchEvent(new CustomEvent('macro-demo-interaction'));
  vi.advanceTimersByTime(15000);
  expect(
    view.container
      .querySelector('[data-crm-company="northwind"]')!
      .getAttribute('data-crm-stage')
  ).toBe('Qualified');
});
