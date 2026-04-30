import { tryMacroId, useDisplayNameParts } from '@core/user';

const DEFAULT_MAX_CHARS = 30;

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

    const max = props.maxChars ?? DEFAULT_MAX_CHARS;
    return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  };

  return <>{name()}</>;
}
