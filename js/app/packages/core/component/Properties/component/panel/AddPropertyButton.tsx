import { Button } from '@ui/components/Button';
import type { Component } from 'solid-js';

interface AddPropertyButtonProps {
  onClick: () => void;
}

export const AddPropertyButton: Component<AddPropertyButtonProps> = (props) => {
  return (
    <Button variant="secondary" class="w-full" onClick={props.onClick}>
      + Add Property
    </Button>
  );
};
