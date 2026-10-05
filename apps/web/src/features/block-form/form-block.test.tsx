import { cleanup, render, screen } from '@solidjs/testing-library';
import { type Accessor, createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormContext } from './context/form-context';
import FormBlock from './form-block';
import { createMockFormContext } from './tests/mock-context';

const state = vi.hoisted(() => ({
  flag: undefined as
    | Accessor<{ enabled: boolean; loading: boolean }>
    | undefined,
  context: undefined as FormContext | undefined,
  editorMounted: vi.fn(),
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => state.flag,
}));
vi.mock('@core/constant/featureFlags', () => ({ enableForms: {} }));
vi.mock('@core/block', () => ({
  useBlockId: () => 'form-1',
  useIsNestedBlock: () => false,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({}),
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: ParentProps) => props.children,
  SplitHeaderRight: (props: ParentProps) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  BlockItemSplitLabel: () => null,
}));
vi.mock('@components/app/ResponsiveBlockToolbar', () => ({
  ResponsivePermissionsBadge: () => null,
}));
vi.mock('@core/component/DocumentBlockContainer', () => ({
  DocumentBlockContainer: (props: ParentProps) => props.children,
}));
vi.mock('@core/component/LiveIndicators', () => ({
  BlockLiveIndicators: () => null,
}));
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareTrigger: () => null,
}));
vi.mock('@core/component/TopBar/shareModal', () => ({
  useShareModal: () => () => {},
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({}),
}));
vi.mock('@core/util/useCopyLink', () => ({
  useCopyLink: () => () => {},
}));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.local',
}));
vi.mock('@queries/storage/forms', () => ({
  useFormSharePermissionsQuery: () => ({ isSuccess: false }),
}));
vi.mock('./form-context-production', () => ({
  createAppFormContext: () => state.context,
}));
vi.mock('./form-global-sharing', () => ({
  createFormShareInput: () => () => undefined,
}));
vi.mock('./views/form-page-view', () => ({
  FormPageView: () => {
    state.editorMounted();
    return <p>Form editor</p>;
  },
}));
vi.mock('./views/respond-view', () => ({
  RespondView: () => <p>Fill out the form</p>,
}));
vi.mock('./views/form-card-view', () => ({ FormCardView: () => null }));

beforeEach(() => {
  state.editorMounted.mockClear();
  state.context = createMockFormContext({
    detail: {
      form: {
        id: 'form-1',
        name: 'Workshop RSVP',
        description: '',
        ownerId: 'macro|owner@example.com',
        databaseId: 'database-1',
        tableId: 'table-1',
        audience: 'public',
        status: 'open',
        closesAt: null,
        tallyVisible: false,
        confirmationMessage: 'Thank you',
        submittedColumnId: null,
        respondentColumnId: null,
      },
      layout: { sections: [] },
      columns: [],
      access: 'owner',
      tableGone: false,
    },
  }).context;
});
afterEach(cleanup);

describe('Forms authoring rollout', () => {
  it('does not mount the editor before the flag resolves, even for an owner', () => {
    const [flag, setFlag] = createSignal({ enabled: false, loading: true });
    state.flag = flag;
    render(() => <FormBlock />);

    expect(screen.queryByText('Form editor')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(state.editorMounted).not.toHaveBeenCalled();
    expect(screen.getByText('Fill out the form')).toBeTruthy();

    setFlag({ enabled: true, loading: false });
    expect(screen.getByText('Form editor')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy();
    expect(state.editorMounted).toHaveBeenCalledOnce();

    setFlag({ enabled: false, loading: false });
    expect(screen.queryByText('Form editor')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.getByText('Fill out the form')).toBeTruthy();
  });

  it('keeps an explicitly disabled owner on the respondent view', () => {
    state.flag = () => ({ enabled: false, loading: false });
    render(() => <FormBlock />);

    expect(screen.queryByText('Form editor')).toBeNull();
    expect(state.editorMounted).not.toHaveBeenCalled();
    expect(screen.getByText('Fill out the form')).toBeTruthy();
  });

  it('keeps a respondent link in respondent mode when authoring is enabled', () => {
    state.flag = () => ({ enabled: true, loading: false });
    render(() => <FormBlock view="respond" />);

    expect(screen.queryByText('Form editor')).toBeNull();
    expect(state.editorMounted).not.toHaveBeenCalled();
    expect(screen.getByText('Fill out the form')).toBeTruthy();
  });
});
