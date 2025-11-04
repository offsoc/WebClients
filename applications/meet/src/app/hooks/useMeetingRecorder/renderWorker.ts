import { SCREEN_SHARE_PAGE_SIZE } from '../../constants';
import { calculateGridLayout } from '../../utils/calculateGridLayout';
import {
    PROFILE_COLORS,
    drawParticipantBorder,
    drawParticipantName,
    drawParticipantPlaceholder,
    roundRect,
} from './drawingUtils';

const FPS = 30;
const GAP = 11;
const BORDER_RADIUS = 28;
const SIDEBAR_WIDTH = 320;

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

interface DrawVideoFrameParams {
    ctx: OffscreenCanvasRenderingContext2D;
    frame: VideoFrame | ImageBitmap;
    x: number;
    y: number;
    width: number;
    height: number;
    radius?: number;
    objectFit?: 'cover' | 'contain';
}

function drawVideoFrame({ ctx, frame, x, y, width, height, radius = 0, objectFit = 'cover' }: DrawVideoFrameParams) {
    try {
        const videoWidth = 'displayWidth' in frame ? frame.displayWidth : frame.width;
        const videoHeight = 'displayHeight' in frame ? frame.displayHeight : frame.height;

        if (videoWidth === 0 || videoHeight === 0) {
            return;
        }

        const videoAspect = videoWidth / videoHeight;
        const targetAspect = width / height;

        let drawWidth = width;
        let drawHeight = height;
        let drawX = x;
        let drawY = y;

        if (objectFit === 'cover') {
            if (videoAspect > targetAspect) {
                drawHeight = height;
                drawWidth = height * videoAspect;
                drawX = x - (drawWidth - width) / 2;
                drawY = y;
            } else {
                drawWidth = width;
                drawHeight = width / videoAspect;
                drawX = x;
                drawY = y - (drawHeight - height) / 2;
            }
        } else {
            if (videoAspect > targetAspect) {
                drawWidth = width;
                drawHeight = width / videoAspect;
                drawX = x;
                drawY = y + (height - drawHeight) / 2;
            } else {
                drawHeight = height;
                drawWidth = height * videoAspect;
                drawX = x + (width - drawWidth) / 2;
                drawY = y;
            }
        }

        ctx.save();

        if (radius > 0) {
            const maxRadius = Math.min(radius, Math.min(width, height) / 2);
            roundRect(ctx, x, y, width, height, maxRadius);
        } else {
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.closePath();
        }

        ctx.clip();

        ctx.drawImage(frame, drawX, drawY, drawWidth, drawHeight);

        ctx.restore();
    } catch (error) {}
}

function drawRecordingCanvas(canvas: OffscreenCanvas, ctx: OffscreenCanvasRenderingContext2D) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { participants, isLargerThanMd, isNarrowHeight } = state.renderState;

    const screenShareParticipant = participants.find((p) => p.isScreenShare);
    const regularParticipants = participants.filter((p) => !p.isScreenShare);

    const { cols, rows } = calculateGridLayout(regularParticipants.length, !isLargerThanMd || isNarrowHeight);

    if (screenShareParticipant && regularParticipants.length > 0) {
        const numParticipantsInSidebar = Math.min(regularParticipants.length, SCREEN_SHARE_PAGE_SIZE);
        const sidebarItemHeight = (canvas.height - GAP * (numParticipantsInSidebar + 1)) / numParticipantsInSidebar;

        const screenShareX = GAP;
        const screenShareY = GAP;
        const screenShareWidth = canvas.width - SIDEBAR_WIDTH - GAP * 2;
        const screenShareHeight = canvas.height - GAP * 2;

        const screenShareKey = `${screenShareParticipant.identity}-screenshare`;
        const screenShareBitmap = state.videoFrames.get(screenShareKey);
        if (screenShareBitmap) {
            drawVideoFrame({
                ctx,
                frame: screenShareBitmap,
                x: screenShareX,
                y: screenShareY,
                width: screenShareWidth,
                height: screenShareHeight,
                objectFit: 'contain',
            });
        }

        drawParticipantName({
            ctx,
            name: `${screenShareParticipant.name} (Screen)`,
            x: screenShareX,
            y: screenShareY,
            height: screenShareHeight,
        });

        const sidebarX = screenShareX + screenShareWidth + GAP;

        regularParticipants.slice(0, PROFILE_COLORS.length).forEach((participant, index) => {
            const xPos = sidebarX;
            const yPos = GAP + index * (sidebarItemHeight + GAP);
            const tileWidth = SIDEBAR_WIDTH - GAP;
            const tileHeight = sidebarItemHeight;

            const colorIndex = participant.participantIndex % PROFILE_COLORS.length;
            const backgroundColor = `meet-background-${colorIndex + 1}`;
            const profileColor = `profile-background-${colorIndex + 1}`;
            const borderColor = `tile-border-${colorIndex + 1}`;

            if (participant.hasVideo) {
                const bitmap = state.videoFrames.get(participant.identity);
                if (bitmap) {
                    drawVideoFrame({
                        ctx,
                        frame: bitmap,
                        x: xPos,
                        y: yPos,
                        width: tileWidth,
                        height: tileHeight,
                        radius: BORDER_RADIUS / 2,
                    });
                }
            } else {
                drawParticipantPlaceholder({
                    ctx,
                    name: participant.name,
                    x: xPos,
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
                x: xPos,
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
                x: xPos,
                y: yPos,
                height: tileHeight,
            });
        });
    } else if (screenShareParticipant) {
        const screenShareKey = `${screenShareParticipant.identity}-screenshare`;
        const screenShareBitmap = state.videoFrames.get(screenShareKey);
        if (screenShareBitmap) {
            drawVideoFrame({
                ctx,
                frame: screenShareBitmap,
                x: 0,
                y: 0,
                width: canvas.width,
                height: canvas.height,
                objectFit: 'contain',
            });
        }

        drawParticipantName({
            ctx,
            name: `${screenShareParticipant.name} (is presenting)`,
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

            const colorIndex = participant.participantIndex % PROFILE_COLORS.length;
            const backgroundColor = `meet-background-${colorIndex + 1}`;
            const profileColor = `profile-background-${colorIndex + 1}`;
            const borderColor = `tile-border-${colorIndex + 1}`;

            if (participant.hasVideo) {
                const bitmap = state.videoFrames.get(participant.identity);
                if (bitmap) {
                    drawVideoFrame({
                        ctx,
                        frame: bitmap,
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
        return;
    }

    const render = () => {
        if (state.canvas && state.ctx) {
            drawRecordingCanvas(state.canvas, state.ctx);
        }
    };

    render();
    state.renderInterval = setInterval(render, 1000 / FPS) as unknown as number;
}

function stopRenderLoop() {
    if (state.renderInterval !== null) {
        clearInterval(state.renderInterval);
        state.renderInterval = null;
    }

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

self.onmessage = (event: MessageEvent<RenderWorkerMessage>) => {
    const { type, canvas, state: newState, frames, frameData } = event.data;

    switch (type) {
        case 'init':
            if (canvas) {
                state.canvas = canvas;
                state.ctx = canvas.getContext('2d');
                if (state.ctx) {
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
