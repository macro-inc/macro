import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal } from 'solid-js';
import type { EventEditorSubmitValues } from '../components/composer/event-form-model';
import type { CalendarComposerOptions } from '../core/composer';
import type { ComposerMetadataChanges } from '../core/composer-metadata';
import {
  type ComposerSetupSource,
  createCalendarComposerSetup,
} from './create-calendar-composer-setup';

/** One review decision and one composer model for either phone or desktop placement. */
export function createAgentComposer<Args>(
  options: ComposerSetupSource & {
    timeFormat: CalendarComposerOptions['timeFormat'];
    guestPolicyEditable: boolean;
    canAct: () => boolean;
    prepare: (
      values?: EventEditorSubmitValues,
      metadata?: ComposerMetadataChanges
    ) => Args | undefined;
    onExecute: (args: Args) => Promise<boolean>;
    onReject: () => Promise<boolean>;
  }
) {
  const [operation, setOperation] = createSignal<'create' | 'reject'>();
  let finalized = false;
  const locked = () =>
    finalized || !options.canAct() || operation() !== undefined;
  const create = async (
    values: EventEditorSubmitValues,
    metadata?: ComposerMetadataChanges
  ) => {
    if (locked()) return;
    const args = options.prepare(values, metadata);
    if (!args) return;
    setOperation('create');
    try {
      if (await options.onExecute(args)) finalized = true;
    } finally {
      setOperation(undefined);
    }
  };
  const cancel = async () => {
    if (locked()) return;
    setOperation('reject');
    try {
      if (await options.onReject()) finalized = true;
    } finally {
      setOperation(undefined);
    }
  };
  const { controller, model } = createCalendarComposerSetup(options, () => ({
    get pending() {
      return operation() === 'create';
    },
    get disabled() {
      return finalized || !options.canAct() || operation() === 'reject';
    },
    get timeFormat() {
      return options.timeFormat;
    },
    get guestPolicyEditable() {
      return options.guestPolicyEditable;
    },
    visibilityReadOnlyReason: t('calendar.visibilityUnsupported'),
    onSubmit: (values, _scope, metadata) =>
      fireAndForget(create(values, metadata), 'ai-calendar-compose'),
  }));
  return { controller, model, create, cancel, locked, operation };
}
