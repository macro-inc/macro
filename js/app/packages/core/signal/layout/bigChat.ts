import { useSearchParams } from '@solidjs/router';
import type { Accessor, Setter } from 'solid-js';

function useQueryBool(param: string): [Accessor<boolean>, Setter<boolean>] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = () => Boolean(searchParams[param]);
  const setValue: Setter<boolean> = (next) => {
    const current = value();
    const resolved = typeof next === 'function' ? next(current) : next;
    setSearchParams({ [param]: resolved || undefined });
  };
  return [value, setValue] as const;
}

export const useBigChat = () => useQueryBool('chat');
