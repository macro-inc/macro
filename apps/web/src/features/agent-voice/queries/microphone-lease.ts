import { acquireAudioInputLease } from '@core/util/audio-input-lease';

export const acquireVoiceMicrophone = () =>
  acquireAudioInputLease({ required: true });
