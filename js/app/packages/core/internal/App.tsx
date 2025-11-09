import { BlockRegistry } from '@core/block';
import { EntityIcon } from '@core/component/EntityIcon';
import { LiveIndicators } from '@core/component/LiveIndicators';
import { FileMenu } from '@core/component/TopBar/FileMenu';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import MacroBrandLoader from '@macro-icons/macro-brand-loader.svg';
import MacroGridLoader from '@macro-icons/macro-grid-noise-loader.svg';
import Acorn from '@phosphor-icons/core/regular/acorn.svg?component-solid';
import Sparkle from '@phosphor-icons/core/regular/sparkle.svg?component-solid';
import Subtract from '@phosphor-icons/core/regular/subtract.svg?component-solid';
import TrashSimple from '@phosphor-icons/core/regular/trash-simple.svg?component-solid';
import { type Component, createSignal, For, Index } from 'solid-js';
import { IconButton } from '../component/IconButton';
import { ItemPreview } from '../component/ItemPreview';
import { DropdownMenuContent, MenuItem } from '../component/Menu';
import { Permissions } from '../component/SharePermissions';
import { TextButton } from '../component/TextButton';
import { Bar } from '../component/TopBar/Bar';
import { Center } from '../component/TopBar/Center';
import { Left } from '../component/TopBar/Left';

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
        left={
          <Left>
            <FileMenu
              id="123"
              itemType="document"
              projectName="Core"
              name="Component"
            >
              <MenuItem
                onClick={() => alert('World')}
                text="Hello"
                icon={Sparkle}
              />
              <MenuItem onClick={() => {}} text="Butterfly" icon={Sparkle} />
              <MenuItem onClick={() => {}} text="Ocean" icon={Sparkle} />
              <MenuItem onClick={() => {}} text="Mountain" icon={Sparkle} />
              <MenuItem onClick={() => {}} text="Forest" icon={Sparkle} />
              <MenuItem onClick={() => {}} text="River" icon={Sparkle} />
              <MenuItem onClick={() => {}} text="Valley" icon={Sparkle} />
              <MenuItem onClick={() => {}} text="Delete" icon={TrashSimple} />
            </FileMenu>
          </Left>
        }
        center={
          <Center>
            <TextButton
              theme="clear"
              text={documentAccess()}
              showChevron
              onClick={togglePublicPermissions}
            />
          </Center>
        }
      />
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <For each={Themes}>
          {(theme) => (
            <TextButton
              theme={theme}
              text="Button Text"
              icon={Subtract}
              showChevron
            />
          )}
        </For>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={ThemesWithSeparator}>
          {(theme) => (
            <TextButton
              theme={theme()}
              text="Button Text"
              icon={Subtract}
              showChevron
              showSeparator
            />
          )}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={Themes}>
          {(theme) => <IconButton theme={theme()} icon={Acorn} />}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={ThemesWithSeparator}>
          {(theme) => <IconButton theme={theme()} icon={Acorn} showChevron />}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <Index each={ThemesWithSeparator}>
          {(theme) => (
            <IconButton theme={theme()} icon={Acorn} showChevron border />
          )}
        </Index>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <div class={`flex justify-center ${Alignments[active()]}`}>
          <span
            contentEditable
            class="w-64 p-0.5 border-1 border-edge rounded-lg"
          >
            macro
          </span>
        </div>
      </div>
      <div class="flex flex-row flex-wrap justify-center gap-4">
        <DropdownMenu>
          <DropdownMenu.Trigger>
            <TextButton theme="base" text="Open" tabIndex={-1} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenuContent>
              <MenuItem text="This Menu Item" />
              <MenuItem text="This Menu Item" />
              <MenuItem text="This Menu Item" icon={TrashSimple} />
              <MenuItem
                text="This Menu Item"
                icon={TrashSimple}
                iconClass="text-failure"
              />
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu>
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
            return (
              <ItemPreview
                itemId={item.id}
                itemType={item.type as 'document' | 'chat' | undefined}
              />
            );
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
