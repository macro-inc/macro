import ChannelIcon from '@phosphor/hash-straight.svg';
import MailIcon from '@phosphor/paperclip.svg';
import { For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { homepagePeople } from '../../core/homepage-demo-people';
import { EmailTags } from '../email/frozen/EmailRows';
import { type DriveFile, type DriveKind, driveKinds } from './driveFiles';

/** A file kind's icon in its entity colour. */
export function DriveIcon(props: { kind: DriveKind }) {
  return (
    <Dynamic
      component={driveKinds[props.kind].icon}
      class="drive-icon"
      data-kind={props.kind}
      aria-hidden="true"
    />
  );
}

/**
 * Drive's file list: the file's icon and name, where it came from, its tags,
 * who added it, and when. `detail` replaces the tags with a plain label.
 */
export function DriveFileRows(props: {
  files: readonly DriveFile[];
  /** Rows that just arrived, drawn with the list's selection. */
  fresh?: readonly string[];
  detail?: (file: DriveFile) => JSX.Element;
  hideSource?: boolean;
}) {
  return (
    <div class="drive-rows">
      <For each={props.files}>
        {(file) => (
          <div
            class="drive-row"
            data-fresh={props.fresh?.includes(file.id) ? '' : undefined}
          >
            <DriveIcon kind={file.kind} />
            <span class="drive-row-name">{file.name}</span>
            <Show when={!props.hideSource && file.source}>
              {(source) => (
                <span class="drive-row-source">
                  <Show when={source() === 'email'} fallback={<ChannelIcon />}>
                    <MailIcon />
                  </Show>
                  {source() === 'email' ? 'Email' : 'launch'}
                </span>
              )}
            </Show>
            <Show when={props.detail} fallback={<EmailTags tags={file.tags} />}>
              {(detail) => (
                <span class="drive-row-detail">{detail()(file)}</span>
              )}
            </Show>
            <img
              class="drive-row-owner"
              src={homepagePeople[file.owner].photo}
              alt=""
            />
            <span class="drive-row-time">{file.updated}</span>
          </div>
        )}
      </For>
    </div>
  );
}
