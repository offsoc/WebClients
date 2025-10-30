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
