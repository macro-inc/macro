import { OldMenu, OldMenuItem } from '@core/component/OldMenu';
import AcornIcon from '@phosphor-icons/core/regular/acorn.svg?component-solid';
import ArrowDownIcon from '@phosphor-icons/core/regular/arrow-down.svg?component-solid';
import ArrowLeftIcon from '@phosphor-icons/core/regular/arrow-left.svg?component-solid';
import ArrowRightIcon from '@phosphor-icons/core/regular/arrow-right.svg?component-solid';
import ArrowUpIcon from '@phosphor-icons/core/regular/arrow-up.svg?component-solid';
import ArrowsClockwiseIcon from '@phosphor-icons/core/regular/arrows-clockwise.svg?component-solid';
import BookOpenIcon from '@phosphor-icons/core/regular/book-open.svg?component-solid';
import BrainIcon from '@phosphor-icons/core/regular/brain.svg?component-solid';
import BriefcaseIcon from '@phosphor-icons/core/regular/briefcase.svg?component-solid';
import CalculatorIcon from '@phosphor-icons/core/regular/calculator.svg?component-solid';
import CalendarIcon from '@phosphor-icons/core/regular/calendar.svg?component-solid';
import CameraIcon from '@phosphor-icons/core/regular/camera.svg?component-solid';
import ChartBarIcon from '@phosphor-icons/core/regular/chart-bar.svg?component-solid';
import ChartLineUpIcon from '@phosphor-icons/core/regular/chart-line-up.svg?component-solid';
import ChatIcon from '@phosphor-icons/core/regular/chat.svg?component-solid';
import ClipboardTextIcon from '@phosphor-icons/core/regular/clipboard-text.svg?component-solid';
import ClockIcon from '@phosphor-icons/core/regular/clock.svg?component-solid';
import CloudIcon from '@phosphor-icons/core/regular/cloud.svg?component-solid';
import CodeIcon from '@phosphor-icons/core/regular/code.svg?component-solid';
import CubeIcon from '@phosphor-icons/core/regular/cube.svg?component-solid';
import DatabaseIcon from '@phosphor-icons/core/regular/database.svg?component-solid';
import EnvelopeIcon from '@phosphor-icons/core/regular/envelope.svg?component-solid';
import FileTextIcon from '@phosphor-icons/core/regular/file-text.svg?component-solid';
import FolderOpenIcon from '@phosphor-icons/core/regular/folder-open.svg?component-solid';
import FunnelIcon from '@phosphor-icons/core/regular/funnel.svg?component-solid';
import FunnelXIcon from '@phosphor-icons/core/regular/funnel-x.svg?component-solid';
import GearIcon from '@phosphor-icons/core/regular/gear.svg?component-solid';
import GlobeIcon from '@phosphor-icons/core/regular/globe.svg?component-solid';
import HashIcon from '@phosphor-icons/core/regular/hash.svg?component-solid';
import HeartIcon from '@phosphor-icons/core/regular/heart.svg?component-solid';
import KeyIcon from '@phosphor-icons/core/regular/key.svg?component-solid';
import LightbulbIcon from '@phosphor-icons/core/regular/lightbulb.svg?component-solid';
import LightningIcon from '@phosphor-icons/core/regular/lightning.svg?component-solid';
import LinkIcon from '@phosphor-icons/core/regular/link.svg?component-solid';
import ListChecksIcon from '@phosphor-icons/core/regular/list-checks.svg?component-solid';
import MagicWandIcon from '@phosphor-icons/core/regular/magic-wand.svg?component-solid';
import MagnifyingGlassIcon from '@phosphor-icons/core/regular/magnifying-glass.svg?component-solid';
import MapPinIcon from '@phosphor-icons/core/regular/map-pin.svg?component-solid';
import MicrophoneIcon from '@phosphor-icons/core/regular/microphone.svg?component-solid';
import MusicNoteIcon from '@phosphor-icons/core/regular/music-note.svg?component-solid';
import PaletteIcon from '@phosphor-icons/core/regular/palette.svg?component-solid';
import PencilIcon from '@phosphor-icons/core/regular/pencil.svg?component-solid';
import PhoneIcon from '@phosphor-icons/core/regular/phone.svg?component-solid';
import PresentationChartIcon from '@phosphor-icons/core/regular/presentation-chart.svg?component-solid';
import PuzzlePieceIcon from '@phosphor-icons/core/regular/puzzle-piece.svg?component-solid';
import RocketIcon from '@phosphor-icons/core/regular/rocket.svg?component-solid';
import ShieldCheckIcon from '@phosphor-icons/core/regular/shield-check.svg?component-solid';
import SmileyIcon from '@phosphor-icons/core/regular/smiley.svg?component-solid';
import SparkleIcon from '@phosphor-icons/core/regular/sparkle.svg?component-solid';
import StackIcon from '@phosphor-icons/core/regular/stack.svg?component-solid';
import TagIcon from '@phosphor-icons/core/regular/tag.svg?component-solid';
import TargetIcon from '@phosphor-icons/core/regular/target.svg?component-solid';
import TranslateIcon from '@phosphor-icons/core/regular/translate.svg?component-solid';
import TreeStructureIcon from '@phosphor-icons/core/regular/tree-structure.svg?component-solid';
import TrendUpIcon from '@phosphor-icons/core/regular/trend-up.svg?component-solid';
import TrophyIcon from '@phosphor-icons/core/regular/trophy.svg?component-solid';
import UsersIcon from '@phosphor-icons/core/regular/users.svg?component-solid';
import WrenchIcon from '@phosphor-icons/core/regular/wrench.svg?component-solid';
import {
  type Accessor,
  type Component,
  type ComponentProps,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import colors from 'tailwindcss/colors';
import type { FilteredTailwindColors } from './TailwindColorPicker';

export const iconMap: Record<string, Component<ComponentProps<'svg'>>> = {
  AcornIcon,
  ArrowsClockwiseIcon,
  BookOpenIcon,
  BrainIcon,
  BriefcaseIcon,
  CalculatorIcon,
  CalendarIcon,
  CameraIcon,
  ChartBarIcon,
  ChartLineUpIcon,
  ChatIcon,
  ClipboardTextIcon,
  ClockIcon,
  CloudIcon,
  CodeIcon,
  CubeIcon,
  DatabaseIcon,
  EnvelopeIcon,
  FileTextIcon,
  FolderOpenIcon,
  FunnelIcon,
  FunnelXIcon,
  GearIcon,
  GlobeIcon,
  HashIcon,
  HeartIcon,
  KeyIcon,
  LightbulbIcon,
  LightningIcon,
  LinkIcon,
  ListChecksIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  MicrophoneIcon,
  MusicNoteIcon,
  PaletteIcon,
  PencilIcon,
  PhoneIcon,
  PresentationChartIcon,
  PuzzlePieceIcon,
  RocketIcon,
  ShieldCheckIcon,
  SmileyIcon,
  SparkleIcon,
  StackIcon,
  TagIcon,
  TargetIcon,
  TranslateIcon,
  TreeStructureIcon,
  TrendUpIcon,
  TrophyIcon,
  UsersIcon,
  WrenchIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
};

export const icons = Object.values(iconMap);

export function IconSelectorMenu(props: {
  onIconSelect: (icon: Component) => void;
  show: Accessor<boolean>;
  setShow: (show: boolean) => void;
  color?: FilteredTailwindColors;
  text?: string;
}) {
  let menuRef: HTMLDivElement | undefined;

  function handleOutsideClick(event: MouseEvent) {
    if (menuRef && !menuRef.contains(event.target as Node)) {
      props.setShow(false);
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleOutsideClick);
    });
  });

  function handleIconSelect(icon: Component) {
    props.onIconSelect(icon);
    props.setShow(false);
  }

  return (
    <Show when={props.show()}>
      <div class="max-h-[290px] overflow-y-auto" ref={menuRef}>
        <OldMenu class="max-h-[290px] overflow-y-auto">
          <For each={icons}>
            {(icon) => (
              <OldMenuItem
                icon={() => (
                  <Dynamic
                    component={icon}
                    style={
                      props.color
                        ? { color: colors[props.color][500] }
                        : undefined
                    }
                  />
                )}
                text={props.text ?? ''}
                onClick={() => handleIconSelect(icon)}
              />
            )}
          </For>
        </OldMenu>
      </div>
    </Show>
  );
}
