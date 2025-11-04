import { useEffect, useRef, useState } from 'react';

import { useTracks } from '@livekit/components-react';
import { Track } from '@proton-meet/livekit-client';

import { wait } from '@proton/shared/lib/helpers/promise';

import { useMeetContext } from '../../contexts/MeetContext';
import { useIsLargerThanMd } from '../useIsLargerThanMd';
import { useIsNarrowHeight } from '../useIsNarrowHeight';
import { MessageType } from './recordingWorkerTypes';
import type { FrameReaderInfo, RecordingState, RecordingTrackInfo } from './types';
import { getRecordingDetails, getTracksForRecording, supportsTrackProcessor } from './utils';
import { WorkerRecordingStorage } from './workerStorage';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const FPS = 30;

const { mimeType, extension } = getRecordingDetails();

export function useMeetingRecorder(participantNameMap: Record<string, string>) {
    const isLargerThanMd = useIsLargerThanMd();

    const isNarrowHeight = useIsNarrowHeight();

    const [recordingState, setRecordingState] = useState<RecordingState>({
        isRecording: false,
        duration: 0,
        recordedChunks: [],
    });

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const renderWorkerRef = useRef<Worker | null>(null);
    const frameReadersRef = useRef<Map<string, FrameReaderInfo>>(new Map());
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const startTimeRef = useRef<number>(0);
    const durationIntervalRef = useRef<number>();
    const workerStorageRef = useRef<WorkerRecordingStorage | null>(null);
    const visibilityListenerRef = useRef<(() => void) | null>(null);

    const cameraTracks = useTracks([Track.Source.Camera]);
    const screenShareTracks = useTracks([Track.Source.ScreenShare]);
    const audioTracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio]);
    const { pagedParticipants } = useMeetContext();

    const renderInfoRef = useRef({
        cameraTracks,
        screenShareTracks,
        audioTracks,
        pagedParticipants,
        participantNameMap,
    });

    renderInfoRef.current = {
        cameraTracks,
        screenShareTracks,
        audioTracks,
        pagedParticipants,
        participantNameMap,
    };

    const prepareRenderState = () => {
        const tracks = getTracksForRecording(
            renderInfoRef.current.pagedParticipants,
            renderInfoRef.current.cameraTracks,
            renderInfoRef.current.screenShareTracks
        );

        const participants = tracks.map((track) => {
            const audioPublication = Array.from(track.participant.trackPublications.values()).find(
                (pub) => pub.kind === Track.Kind.Audio && pub.track
            );
            const hasActiveAudio = audioPublication ? !audioPublication.isMuted : false;

            return {
                identity: track.participant?.identity || '',
                name: renderInfoRef.current.participantNameMap[track.participant?.identity || ''] || 'Unknown',
                participantIndex: track.participantIndex,
                isScreenShare: track.isScreenShare,
                hasVideo: Boolean(track.track && !track.track.isMuted),
                hasActiveAudio,
            };
        });

        return {
            participants,
            isLargerThanMd,
            isNarrowHeight,
        };
    };

    const startFrameCaptureWithProcessor = (trackInfo: RecordingTrackInfo, participantKey: string) => {
        const mediaTrack = trackInfo.track?.mediaStreamTrack;
        if (!mediaTrack || !supportsTrackProcessor() || !renderWorkerRef.current) {
            return false;
        }

        const trackId = trackInfo.track?.sid || `track-${Date.now()}`;

        try {
            // @ts-expect-error - MediaStreamTrackProcessor is not yet in TypeScript types
            const processor = new MediaStreamTrackProcessor({ track: mediaTrack });
            const reader = processor.readable.getReader();

            frameReadersRef.current.set(trackId, {
                reader,
                participantKey,
            });

            const pump = async () => {
                try {
                    while (frameReadersRef.current.has(trackId)) {
                        const { value: frame, done } = await reader.read();
                        if (done) {
                            break;
                        }

                        if (renderWorkerRef.current && frame) {
                            renderWorkerRef.current.postMessage(
                                {
                                    type: 'updateFrame',
                                    frameData: { participantIdentity: participantKey, frame },
                                },
                                [frame]
                            );
                        }
                    }
                } catch (error) {
                    // Reader was cancelled or track ended
                }
            };

            void pump();
            return true;
        } catch (error) {
            return false;
        }
    };

    const startFrameCapture = (trackInfo: RecordingTrackInfo) => {
        if (!trackInfo.track || trackInfo.track.isMuted) {
            return;
        }

        const participantKey = trackInfo.isScreenShare
            ? `${trackInfo.participant?.identity || ''}-screenshare`
            : trackInfo.participant?.identity || '';

        if (startFrameCaptureWithProcessor(trackInfo, participantKey)) {
            return;
        }
    };

    const stopFrameCapture = (trackId: string) => {
        const readerInfo = frameReadersRef.current.get(trackId);
        if (!readerInfo) {
            return;
        }

        if (readerInfo.reader) {
            void readerInfo.reader.cancel();
        }

        frameReadersRef.current.delete(trackId);
    };

    const stopAllFrameCaptures = () => {
        frameReadersRef.current.forEach((_, trackId) => {
            stopFrameCapture(trackId);
        });
        frameReadersRef.current.clear();
    };

    const setupAudioMixing = () => {
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        let hasAudio = false;

        audioTracks.forEach((trackRef) => {
            if (trackRef.publication.track && !trackRef.publication.isMuted) {
                const mediaStreamTrack = trackRef.publication.track.mediaStreamTrack;
                if (mediaStreamTrack) {
                    const stream = new MediaStream([mediaStreamTrack]);
                    const source = audioContext.createMediaStreamSource(stream);
                    source.connect(destination);
                    hasAudio = true;
                }
            }
        });

        audioContextRef.current = audioContext;
        audioDestinationRef.current = destination;

        const handleVisibilityChange = () => {
            if (audioContextRef?.current?.state === 'suspended') {
                void audioContextRef.current.resume();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        visibilityListenerRef.current = handleVisibilityChange;

        return { stream: destination.stream, hasAudio };
    };

    const startRecording = async () => {
        try {
            if (workerStorageRef.current) {
                try {
                    await workerStorageRef.current.clear();
                    workerStorageRef.current.terminate();
                } catch (error) {}
                workerStorageRef.current = null;
            }

            const storage = new WorkerRecordingStorage(extension);
            await storage.init();
            workerStorageRef.current = storage;

            // Create canvas
            const canvas = document.createElement('canvas');
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;
            canvasRef.current = canvas;

            const canvasStream = canvas.captureStream(FPS);

            const worker = new Worker(new URL('./renderWorker.ts', import.meta.url), {
                type: 'module',
            });
            renderWorkerRef.current = worker;

            // Transfer canvas to worker as OffscreenCanvas
            const offscreen = canvas.transferControlToOffscreen();
            worker.postMessage(
                {
                    type: MessageType.INIT,
                    canvas: offscreen,
                    state: prepareRenderState(),
                },
                [offscreen]
            );

            // Start rendering in worker
            worker.postMessage({ type: 'render' });

            const { stream: audioStream, hasAudio } = setupAudioMixing();

            const videoTracks = canvasStream.getVideoTracks();
            const tracks = [...videoTracks, ...(hasAudio ? audioStream.getAudioTracks() : [])];

            const combinedStream = new MediaStream(tracks);

            const options = { mimeType };
            const mediaRecorder = new MediaRecorder(combinedStream, options);

            recordedChunksRef.current = [];

            let chunkCount = 0;
            mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0 && workerStorageRef.current) {
                    try {
                        chunkCount++;
                        await workerStorageRef.current.addChunk(event.data);
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.error(`✗ Failed to store chunk ${chunkCount} in OPFS:`, error);
                    }
                } else {
                    // eslint-disable-next-line no-console
                    console.warn('ondataavailable called with empty data or no storage');
                }
            };

            mediaRecorder.onerror = (event) => {
                // eslint-disable-next-line no-console
                console.error('MediaRecorder error:', event);
            };

            mediaRecorder.start(1000);
            mediaRecorderRef.current = mediaRecorder;

            // Start video elements and frame capture for tracks
            const recordingTracks = getTracksForRecording(
                renderInfoRef.current.pagedParticipants,
                renderInfoRef.current.cameraTracks,
                renderInfoRef.current.screenShareTracks
            );
            recordingTracks.forEach((trackInfo) => {
                if (trackInfo.track && !trackInfo.track.isMuted) {
                    startFrameCapture(trackInfo);
                }
            });

            startTimeRef.current = Date.now();
            durationIntervalRef.current = window.setInterval(() => {
                setRecordingState((prev) => ({
                    ...prev,
                    duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
                }));
            }, 1000);

            setRecordingState({
                isRecording: true,
                duration: 0,
                recordedChunks: [],
            });
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to start recording:', error);
            throw error;
        }
    };

    const stopRecording = () => {
        return new Promise<Blob | null>(async (resolve) => {
            if (mediaRecorderRef.current && recordingState.isRecording) {
                mediaRecorderRef.current.onstop = async () => {
                    let blob: Blob | null = null;

                    // Small delay to ensure all async ondataavailable handlers complete
                    await wait(100);

                    if (!workerStorageRef.current) {
                        resolve(null);

                        return;
                    }

                    try {
                        const file = await workerStorageRef.current.getFile();

                        if (file.type && file.type !== '') {
                            blob = file;
                        } else {
                            blob = file.slice(0, file.size, mimeType);
                        }
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.error('Failed to retrieve file from OPFS:', error);
                    }

                    stopAllFrameCaptures();

                    if (renderWorkerRef.current) {
                        renderWorkerRef.current.postMessage({ type: 'stop' });
                        renderWorkerRef.current.terminate();
                        renderWorkerRef.current = null;
                    }

                    if (audioContextRef.current) {
                        void audioContextRef.current.close();
                    }

                    if (visibilityListenerRef.current) {
                        document.removeEventListener('visibilitychange', visibilityListenerRef.current);
                        visibilityListenerRef.current = null;
                    }

                    if (durationIntervalRef.current) {
                        clearInterval(durationIntervalRef.current);
                    }

                    recordedChunksRef.current = [];

                    setRecordingState({
                        isRecording: false,
                        duration: 0,
                        recordedChunks: [],
                    });

                    resolve(blob);
                };

                mediaRecorderRef.current.stop();
            } else {
                if (workerStorageRef.current) {
                    workerStorageRef.current.terminate();
                    workerStorageRef.current = null;
                }
                resolve(null);
            }
        });
    };

    const downloadRecording = async () => {
        const blob = await stopRecording();

        if (!blob || blob.size === 0) {
            return;
        }

        try {
            // Download file from OPFS
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `meeting-recording-${new Date().toISOString()}.${extension}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            await wait(1000);
            URL.revokeObjectURL(url);
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Failed to download recording:', error);
        }
    };

    useEffect(() => {
        if (!recordingState.isRecording || !renderWorkerRef.current) {
            return;
        }

        renderWorkerRef.current.postMessage({
            type: 'updateState',
            state: prepareRenderState(),
        });
    }, [recordingState.isRecording, isLargerThanMd, isNarrowHeight, pagedParticipants]);

    // Handle track changes during recording (start/stop frame capture as needed)
    useEffect(() => {
        if (!recordingState.isRecording) {
            return;
        }

        const tracks = getTracksForRecording(
            renderInfoRef.current.pagedParticipants,
            renderInfoRef.current.cameraTracks,
            renderInfoRef.current.screenShareTracks
        );

        // Get current track IDs
        const currentTrackIds = new Set(Array.from(frameReadersRef.current.keys()));

        const newTrackIds = new Set(tracks.filter((t) => t.track && !t.track.isMuted).map((t) => t.track!.sid || ''));

        // Stop captures for tracks that are no longer active
        currentTrackIds.forEach((trackId) => {
            if (!newTrackIds.has(trackId)) {
                stopFrameCapture(trackId);
            }
        });

        // Start captures for new tracks
        tracks.forEach((trackInfo) => {
            const trackId = trackInfo.track?.sid;
            if (trackId && !currentTrackIds.has(trackId) && trackInfo.track && !trackInfo.track.isMuted) {
                startFrameCapture(trackInfo);
            }
        });
    }, [recordingState.isRecording, cameraTracks, screenShareTracks, pagedParticipants]);

    const handleCleanup = async () => {
        stopAllFrameCaptures();
        if (renderWorkerRef.current) {
            renderWorkerRef.current.postMessage({ type: 'stop' });
            renderWorkerRef.current.terminate();
            renderWorkerRef.current = null;
        }
        if (audioContextRef.current) {
            await audioContextRef.current.close();
        }
        if (visibilityListenerRef.current) {
            document.removeEventListener('visibilitychange', visibilityListenerRef.current);
            visibilityListenerRef.current = null;
        }
        if (durationIntervalRef.current) {
            clearInterval(durationIntervalRef.current);
        }
        if (workerStorageRef.current) {
            await workerStorageRef.current.clear();
            workerStorageRef.current.terminate();
            workerStorageRef.current = null;
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            void handleCleanup();
        };
    }, []);

    return {
        recordingState,
        startRecording,
        stopRecording,
        downloadRecording,
    };
}
