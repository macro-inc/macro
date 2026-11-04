import { startUiOperation } from '@app/observability/ui-operation';
import {
  type Accessor,
  batch,
  createMemo,
  createRenderEffect,
  createSignal,
  on,
} from 'solid-js';
import type {
  CrmWorkspace,
  PeopleVisibility,
} from '../context/workspace-context';

/** A local, explicit choice. Shared links and saved filters cannot enable it. */
export function createPeopleVisibility(scope: {
  userId: Accessor<string | undefined>;
  teamId: Accessor<string | undefined>;
  isAdmin: Accessor<boolean>;
  activeTab: Accessor<string | undefined>;
}): PeopleVisibility {
  const identity = createMemo(() =>
    scope.userId() && scope.teamId() && scope.isAdmin()
      ? JSON.stringify([scope.userId(), scope.teamId()])
      : undefined
  );
  const [requested, setRequested] = createSignal<string>();
  const people = () => scope.activeTab() === 'people';
  const canShowRemoved = () => !!identity();
  const showRemoved = () =>
    people() && !!identity() && requested() === identity();

  // Synchronize the local choice with the host session/navigation lifecycle.
  // Comparing the identity also closes the gate before this effect runs.
  createRenderEffect(
    on([identity, people], () => setRequested(undefined), { defer: true })
  );

  return {
    canShowRemoved,
    showRemoved,
    removedTeamId: () => (showRemoved() ? scope.teamId() : undefined),
    setShowRemoved(value: boolean) {
      const next = value && people() ? identity() : undefined;
      if (next === requested()) return;
      const operation = startUiOperation('crm.people_visibility', {
        attributes: { 'crm.hidden': !!next },
      });
      operation.run(() => setRequested(next));
      operation.afterPaint();
    },
  };
}

/** Keep shared Soup query/predicate stores aligned with the local display choice. */
export function bindPeopleVisibility(
  visibility: PeopleVisibility,
  view: Pick<CrmWorkspace, 'activeTab' | 'queryFilters'> & {
    soup: { predicates: CrmWorkspace['soup']['predicates'] };
  }
) {
  createRenderEffect(
    on(
      () => ({
        people: view.activeTab() === 'people',
        showRemoved: visibility.showRemoved(),
        removedTeamId: visibility.removedTeamId(),
        includedHidden: view.queryFilters.state.include.crmContactHidden,
        teams: view.queryFilters.state.include.crmContactTeamId?.slice(),
        excludedHidden: view.queryFilters.state.exclude.crmContactHidden,
        excludedTeams: view.queryFilters.state.exclude.crmContactTeamId,
        and: view.soup.predicates.andIds(),
        or: view.soup.predicates.orIds(),
      }),
      ({
        people,
        showRemoved,
        removedTeamId,
        includedHidden,
        teams,
        excludedHidden,
        excludedTeams,
        and,
        or,
      }) => {
        const hidden = people && showRemoved;
        const teamId = hidden ? removedTeamId : undefined;
        const expected = hidden ? 'crm-contact-hidden' : 'crm-contact-active';
        const isVisibility = (id: string) =>
          id === 'crm-contact-active' || id === 'crm-contact-hidden';
        batch(() => {
          if (
            includedHidden !== (people ? hidden : undefined) ||
            (teamId
              ? teams?.length !== 1 || teams[0] !== teamId
              : !!teams?.length) ||
            excludedHidden !== undefined ||
            excludedTeams !== undefined
          ) {
            view.queryFilters.set({
              include: {
                crmContactHidden: people ? hidden : undefined,
                crmContactTeamId: teamId ? [teamId] : undefined,
              },
              exclude: {
                crmContactHidden: undefined,
                crmContactTeamId: undefined,
              },
            });
          }
          if (
            people &&
            (!and.includes(expected) ||
              and.some((id) => isVisibility(id) && id !== expected) ||
              or.some(isVisibility))
          ) {
            view.soup.predicates.set({
              and: [...and.filter((id) => !isVisibility(id)), expected],
              or: or.filter((id) => !isVisibility(id)),
            });
          } else if (
            !people &&
            (and.includes('crm-contact-hidden') ||
              or.includes('crm-contact-hidden'))
          ) {
            view.soup.predicates.set({
              and: and.filter((id) => id !== 'crm-contact-hidden'),
              or: or.filter((id) => id !== 'crm-contact-hidden'),
            });
          }
        });
      }
    )
  );
}
