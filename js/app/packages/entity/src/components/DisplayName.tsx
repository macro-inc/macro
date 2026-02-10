import { tryMacroId, useDisplayNameParts } from '@core/user';

export function DisplayName(props: {
  id: string;
  format?: 'firstName' | 'lastName' | 'fullName';
}) {
  const parts = useDisplayNameParts(tryMacroId(props.id));

  const name = () => {
    const format = props.format ?? 'fullName';

    if (format === 'fullName') {
      return parts.fullName();
    }

    // For firstName or lastName, fall back to fullName if empty
    const requestedPart = parts[format]();
    return requestedPart || parts.fullName();
  };

  return <>{name()}</>;
}
