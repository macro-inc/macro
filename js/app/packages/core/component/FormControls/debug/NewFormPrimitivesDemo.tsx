import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Button } from '../Button';
import DropdownMenu from '../DropdownMenu';
import { SegmentedControl } from '../SegmentControls';
import { ToggleButton } from '../ToggleButton';
import { ToggleSwitch } from '../ToggleSwitch';

const NewFormPrimitivesDemo = () => {
  const [list] = createStore(['!', '*', '★', '⍻']);
  const [layoutList] = createStore([
    'Recent',
    'Title',
    'Created',
    'Owner',
    'Type',
  ]);
  const [selectItemFromList, setSelectItemFromList] = createSignal(list[1]);

  const [openDropdown1, setOpenDropdown1] = createSignal(false);
  const [openDropdown2, setOpenDropdown2] = createSignal(false);
  const [switchVal, setSwitchVal] = createSignal(true);
  const [selectVal, setSelectVal] = createSignal(true);
  const [unrollNotifications, setUnrollNotifications] = createSignal(true);

  return (
    <div class="p-6">
      <h2>Size: SM</h2>
      <div class="flex gap-4 items-center">
        <ToggleSwitch size="SM" label="Subscribe" />
        <SegmentedControl
          size="SM"
          label="Show"
          value={selectItemFromList()}
          list={list}
          onChange={(newValue) => setSelectItemFromList(newValue)}
        />
        <ToggleButton size="SM">Select Btn</ToggleButton>

        <Button size="SM" hotkeyShortcut="cmd+k">
          Console
        </Button>

        <DropdownMenu
          size="SM"
          triggerLabel="dropdown"
          open={openDropdown1()}
          onOpenChange={setOpenDropdown1}
        >
          <div class="min-w-[10vw]">
            <div class="grid divide-y divide-edge">
              <section class="p-2">
                <SegmentedControl
                  size="SM"
                  label="Layout"
                  // value={selectItemFromList()}
                  list={['Compact', 'Relaxed', 'Visual']}
                  // onChange={(newValue) => setSelectItemFromList(newValue)}
                />
              </section>
              <section class="p-2">
                <SegmentedControl
                  size="SM"
                  label="Sort"
                  // value={selectItemFromList()}
                  list={layoutList}
                  // onChange={(newValue) => setSelectItemFromList(newValue)}
                />
              </section>
              <section class="grid gap-1 p-2">
                <ToggleSwitch
                  size="SM"
                  label="Unroll Notifications"
                  checked={unrollNotifications()}
                  onChange={setUnrollNotifications}
                />
                <ToggleSwitch size="SM" label="Indicate Unread" />
                <ToggleSwitch size="SM" label="Monochrome" />
              </section>
            </div>
            <div class="grid grid-flow-col w-full border-edge border-t-[2px]">
              <Button
                size="SM"
                theme="secondary"
                border={false}
                onClick={() => {
                  // Reset logic here
                  setOpenDropdown1(false);
                }}
              >
                Reset
              </Button>
              <Button
                size="SM"
                theme="primary"
                border={false}
                onClick={() => {
                  // submit logic here
                  setOpenDropdown1(false);
                }}
              >
                Submit
              </Button>
            </div>
          </div>
        </DropdownMenu>
      </div>
      <hr class="my-4" />
      <h2>Size: Base</h2>
      <div class="flex gap-4">
        <ToggleSwitch label="Subscribe" />
        <SegmentedControl
          size="Base"
          label="Show"
          value={selectItemFromList()}
          list={list}
          onChange={(newValue) => setSelectItemFromList(newValue)}
        />
        <DropdownMenu
          size="Base"
          triggerLabel="dropdown"
          open={openDropdown2()}
          onOpenChange={setOpenDropdown2}
        >
          <div class="min-w-[10vw]">
            <div class="grid divide-y divide-edge">
              <section class="p-2">
                <SegmentedControl
                  size="SM"
                  // label="Layout"
                  value={selectItemFromList()}
                  list={['Compact', 'Relaxed', 'Visual']}
                  onChange={(newValue) => setSelectItemFromList(newValue)}
                />
              </section>
              <section class="p-2">
                <SegmentedControl
                  size="SM"
                  label="Sort"
                  value={selectItemFromList()}
                  list={layoutList}
                  onChange={(newValue) => setSelectItemFromList(newValue)}
                />
              </section>
              <section class="grid gap-1 p-2">
                <ToggleSwitch
                  size="SM"
                  label="Unroll Notifications"
                  checked={unrollNotifications()}
                  onChange={setUnrollNotifications}
                />
                <ToggleSwitch size="SM" label="Indicate Unread" />
                <ToggleSwitch size="SM" label="Monochrome" />
              </section>
            </div>
            <div class="grid grid-flow-col w-full border-edge border-t-[2px]">
              <Button
                size="SM"
                theme="secondary"
                border={false}
                onClick={() => {
                  // Reset logic here
                  setOpenDropdown2(false);
                }}
              >
                Reset
              </Button>
              <Button
                size="SM"
                theme="primary"
                border={false}
                onClick={() => {
                  // submit logic here
                  setOpenDropdown2(false);
                }}
              >
                Submit
              </Button>
            </div>
          </div>
        </DropdownMenu>
        <ToggleButton size="Base">Select Btn</ToggleButton>
        <Button size="Base" hotkeyShortcut="cmd+k">
          Console
        </Button>
      </div>
      <hr class="my-4" />
      <h2>Misc</h2>
      <div class="flex gap-4">
        <ToggleSwitch
          label="Subscribe"
          checked={switchVal()}
          onChange={setSwitchVal}
        />
        <ToggleButton size="Base" pressed={selectVal()} onChange={setSelectVal}>
          Select Btn
        </ToggleButton>
      </div>
    </div>
  );
};

export default NewFormPrimitivesDemo;
