import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsSearchResult } from '../core/settings-search';
import { SettingsSearchTarget } from './settings-search-target';

const result: SettingsSearchResult = {
  id: 'Email:Signatures',
  tab: 'Email',
  title: 'Signatures',
  target: 'signatures',
  keywords: '',
  page: { tab: 'Email', label: 'Email', keywords: [], icon: () => null },
};
afterEach(cleanup);
describe('settings search navigation', () => {
  it('scrolls only the page, keeping the surrounding drawer header in place', () => {
    const scroll = vi.fn();
    const { getByText } = render(() => (
      <SettingsSearchTarget result={result}>
        <div
          data-settings-page
          ref={(el) => {
            el.scrollTo = scroll;
          }}
        >
          <section data-settings-target="signatures">Signature editor</section>
        </div>
      </SettingsSearchTarget>
    ));
    expect(scroll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(getByText('Signature editor'));
  });
  it('waits for a lazy section to become available', async () => {
    const [ready, setReady] = createSignal(false);
    const { getByText } = render(() => (
      <SettingsSearchTarget result={result}>
        <div
          data-settings-page
          ref={(el) => {
            el.scrollTo = vi.fn();
          }}
        >
          <Show when={ready()}>
            <section data-settings-target="signatures">Loaded editor</section>
          </Show>
        </div>
      </SettingsSearchTarget>
    ));
    setReady(true);
    await waitFor(() =>
      expect(document.activeElement).toBe(getByText('Loaded editor'))
    );
  });
  it('focuses the heading for a page-level result', () => {
    const { getByText } = render(() => (
      <SettingsSearchTarget result={{ ...result, target: undefined }}>
        <div
          data-settings-page
          ref={(el) => {
            el.scrollTo = vi.fn();
          }}
        >
          <h1>Email</h1>
        </div>
      </SettingsSearchTarget>
    ));
    expect(document.activeElement).toBe(getByText('Email'));
  });
});
