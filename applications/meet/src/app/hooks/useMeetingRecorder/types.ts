import type { Track as LiveKitTrack, Participant } from '@proton-meet/livekit-client';

export interface RecordingTrackInfo {
    track: LiveKitTrack;
    participant: Participant;
    isScreenShare: boolean;
}

export interface RecordingState {
    isRecording: boolean;
    isPaused: boolean;
    duration: number;
    recordedChunks: Blob[];
}
