import { HeaderActionButton } from '@components/app/HeaderActionButton';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
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
} from '../shared/form-block-header-parts';

/**
 * The form block's header on touch: the title with its menu, the access
 * badge, who else is editing, and one island with Preview, Publish or Open
 * form, and Share. The tabs sit in the page body.
 */
export function MobileFormBlockHeader(props: FormBlockHeaderProps) {
  return (
    <>
      <MobileHeader
        trailing={
          <>
            <Show when={!props.respondOnly && canEditForm(props.detail())}>
              <BlockLiveIndicators />
            </Show>
            <MobileHeader.Island>
              <div class="flex items-center gap-1.5">
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
                            <PaperPlaneTilt class="size-6 shrink-0 pointer-events-none" />
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
            </MobileHeader.Island>
          </>
        }
      >
        <MobileHeader.Title
          class="ph-no-capture"
          iconType="form"
          colorIcon
          icon={
            <Show when={props.detail()}>
              {(detail) => <FormTitleIcon detail={detail()} />}
            </Show>
          }
          label={props.name()}
        />
        <MobileHeader.Island>
          <SplitPermissionsBadge />
        </MobileHeader.Island>
      </MobileHeader>
      <Show when={props.detail()}>
        {(detail) => <FormFileMenu formId={props.formId} detail={detail()} />}
      </Show>
    </>
  );
}
