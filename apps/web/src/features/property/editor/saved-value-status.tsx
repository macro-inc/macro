import { t } from '@app/lib/i18n';
import { CommandMenuEmptyState } from '@ui';

/** Whether the values a saved item already holds have been read. */
export type SavedValueState = 'known' | 'loading' | 'failed';

/** Takes the place of an editor's rows until the item's values are read. */
export function SavedValueStatus(props: {
  state: SavedValueState;
  valuesLabel: string;
}) {
  return (
    <CommandMenuEmptyState>
      {props.state === 'failed'
        ? t('entityActions.propertyValuesUnavailable', {
            values: props.valuesLabel,
          })
        : t('entityActions.propertyValuesLoading', {
            values: props.valuesLabel,
          })}
    </CommandMenuEmptyState>
  );
}
