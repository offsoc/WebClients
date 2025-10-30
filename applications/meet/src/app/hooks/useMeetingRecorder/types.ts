import type { Participant, Track } from '@proton-meet/livekit-client';

export interface RecordingTrackInfo {
    track: Track | null;
    participant: Participant;
    isScreenShare: boolean;
    participantIndex: number;
}

export interface RecordingState {
    isRecording: boolean;
    duration: number;
    recordedChunks: Blob[];
}

export interface FrameReaderInfo {
    reader: ReadableStreamDefaultReader<VideoFrame> | null;
    videoElement: HTMLVideoElement;
    rafHandle: number | null;
    participantKey: string;
}
