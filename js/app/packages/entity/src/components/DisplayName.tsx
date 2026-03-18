import { tryMacroId, useDisplayNameParts } from '@core/user';

export function useDisplayName(props: {
  id: string;
  format?: 'firstName' | 'lastName' | 'fullName';
}): () => string {
  return () => {
    const parts = useDisplayNameParts(tryMacroId(props.id));
    const format = props.format ?? 'fullName';

    if (format === 'fullName') {
      return parts.fullName();
    }

    // For firstName or lastName, fall back to fullName if empty
    const requestedPart = parts[format]();
    return requestedPart || parts.fullName();
  };
}

export function DisplayName(props: {
  id: string;
  format?: 'firstName' | 'lastName' | 'fullName';
}) {
  const name = useDisplayName(props);
  return <>{name()}</>;
}
