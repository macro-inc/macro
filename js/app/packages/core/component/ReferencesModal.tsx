import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import clickOutside from '@core/directive/clickOutside';
import { isErr } from '@core/util/maybeResult';
import Quotes from '@icon/regular/quotes.svg';
import BracketLeft from '@macro-icons/macro-group-bracket-left.svg';
import { commsServiceClient } from '@service-comms/client';
import type { ItemType } from '@service-storage/client';
import { createResource, Suspense } from 'solid-js';
import { References } from './References';
import { Tooltip } from './Tooltip';

false && clickOutside;
const DRAWER_ID = 'references';

export function ReferencesButton(props: {
  documentId: string;
  documentName?: string;
  entityType?: ItemType;
  buttonSize?: 'sm';
}) {
  const drawerControl = useDrawerControl(DRAWER_ID);
  const [referenceCount] = createResource(
    () => props.documentId,
    async (id) => {
      const entityType = props.entityType ?? 'document';
      const response = await commsServiceClient.attachmentReferences({
        entity_type: entityType,
        entity_id: id,
      });
      if (isErr(response)) {
        console.error(response);
        return 0;
      }
      return response[1].references.length;
    }
  );
  return (
    <Tooltip tooltip={'View References'}>
      <div
        class="flex items-center gap-1 py-1 font-mono text-xs text-ink-disabled hover:bg-hover relative"
        tabIndex={0}
        onClick={drawerControl.toggle}
        role="button"
      >
        <BracketLeft class="h-4 w-2 text-edge" />
        <Quotes class="size-4 text-ink" />
        <Suspense fallback={<div class="text-xs">0</div>}>
          <span class="text-xs">{referenceCount() ?? ''}</span>
        </Suspense>
        <BracketLeft class="h-4 w-2 rotate-180 text-edge" />
      </div>
    </Tooltip>
  );
}

export function ReferencesDrawer(props: {
  documentId: string;
  documentName?: string;
  entityType?: ItemType;
}) {
  const title = () => {
    if (!props.documentName) return 'References';
    return (
      <>
        References
        <span class="text-ink-extra-muted">
          {' - '}
          {props.documentName}
        </span>
      </>
    );
  };
  return (
    <SplitDrawer id={DRAWER_ID} side="right" size={768} title={title()}>
      <Suspense
        fallback={
          <div class="flex justify-center py-8">
            <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted"></div>
          </div>
        }
      >
        <References
          documentId={props.documentId}
          entityType={props.entityType}
        />
      </Suspense>
    </SplitDrawer>
  );
}

export type ReferencesModalProps = {
  documentId: string;
  documentName?: string;
  buttonSize?: 'sm';
  entityType?: ItemType;
};

export function ReferencesModal(props: ReferencesModalProps) {
  const drawerControl = useDrawerControl(DRAWER_ID);
  const [referenceCount] = createResource(
    () => props.documentId,
    async (id) => {
      const entityType = props.entityType ?? 'document';
      const response = await commsServiceClient.attachmentReferences({
        entity_type: entityType,
        entity_id: id,
      });

      if (isErr(response)) {
        console.error(response);
        return 0;
      }

      return response[1].references.length;
    }
  );

  const title = () => {
    if (!props.documentName) return 'References';
    return (
      <>
        References
        <span class="text-ink-extra-muted">
          {' - '}
          {props.documentName}
        </span>
      </>
    );
  };
  return (
    <>
      <Tooltip tooltip={'View References'}>
        <div
          class="flex items-center gap-1 py-1 font-mono text-xs text-ink-disabled hover:bg-hover relative"
          tabIndex={0}
          onClick={drawerControl.toggle}
          role="button"
        >
          <BracketLeft class="h-4 w-2 text-edge" />
          <Quotes class="size-4 text-ink" />
          <Suspense fallback={<div class="text-xs">0</div>}>
            <span class="text-xs">{referenceCount() ?? ''}</span>
          </Suspense>
          <BracketLeft class="h-4 w-2 rotate-180 text-edge" />
        </div>
      </Tooltip>
      <SplitDrawer id={DRAWER_ID} side="right" size={768} title={title()}>
        <Suspense
          fallback={
            <div class="flex justify-center py-8">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted"></div>
            </div>
          }
        >
          <References
            documentId={props.documentId}
            entityType={props.entityType}
          />
        </Suspense>
      </SplitDrawer>
    </>
  );
}
