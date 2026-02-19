import { projectBlockDataSignal } from '../signal/projectBlockData';
import { ProjectPropertiesDrawer } from './ProjectPropertiesModal';
import type { ParentProps } from 'solid-js';

export function ModalsMounter(props: ParentProps) {
  const name = () => projectBlockDataSignal()?.projectMetadata.name;
  return (
    <>
      {props.children}
      <ProjectPropertiesDrawer name={name()} />
    </>
  );
}
