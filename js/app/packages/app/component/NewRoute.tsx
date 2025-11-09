import { useIsAuthenticated } from '@core/auth';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { createCodeFileFromText } from '@core/util/create';
import { isPaymentError } from '@core/util/handlePaymentError';
import { isErr } from '@core/util/maybeResult';
import { uploadFile } from '@core/util/upload';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { postNewHistoryItem } from '@service-storage/history';
import { newBlankDocument } from '@service-storage/util/newBlankDocument';
import {
  Navigate,
  type RouteSectionProps,
  useNavigate,
  useSearchParams,
} from '@solidjs/router';
import { createResource, Show } from 'solid-js';

export default function NewBlockRoute(props: RouteSectionProps) {
  const authenticated = useIsAuthenticated();
  const { showPaywall } = usePaywallState();
  const navigate = useNavigate();

  const upload = async (file: File, type: 'md' | 'canvas') => {
    const uploadResult = await uploadFile(file, 'dss', {
      skipAnalytics: true,
      fileType: type,
    });
    if (uploadResult.failed || uploadResult.type !== 'document') {
      console.error(
        'Invalid upload result. Expected DSS document',
        uploadResult
      );
      return navigate('/');
    }
    const documentId = uploadResult.documentId;
    postNewHistoryItem('document', documentId);
    return documentId;
  };

  const [newBlockId] = createResource(async () => {
    switch (props.params.block) {
      case 'chat': {
        const maybeChat = await cognitionApiServiceClient.createChat({});
        if (isPaymentError(maybeChat)) {
          showPaywall();
          return navigate('/');
        }
        if (isErr(maybeChat)) {
          return navigate('/');
        }
        const [, chat] = maybeChat;
        postNewHistoryItem('chat', chat.id);
        return chat.id;
      }
      case 'rss':
        return navigate('/');
      case 'pdf':
        // noop, can't create new pdf
        return navigate('/');
      case 'md': {
        const emptyMdFile = newBlankDocument('md');
        if (!emptyMdFile) return navigate('/');
        return upload(emptyMdFile, 'md');
      }
      case 'code': {
        const maybeDoc = await createCodeFileFromText({
          code: 'print("Hello, World!")',
          extension: 'py',
        });
        if (isErr(maybeDoc, 'UNAUTHORIZED')) {
          showPaywall(PaywallKey.FILE_LIMIT);
        }
        const [, result] = maybeDoc;
        if (!result?.documentId) {
          return navigate('/');
        }
        postNewHistoryItem('document', result.documentId);
        return result.documentId;
      }
      case 'canvas': {
        const emptyCanvasFile = newBlankDocument('canvas');
        if (!emptyCanvasFile) return navigate('/');
        return upload(emptyCanvasFile, 'canvas');
      }
      case 'start':
        return 'block';
    }
  });

  // If we have a prompt in the search params,
  // we should pass it to the new chat block
  const [searchParams] = useSearchParams();
  const prompt = searchParams.prompt;
  const chatPrompt =
    props.params.block === 'chat' && prompt ? `?prompt=${prompt}` : '';

  // If the user is not authenticated, redirect to login
  if (!authenticated()) {
    return <Navigate href="/login" />;
  }

  return (
    <Show when={newBlockId()}>
      {(id) => (
        <Navigate href={`/${props.params.block}/${id()}${chatPrompt}`} />
      )}
    </Show>
  );
}
