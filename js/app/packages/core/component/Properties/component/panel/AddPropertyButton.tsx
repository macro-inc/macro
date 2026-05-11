import { Button } from '@ui';
import type { Component } from 'solid-js';

interface AddPropertyButtonProps {
  onClick: () => void;
}

export const AddPropertyButton: Component<AddPropertyButtonProps> = (props) => {
  return (
    <Button variant="base" class="w-full" onClick={props.onClick}>
      + Add Property
    </Button>
  );
};
