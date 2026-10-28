import { Show } from 'solid-js';
import type { GroupHeaderProps } from '../../next-soup/create-soup-state';
import { DefaultGroupHeader } from '../../next-soup/soup-view/soup-view';
import { CrmStageIcon } from '../components/stage-icon';
import { useDealStages } from './use-crm';
export function CompanyGroupHeader(props: GroupHeaderProps) {
  const stages = useDealStages();
  const optionId = () => {
    const value = props.group.value ?? props.group.key;
    return typeof value === 'string' && value ? value : undefined;
  };
  const index = (id: string) => {
    const i = stages.stages().findIndex((stage) => stage.id === id);
    return i === -1 ? undefined : i;
  };
  return (
    <DefaultGroupHeader
      {...props}
      icon={
        <Show when={optionId()}>
          {(id) => (
            <CrmStageIcon
              optionId={id()}
              index={index(id())}
              class="size-3.5"
            />
          )}
        </Show>
      }
    />
  );
}
