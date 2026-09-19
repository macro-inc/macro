import { toast } from '@core/component/Toast/Toast';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { useSetContactHiddenMutation } from '@queries/contacts/contacts';

/** The part of an address-book suggestion the removal needs. */
type ContactSuggestion = { data: { id: string; email: string } };

/**
 * Removes an address-book suggestion from the composer's recipient picker,
 * for addresses that should stop coming up (a typo that keeps bouncing, a
 * contact who moved on). The suggestion is hidden for this user only; typing
 * the address still works, and the toast offers an undo.
 */
export function useRemoveContactSuggestion() {
  const setHidden = useSetContactHiddenMutation();

  return (option: ContactSuggestion) => {
    const { id, email } = option.data;
    setHidden.mutate(
      { userId: id, hidden: true },
      {
        onSuccess: () => {
          toast.success('Removed from suggestions', {
            subtext: email,
            actions: [
              {
                label: 'Undo',
                icon: ArrowCounterClockwise,
                onClick: () =>
                  setHidden.mutate(
                    { userId: id, hidden: false },
                    {
                      onError: () =>
                        toast.failure('Failed to restore suggestion', {
                          subtext: email,
                        }),
                    }
                  ),
              },
            ],
          });
        },
        onError: () =>
          toast.failure('Failed to remove suggestion', { subtext: email }),
      }
    );
  };
}
