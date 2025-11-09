import { useLocation, useNavigate } from '@solidjs/router';
import { type Accessor, createMemo, type Setter } from 'solid-js';

function useQueryBool(param: string): [Accessor<boolean>, Setter<boolean>] {
  const location = useLocation();
  const navigate = useNavigate();

  const value = createMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get(param) === 'true';
  });

  const setValue: Setter<boolean> = (next) => {
    const current = value();
    const resolved = typeof next === 'function' ? next(current) : next;

    const params = new URLSearchParams(location.search);
    if (resolved) params.set(param, 'true');
    else params.delete(param);

    navigate(`${location.pathname.replace('/app/', '')}?${params.toString()}`, {
      replace: true,
      scroll: false,
    });

    return resolved;
  };

  return [value, setValue] as const;
}

export const useBigChat = () => useQueryBool('chat');
