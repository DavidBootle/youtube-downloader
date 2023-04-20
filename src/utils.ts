import ytdl from 'ytdl-core';
import fs, { stat } from 'fs';
import { Readable } from 'stream';
import { Server } from "socket.io";
import ffmpeg from 'ffmpeg';

/**
 * Represents a single emit event.
 */
export type SocketResponse = {
    signal: string,
    data: any
}

export enum ConversionState {
    /** The conversion has not started yet. */
    STARTING = "STARTING",
    /** The conversion is currently downloading the video. */
    DOWNLOADING = "DOWNLOADING",
    /** The conversion is currently converting the video. */
    CONVERTING = "CONVERTING",
    /** The conversion has completed successfully and the video is ready to be downloaded. */
    COMPLETED = "COMPLETED",
    /** The conversion has failed. */
    FAILED = "FAILED"
}

/**
 * Represents a single file download.
 */
class Download {
    /** The path of the file download. */
    downloadPath: string;
    /** The total size of the file. */
    totalSize?: number;
    /** The amount of the file that has been downloaded. */
    downloadedSize?: number;
    /** Whether the download has started. */
    started: boolean;
    /** Whether the download has reached an error. */
    error: boolean;
    /** Whether the download was completed. */
    completed: boolean;
    /** The function to call to notify the parent object that the status has changed. */
    statusUpdate: () => void;

    // internal variables
    private writeStream?: fs.WriteStream;
    private source?: Readable;

    /**
     * Initialize a new download object.
     * @param downloadPath The path of the file download.
     */
    constructor(downloadPath: string) {
        this.downloadPath = downloadPath;
        this.error = false;
        this.completed = false;
        this.started = false;
        this.statusUpdate = () => {};
    }

    /**
     * Change the function to call to notify the parent object that the status has changed.
     * @param newStatusUpdate The new function to call to notify the parent object that the status has changed.
     */
    changeStatusUpdate(newStatusUpdate: () => void) {
        this.statusUpdate = newStatusUpdate;
    }

    /**
     * Start the download.
     * @param youtubeURL The url of the youtube video to download.
     * @param options The filter to use for the download.
     */
    startDownload(youtubeURL: string, options: ytdl.downloadOptions) {
        try {
            // create write stream
            this.writeStream = fs.createWriteStream(this.downloadPath);

            // initiate download
            this.source = ytdl(youtubeURL, options);

            // pipe the download to the write stream
            this.writeStream = this.source.pipe(this.writeStream);

            // setup event handlers
            this.source.on('progress', this.progressHandler.bind(this));
            this.writeStream.on('finish', this.finishedHandler.bind(this));
            this.writeStream.on('error', this.errorHandler.bind(this));

            // set started to true
            this.started = true;
        }
        
        // handle any errors in the creation of the streams
        catch (error) {
            this.error = true;
            console.error(error);
        }
    }

    /**
     * Stops the download in progress and deletes the downloaded file.
     * This is used for if the user cancels a download, or a parallel download fails.
     */
    stopDownload() {
        // close the write stream
        this.writeStream?.close();
        // close the source stream
        this.source?.destroy();

        // remove the downloaded file
        fs.unlink(this.downloadPath, ()=>{});
    }

    /**
     * Handles the progress event emitted by the download.
     * @param chunkLength The length of the chunk that was downloaded.
     * @param downloaded The amount of the file that has been downloaded.
     * @param total The total size of the file.
     */
    private progressHandler(chunkLength: number, downloaded: number, total: number) {
        this.downloadedSize = downloaded;
        this.totalSize = total;
        this.statusUpdate();
    }

    /**
     * Handles the finish event emitted by the download.
     */
    private finishedHandler() {
        this.completed = true;
        this.statusUpdate();
    }

    /**
     * Handles the error event emitted by the download.
     * @param error The error that was emitted.
     */
    private errorHandler(error: Error) {
        this.error = true;
        console.error(error);
        this.statusUpdate();
    }
}

class Conversion {
    /** The file path where the converted file will be stored. */
    outputPath: string;
    /** The download progress as a percentage represented as a decimal. */
    progress: number;
    /** The last status event emitted for this conversion. */
    lastUpdate?: SocketResponse;
    /** The time in milliseconds when the conversion was started as gotten by Date().getTime() */
    startTime: number;
    /** The token used as the identifier for this conversion */
    token: string;
    /** Internal variable used to keep track of all download objects for progress calculations. */
    private downloads: Download[];
    /** The url of the youtube video being downloaded. */
    youtubeUrl: string;
    /** Represents the state of the conversion. */
    state: ConversionState;
    /** Socket.io server */
    io: Server;
    /** Remove callback */
    removeCallback?: () => void;

    /**
     * Initialize a new conversion object. Please note that this is an abstract class and should not be instantiated directly.
     * @param downloads A list of download objects attached to this conversion.
     * @param outputPath The path that the file outputted file should have.
     * @param token The token used as the identifier for this conversion.
     * @param youtubeUrl The url of the youtube video being downloaded.
     * @param io Socket.io server
     * @param removeCallback Function that is called when the conversion runs delete on itself.
     */
    constructor(downloads: Download[], outputPath: string, token: string, youtubeUrl: string, io: Server, removeCallback?: () => void) {
        this.outputPath = outputPath;
        this.token = token;
        this.downloads = downloads;
        this.youtubeUrl = youtubeUrl;
        this.io = io;
        this.removeCallback = removeCallback;

        this.progress = 0;
        this.startTime = new Date().getTime();
        this.state = ConversionState.STARTING;

        // set the status update function for each download object
        this.downloads.forEach(download => download.changeStatusUpdate(this.downloadStatusUpdate.bind(this)));
    }

    /**
     * Wrapper for emitting a status update to connected sockets.
     */
    emit(signal: string, data: any) {
        this.io.to(this.token).emit(signal, data);
        this.lastUpdate = { signal, data };
    }

    /**
     * Starts the download process.
     * Children should overwrite this method and manually start the download for each object.
     */
    startDownload() {
        // children should manually start the process for each download object
        this.state = ConversionState.DOWNLOADING;
    }

    /**
     * Starts the conversion process.
     * Children should overwrite this method and define how the conversion should work.
     */
    startConversion() {
        // children should overwrite this method to define how conversion should work
        this.state = ConversionState.CONVERTING;
    }
    
    /**
     * This is the function that download objects will call when they have updated their status.
     */
    downloadStatusUpdate() {
        // if not all downloads have started, do nothing
        if (!this.downloads.every(download => download.started)) {
            // if not all downloads have started, do nothing
        }

        // otherwise, if any of the downloads have an error, set the state to failed and cancel all downloads
        else if (this.downloads.some(download => download.error)) {
            this.state = ConversionState.FAILED;
            this.downloads.forEach(download => download.stopDownload());
            this.delete();
        }

        // otherwise, if any downloads are still in the process of downloading but some have not been completed
        else if (!this.downloads.every(download => download.completed)) {
            // get the total size of all downloads
            let totalSize = this.downloads.reduce((total, download) => total + download.totalSize, 0);
            // get the total amount of data downloaded
            let downloadedSize = this.downloads.reduce((total, download) => total + download.downloadedSize, 0);
            // calculate the progress of the total download
            this.progress = downloadedSize / totalSize;

            // emit changes to the user
            this.emit('downloading', {
                progress: this.progress * 100,
                eta: this.getETAString()
            });
        }

        // otherwise, if all downloads are finished
        else if (this.downloads.every(download => download.completed)) {
            // send update to user
            this.emit('converting', {});
            // start the conversion process
            this.startConversion();
        }
    }

    /**
     * Calls the callback function.
     * Should be overwritten by children to define what should happen when the conversion is removed.
     */
    delete() {
        this.removeCallback();
    }

    /**
     * Returns a human-readable string representing the ETA remaining for the download.
     * @returns A string representing the estimated time remaining for the download to complete.
     */
    private getETAString() {
        let timeElapsed = new Date().getTime() - this.startTime;
        let timeRemaining = (timeElapsed / this.progress) * (1 - this.progress);
    
        if (timeRemaining / 86400000 > 1) {
            let days = Math.floor(timeRemaining / 86400000);
            return `${days} day${days == 1 ? '' : 's'}`
        }
        else if (timeRemaining / 3600000 > 1) {
            let hours = Math.floor(timeRemaining / 3600000);
            return `${hours} hour${hours == 1 ? '' : 's'}`;
        }
        else if (timeRemaining / 60000 > 1) {
            let minutes = Math.floor(timeRemaining / 60000);
            return `${minutes} minute${minutes == 1 ? '' : 's'}`;
        }
        else {
            let seconds = Math.floor(timeRemaining / 1000);
            return `${seconds} second${seconds == 1 ? '' : 's'}`;
        }
    }
}

/**
 * Represents a single MP3 audio conversion.
 */
export class MP3Conversion extends Conversion {

    /** The download object representing the audio. */
    audio: Download;

    /**
     * Create a new MP3Conversion object.
     * @param token The token used as the identifier for this conversion.
     * @param youtubeURL The url of the youtube video being downloaded.
     * @param audioDownloadPath The path that the audio file should be downloaded to.
     * @param outputPath The path that the outputted file should have after conversion.
     * @param io Socket.io server
     * @param removeCallback Function that is called when the conversion runs delete on itself.
     */
    constructor(token: string, youtubeURL: string, audioDownloadPath: string, outputPath: string, io: Server, removeCallback?: () => void) {

        // create the audio download object
        let audio = new Download(audioDownloadPath);
        
        super([audio], outputPath, token, youtubeURL, io, removeCallback);
        this.audio = audio;
    }

    /**
     * Start downloading.
     */
    startDownload() {
        super.startDownload();

        // start the audio download
        this.audio.startDownload(this.youtubeUrl, { quality: 'highestaudio' });
    }

    /**
     * Start conversion.
     * This should not be called manually, it will be called when the download is finished.
     */
    async startConversion() {
        try {
            // convert the downloaded audio to mp3
            let video = await new ffmpeg(this.audio.downloadPath);
            await video.fnExtractSoundToMP3(this.outputPath);

            // set the state to completed and emit a success signal
            this.state = ConversionState.COMPLETED;
            this.emit('finished', {});

            // set timeout to delete the downloaded files
            setTimeout(() => {
                this.delete()
            }, parseInt(process.env.YTDL_CLEAR_AFTER_COMPLETE_TIME) * 1000 * 60);
        }

        catch (error) {
            // if any conversion fails, set the state to failed and emit an error
            this.state = ConversionState.FAILED;
            this.emit('download_error', { message: error.message });
            this.delete();
        }
    }

    /**
     * Delete all associated files from disk and call the delete callback.
     */
    delete() {
        // delete the downloaded files
        super.delete();
        fs.unlink(this.audio.downloadPath, () => {});
        fs.unlink(this.outputPath, () => {});
    }

}

/**
 * Represents a single MP4 video conversion.
 */
export class MP4Conversion extends Conversion {

    /** The download object representing the audio. */
    audio: Download;
    /** The download object representing the video. */
    video: Download;
    /** The quality of the video. */
    quality: string;

    /**
     * Create a new MP4Conversion object.
     * @param token The token used as the identifier for this conversion.
     * @param youtubeURL The url of the youtube video being downloaded.
     * @param quality The quality of the video.
     * @param audioDownloadPath The path that the audio file should be downloaded to.
     * @param videoDownloadPath The path that the video file should be downloaded to.
     * @param outputPath The path that the outputted file should have after conversion.
     * @param io Socket.io server
     * @param removeCallback Function that is called when the conversion runs delete on itself.
     */
    constructor(token: string, youtubeURL: string, quality: string, audioDownloadPath: string, videoDownloadPath: string, outputPath: string, io: Server, removeCallback?: () => void) {

        // create the audio download object
        let audio = new Download(audioDownloadPath);
        let video = new Download(videoDownloadPath);
        
        super([audio, video], outputPath, token, youtubeURL, io, removeCallback);
        this.audio = audio;
        this.video = video;
        this.quality = quality;
    }

    /**
     * Start downloading.
     */
    startDownload() {
        super.startDownload();

        // start the audio and video downloads
        this.audio.startDownload(this.youtubeUrl, { quality: 'highestaudio' });
        this.video.startDownload(this.youtubeUrl, { filter: format => format.quality == this.quality && format.container == 'mp4' });
    }

    /**
     * Start conversion.
     * This should not be called manually, it will be called when the download is finished.
     */
    async startConversion() {
        try {
            // combine audio and video
            let video = await new ffmpeg(this.video.downloadPath);
            video.addInput(this.audio.downloadPath);
            video.addCommand('-c:v', 'copy');
            video.addCommand('-c:a', 'aac');
            await video.save(this.outputPath);

            // set the state to completed and emit a success signal
            this.state = ConversionState.COMPLETED;
            this.emit('finished', {});

            // set timeout to delete the downloaded files
            setTimeout(() => {
                this.delete()
            }, parseInt(process.env.YTDL_CLEAR_AFTER_COMPLETE_TIME) * 1000 * 60);
        }

        catch (error) {
            // if any conversion fails, set the state to failed and emit an error
            this.state = ConversionState.FAILED;
            this.emit('download_error', { message: error.message });
            this.delete();
        }
    }

}