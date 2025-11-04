// Type that accepts both regular and offscreen canvas contexts
type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Helper to draw a rounded rectangle path
 */
export function roundRect(ctx: CanvasContext, x: number, y: number, width: number, height: number, radius: number) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Draws participant name overlay on the video tile
 */
export function drawParticipantName({
    ctx,
    name,
    x,
    y,
    height,
}: {
    ctx: CanvasContext;
    name: string;
    x: number;
    y: number;
    height: number;
}) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // Add text shadow for better visibility
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    // Draw text at bottom-left corner (10px padding from left and bottom)
    ctx.fillText(name, x + 10, y + height - 10);

    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

/**
 * Profile colors for participant borders (matching app.scss $profile-colors)
 */
export const PROFILE_COLORS = [
    '#b9abff', // purple
    '#88f189', // green
    '#ababf8', // blue-ish
    '#7bdcff', // cyan
    '#ff8a8a', // red
    '#ffb35f', // orange
];

/**
 * Meet background colors (matching app.scss $meet-background-colors)
 */
const MEET_BACKGROUND_COLORS = [
    '#413969', // purple-minor-3
    '#2b3e40', // green-minor-3
    '#332f62', // interaction-minor-3
    '#094a62', // blue-minor-3
    '#3d2a3d', // red-minor-2
    '#523a2e', // orange-minor-3
];

/**
 * Get participant initials from name
 */
function getParticipantInitials(participantName: string): string {
    if (!participantName) {
        return 'NA';
    }

    const nameParts = participantName.split(' ');
    return `${nameParts?.[0]?.charAt(0)?.toLocaleUpperCase()}${nameParts?.[1]?.charAt(0)?.toLocaleUpperCase() ?? ''}`;
}

/**
 * Draws a placeholder for participants without video (colored background with initials)
 */
export function drawParticipantPlaceholder({
    ctx,
    name,
    x,
    y,
    width,
    height,
    backgroundColor,
    profileColor,
    radius = 12,
}: {
    ctx: CanvasContext;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    backgroundColor: string;
    profileColor: string;
    radius?: number;
}) {
    // Save context
    ctx.save();

    // Create rounded rectangle clipping path
    roundRect(ctx, x, y, width, height, radius);
    ctx.clip();

    // Parse background color index
    const bgMatch = backgroundColor.match(/meet-background-(\d+)/);
    const bgIndex = bgMatch ? parseInt(bgMatch[1], 10) - 1 : 0;
    const bgColor = MEET_BACKGROUND_COLORS[bgIndex % MEET_BACKGROUND_COLORS.length];

    // Draw background
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, width, height);

    // Parse profile color index
    const profMatch = profileColor.match(/profile-background-(\d+)/);
    const profIndex = profMatch ? parseInt(profMatch[1], 10) - 1 : 0;
    const profColor = PROFILE_COLORS[profIndex % PROFILE_COLORS.length];

    // Calculate circle size based on tile size (proportional to view size)
    const circleSize = Math.min(width, height) * 0.3; // 30% of smallest dimension
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    // Draw profile circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, circleSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = profColor;
    ctx.fill();

    // Draw initials
    const initials = getParticipantInitials(name);
    const fontSize = circleSize * 0.4;
    ctx.fillStyle = '#000000';
    ctx.font = `600 ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, centerX, centerY);

    // Restore context
    ctx.restore();
}

/**
 * Draws colored border around participant tile when they have active audio
 */
export function drawParticipantBorder({
    ctx,
    x,
    y,
    width,
    height,
    borderColor,
    isActive,
    radius = 12,
}: {
    ctx: CanvasContext;
    x: number;
    y: number;
    width: number;
    height: number;
    borderColor: string;
    isActive: boolean;
    radius?: number;
}) {
    if (!isActive) {
        return;
    }

    // Parse tile-border-N to get color index
    const match = borderColor.match(/tile-border-(\d+)/);
    const colorIndex = match ? parseInt(match[1], 10) - 1 : 0;
    const color = PROFILE_COLORS[colorIndex % PROFILE_COLORS.length];

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;

    // Draw rounded rectangle border
    roundRect(ctx, x, y, width, height, radius);
    ctx.stroke();
}
