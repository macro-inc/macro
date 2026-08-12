import { getDisplayName, tryMacroId } from '@core/user';
import { truncateLabel } from '@core/util/string';

export function DisplayName(props: {
  id: string;
  format?: 'firstName' | 'lastName' | 'fullName';
  maxChars?: number;
}) {
  const name = () => {
    const fullName = getDisplayName(tryMacroId(props.id));
    const format = props.format ?? 'fullName';

    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
    const raw = (() => {
      if (format === 'firstName') return nameParts[0] || fullName;
      if (format === 'lastName') {
        return nameParts.length > 1 ? (nameParts.at(-1) ?? '') : fullName;
      }
      return fullName;
    })();

    return truncateLabel(raw, props.maxChars);
  };

  return <>{name()}</>;
}
