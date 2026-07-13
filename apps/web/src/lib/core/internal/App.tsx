import { BlockRegistry } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { LiveIndicators } from '@core/component/LiveIndicators';
import MacroBrandLoader from '@icon/macro-brand-loader.svg';
import MacroGridLoader from '@icon/macro-grid-noise-loader.svg';
import Acorn from '@phosphor-icons/core/regular/acorn.svg?component-solid';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import Subtract from '@phosphor-icons/core/regular/subtract.svg?component-solid';
import TrashSimple from '@phosphor-icons/core/regular/trash-simple.svg?component-solid';
import type { ItemType } from '@service-storage/client';
import { Button, Dropdown } from '@ui';
import { type Component, createSignal, For, Index } from 'solid-js';
import { ItemPreview } from '../component/ItemPreview';
import { Permissions } from '../component/SharePermissions';
import { Bar } from '../component/TopBar/Bar';
import { Center } from '../component/TopBar/Center';

const App: Component = () => {
  const Themes = [
    'base',
    'contrast',
    'accent',
    'accentOpaque',
    'disabled',
    'clear',
    'green',
    'red',
  ] as const;

  const testIds = [
    { id: '15085bba-d188-4c80-aac6-657b15b255d8', type: 'document' },
    { id: '6f1ea347-fee1-4717-b118-89e7bda1eacd', type: 'document' },
    { id: 'dd2ec57b-0bce-4051-8522-cf8a5f0802d5', type: 'document' },
    { id: '4cc975e0-4253-49c7-9b2e-5599783860db', type: 'document' }, // no access
    { id: '4cc975e0-4253-49c7-9b2e-55997ff860db', type: 'document' }, // doesn't exist
    { id: '676f0761-9bed-4767-9fe0-3977aa57ae1d', type: 'document' }, // deleted
    { id: 'eff713fc-28a3-45b0-aa73-5de8de38160e', type: 'chat' }, //deleted
    { id: 'a5300a46-98bc-4628-b9f4-e3129e8e643f', type: 'chat' },
    { id: 'bff194dd-18b7-4f3c-a6d1-f665dcbc6a9b', type: 'chat' },
    { id: 'c0543500-8e1c-44cd-bcb3-1b08343eb6b3', type: 'chat' }, // no access
    { id: '4cc975e0-4253-49c7-9b2e-55997ff860db', type: 'chat' }, // doesn't exist
  ];

  const ThemesWithSeparator = Themes.filter((theme) => theme !== 'clear');

  const [publicPermissions, setPublicPermissions] = createSignal<Permissions>(
    Permissions.CAN_VIEW
  );

  const documentAccess = () =>
    publicPermissions() === Permissions.NO_ACCESS
      ? 'Make Public'
      : 'Make Private';
  const togglePublicPermissions = () =>
    setPublicPermissions((prev) =>
      prev === Permissions.CAN_VIEW
        ? Permissions.NO_ACCESS
        : Permissions.CAN_VIEW
    );

  const [active, _setActive] = createSignal(0);
  const Alignments = [
    'text-left',
    'text-center',
    'text-right',
    'text-justify',
  ] as const;

  return (
    <div class="flex flex-col gap-4 w-full">
      <Bar
        center={
          <Center>
            <Button variant="ghost" onClick={togglePublicPermissions}>
              {documentAccess()} <CaretDown />
            </Button>
          </Center>
        }
      />
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <For each={Themes}>
          {() => (
            <Button variant="base">
              <Subtract /> Button Text <CaretDown />
            </Button>
          )}
        </For>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={ThemesWithSeparator}>
          {() => (
            <Button variant="base">
              <Subtract /> Button Text <CaretDown />
            </Button>
          )}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={Themes}>
          {() => (
            <Button variant="base" size="icon-md">
              <Acorn />
            </Button>
          )}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={ThemesWithSeparator}>
          {() => (
            <Button variant="base" size="icon-md">
              <Acorn />
              <CaretDown />
            </Button>
          )}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={ThemesWithSeparator}>
          {() => (
            <Button variant="base" size="icon-md">
              <Acorn />
              <CaretDown />
            </Button>
          )}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <div class={`flex justify-center ${Alignments[active()]}`}>
          <span
            contentEditable
            class="w-64 p-0.5 border border-edge rounded-lg"
          >
            macro
          </span>
        </div>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Dropdown>
          <Dropdown.Trigger variant="base" tabIndex={-1}>
            Open
          </Dropdown.Trigger>
          <Dropdown.Content>
            <Dropdown.Group>
              <Dropdown.Item>
                <span class="flex-1 truncate">This Menu Item</span>
              </Dropdown.Item>
              <Dropdown.Item>
                <span class="flex-1 truncate">This Menu Item</span>
              </Dropdown.Item>
              <Dropdown.Item>
                <TrashSimple class="size-4 shrink-0" />
                <span class="flex-1 truncate">This Menu Item</span>
              </Dropdown.Item>
              <Dropdown.Item>
                <TrashSimple class="size-4 shrink-0 text-failure" />
                <span class="flex-1 truncate">This Menu Item</span>
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </div>
      <div class="w-full flex flex-wrap gap-2 justify-center">
        <For each={BlockRegistry}>
          {(block) => {
            return <EntityIcon targetType={block} size="md" />;
          }}
        </For>
      </div>
      <div class="w-full flex flex-wrap gap-2 justify-center">
        <For each={BlockRegistry}>
          {(block) => {
            return <EntityIcon targetType={block} size="sm" />;
          }}
        </For>
      </div>
      <div class="w-full flex flex-wrap gap-2 justify-center">
        <For each={BlockRegistry}>
          {(block) => {
            return <EntityIcon targetType={block} size="xs" />;
          }}
        </For>
      </div>
      <div class="w-full flex gap-2 justify-center flex-wrap">
        <For each={testIds}>
          {(item) => {
            return <ItemPreview id={item.id} type={item.type as ItemType} />;
          }}
        </For>
      </div>
      <div class="flex flex-wrap gap-2 justify-center">
        <LiveIndicators
          userIds={[
            'macro|teo@macro.com',
            'macro|hutch@macro.com',
            'macro|jacob@macro.com',
            'macro|seamus@macro.com',
            'macro|gab@macro.com',
          ]}
        />
      </div>
      <div class="flex flex-wrap gap-2 justify-center">
        <MacroBrandLoader class="text-accent size-24" />
        <MacroGridLoader class="text-accent size-24" />
      </div>
    </div>
  );
};

export default App;
