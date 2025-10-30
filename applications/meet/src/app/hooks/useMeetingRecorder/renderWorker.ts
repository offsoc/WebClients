/**
 * Rendering Worker for Meeting Recorder
 * Handles canvas rendering in a Web Worker to avoid background tab throttling
 */
import { calculateGridLayout } from '../../utils/calculateGridLayout';
import { drawParticipantBorder, drawParticipantName, drawParticipantPlaceholder } from './drawingUtils';

const FPS = 30;
const GAP = 11;
const BORDER_RADIUS = 28;

interface VideoFrameData {
    participantIdentity: string;
    bitmap: ImageBitmap;
}

interface SingleFrameData {
    participantIdentity: string;
    frame: VideoFrame | ImageBitmap;
}

interface RenderWorkerMessage {
    type: 'init' | 'render' | 'updateState' | 'updateFrames' | 'updateFrame' | 'stop';
    canvas?: OffscreenCanvas;
    state?: RenderState;
    frames?: VideoFrameData[];
    frameData?: SingleFrameData;
}

interface ParticipantInfo {
    identity: string;
    name: string;
    participantIndex: number;
    isScreenShare: boolean;
    hasVideo: boolean;
    hasActiveAudio: boolean;
}

interface RenderState {
    participants: ParticipantInfo[];
    isLargerThanMd: boolean;
    isNarrowHeight: boolean;
}

interface WorkerState {
    canvas: OffscreenCanvas | null;
    ctx: OffscreenCanvasRenderingContext2D | null;
    renderState: RenderState;
    videoFrames: Map<string, VideoFrame | ImageBitmap>;
    renderInterval: number | null;
}

const state: WorkerState = {
    canvas: null,
    ctx: null,
    renderState: {
        participants: [],
        isLargerThanMd: true,
        isNarrowHeight: false,
    },
    videoFrames: new Map(),
    renderInterval: null,
};

function drawVideoFrame(
    ctx: OffscreenCanvasRenderingContext2D,
    frame: VideoFrame | ImageBitmap,
    x: number,
    y: number,
    width: number,
    height: number,
    radius = 0
) {
    try {
        const videoWidth = 'displayWidth' in frame ? frame.displayWidth : frame.width;
        const videoHeight = 'displayHeight' in frame ? frame.displayHeight : frame.height;

        if (videoWidth === 0 || videoHeight === 0) {
            return;
        }

        // Calculate aspect ratio
        const videoAspect = videoWidth / videoHeight;
        const targetAspect = width / height;

        let drawWidth = width;
        let drawHeight = height;
        let drawX = x;
        let drawY = y;

        if (videoAspect > targetAspect) {
            drawWidth = height * videoAspect;
            drawX = x - (drawWidth - width) / 2;
        } else {
            drawHeight = width / videoAspect;
            drawY = y - (drawHeight - height) / 2;
        }

        if (radius > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(x, y, width, height, radius);
            ctx.clip();
        }

        ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);

        if (radius > 0) {
            ctx.restore();
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to draw video frame:', error);
        // Draw error placeholder
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x, y, width, height);
    }
}

function drawRecordingCanvas(canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D) {
    // Clear canvas with black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { participants, isLargerThanMd, isNarrowHeight } = state.renderState;

    if (participants.length === 0) {
        // Draw "Recording..." text
        ctx.fillStyle = '#ffffff';
        ctx.font = '48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Recording...', canvas.width / 2, canvas.height / 2);
        return;
    }

    // Check if there's a screenshare
    const screenShareParticipant = participants.find((p) => p.isScreenShare);
    const regularParticipants = participants.filter((p) => !p.isScreenShare);

    const { cols, rows } = calculateGridLayout(regularParticipants.length, !isLargerThanMd || isNarrowHeight);

    if (screenShareParticipant && regularParticipants.length > 0) {
        // Layout: Large screenshare on left, participants on right sidebar
        const screenShareWidth = canvas.width * 0.85;
        const sidebarWidth = canvas.width * 0.15;
        const sidebarItemHeight = canvas.height / Math.min(regularParticipants.length, 6);

        // Draw screenshare - use the screenshare-specific key
        const screenShareKey = `${screenShareParticipant.identity}-screenshare`;
        const screenShareBitmap = state.videoFrames.get(screenShareKey);
        if (screenShareBitmap) {
            drawVideoFrame(ctx, screenShareBitmap, 0, 0, screenShareWidth, canvas.height);
        }

        drawParticipantName({
            ctx,
            name: `${screenShareParticipant.name} (Screen)`,
            x: 0,
            y: 0,
            height: canvas.height,
        });

        regularParticipants.slice(0, 6).forEach((participant, index) => {
            const yPos = index * sidebarItemHeight + GAP;
            const tileWidth = sidebarWidth - GAP;
            const tileHeight = sidebarItemHeight - GAP;

            const colorIndex = participant.participantIndex % 6;
            const backgroundColor = `meet-background-${colorIndex + 1}`;
            const profileColor = `profile-background-${colorIndex + 1}`;
            const borderColor = `tile-border-${colorIndex + 1}`;

            if (participant.hasVideo) {
                const bitmap = state.videoFrames.get(participant.identity);
                if (bitmap) {
                    drawVideoFrame(
                        ctx,
                        bitmap,
                        screenShareWidth + GAP / 2,
                        yPos,
                        tileWidth,
                        tileHeight,
                        BORDER_RADIUS / 2
                    );
                }
            } else {
                drawParticipantPlaceholder({
                    ctx,
                    name: participant.name,
                    x: screenShareWidth + GAP / 2,
                    y: yPos,
                    width: tileWidth,
                    height: tileHeight,
                    backgroundColor,
                    profileColor,
                    radius: BORDER_RADIUS / 2,
                });
            }

            drawParticipantBorder({
                ctx,
                x: screenShareWidth + GAP / 2,
                y: yPos,
                width: tileWidth,
                height: tileHeight,
                borderColor,
                isActive: participant.hasActiveAudio,
                radius: BORDER_RADIUS / 2,
            });

            drawParticipantName({
                ctx,
                name: participant.name,
                x: screenShareWidth + GAP / 2,
                y: yPos,
                height: tileHeight,
            });
        });
    } else if (screenShareParticipant) {
        // Draw screenshare fullscreen - use the screenshare-specific key
        const screenShareKey = `${screenShareParticipant.identity}-screenshare`;
        const screenShareBitmap = state.videoFrames.get(screenShareKey);
        if (screenShareBitmap) {
            drawVideoFrame(ctx, screenShareBitmap, 0, 0, canvas.width, canvas.height);
        }

        drawParticipantName({
            ctx,
            name: `${screenShareParticipant.name} (Screen)`,
            x: 0,
            y: 0,
            height: canvas.height,
        });
    } else {
        const cellWidth = canvas.width / cols;
        const cellHeight = canvas.height / rows;

        regularParticipants.forEach((participant, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);

            const x = col * cellWidth + GAP;
            const y = row * cellHeight + GAP;
            const tileWidth = cellWidth - GAP;
            const tileHeight = cellHeight - GAP;

            const colorIndex = participant.participantIndex % 6;
            const backgroundColor = `meet-background-${colorIndex + 1}`;
            const profileColor = `profile-background-${colorIndex + 1}`;
            const borderColor = `tile-border-${colorIndex + 1}`;

            if (participant.hasVideo) {
                const bitmap = state.videoFrames.get(participant.identity);
                if (bitmap) {
                    drawVideoFrame(ctx, bitmap, x, y, tileWidth, tileHeight, BORDER_RADIUS);
                }
            } else {
                drawParticipantPlaceholder({
                    ctx,
                    name: participant.name,
                    x,
                    y,
                    width: tileWidth,
                    height: tileHeight,
                    backgroundColor,
                    profileColor,
                    radius: BORDER_RADIUS,
                });
            }

            drawParticipantBorder({
                ctx,
                x,
                y,
                width: tileWidth,
                height: tileHeight,
                borderColor,
                isActive: participant.hasActiveAudio,
                radius: BORDER_RADIUS,
            });

            drawParticipantName({
                ctx,
                name: participant.name,
                x,
                y,
                height: tileHeight,
            });
        });
    }
}

function startRenderLoop() {
    if (state.renderInterval !== null) {
        return; // Already running
    }

    const render = () => {
        if (state.canvas && state.ctx) {
            drawRecordingCanvas(state.canvas, state.ctx);
        }
    };

    // Use setInterval in worker - workers are NOT throttled like main thread
    // This is the key advantage: worker timers run at full speed even in background tabs
    render(); // Initial render
    state.renderInterval = setInterval(render, 1000 / FPS) as unknown as number;
}

function stopRenderLoop() {
    if (state.renderInterval !== null) {
        clearInterval(state.renderInterval);
        state.renderInterval = null;
    }

    // Cleanup frames/bitmaps
    state.videoFrames.forEach((frame) => {
        if ('close' in frame) {
            frame.close();
        }
    });
    state.videoFrames.clear();
}

function cleanupFrame(frame: VideoFrame | ImageBitmap) {
    if ('close' in frame) {
        frame.close();
    }
}

// Message handler
self.onmessage = (event: MessageEvent<RenderWorkerMessage>) => {
    const { type, canvas, state: newState, frames, frameData } = event.data;

    switch (type) {
        case 'init':
            if (canvas) {
                state.canvas = canvas;
                state.ctx = canvas.getContext('2d');
                if (state.ctx) {
                    // Initial black screen
                    state.ctx.fillStyle = '#000000';
                    state.ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }
            if (newState) {
                state.renderState = newState;
            }
            break;

        case 'render':
            startRenderLoop();
            break;

        case 'updateState':
            if (newState) {
                state.renderState = newState;
            }
            break;

        case 'updateFrame':
            // Handle single frame update (from requestVideoFrameCallback or MediaStreamTrackProcessor)
            if (frameData) {
                const { participantIdentity, frame } = frameData;
                const oldFrame = state.videoFrames.get(participantIdentity);
                if (oldFrame) {
                    cleanupFrame(oldFrame);
                }
                state.videoFrames.set(participantIdentity, frame);
            }
            break;

        case 'updateFrames':
            if (frames) {
                // Close old bitmaps to free memory
                frames.forEach(({ participantIdentity, bitmap }) => {
                    const oldBitmap = state.videoFrames.get(participantIdentity);
                    if (oldBitmap) {
                        cleanupFrame(oldBitmap);
                    }
                    state.videoFrames.set(participantIdentity, bitmap);
                });
            }
            break;

        case 'stop':
            stopRenderLoop();
            break;
    }
};

export {};
