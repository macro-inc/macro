import WhatsappIcon from '@phosphor/whatsapp-logo.svg';
import { Item } from '@ui';

/** WhatsApp's brand tile, the media slot of the account rows. */
export function WhatsAppTile() {
  return (
    <Item.Media class="bg-[#25D366] text-[#fff]">
      <WhatsappIcon />
    </Item.Media>
  );
}
