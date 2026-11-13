import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
  SplitTitleFileMenu,
} from '@components/app/split-layout/components/SplitLabel';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import Eye from '@icon/system/regular/eye.svg';
import PaperPlaneTilt from '@icon/system/regular/paper-plane-tilt.svg';
import { Show } from 'solid-js';
import {
  canEditForm,
  type FormBlockHeaderProps,
  FormFileMenu,
  FormTitleIcon,
} from './shared/form-block-header-parts';

/** The form block's header on desktop: Preview, Publish or Open form, Share. */
export function FormBlockHeader(props: FormBlockHeaderProps) {
  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          name={props.name}
          icon={
            <Show when={props.detail()}>
              {(detail) => <FormTitleIcon detail={detail()} />}
            </Show>
          }
        />
      </SplitHeaderLeft>
      <Show when={props.detail()}>
        {(detail) => (
          <SplitTitleFileMenu>
            <FormFileMenu
              formId={props.formId}
              detail={detail()}
              buttonClass="order-first"
            />
          </SplitTitleFileMenu>
        )}
      </Show>
      <SplitHeaderRight>
        <Show when={!props.respondOnly && canEditForm(props.detail())}>
          <BlockLiveIndicators />
        </Show>
        <div class="order-[1000] flex items-center gap-2">
          <Show
            when={
              !props.respondOnly &&
              props.detail() &&
              props.detail()?.access !== 'view'
            }
          >
            <HeaderActionGroup label="Form actions">
              <HeaderActionButton
                grouped
                label="Preview"
                icon={<Eye class="size-3.5" />}
                disabled={props.preview.opening()}
                onClick={() =>
                  fireAndForget(props.preview.open(), 'form-preview')
                }
              />
              <Show
                when={props.published()}
                fallback={
                  <HeaderActionButton
                    grouped
                    label="Publish"
                    icon={
                      <PaperPlaneTilt class="size-3.5 shrink-0 pointer-events-none" />
                    }
                    onClick={props.openShare}
                  />
                }
              >
                <HeaderActionButton
                  grouped
                  label="Open form"
                  icon={<ArrowSquareOut class="size-3.5" />}
                  onClick={props.openRespond}
                />
              </Show>
            </HeaderActionGroup>
          </Show>
          <ShareTrigger
            id={props.formId}
            blockType="form"
            onClick={props.openShare}
            copyLink={props.copyRespondLink}
          />
        </div>
      </SplitHeaderRight>
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
    </>
  );
}
