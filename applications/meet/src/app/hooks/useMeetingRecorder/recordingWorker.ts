/**
 * Web Worker for handling OPFS-based recording storage
 * This allows Safari to use the sync OPFS API (createSyncAccessHandle)
 * which is only available in worker contexts.
 */

interface FileSystemSyncAccessHandle {
    write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
    read(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
    flush(): void;
    close(): void;
    getSize(): number;
    truncate(newSize: number): void;
}

interface WorkerMessage {
    type: 'init' | 'addChunk' | 'closeHandles' | 'clear' | 'close';
    id: string;
    data?: any;
}

interface WorkerResponse {
    type: 'success' | 'error' | 'progress';
    id: string;
    data?: any;
    error?: string;
}

class OPFSWorkerStorage {
    private root: FileSystemDirectoryHandle | null = null;
    private fileHandle: FileSystemFileHandle | null = null;
    private writable: FileSystemWritableFileStream | null = null;
    private syncAccessHandle: FileSystemSyncAccessHandle | null = null;
    private useSyncAPI = false;
    private filePosition = 0;
    private recordingId: string = '';
    private fileExtension: string = 'webm';
    private fileName: string = '';

    async init(recordingId: string, fileExtension: string): Promise<void> {
        this.recordingId = recordingId;
        this.fileExtension = fileExtension;
        this.fileName = `recording-${this.recordingId}.${this.fileExtension}`;

        this.root = await navigator.storage.getDirectory();

        this.fileHandle = await this.root.getFileHandle(this.fileName, {
            create: true,
        });

        if (typeof (this.fileHandle as any).createWritable === 'function') {
            this.writable = await (this.fileHandle as any).createWritable();
            this.useSyncAPI = false;
        } else if (typeof (this.fileHandle as any).createSyncAccessHandle === 'function') {
            this.syncAccessHandle = await (this.fileHandle as any).createSyncAccessHandle();
            this.useSyncAPI = true;
            this.filePosition = 0;
        } else {
            throw new Error('No supported OPFS write API available in worker');
        }
    }

    async addChunk(chunkBuffer: ArrayBuffer): Promise<void> {
        if (this.useSyncAPI && this.syncAccessHandle) {
            const bytesWritten = this.syncAccessHandle.write(chunkBuffer, { at: this.filePosition });
            this.filePosition += bytesWritten;
            this.syncAccessHandle.flush();
        } else if (this.writable) {
            await this.writable.write(chunkBuffer);
        } else {
            throw new Error('No writable stream or sync handle available');
        }
    }

    async closeHandles(): Promise<string> {
        if (this.writable) {
            await this.writable.close();
            this.writable = null;
        } else if (this.syncAccessHandle) {
            this.syncAccessHandle.flush();
            this.syncAccessHandle.close();
            this.syncAccessHandle = null;
        }

        return this.fileName;
    }

    async clear(): Promise<void> {
        if (this.writable) {
            await this.writable.close();
            this.writable = null;
        } else if (this.syncAccessHandle) {
            this.syncAccessHandle.close();
            this.syncAccessHandle = null;
        }

        if (this.root && this.fileHandle) {
            await this.root.removeEntry(this.fileName);
            this.fileHandle = null;
        }
    }

    close(): void {
        try {
            if (this.syncAccessHandle) {
                this.syncAccessHandle.close();
                this.syncAccessHandle = null;
            }
        } catch (err) {
            console.error('[Worker] Error closing sync handle:', err);
        }
    }
}

const storage = new OPFSWorkerStorage();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const { type, id, data } = event.data;

    try {
        switch (type) {
            case 'init': {
                const { recordingId, fileExtension } = data;
                await storage.init(recordingId, fileExtension);
                const response: WorkerResponse = { type: 'success', id };
                self.postMessage(response);
                break;
            }

            case 'addChunk': {
                const { chunkBuffer } = data;
                await storage.addChunk(chunkBuffer);
                const response: WorkerResponse = { type: 'success', id };
                self.postMessage(response);
                break;
            }

            case 'closeHandles': {
                const fileName = await storage.closeHandles();
                const response: WorkerResponse = {
                    type: 'success',
                    id,
                    data: { fileName },
                };
                self.postMessage(response);
                break;
            }

            case 'clear': {
                await storage.clear();
                const response: WorkerResponse = { type: 'success', id };
                self.postMessage(response);
                break;
            }

            case 'close': {
                storage.close();
                const response: WorkerResponse = { type: 'success', id };
                self.postMessage(response);
                break;
            }

            default:
                throw new Error(`Unknown message type: ${type}`);
        }
    } catch (error) {
        const response: WorkerResponse = {
            type: 'error',
            id,
            error: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};
