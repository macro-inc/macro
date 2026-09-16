export type AudioRecording = {
  finish(): Promise<Blob>;
  cancel(): void;
};

export type StartRecording = (options: {
  signal: AbortSignal;
  onLevel: (level: number) => void;
  onLimit: () => void;
}) => Promise<AudioRecording>;

export type TranscribeAudio = (
  audio: Blob,
  signal: AbortSignal
) => Promise<string>;
