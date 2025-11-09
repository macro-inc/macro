import { refetchHistory } from '@service-storage/history';
import { useNavigate } from '@solidjs/router';
import { isErr } from './maybeResult';
import { propsToHref } from './url';

export function useOpenLastItem() {
  const navigate = useNavigate();

  return async () => {
    const maybeHistory = await refetchHistory(true);
    if (!maybeHistory || isErr(maybeHistory)) return;
    const lastItem = maybeHistory[1].data[0];
    if (!lastItem) return;

    let href;
    if (lastItem.type === 'document') {
      href = propsToHref({
        fileType: lastItem.fileType,
        id: lastItem.id,
      });
    } else if (lastItem.type === 'chat') {
      href = `/chat/${lastItem.id}`;
    }

    if (href) {
      navigate(href);
    }
  };
}
