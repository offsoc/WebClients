import { useState } from 'react';

import { c } from 'ttag';

import { CircleLoader } from '@proton/atoms';
import { useNotifications } from '@proton/components';
import { IcMeetRecord, IcStop } from '@proton/icons';

import { CircleButton } from '../../atoms/CircleButton/CircleButton';
import { useMeetContext } from '../../contexts/MeetContext';
import { useMeetingRecorder } from '../../hooks/useMeetingRecorder/useMeetingRecorder';

import './RecordingControls.scss';

export const RecordingControls = () => {
    const { participantNameMap } = useMeetContext();
    const { createNotification } = useNotifications();
    const [isStarting, setIsStarting] = useState(false);

    const { recordingState, startRecording, downloadRecording } = useMeetingRecorder(participantNameMap);

    const handleStartRecording = async () => {
        try {
            setIsStarting(true);
            await startRecording();
            createNotification({
                text: c('Info').t`Recording started`,
                type: 'success',
            });
        } catch (error) {
            createNotification({
                text: c('Error').t`Failed to start recording`,
                type: 'error',
            });
        } finally {
            setIsStarting(false);
        }
    };

    const handleStopAndDownload = async () => {
        try {
            await downloadRecording();
            createNotification({
                text: c('Info').t`Recording saved`,
                type: 'success',
            });
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

    return (
        <div className="recording-controls flex items-center gap-2">
            {!recordingState.isRecording ? (
                <>
                    {isStarting ? (
                        <div className="flex items-center justify-center" style={{ width: '2.5rem', height: '2.5rem' }}>
                            <CircleLoader
                                className="color-norm"
                                style={{ '--w-custom': '1.5rem', '--h-custom': '1.5rem' }}
                            />
                        </div>
                    ) : (
                        <CircleButton
                            IconComponent={IcMeetRecord}
                            onClick={handleStartRecording}
                            ariaLabel={c('Action').t`Start recording`}
                            size={5}
                            buttonStyle={{
                                'padding-block': 0,
                                'padding-inline': 0,
                                width: '2.5rem',
                                height: '2.5rem',
                                backgroundColor: 'var(--signal-danger)',
                            }}
                        />
                    )}
                </>
            ) : (
                <>
                    <div className="recording-indicator flex items-center gap-2 bg-danger rounded px-3 py-2">
                        <div className="recording-pulse" />
                        <span className="text-sm font-bold color-norm">
                            {c('Info').t`Recording`} {formatDuration(recordingState.duration)}
                        </span>
                    </div>
                    <CircleButton
                        IconComponent={IcStop}
                        onClick={handleStopAndDownload}
                        ariaLabel={c('Action').t`Stop and save recording`}
                        size={5}
                        buttonStyle={{
                            'padding-block': 0,
                            'padding-inline': 0,
                            width: '2.5rem',
                            height: '2.5rem',
                        }}
                    />
                </>
            )}
        </div>
    );
};
