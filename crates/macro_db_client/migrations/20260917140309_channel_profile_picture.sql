-- Static files are owned by the static-file service; channel deletion removes
-- this reference along with the channel, without deleting a potentially shared file.
ALTER TABLE comms_channels ADD COLUMN profile_picture_id UUID;
