# Channel Tabs

Each Channel view should have four tabs.

1. Messages (Default)
This is the default view. This is a paginated list of top level channel threads and an input box in the bottom.


2. Attachments
This view is specifically tailored to seeing all the files that are within the channel.

There should be two sections:
  1. Media - This is an ImageGallery view same width as a channel message holding approximately 5-6 media previews. Media contains attachments that are "static".
  2. Files - This should be using a unified-list (simmilar to the one inside of next-soup). This list should contain all non static attachments ordered by the date they where attached in the channel. You should not be able to mutate files in this view, only reference and open.


3. Participants
This view is where you manage the channel participants. It should be a virtualized list of all participants (channel message width), with the ability to search for participants, and add new participants. Each participant item should also have a remove button to remove them from the channel is neccesary.


4. New
This is a unique view that is simmilar to the default messages view but only contains messages that are "new".
