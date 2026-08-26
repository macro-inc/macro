import { usePersonasQuery } from '@queries/bots/personas';
import { createSignal, Show } from 'solid-js';
import { PersonaCreate } from './Personas/PersonaCreate';
import { PersonaDetail } from './Personas/PersonaDetail';
import { PersonaList } from './Personas/PersonaList';

type PersonaSettingsView =
  | { type: 'list' }
  | { type: 'create' }
  | { type: 'detail'; personaId: string };

export function Personas() {
  const personasQuery = usePersonasQuery();
  const [view, setView] = createSignal<PersonaSettingsView>({ type: 'list' });

  const creating = () => view().type === 'create';
  const selectedPersonaId = () => {
    const current = view();
    return current.type === 'detail' ? current.personaId : undefined;
  };
  const showList = () => setView({ type: 'list' });

  return (
    <Show when={!creating()} fallback={<PersonaCreate onBack={showList} />}>
      <Show
        when={selectedPersonaId()}
        fallback={
          <PersonaList
            personas={personasQuery.data}
            loading={personasQuery.isLoading}
            onCreate={() => setView({ type: 'create' })}
            onOpen={(personaId) => setView({ type: 'detail', personaId })}
          />
        }
      >
        {(personaId) => (
          <PersonaDetail personaId={personaId()} onBack={showList} />
        )}
      </Show>
    </Show>
  );
}
