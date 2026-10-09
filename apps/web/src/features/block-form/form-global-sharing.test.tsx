import { Permissions } from '@core/component/SharePermissions';
import type { FormDetail as WireFormDetail } from '@service-storage/generated/schemas/formDetail';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ManagedDialogProps } from '@ui';
import { errAsync, okAsync } from 'neverthrow';
import { type Component, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormDetail } from './core/form-model';
import {
  createFormShareInput,
  openFormShareModal,
} from './form-global-sharing';

const copied = vi.hoisted(() => [] as string[]);
vi.mock('@core/util/useCopyLink', () => ({
  useCopyLink: () => async (link: string) => {
    copied.push(link);
    return true;
  },
}));
vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));
const forms = vi.hoisted(() => ({
  fetchFormDetail: vi.fn(),
  detail: undefined as WireFormDetail | undefined,
  updateMetadata: vi.fn(),
}));
vi.mock('@queries/storage/forms', () => ({
  fetchFormDetail: forms.fetchFormDetail,
  useFormDetailQuery: () => ({
    get isSuccess() {
      return forms.detail !== undefined;
    },
    get data() {
      return forms.detail;
    },
  }),
}));
const failures = vi.hoisted(() => [] as string[]);
vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: () => {},
    failure: (message: string) => failures.push(message),
  },
}));
// The dialog itself is the native one; these tests cover what the form gives it.
vi.mock('@core/component/TopBar/ShareButton', () => ({
  ShareModal: (props: { linkSharing?: Component }) => (
    <Dynamic component={props.linkSharing} />
  ),
}));
vi.mock('./queries/form-sources', () => ({
  updateFormMetadata: forms.updateMetadata,
}));
const opened = vi.hoisted(() => vi.fn());
vi.mock('@ui', async (original) => ({
  ...(await original<typeof import('@ui')>()),
  openDialog: opened,
}));

function rsvp(access: FormDetail['access']): FormDetail {
  return {
    form: {
      id: 'form-1',
      name: 'RSVP',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: null,
      tallyVisible: true,
      confirmationMessage: '',
      submittedColumnId: null,
      respondentColumnId: null,
    },
    layout: { sections: [] },
    columns: [],
    access,
    tableGone: false,
  };
}

afterEach(cleanup);
beforeEach(() => {
  copied.length = 0;
  failures.length = 0;
  forms.fetchFormDetail.mockReset();
  forms.detail = undefined;
  forms.updateMetadata.mockReset();
  forms.updateMetadata.mockReturnValue(okAsync(undefined));
  opened.mockReset();
});

describe('createFormShareInput', () => {
  it('shares an editor’s form at their own access, copying the respond link', () => {
    let input: ReturnType<typeof createFormShareInput> = () => undefined;
    render(() => {
      input = createFormShareInput({
        formId: () => 'form-1',
        detail: () => rsvp('edit'),
        updateMetadata: () => okAsync(undefined),
        notify: { success: () => {}, failure: () => {} },
      });
      return null;
    });
    const current = input();
    expect(current).toMatchObject({
      id: 'form-1',
      blockAlias: 'form',
      itemType: 'form',
      name: 'RSVP',
      owner: 'macro|owner@example.com',
      userPermissions: Permissions.CAN_EDIT,
    });
    current?.copyLink?.();
    expect(copied).toEqual(['https://macro.com/app/form/form-1/respond']);
  });

  it('is undefined until the form’s detail has loaded', () => {
    let input: ReturnType<typeof createFormShareInput> = () => undefined;
    render(() => {
      input = createFormShareInput({
        formId: () => 'form-1',
        detail: () => undefined,
        updateMetadata: () => okAsync(undefined),
        notify: { success: () => {}, failure: () => {} },
      });
      return null;
    });
    expect(input()).toBeUndefined();
  });

  it('lets the owner choose who responds, and offers the editor link by name only', () => {
    const [detail, setDetail] = createSignal(rsvp('owner'));
    const saved: unknown[] = [];
    render(() => {
      const input = createFormShareInput({
        formId: () => 'form-1',
        detail,
        updateMetadata: (_, patch) => {
          saved.push(patch);
          setDetail({
            ...detail(),
            form: { ...detail().form, audience: 'public' },
          });
          return okAsync(undefined);
        },
        notify: { success: () => {}, failure: () => {} },
      });
      return <Dynamic component={input()?.linkSharing} />;
    });
    expect(
      screen.getByRole('button', { name: 'Copy editor link' })
    ).toBeTruthy();
    expect(screen.queryByText(/Editors open the builder/)).toBeNull();
    fireEvent.click(
      screen.getByRole('radio', { name: 'Anyone with the link' })
    );
    expect(saved).toEqual([{ audience: 'public' }]);
    expect(
      screen.getByText(
        'Anyone with the link can fill out this form. No sign-in needed.'
      )
    ).toBeTruthy();
  });

  it('shows a respondent the respond link but no editor link or audience choice', () => {
    render(() => {
      const input = createFormShareInput({
        formId: () => 'form-1',
        detail: () => rsvp('view'),
        updateMetadata: () => okAsync(undefined),
        notify: { success: () => {}, failure: () => {} },
      });
      return <Dynamic component={input()?.linkSharing} />;
    });
    expect(screen.getByRole('button', { name: 'Copy form link' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Copy editor link' })
    ).toBeNull();
    expect(screen.getByText('Only the owner can change this.')).toBeTruthy();
  });
});

describe('openFormShareModal', () => {
  it('uses the live wire detail to change the audience in the actual global dialog', async () => {
    forms.detail = {
      form: {
        id: 'form-1',
        name: 'Workshop',
        description: '',
        ownerId: 'macro|owner@example.com',
        databaseId: 'database-1',
        tableId: 'table-1',
        audience: 'members',
        status: 'open',
        closesAt: null,
        tallyVisible: false,
        confirmationMessage: '',
        submittedColumnId: null,
        respondentColumnId: null,
        createdAt: '2026-10-05T12:00:00Z',
        updatedAt: '2026-10-05T12:00:00Z',
      },
      sections: [],
      access: 'owner',
      tableGone: false,
    };
    forms.fetchFormDetail.mockReturnValue(okAsync(forms.detail));
    await openFormShareModal('form-1');
    const [Dialog, props] = opened.mock.calls[0] as [
      Component<ManagedDialogProps & { formId: string }>,
      { formId: string },
    ];
    render(() => <Dialog {...props} open onOpenChange={() => {}} />);
    fireEvent.click(
      screen.getByRole('radio', { name: 'Anyone with the link' })
    );
    expect(forms.updateMetadata).toHaveBeenCalledExactlyOnceWith('form-1', {
      audience: 'public',
    });
  });

  it('opens the share dialog once the form’s detail has loaded', async () => {
    forms.fetchFormDetail.mockReturnValue(okAsync(rsvp('owner')));
    await openFormShareModal('form-1');
    expect(forms.fetchFormDetail).toHaveBeenCalledWith('form-1');
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0][1]).toEqual({ formId: 'form-1' });
  });

  it('tells the person and opens nothing when the form can’t be read', async () => {
    forms.fetchFormDetail.mockReturnValue(errAsync([{ message: 'gone' }]));
    expect(await openFormShareModal('form-1')).toBeUndefined();
    expect(opened).not.toHaveBeenCalled();
    expect(failures).toEqual(['This form’s sharing couldn’t be loaded.']);
  });
});
