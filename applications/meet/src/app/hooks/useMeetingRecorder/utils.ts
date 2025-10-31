import type { TrackReference } from '@livekit/components-react';
import type { LocalParticipant, RemoteParticipant, Track } from '@proton-meet/livekit-client';

import type { RecordingTrackInfo } from './types';

const mp4Codecs = [
    'video/mp4;codecs=h264,aac',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
];

const webmCodecs = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
];

export const getRecordingDetails = () => {
    let selectedMimeType = 'video/webm';
    let selectedExtension = 'webm';

    for (const codec of mp4Codecs) {
        if (MediaRecorder.isTypeSupported(codec)) {
            selectedMimeType = codec;
            selectedExtension = 'mp4';
            break;
        }
    }

    if (selectedExtension !== 'mp4') {
        for (const codec of webmCodecs) {
            if (MediaRecorder.isTypeSupported(codec)) {
                selectedMimeType = codec;
                selectedExtension = 'webm';
                break;
            }
        }
    }

    return {
        mimeType: selectedMimeType,
        extension: selectedExtension,
    };
};

export const createVideoElement = (trackInfo: RecordingTrackInfo) => {
    const videoElement = document.createElement('video');
    videoElement.muted = true;
    videoElement.autoplay = true;
    videoElement.playsInline = true;

    trackInfo.track?.attach(videoElement);

    const playVideo = async () => {
        try {
            if (videoElement) {
                await videoElement.play();
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to play video:', error);
        }
    };

    videoElement.addEventListener('canplay', playVideo, { once: true });

    return videoElement;
};

export const cleanupVideoElement = (videoElement: HTMLVideoElement) => {
    videoElement.pause();
    videoElement.src = '';
    videoElement.load();
};

export const getTracksForRecording = (
    pagedParticipants: (RemoteParticipant | LocalParticipant)[],
    cameraTracks: TrackReference[],
    screenShareTracks: TrackReference[]
): RecordingTrackInfo[] => {
    const screenShareTrack = screenShareTracks?.[0];

    const participantTracksForRecording = pagedParticipants.map((participant, index) => {
        const cameraTrackReference = cameraTracks.find(
            (trackRef) => trackRef.participant?.identity === participant.identity
        );

        return {
            track: cameraTrackReference?.publication.track as Track,
            participant: participant,
            isScreenShare: false,
            participantIndex: index,
        };
    });

    const allTracks = screenShareTrack
        ? [
              {
                  track: screenShareTrack.publication.track as Track,
                  participant: screenShareTrack.participant,
                  isScreenShare: true,
                  participantIndex: 0,
              },
              ...participantTracksForRecording,
          ]
        : participantTracksForRecording;

    return allTracks;
};

export const supportsTrackProcessor = () => {
    return (
        typeof (window as any).MediaStreamTrackProcessor !== 'undefined' &&
        typeof (window as any).VideoFrame !== 'undefined'
    );
};
