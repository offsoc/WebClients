import { useRef, useState } from 'react';

import { c } from 'ttag';

import { Button } from '@proton/atoms/Button/Button';
import { useNotifications } from '@proton/components';
import { IcMeetRecord } from '@proton/icons/icons/IcMeetRecord';
import { IcMeetRecordStop } from '@proton/icons/icons/IcMeetRecordStop';
import { isFirefox, isMobile } from '@proton/shared/lib/helpers/browser';
import clsx from '@proton/utils/clsx';

import { CircleButton } from '../../atoms/CircleButton/CircleButton';
import { useIsLargerThanMd } from '../../hooks/useIsLargerThanMd';
import { useIsLocalParticipantHost } from '../../hooks/useIsLocalParticipantHost';
import type { MeetingRecordingState } from '../../hooks/useMeetingRecorder/types';

import './RecordingControls.scss';

interface RecordingControlsProps {
    startRecording: () => Promise<void>;
    downloadRecording: () => Promise<void>;
    recordingState: MeetingRecordingState;
}

export const RecordingControls = ({ startRecording, downloadRecording, recordingState }: RecordingControlsProps) => {
    const { createNotification } = useNotifications();

    const durationIntervalRef = useRef<number>();

    const isLargerThanMd = useIsLargerThanMd();

    const [duration, setDuration] = useState(0);

    const isLocalParticipantHost = useIsLocalParticipantHost();

    const recordingNotSupported = isMobile() || isFirefox();

    const handleStartRecording = async () => {
        try {
            await startRecording();
            durationIntervalRef.current = window.setInterval(() => {
                setDuration((prev) => prev + 1);
            }, 1000);
        } catch (error) {
            createNotification({
                text: c('Error').t`Failed to start recording`,
                type: 'error',
            });
        }
    };

    const handleStopAndDownload = async () => {
        try {
            await downloadRecording();
            createNotification({
                text: c('Info').t`Recording saved`,
                type: 'success',
            });
            clearInterval(durationIntervalRef.current);
            setDuration(0);
        } catch (error) {
            createNotification({
                text: c('Error').t`Failed to save recording`,
                type: 'error',
            });
        }
    };

    const formatDuration = (seconds: number) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    if (!isLocalParticipantHost || recordingNotSupported) {
        return null;
    }

    return (
        <div className="recording-controls flex items-center gap-2">
            {!recordingState.isRecording ? (
                <CircleButton
                    IconComponent={IcMeetRecord}
                    onClick={handleStartRecording}
                    ariaLabel={c('Action').t`Start recording`}
                    size={6}
                />
            ) : (
                <Button
                    className={clsx(
                        isLargerThanMd ? 'px-5 py-4' : 'px-4 py-3',
                        'stop-recording-button border-none shrink-0 w-custom'
                    )}
                    pill={true}
                    size="large"
                    onClick={handleStopAndDownload}
                    aria-label={c('Alt').t`Leave Meeting`}
                    style={{ '--w-custom': '15rem' }}
                >
                    <div className="w-full flex items-center justify-center gap-2 flex-nowrap">
                        <IcMeetRecordStop className="shrink-0" size={6} />
                        <span>{c('Action').t`Stop recording`}</span>
                        <span>{formatDuration(duration)}</span>
                    </div>
                </Button>
            )}
        </div>
    );
};
