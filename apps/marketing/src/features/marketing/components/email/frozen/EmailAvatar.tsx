import { Show } from 'solid-js';
import aidan from '../../../../../assets/people/aidan.webp';
import mark from '../../../../../assets/people/mark.jpeg';
import panat from '../../../../../assets/people/panat.webp';
import { homepagePeople } from '../../../core/homepage-demo-people';

// Existing website-owned portraits illustrate fictional sample contacts.
const sampleContactPhotos: Record<string, string> = {
  Dana: homepagePeople.valentina.photo,
  Maya: homepagePeople.julia.photo,
  Alex: panat,
  Sam: mark,
  Jamie: aidan,
};
export function EmailAvatar(props: { name: string; class?: string }) {
  const photo = () =>
    Object.values(homepagePeople).find((person) =>
      props.name.startsWith(person.shortName)
    )?.photo ?? sampleContactPhotos[props.name.split(' ')[0]];
  return (
    <Show
      when={photo()}
      fallback={
        <span
          aria-hidden="true"
          class={`inline-flex shrink-0 items-center justify-center rounded-full bg-active text-[10px] text-ink-muted ${props.class ?? 'size-6'}`}
        >
          {props.name.slice(0, 1)}
        </span>
      }
    >
      {(src) => (
        <img
          src={src()}
          alt=""
          class={`shrink-0 rounded-full object-cover ${props.class ?? 'size-6'}`}
        />
      )}
    </Show>
  );
}
