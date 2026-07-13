import { tryMacroId, useDisplayNameParts } from '@core/user';
import { truncateLabel } from '@core/util/string';

export function DisplayName(props: {
  id: string;
  format?: 'firstName' | 'lastName' | 'fullName';
  maxChars?: number;
}) {
  const name = () => {
    const parts = useDisplayNameParts(tryMacroId(props.id));
    const format = props.format ?? 'fullName';

    const raw =
      format === 'fullName'
        ? parts.fullName()
        : parts[format]() || parts.fullName();

    return truncateLabel(raw, props.maxChars);
  };

  return <>{name()}</>;
}
