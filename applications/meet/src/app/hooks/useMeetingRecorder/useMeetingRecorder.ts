import { useCallback, useEffect, useRef, useState } from 'react';

import { useTracks } from '@livekit/components-react';
import { Track } from '@proton-meet/livekit-client';

import isTruthy from '@proton/utils/isTruthy';

import {
    drawParticipantBorder,
    drawParticipantName,
    drawParticipantPlaceholder,
    drawVideoWithAspectRatio,
} from './drawingUtils';
import type { RecordingState, RecordingTrackInfo } from './types';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const FPS = 30;
const GAP = 11; // Gap between tiles (matching 0.6875rem from ParticipantGrid)
const BORDER_RADIUS = 12; // Border radius for rounded corners

export function useMeetingRecorder(participantNameMap: Record<string, string>) {
    const [recordingState, setRecordingState] = useState<RecordingState>({
        isRecording: false,
        isPaused: false,
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

    // Get all camera and screenshare tracks
    const cameraTracks = useTracks([Track.Source.Camera]);
    const screenShareTracks = useTracks([Track.Source.ScreenShare]);
    const audioTracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio]);

    // Prepare tracks for recording
    const tracksForRecording = useRef<RecordingTrackInfo[]>([]);

    useEffect(() => {
        const screenShare = screenShareTracks[0];
        const cameras = cameraTracks.filter((track) => !track.publication.isMuted && track.publication.track);

        tracksForRecording.current = [screenShare, ...cameras]
            .map((trackRef) => {
                if (!trackRef?.publication.track) {
                    return null;
                }
                return {
                    track: trackRef.publication.track,
                    participant: trackRef.participant!,
                    isScreenShare: trackRef.source === Track.Source.ScreenShare,
                };
            })
            .filter(isTruthy);
    }, [cameraTracks, screenShareTracks]);

    // Create video element for a track
    const createVideoElement = useCallback((trackInfo: RecordingTrackInfo) => {
        const trackId = trackInfo.track.sid || `track-${Date.now()}`;
        let videoElement = videoElementsRef.current.get(trackId);

        if (!videoElement) {
            videoElement = document.createElement('video');
            videoElement.muted = true;
            videoElement.autoplay = true;
            videoElement.playsInline = true;

            trackInfo.track.attach(videoElement);

            const playVideo = async () => {
                try {
                    if (videoElement) {
                        await videoElement.play();
                    }
                } catch (error) {
                    console.error('Failed to play video:', error);
                }
            };

            videoElement.addEventListener('canplay', playVideo, { once: true });
            videoElementsRef.current.set(trackId, videoElement);
        }

        return videoElement;
    }, []);

    // Calculate grid layout
    const calculateGridLayout = (count: number) => {
        if (count === 0) {
            return { cols: 0, rows: 0 };
        }
        if (count === 1) {
            return { cols: 1, rows: 1 };
        }
        if (count === 2) {
            return { cols: 2, rows: 1 };
        }
        if (count <= 4) {
            return { cols: 2, rows: 2 };
        }
        if (count <= 6) {
            return { cols: 3, rows: 2 };
        }
        if (count <= 9) {
            return { cols: 3, rows: 3 };
        }
        if (count <= 12) {
            return { cols: 4, rows: 3 };
        }
        return { cols: 4, rows: 4 };
    };

    // Draw the recording canvas
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
                const screenShareWidth = canvas.width * 0.75;
                const sidebarWidth = canvas.width * 0.25;
                const sidebarItemHeight = canvas.height / Math.min(participantTracks.length, 6);

                // Draw screenshare
                const screenShareVideo = createVideoElement(screenShareTrack);
                drawVideoWithAspectRatio({
                    ctx,
                    videoElement: screenShareVideo,
                    x: 0,
                    y: 0,
                    width: screenShareWidth,
                    height: canvas.height,
                });

                const screenShareName = participantNameMap[screenShareTrack.participant?.identity || ''] || 'Unknown';
                drawParticipantName({
                    ctx,
                    name: `${screenShareName} (Screen)`,
                    x: 0,
                    y: 0,
                });

                // Draw participants in sidebar
                participantTracks.slice(0, 6).forEach((trackInfo, index) => {
                    const yPos = index * sidebarItemHeight + GAP;
                    const tileWidth = sidebarWidth - GAP;
                    const tileHeight = sidebarItemHeight - GAP;

                    // Check if video is available (camera track and not muted)
                    const hasVideo = trackInfo.track && !trackInfo.track.isMuted;
                    const name = participantNameMap[trackInfo.participant?.identity || ''] || 'Unknown';

                    // Get colors from metadata
                    const metadata = JSON.parse(trackInfo.participant.metadata || '{}');
                    const backgroundColor = metadata?.backgroundColor || 'meet-background-1';
                    const profileColor = metadata?.profileColor || 'profile-background-1';

                    if (hasVideo) {
                        const videoElement = createVideoElement(trackInfo);
                        drawVideoWithAspectRatio({
                            ctx,
                            videoElement,
                            x: screenShareWidth + GAP / 2,
                            y: yPos,
                            width: tileWidth,
                            height: tileHeight,
                            radius: BORDER_RADIUS / 2, // Smaller radius for sidebar
                        });
                    } else {
                        // Draw placeholder with initials
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

                    // Check if participant has active audio
                    const audioPublication = Array.from(trackInfo.participant.trackPublications.values()).find(
                        (pub) => pub.kind === 'audio' && pub.track
                    );
                    const hasActiveAudio = audioPublication ? !audioPublication.isMuted : false;

                    // Get border color from metadata
                    const borderColor = metadata?.borderColor || 'tile-border-1';

                    // Draw colored border if audio is active
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
                    });
                });
            } else if (screenShareTrack) {
                // Only screenshare, no participants
                const screenShareVideo = createVideoElement(screenShareTrack);
                drawVideoWithAspectRatio({
                    ctx,
                    videoElement: screenShareVideo,
                    x: 0,
                    y: 0,
                    width: canvas.width,
                    height: canvas.height,
                });

                const screenShareName = participantNameMap[screenShareTrack.participant?.identity || ''] || 'Unknown';
                drawParticipantName({
                    ctx,
                    name: `${screenShareName} (Screen)`,
                    x: 0,
                    y: 0,
                });
            } else {
                // Grid layout for participants
                const { cols, rows } = calculateGridLayout(participantTracks.length);
                const cellWidth = canvas.width / cols;
                const cellHeight = canvas.height / rows;

                participantTracks.forEach((trackInfo, index) => {
                    const col = index % cols;
                    const row = Math.floor(index / cols);

                    // Calculate position with gaps
                    const x = col * cellWidth + GAP;
                    const y = row * cellHeight + GAP;
                    const tileWidth = cellWidth - GAP;
                    const tileHeight = cellHeight - GAP;

                    // Get participant info
                    const participantName = participantNameMap[trackInfo.participant?.identity || ''] || 'Unknown';
                    const participantMetadata = JSON.parse(trackInfo.participant.metadata || '{}');
                    const backgroundColor = participantMetadata?.backgroundColor || 'meet-background-1';
                    const profileColor = participantMetadata?.profileColor || 'profile-background-1';
                    const borderColor = participantMetadata?.borderColor || 'tile-border-1';

                    // Check if video is available (camera track and not muted)
                    const hasVideo = trackInfo.track && !trackInfo.track.isMuted;

                    if (hasVideo) {
                        const videoElement = createVideoElement(trackInfo);
                        drawVideoWithAspectRatio({
                            ctx,
                            videoElement,
                            x,
                            y,
                            width: tileWidth,
                            height: tileHeight,
                            radius: BORDER_RADIUS,
                        });
                    } else {
                        // Draw placeholder with initials
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

                    // Check if participant has active audio
                    const audioPublication = Array.from(trackInfo.participant.trackPublications.values()).find(
                        (pub) => pub.kind === 'audio' && pub.track
                    );
                    const hasActiveAudio = audioPublication ? !audioPublication.isMuted : false;

                    // Draw colored border if audio is active
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
                    });
                });
            }
        },
        [createVideoElement, participantNameMap]
    );

    // Start rendering loop
    const startRenderingLoop = useCallback(
        (canvas: HTMLCanvasElement) => {
            let frameCount = 0;

            const render = () => {
                drawRecordingCanvas(canvas, tracksForRecording.current);
                frameCount++;

                // Log every 30 frames (once per second at 30fps)
                if (frameCount % 30 === 0) {
                    console.log(`Rendered ${frameCount} frames, tracks: ${tracksForRecording.current.length}`);
                }

                animationFrameRef.current = requestAnimationFrame(render);
            };
            console.log('Starting rendering loop');
            render();
        },
        [drawRecordingCanvas]
    );

    // Setup audio mixing
    const setupAudioMixing = useCallback(() => {
        console.log('setupAudioMixing called, available audio tracks:', audioTracks.length);

        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        let connectedSources = 0;

        // Mix all audio tracks
        audioTracks.forEach((trackRef) => {
            if (trackRef.publication.track && !trackRef.publication.isMuted) {
                const mediaStreamTrack = trackRef.publication.track.mediaStreamTrack;
                if (mediaStreamTrack) {
                    console.log('Connecting audio track:', trackRef.participant?.identity);
                    const stream = new MediaStream([mediaStreamTrack]);
                    const source = audioContext.createMediaStreamSource(stream);
                    source.connect(destination);
                    connectedSources++;
                }
            }
        });

        console.log('Connected audio sources:', connectedSources);

        audioContextRef.current = audioContext;
        audioDestinationRef.current = destination;

        return { stream: destination.stream, hasAudio: connectedSources > 0 };
    }, [audioTracks]);

    // Start recording
    const startRecording = useCallback(async () => {
        try {
            // Create canvas
            const canvas = document.createElement('canvas');
            canvas.width = CANVAS_WIDTH;
            canvas.height = CANVAS_HEIGHT;
            canvasRef.current = canvas;

            // Draw initial frame to canvas BEFORE capturing stream
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

            // Get canvas stream with fixed FPS
            const canvasStream = canvas.captureStream(FPS);
            console.log('Canvas stream created:', canvasStream);
            console.log('Video tracks:', canvasStream.getVideoTracks().length);
            canvasStream.getVideoTracks().forEach((track, i) => {
                console.log(
                    `Video track ${i}:`,
                    track.label,
                    'enabled:',
                    track.enabled,
                    'readyState:',
                    track.readyState
                );
            });

            // Setup audio mixing
            const { stream: audioStream, hasAudio } = setupAudioMixing();
            console.log('Audio mixing setup complete, hasAudio:', hasAudio);

            // Combine video and audio (only add audio if we have any)
            const videoTracks = canvasStream.getVideoTracks();
            const tracks = [...videoTracks];

            if (hasAudio) {
                const audioTracks = audioStream.getAudioTracks();
                console.log('Adding audio tracks:', audioTracks.length);
                tracks.push(...audioTracks);
            } else {
                console.log('No audio tracks to add - video only recording');
            }

            const combinedStream = new MediaStream(tracks);
            console.log('Combined stream tracks:', combinedStream.getTracks().length);

            // Create MediaRecorder with NO options for testing
            const mediaRecorder = new MediaRecorder(combinedStream);
            console.log('MediaRecorder created with default settings');
            console.log('MediaRecorder state:', mediaRecorder.state);
            console.log('MediaRecorder mimeType:', mediaRecorder.mimeType);

            recordedChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                console.log('ondataavailable fired, data size:', event.data.size);
                if (event.data.size > 0) {
                    recordedChunksRef.current.push(event.data);
                    console.log('Chunk added, total chunks:', recordedChunksRef.current.length);
                    setRecordingState((prev) => ({
                        ...prev,
                        recordedChunks: [...recordedChunksRef.current],
                    }));
                }
            };

            mediaRecorder.onerror = (event) => {
                console.error('MediaRecorder error:', event);
            };

            mediaRecorder.onstart = () => {
                console.log('MediaRecorder onstart event fired');
            };

            mediaRecorder.onstop = () => {
                console.log('MediaRecorder onstop event fired (from event handler)');
            };

            console.log('Starting MediaRecorder...');
            mediaRecorder.start(1000); // Collect data every second
            console.log('MediaRecorder started, state:', mediaRecorder.state);
            mediaRecorderRef.current = mediaRecorder;

            // NOW start rendering loop after MediaRecorder is started
            startRenderingLoop(canvas);

            // Start duration counter
            startTimeRef.current = Date.now();
            durationIntervalRef.current = window.setInterval(() => {
                setRecordingState((prev) => ({
                    ...prev,
                    duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
                }));
            }, 1000);

            setRecordingState({
                isRecording: true,
                isPaused: false,
                duration: 0,
                recordedChunks: [],
            });
        } catch (error) {
            console.error('Failed to start recording:', error);
            throw error;
        }
    }, [startRenderingLoop, setupAudioMixing]);

    // Stop recording
    const stopRecording = useCallback(() => {
        console.log('stopRecording called, isRecording:', recordingState.isRecording);
        console.log('MediaRecorder state:', mediaRecorderRef.current?.state);
        console.log('Chunks available:', recordedChunksRef.current.length);

        return new Promise<Blob>((resolve) => {
            if (mediaRecorderRef.current && recordingState.isRecording) {
                console.log('Setting up onstop handler');

                mediaRecorderRef.current.onstop = () => {
                    console.log('MediaRecorder onstop fired');
                    console.log('Final chunks count:', recordedChunksRef.current.length);

                    const mimeType = mediaRecorderRef.current?.mimeType || 'video/webm';
                    const blob = new Blob(recordedChunksRef.current, { type: mimeType });

                    console.log('Blob created:', blob.size, 'bytes, type:', blob.type);

                    // Stop rendering loop
                    if (animationFrameRef.current) {
                        cancelAnimationFrame(animationFrameRef.current);
                    }

                    // Cleanup audio context
                    if (audioContextRef.current) {
                        audioContextRef.current.close();
                    }

                    // Clear duration interval
                    if (durationIntervalRef.current) {
                        clearInterval(durationIntervalRef.current);
                    }

                    // Cleanup video elements
                    videoElementsRef.current.forEach((video) => {
                        video.pause();
                        video.src = '';
                        video.load();
                    });
                    videoElementsRef.current.clear();

                    setRecordingState({
                        isRecording: false,
                        isPaused: false,
                        duration: 0,
                        recordedChunks: [],
                    });

                    resolve(blob);
                };

                console.log('Calling mediaRecorder.stop()');
                mediaRecorderRef.current.stop();
            } else {
                console.log('Not recording or no mediaRecorder, resolving empty blob');
                resolve(new Blob());
            }
        });
    }, [recordingState.isRecording]);

    // Pause recording
    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current && recordingState.isRecording && !recordingState.isPaused) {
            mediaRecorderRef.current.pause();
            setRecordingState((prev) => ({ ...prev, isPaused: true }));
        }
    }, [recordingState.isRecording, recordingState.isPaused]);

    // Resume recording
    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current && recordingState.isRecording && recordingState.isPaused) {
            mediaRecorderRef.current.resume();
            setRecordingState((prev) => ({ ...prev, isPaused: false }));
        }
    }, [recordingState.isRecording, recordingState.isPaused]);

    // Download recording
    const downloadRecording = useCallback(async () => {
        console.log('downloadRecording called, isRecording:', recordingState.isRecording);
        console.log('Recorded chunks before stop:', recordedChunksRef.current.length);

        const blob = await stopRecording();

        console.log('Blob received:', blob.size, 'bytes');
        console.log('Blob type:', blob.type);

        if (blob.size > 0) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `meeting-recording-${new Date().toISOString()}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log('Download triggered successfully');
        } else {
            console.warn('Blob is empty, no download triggered');
        }
    }, [stopRecording, recordingState.isRecording]);

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
            videoElementsRef.current.forEach((video) => {
                video.pause();
                video.src = '';
                video.load();
            });
            videoElementsRef.current.clear();
        };
    }, []);

    return {
        recordingState,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        downloadRecording,
    };
}
