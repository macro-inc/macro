import { DocumentMention } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';

/** The same email reference used in documents and channel messages. */
export function EmailThreadMention(props: {
  threadId: string;
  subject: string;
  onOpened?: () => void;
}) {
  return (
    <DocumentMention
      key={props.threadId}
      documentId={props.threadId}
      documentName={props.subject}
      blockName="email"
      theme={{}}
      // The owner-scoped exclusion row already provides the inline title.
      // Avoid fetching every thread's full preview when settings opens.
      inlinePreview={() => ({
        id: props.threadId,
        type: 'email',
        access: 'access',
        loading: false,
        name: props.subject,
        rawName: props.subject,
      })}
      onOpened={props.onOpened}
    />
  );
}
