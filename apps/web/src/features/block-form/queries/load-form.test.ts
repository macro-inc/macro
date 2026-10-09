import { okAsync } from 'neverthrow';
import { expect, it, vi } from 'vitest';
import { loadForm } from './load-form';

const forms = vi.hoisted(() => ({ fetchFormDetail: vi.fn() }));
vi.mock('@queries/storage/forms', () => forms);

it('gives the block the viewer’s form access, read through the detail cache', async () => {
  forms.fetchFormDetail.mockReturnValue(
    okAsync({
      form: { id: 'form-id', name: 'Q4 offsite RSVP' },
      access: 'owner',
    })
  );
  const result = await loadForm('form-id');
  expect(result._unsafeUnwrap().userAccessLevel).toBe('owner');
  expect(forms.fetchFormDetail).toHaveBeenCalledWith('form-id');
});
