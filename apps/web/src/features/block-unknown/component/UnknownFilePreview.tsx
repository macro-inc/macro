import { ContentLoading } from '@components/app/ContentLoading';
import { lazyNamed } from '@core/util/lazyNamed';
import { useQuery } from '@tanstack/solid-query';
import { Match, Suspense, Switch } from 'solid-js';
import {
  type TextPreviewFile,
  textPreviewQueryOptions,
} from '../queries/text-preview';
import { UnknownContent } from './UnknownContent';

const UnknownTextContent = lazyNamed(
  () => import('./UnknownTextContent'),
  'UnknownTextContent'
);

/**
 * Prop-driven unknown file body shared by the legacy block and Drive detail
 * hosts: text reads in place, anything else offers the file itself.
 */
export function UnknownFilePreview(props: {
  file: TextPreviewFile | undefined;
  fileName: string;
  convertingTo?: string;
  onShare: () => void;
  onDownload: () => void;
}) {
  const preview = useQuery(() => textPreviewQueryOptions(props.file));
  const text = () => (preview.isSuccess ? preview.data : null);

  return (
    <Switch
      fallback={
        <UnknownContent
          fileName={props.fileName}
          convertingTo={props.convertingTo}
          onShare={props.onShare}
          onDownload={props.onDownload}
        />
      }
    >
      <Match when={preview.isLoading}>
        <ContentLoading />
      </Match>
      <Match when={text()}>
        {(value) => (
          <Suspense fallback={<ContentLoading />}>
            <UnknownTextContent text={value()} />
          </Suspense>
        )}
      </Match>
    </Switch>
  );
}
