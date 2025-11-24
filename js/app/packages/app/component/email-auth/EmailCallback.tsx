import { toast } from '@core/component/Toast/Toast';
import { maybeStartEmailSync, useEmailLinks } from '@core/email-link';
import { whenSettled } from '@core/util/whenSettled';
import { useNavigate } from '@solidjs/router';

export function EmailCallback() {
  const navigate = useNavigate();
  const emailLinks = useEmailLinks();

  whenSettled(
    emailLinks,
    (links) => {
      let result = maybeStartEmailSync(links);
      if (result) {
        toast.success('Syncing email links...', 'this might take a while');
      }
      navigate('/component/unified-list');
    },
    (error) => {
      toast.failure(error.message);
    }
  );

  return null;
}
