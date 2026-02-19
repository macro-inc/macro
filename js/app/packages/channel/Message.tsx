import type { ApiThreadReply } from '@service-storage/generated/schemas';

type MessageProps = {
  message: ApiThreadReply;
};
export function Message(props: MessageProps) {
  return <div></div>;
}
