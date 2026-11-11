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
import { isCrmActivityTab, pipelineIdOfTab } from '../core/navigation';

function recordList(tab: string | undefined): boolean {
  return !!tab && !isCrmActivityTab(tab) && !pipelineIdOfTab(tab);
}

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
  const [requested, setRequested] = createSignal<string | undefined>(
    scope.activeTab() === 'hidden' ? identity() : undefined
  );
  const isList = () => recordList(scope.activeTab());
  const canShowRemoved = () => !!identity();
  const showRemoved = () =>
    isList() && !!identity() && requested() === identity();

  // Synchronize the local choice with the host session/navigation lifecycle.
  // Comparing the identity also closes the gate before this effect runs.
  createRenderEffect(
    on(
      [identity, scope.activeTab],
      () =>
        setRequested(scope.activeTab() === 'hidden' ? identity() : undefined),
      { defer: true }
    )
  );

  return {
    canShowRemoved,
    showRemoved,
    removedTeamId: () => (showRemoved() ? scope.teamId() : undefined),
    setShowRemoved(value: boolean) {
      const next = value && isList() ? identity() : undefined;
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
        companies:
          view.activeTab() !== 'people' && recordList(view.activeTab()),
        companyHidden: view.queryFilters.state.include.crmCompanyHidden,
        excludedCompanyHidden: view.queryFilters.state.exclude.crmCompanyHidden,
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
        companies,
        companyHidden,
        excludedCompanyHidden,
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
          const companyVisibility = (id: string) =>
            id === 'crm-company-active' || id === 'crm-company-hidden';
          const contactVisibility = (id: string) =>
            id === 'crm-contact-active' || id === 'crm-contact-hidden';
          if (people || companies) {
            const expected = people
              ? hidden
                ? 'crm-contact-hidden'
                : 'crm-contact-active'
              : showRemoved
                ? 'crm-company-hidden'
                : 'crm-company-active';
            const isVisibility = (id: string) =>
              companyVisibility(id) || contactVisibility(id);
            if (
              !and.includes(expected) ||
              and.some((id) => isVisibility(id) && id !== expected) ||
              or.some(isVisibility)
            ) {
              view.soup.predicates.set({
                and: [...and.filter((id) => !isVisibility(id)), expected],
                or: or.filter((id) => !isVisibility(id)),
              });
            }
          }
          if (
            companies &&
            (companyHidden !== showRemoved ||
              excludedCompanyHidden !== undefined)
          )
            view.queryFilters.set({
              include: { crmCompanyHidden: showRemoved },
              exclude: { crmCompanyHidden: undefined },
            });
        });
      }
    )
  );
}
