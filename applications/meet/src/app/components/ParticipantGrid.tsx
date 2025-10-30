import { useMeetContext } from '../contexts/MeetContext';
import { useIsLargerThanMd } from '../hooks/useIsLargerThanMd';
import { useIsNarrowHeight } from '../hooks/useIsNarrowHeight';
import { calculateGridLayout } from '../utils/calculateGridLayout';
import { ParticipantTile } from './ParticipantTile/ParticipantTile';

export const ParticipantGrid = () => {
    const { pagedParticipants } = useMeetContext();

    const isLargerThanMd = useIsLargerThanMd();

    const isNarrowHeight = useIsNarrowHeight();

    const { cols, rows } = calculateGridLayout(pagedParticipants.length, !isLargerThanMd || isNarrowHeight);

    const gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const gridTemplateRows = `repeat(${rows}, 1fr)`;

    return (
        <div className="flex-1 min-h-0 overflow-y-auto h-full">
            <div
                className="w-full h-full"
                style={{
                    display: 'grid',
                    gridTemplateColumns,
                    gridTemplateRows,
                    gap: '0.6875rem',
                }}
            >
                {pagedParticipants.map((participant) => {
                    return (
                        <ParticipantTile
                            key={participant.identity}
                            participant={participant}
                            viewSize={pagedParticipants.length > 6 ? 'medium' : 'large'}
                        />
                    );
                })}
            </div>
        </div>
    );
};
