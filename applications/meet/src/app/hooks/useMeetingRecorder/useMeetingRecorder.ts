import { useCallback, useEffect, useRef, useState } from 'react';

import { useTracks } from '@livekit/components-react';
import { Track } from '@proton-meet/livekit-client';

import { wait } from '@proton/shared/lib/helpers/promise';

import { useMeetContext } from '../../contexts/MeetContext';
import { calculateGridLayout } from '../../utils/calculateGridLayout';
import { useIsLargerThanMd } from '../useIsLargerThanMd';
import { useIsNarrowHeight } from '../useIsNarrowHeight';
import {
    drawParticipantBorder,
    drawParticipantName,
    drawParticipantPlaceholder,
    drawVideoWithAspectRatio,
} from './drawingUtils';
import type { RecordingState, RecordingTrackInfo } from './types';
import { cleanupVideoElement, createVideoElement, getRecordingDetails, getTracksForRecording } from './utils';
import { WorkerRecordingStorage } from './workerStorage';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const FPS = 30;
const GAP = 11;
const BORDER_RADIUS = 28;

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
    const animationFrameRef = useRef<number>();
    const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const startTimeRef = useRef<number>(0);
    const durationIntervalRef = useRef<number>();
    const workerStorageRef = useRef<WorkerRecordingStorage | null>(null);

    const cameraTracks = useTracks([Track.Source.Camera]);
    const screenShareTracks = useTracks([Track.Source.ScreenShare]);
    const audioTracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio]);
    const { pagedParticipants } = useMeetContext();

    const renderInfoRef = useRef({
        cameraTracks,
        screenShareTracks,
        audioTracks,
        pagedParticipants,
    });

    renderInfoRef.current = {
        cameraTracks,
        screenShareTracks,
        audioTracks,
        pagedParticipants,
    };

    const { cols, rows } = calculateGridLayout(pagedParticipants.length, !isLargerThanMd || isNarrowHeight);

    const getVideoElement = useCallback((trackInfo: RecordingTrackInfo) => {
        if (!trackInfo.track) {
            return null;
        }

        const trackId = trackInfo.track.sid || `track-${Date.now()}`;
        let videoElement = videoElementsRef.current.get(trackId);

        if (!videoElement) {
            videoElement = createVideoElement(trackInfo);
            videoElementsRef.current.set(trackId, videoElement);
        }

        return videoElement;
    }, []);

    const drawRecordingCanvas = useCallback(
        (canvas: HTMLCanvasElement, tracks: RecordingTrackInfo[]) => {
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }

            // Clear canvas with black background
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (tracks.length === 0) {
                // Draw "No participants" text
                ctx.fillStyle = '#ffffff';
                ctx.font = '48px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Recording...', canvas.width / 2, canvas.height / 2);
                return;
            }

            // Check if there's a screenshare
            const screenShareTrack = tracks.find((t) => t.isScreenShare);
            const participantTracks = tracks.filter((t) => !t.isScreenShare);

            if (screenShareTrack && participantTracks.length > 0) {
                // Layout: Large screenshare on left, participants on right sidebar
                const screenShareWidth = canvas.width * 0.85;
                const sidebarWidth = canvas.width * 0.15;
                const sidebarItemHeight = canvas.height / Math.min(participantTracks.length, 6);

                // Draw screenshare
                const screenShareVideo =
                    videoElementsRef.current.get(screenShareTrack.track?.sid || '') ||
                    getVideoElement(screenShareTrack);
                if (screenShareVideo) {
                    drawVideoWithAspectRatio({
                        ctx,
                        videoElement: screenShareVideo,
                        x: 0,
                        y: 0,
                        width: screenShareWidth,
                        height: canvas.height,
                    });
                }

                const screenShareName = participantNameMap[screenShareTrack.participant?.identity || ''] || 'Unknown';
                drawParticipantName({
                    ctx,
                    name: `${screenShareName} (Screen)`,
                    x: 0,
                    y: 0,
                    height: canvas.height,
                });

                participantTracks.slice(0, 6).forEach((trackInfo, index) => {
                    const yPos = index * sidebarItemHeight + GAP;
                    const tileWidth = sidebarWidth - GAP;
                    const tileHeight = sidebarItemHeight - GAP;

                    const hasVideo = trackInfo.track && !trackInfo.track.isMuted;
                    const name = participantNameMap[trackInfo.participant?.identity || ''] || 'Unknown';

                    const colorIndex = trackInfo.participantIndex % 6;
                    const backgroundColor = `meet-background-${colorIndex + 1}`;
                    const profileColor = `profile-background-${colorIndex + 1}`;

                    if (hasVideo) {
                        const videoElement = getVideoElement(trackInfo);
                        if (videoElement) {
                            drawVideoWithAspectRatio({
                                ctx,
                                videoElement,
                                x: screenShareWidth + GAP / 2,
                                y: yPos,
                                width: tileWidth,
                                height: tileHeight,
                                radius: BORDER_RADIUS / 2,
                            });
                        }
                    } else {
                        drawParticipantPlaceholder({
                            ctx,
                            name,
                            x: screenShareWidth + GAP / 2,
                            y: yPos,
                            width: tileWidth,
                            height: tileHeight,
                            backgroundColor,
                            profileColor,
                            radius: BORDER_RADIUS / 2,
                        });
                    }

                    const audioPublication = Array.from(trackInfo.participant.trackPublications.values()).find(
                        (pub) => pub.kind === 'audio' && pub.track
                    );
                    const hasActiveAudio = audioPublication ? !audioPublication.isMuted : false;

                    const borderColor = `tile-border-${colorIndex + 1}`;

                    drawParticipantBorder({
                        ctx,
                        x: screenShareWidth + GAP / 2,
                        y: yPos,
                        width: tileWidth,
                        height: tileHeight,
                        borderColor,
                        isActive: hasActiveAudio,
                        radius: BORDER_RADIUS / 2,
                    });

                    drawParticipantName({
                        ctx,
                        name,
                        x: screenShareWidth + GAP / 2,
                        y: yPos,
                        height: tileHeight,
                    });
                });
            } else if (screenShareTrack) {
                const screenShareVideo = getVideoElement(screenShareTrack);
                if (screenShareVideo) {
                    drawVideoWithAspectRatio({
                        ctx,
                        videoElement: screenShareVideo,
                        x: 0,
                        y: 0,
                        width: canvas.width,
                        height: canvas.height,
                    });
                }

                const screenShareName = participantNameMap[screenShareTrack.participant?.identity || ''] || 'Unknown';
                drawParticipantName({
                    ctx,
                    name: `${screenShareName} (Screen)`,
                    x: 0,
                    y: 0,
                    height: canvas.height,
                });
            } else {
                const cellWidth = canvas.width / cols;
                const cellHeight = canvas.height / rows;

                participantTracks.forEach((trackInfo, index) => {
                    const col = index % cols;
                    const row = Math.floor(index / cols);

                    const x = col * cellWidth + GAP;
                    const y = row * cellHeight + GAP;
                    const tileWidth = cellWidth - GAP;
                    const tileHeight = cellHeight - GAP;

                    const participantName = participantNameMap[trackInfo.participant?.identity || ''] || 'Unknown';

                    const colorIndex = trackInfo.participantIndex % 6;
                    const backgroundColor = `meet-background-${colorIndex + 1}`;
                    const profileColor = `profile-background-${colorIndex + 1}`;
                    const borderColor = `tile-border-${colorIndex + 1}`;

                    const hasVideo = trackInfo.track && !trackInfo.track.isMuted;

                    if (hasVideo) {
                        const videoElement = getVideoElement(trackInfo);
                        if (videoElement) {
                            drawVideoWithAspectRatio({
                                ctx,
                                videoElement,
                                x,
                                y,
                                width: tileWidth,
                                height: tileHeight,
                                radius: BORDER_RADIUS,
                            });
                        }
                    } else {
                        drawParticipantPlaceholder({
                            ctx,
                            name: participantName,
                            x,
                            y,
                            width: tileWidth,
                            height: tileHeight,
                            backgroundColor,
                            profileColor,
                            radius: BORDER_RADIUS,
                        });
                    }

                    const audioPublication = Array.from(trackInfo.participant.trackPublications.values()).find(
                        (pub) => pub.kind === 'audio' && pub.track
                    );
                    const hasActiveAudio = audioPublication ? !audioPublication.isMuted : false;

                    drawParticipantBorder({
                        ctx,
                        x,
                        y,
                        width: tileWidth,
                        height: tileHeight,
                        borderColor,
                        isActive: hasActiveAudio,
                        radius: BORDER_RADIUS,
                    });

                    drawParticipantName({
                        ctx,
                        name: participantName,
                        x,
                        y,
                        height: tileHeight,
                    });
                });
            }
        },
        [createVideoElement, participantNameMap, cols, rows]
    );

    const startRenderingLoop = useCallback(
        (canvas: HTMLCanvasElement) => {
            const render = () => {
                drawRecordingCanvas(
                    canvas,
                    getTracksForRecording(
                        renderInfoRef.current.pagedParticipants,
                        renderInfoRef.current.cameraTracks,
                        renderInfoRef.current.screenShareTracks
                    )
                );

                animationFrameRef.current = requestAnimationFrame(render);
            };
            render();
        },
        [drawRecordingCanvas]
    );

    const setupAudioMixing = useCallback(() => {
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        let connectedSources = 0;

        audioTracks.forEach((trackRef) => {
            if (trackRef.publication.track && !trackRef.publication.isMuted) {
                const mediaStreamTrack = trackRef.publication.track.mediaStreamTrack;
                if (mediaStreamTrack) {
                    const stream = new MediaStream([mediaStreamTrack]);
                    const source = audioContext.createMediaStreamSource(stream);
                    source.connect(destination);
                    connectedSources++;
                }
            }
        });

        audioContextRef.current = audioContext;
        audioDestinationRef.current = destination;

        return { stream: destination.stream, hasAudio: connectedSources > 0 };
    }, [audioTracks]);

    const startRecording = async () => {
        try {
            if (workerStorageRef.current) {
                try {
                    await workerStorageRef.current.clear();
                    workerStorageRef.current.terminate();
                } catch (error) {
                    console.warn('Failed to clean up previous recording:', error);
                }
                workerStorageRef.current = null;
            }

            const recordingId = `recording-${Date.now()}`;
            const storage = new WorkerRecordingStorage(recordingId, extension);
            await storage.init();
            workerStorageRef.current = storage;

            const canvas = document.createElement('canvas');
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;
            canvasRef.current = canvas;

            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#ffffff';
                ctx.font = '48px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Starting recording...', canvas.width / 2, canvas.height / 2);
            }

            const canvasStream = canvas.captureStream(FPS);

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
                        console.error(`✗ Failed to store chunk ${chunkCount} in OPFS:`, error);
                    }
                } else {
                    console.warn('ondataavailable called with empty data or no storage');
                }
            };

            mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event);
            };

            mediaRecorder.start(1000);
            mediaRecorderRef.current = mediaRecorder;

            startRenderingLoop(canvas);

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

                    if (workerStorageRef.current) {
                        try {
                            const file = await workerStorageRef.current.getFile();

                            if (file.type && file.type !== '') {
                                blob = file;
                            } else {
                                blob = file.slice(0, file.size, mimeType);
                            }
                        } catch (error) {
                            console.error('Failed to retrieve file from OPFS:', error);
                        }
                    } else {
                        console.error('No OPFS storage reference available');
                    }

                    if (animationFrameRef.current) {
                        cancelAnimationFrame(animationFrameRef.current);
                    }

                    if (audioContextRef.current) {
                        audioContextRef.current.close();
                    }

                    if (durationIntervalRef.current) {
                        clearInterval(durationIntervalRef.current);
                    }

                    videoElementsRef.current.forEach(cleanupVideoElement);
                    videoElementsRef.current.clear();

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
            console.error('Failed to download recording:', error);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
            if (workerStorageRef.current) {
                workerStorageRef.current.clear().catch(console.error);
                workerStorageRef.current.terminate();
                workerStorageRef.current = null;
            }
            videoElementsRef.current.forEach(cleanupVideoElement);
            videoElementsRef.current.clear();
        };
    }, []);

    return {
        recordingState,
        startRecording,
        stopRecording,
        downloadRecording,
    };
}
