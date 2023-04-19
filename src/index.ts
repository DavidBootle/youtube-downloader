import express, { application } from 'express';
import path from 'path';
import ffmpeg from 'ffmpeg';
import ytdl from 'ytdl-core';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import { createServer } from "http";
import { Server } from "socket.io";
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8002;
const httpServer = createServer(app);
const io = new Server(httpServer, { /* options */ });

app.use("/static", express.static('public'));
app.use(express.json());

// wipe the temp folder when starting up
fs.readdir(process.env.YTDL_PATH, (err, files) => {
    if (err) throw err;
    for (const file of files) {
        fs.unlink(path.join(process.env.YTDL_PATH, file), err => {});
    }
});

/* PAGES */

app.get( "/", (req, res) => {
    // send the home page
    res.sendFile(path.join(__dirname, '../html/index.html'));
});

app.get( "/convert", (req, res) => {
    // send mp4 conversion page
    const token = req.query.token;
    if (!token) { res.sendFile(path.join(__dirname, '../html/pickvideoquality.html')); }
    else { res.sendFile(path.join(__dirname, '../html/convert.html')); }
});

// ping method
app.get( "/api/ping", (req, res) => {
    res.sendStatus(200);
});

/* UTILITIES */
type SocketResponse = {
    signal: string,
    data: any
}

type MP3ConvertInfo = {
    downloadPath: string,
    audioPath: string,
    progress: number,
    converting: boolean,
    finished: boolean,
    error: boolean,
    errorMessage: string,
    lastUpdate?: SocketResponse,
    startTime?: number,
}
type MP4ConvertInfo = {
    videoDownloadPath: string,
    audioDownloadPath: string,
    outputPath: string,
    videoTotalLength: number,
    audioTotalLength: number,
    videoDownloaded: number,
    audioDownloaded: number,
    progress: number,
    convertingAudio: boolean,
    convertingVideo: boolean,
    finished: boolean,
    error: boolean,
    errorMessage: string,
    lastUpdate?: SocketResponse,
    startTime?: number,
}
let downloadsMP3 = new Map<string, MP3ConvertInfo>();
let downloadsMP4 = new Map<string, MP4ConvertInfo>();
function unlinkPath(path: string) {
    fs.unlink(path, (err) => {});
}
type VideoQualityInfo = {
    quality: string,
    qualityLabel: string
}

/** SOCKET.IO **/

/**
 * Wrapper for emitting a status update to connected sockets.
 * @param token The token of the download
 * @param signal The event string
 * @param data A data object or nothing
 */
function status_update(token: string, signal: string, data: any) {
    io.to(token).emit(signal, data);
    
    if (downloadsMP3.has(token)) {
        // handle mp3
        let download = downloadsMP3.get(token);
        download.lastUpdate = { signal, data };
        downloadsMP3.set(token, download);
    } else if (downloadsMP4.has(token)) {
        // handle mp4
        let download = downloadsMP4.get(token);
        download.lastUpdate = { signal, data };
        downloadsMP4.set(token, download);
    }
}

io.on("connection", (socket) => {

    // handle register event
    // clients will emit register when they want to tie themselves to a download
    socket.on('register', (data) => {
        let tokenExists = downloadsMP3.has(data.token) || downloadsMP4.has(data.token);
        if (tokenExists) {
            // if the token is valid, join the socket to the room
            socket.join(data.token);
            socket.emit('register_response', {
                'success': true,
                'message': 'Registered successfully.'
            });
            console.log('Registered new socket to token ' + data.token);
        } else {
            // if the token is invalid, inform the socket
            socket.emit('register_response', {
                'success': false,
                'message': 'Invalid token.'
            });
        }
    });

    // handle update_request event
    // clients will emit update_request when they want to get the latest progress of a download
    socket.on('update_request', (data) => {
        const { token } = data;
        let tokenExists = downloadsMP3.has(token) || downloadsMP4.has(token);
        if (tokenExists) {
            let download = downloadsMP3.has(token) ? downloadsMP3.get(token) : downloadsMP4.get(token);
            if (download.lastUpdate) {
                socket.emit(download.lastUpdate.signal, download.lastUpdate.data);
            } else {
                socket.emit('starting');
            }
        } else {
            socket.emit('register_response', {
                'success': false,
                'message': 'Invalid token.'
            });
        }
    });
});

/**
 * Returns the time remaining as a simple string.
 * @param timeElapsed Time elapsed in milliseconds
 * @param progress Progress percentage from 0 to 100
 */
function getETAString(timeElapsed: number, progress: number) {
    progress /= 100;
    let timeRemaining = (timeElapsed / progress) * (1 - progress);

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

/**
 * Verifies that a given video URL is a real youtube video.
 */
app.get( "/api/verify", (req, res) => {
    // get the url parameter
    const url: string = req.query.url as string;

    // if the url parameter is not provided, return an error
    if (!url) { res.status(400).send("'url' parameter is required."); return; }

    // check if the url is valid
    let isValidURL: boolean = ytdl.validateURL(url);

    // send the response
    res.send({ 'valid': isValidURL });
});

/**
 * Gets the download of an mp3 conversion
 */
app.get( "/api/download/mp3", (req, res) => {
    const token: string = req.query.token as string;

    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP3.has(token);
    if (!isValidToken) { res.status(404).send("Invalid token."); return; }

    let download = downloadsMP3.get(token);

    if (download.error) {
        res.status(500).send(download.errorMessage);
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.delete(token);
        return;
    }

    if (!download.finished) { res.status(400).send('Audio file is not ready for download.'); return; }

    res.sendFile(download.audioPath, (err) => {
        setTimeout(() => {
            unlinkPath(download.downloadPath);
            unlinkPath(download.audioPath);
            downloadsMP3.delete(token);
        }, parseInt(process.env.YTDL_CLEAR_AFTER_DOWNLOAD_TIME) * 60000);
    });
});

/**
 * Gets the download of an mp3 conversion
 */
 app.get( "/api/download/mp4", (req, res) => {
    const token: string = req.query.token as string;

    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP4.has(token);
    if (!isValidToken) { res.status(404).send("Invalid token."); return; }

    let download = downloadsMP4.get(token);

    if (download.error) {
        res.status(500).send(download.errorMessage);
        unlinkPath(download.videoDownloadPath);
        unlinkPath(download.audioDownloadPath);
        unlinkPath(download.outputPath);
        downloadsMP4.delete(token);
        return;
    }

    if (!download.finished) { res.status(400).send('Audio file is not ready for download.'); return; }

    res.sendFile(download.outputPath, (err) => {
        setTimeout(() => {
            unlinkPath(download.videoDownloadPath);
            unlinkPath(download.audioDownloadPath);
            unlinkPath(download.outputPath);
            downloadsMP4.delete(token);
        }, parseInt(process.env.YTDL_CLEAR_AFTER_DOWNLOAD_TIME) * 60000);
    });
});

/**
 * Starts converting a youtube video to mp3.
 */
app.get( "/api/convert/mp3", async (req, res) => {
    const youtubeURL: string = req.query.url as string;

    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }

    const downloadPath: string = `/${process.env.YTDL_PATH}/${uuid()}.mp4`;
    const audioPath: string = `/${process.env.YTDL_PATH}/${uuid()}.mp3`;

    try {
        await ytdl.getVideoID(youtubeURL); // run this to make sure it's a valid video
    } catch {
        res.status(400).send('Not a valid YouTube video.');
        return;
    }

    if (!ytdl.validateURL(youtubeURL)) { res.status(400).send('Not a valid YouTube video.'); return; }

    const videoToken: string = uuid();

    let download: MP3ConvertInfo = {
        downloadPath,
        audioPath,
        progress: 0,
        converting: false,
        finished: false,
        error: false,
        errorMessage: '',
        startTime: new Date().getTime(),
    }
    downloadsMP3.set(videoToken, download);
    res.status(202).send({ 'token': videoToken });

    try {
        let stream = fs.createWriteStream(download.downloadPath);
        let video = ytdl(youtubeURL, { quality: 'highestaudio', filter: 'audioonly' });
        let pipe = video.pipe(stream);

        video.on('progress', (length: number, downloaded: number, totalLength: number) => {
            let download = downloadsMP3.get(videoToken);
            download.progress = (downloaded / totalLength) * 100;
            downloadsMP3.set(videoToken, download);

            // update connected clients with the state of the download
            status_update(videoToken, 'downloading', {
                progress: download.progress,
                eta: getETAString(new Date().getTime() - download.startTime, download.progress),
            });
        });

        pipe.on('finish', async () => {
            let download = downloadsMP3.get(videoToken);
            download.converting = true;
            downloadsMP3.set(videoToken, download);

            // inform connected clients that the download is finished and conversion has begun
            status_update(videoToken, 'converting', {});

            try {
                let download = downloadsMP3.get(videoToken);
                let video = await new ffmpeg(download.downloadPath);
                await video.fnExtractSoundToMP3(download.audioPath);
                download.finished = true;
                downloadsMP3.set(videoToken, download);

                // inform connected clients that the download is complete
                status_update(videoToken, 'finished', {});

                setTimeout(() => {
                    unlinkPath(download.downloadPath);
                    unlinkPath(download.audioPath);
                    downloadsMP4.delete(videoToken);
                }, parseInt(process.env.YTDL_CLEAR_AFTER_COMPLETE_TIME) * 1000 * 60); // remove both files in X minutes
            } catch (err) {
                let download = downloadsMP3.get(videoToken);
                download.error = true;
                download.errorMessage = 'Something went wrong when converting the video.';
                unlinkPath(download.downloadPath);
                unlinkPath(download.audioPath);
                downloadsMP3.set(videoToken, download);
                console.error(err);

                // update connected clients
                status_update(videoToken, 'download_error', {
                    message: download.errorMessage
                });
            }
        });
    } catch (err) {
        let download = downloadsMP3.get(videoToken);
        download.error = true;
        download.errorMessage = 'Something went wrong when downloading the video.';
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.set(videoToken, download);
        console.error(err);

        // inform connected clients that the download has failed
        status_update(videoToken, 'download_error', {
            message: 'Something went wrong when downloading the video.'
        });
    }
});

/**
 * Starts converting a youtube video to mp4.
 */
app.get( "/api/convert/mp4", async (req, res) => {
    const youtubeURL: string = decodeURIComponent(req.query.url as string);
    const quality: string = decodeURIComponent(req.query.quality as string);

    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }
    if (!quality) { res.status(400).send("'quality' parameter is required."); return; }

    const videoDownloadPath: string = `${process.env.YTDL_PATH}/${uuid()}.mp4`;
    const audioDownloadPath: string = `${process.env.YTDL_PATH}/${uuid()}.mp4`;
    const outputPath: string = `${process.env.YTDL_PATH}/${uuid()}.mp4`;

    if (!ytdl.validateURL(youtubeURL)) { res.status(400).send('Not a valid YouTube video.'); return; }

    const videoToken: string = uuid();

    let download: MP4ConvertInfo = {
        videoDownloadPath,
        audioDownloadPath,
        outputPath,
        videoTotalLength: null,
        audioTotalLength: null,
        videoDownloaded: null,
        audioDownloaded: null,
        progress: 0,
        convertingAudio: false,
        convertingVideo: false,
        finished: false,
        error: false,
        errorMessage: '',
        startTime: new Date().getTime(),
    }
    downloadsMP4.set(videoToken, download);
    res.status(202).send({ 'token': videoToken });

    try {

        let video = await ytdl(youtubeURL, { filter: format => format.quality == quality && format.container == 'mp4' });
        let audio = await ytdl(youtubeURL, { quality: 'highestaudio' });

        // get video pipe
        let videoStream = fs.createWriteStream(download.videoDownloadPath);
        let videoPipe = video.pipe(videoStream);

        // get audio pipe
        let audioStream = fs.createWriteStream(download.audioDownloadPath);
        let audioPipe = audio.pipe(audioStream);

        audio.on('progress', (length: number, downloaded: number, totalLength: number) => {
            // get the current state of the download
            let download = downloadsMP4.get(videoToken);

            // if the total length is not set, set it
            if (!download.audioTotalLength) {
                download.audioTotalLength = totalLength;
            }
            // set whether the audio is downloaded
            download.audioDownloaded = downloaded;

            // if all the lengths are set, calculate the progress
            if (download.audioTotalLength && download.audioDownloaded && download.videoTotalLength && download.videoDownloaded) {
                let totalDownloaded = download.audioDownloaded + download.videoDownloaded;
                let totalDownloadLength = download.audioTotalLength + download.videoTotalLength;
                download.progress = (totalDownloaded / totalDownloadLength ) * 100;

                // update connected clients with the state of the download
                status_update(videoToken, 'downloading', {
                    progress: download.progress,
                    eta: getETAString(new Date().getTime() - download.startTime, download.progress),
                });
            }

            downloadsMP4.set(videoToken, download);
        });

        video.on('progress', (length: number, downloaded: number, totalLength: number) => {
            let download = downloadsMP4.get(videoToken);
            if (!download.videoTotalLength) {
                download.videoTotalLength = totalLength;
            }
            download.videoDownloaded = downloaded;

            if (download.audioTotalLength && download.audioDownloaded && download.videoTotalLength && download.videoDownloaded) {
                let totalDownloaded = download.audioDownloaded + download.videoDownloaded;
                let totalDownloadLength = download.audioTotalLength + download.videoTotalLength;
                download.progress = (totalDownloaded / totalDownloadLength ) * 100;

                // update connected clients with the state of the download
                status_update(videoToken, 'downloading', {
                    progress: download.progress,
                    eta: getETAString(new Date().getTime() - download.startTime, download.progress),
                });
            }
            downloadsMP4.set(videoToken, download);
        });

        async function combine() {
            try {
                let download = downloadsMP4.get(videoToken);
                let video = await new ffmpeg(download.videoDownloadPath);
                video.addInput(download.audioDownloadPath);
                video.addCommand('-c:v', 'copy');
                video.addCommand('-c:a', 'aac');
                await video.save(download.outputPath);
                download.finished = true;
                downloadsMP4.set(videoToken, download);

                // inform connected clients that the download is complete
                status_update(videoToken, 'finished', {});

                // remove files after certain amount of time
                setTimeout(() => {
                    unlinkPath(download.videoDownloadPath);
                    unlinkPath(download.audioDownloadPath);
                    unlinkPath(download.outputPath);
                    downloadsMP4.delete(videoToken);
                }, parseInt(process.env.YTDL_CLEAR_AFTER_COMPLETE_TIME) * 1000 * 60); // remove all files in X minutes
            } catch (err) {
                let download = downloadsMP4.get(videoToken);
                download.error = true;
                download.errorMessage = 'Something went wrong when converting the video.';
                unlinkPath(download.audioDownloadPath);
                unlinkPath(download.videoDownloadPath);
                unlinkPath(download.outputPath);
                downloadsMP4.set(videoToken, download);
                console.error(err);

                // update connected clients
                status_update(videoToken, 'download_error', {
                    message: download.errorMessage
                });
            }
        }

        audioPipe.on('finish', async () => {
            audioPipe.close();
            let download = downloadsMP4.get(videoToken);
            download.convertingAudio = true;
            downloadsMP4.set(videoToken, download);

            if (download.convertingAudio && download.convertingVideo) {
                // inform connected clients that the download is finished and conversion has begun
                status_update(videoToken, 'converting', {});
                combine();
            }
        });

        videoPipe.on('finish', async () => {
            videoPipe.close();
            let download = downloadsMP4.get(videoToken);
            download.convertingVideo = true;
            downloadsMP4.set(videoToken, download);
            if (download.convertingAudio && download.convertingVideo) {
                // inform connected clients that the download is finished and conversion has begun
                status_update(videoToken, 'converting', {});
                combine();
            }
        });
    } catch (err) {
        let download = downloadsMP4.get(videoToken);
        download.error = true;
        download.errorMessage = 'Something went wrong when downloading the video.';
        unlinkPath(download.audioDownloadPath);
        unlinkPath(download.videoDownloadPath);
        unlinkPath(download.outputPath);
        downloadsMP4.set(videoToken, download);
        // inform connected clients that the download has failed
        status_update(videoToken, 'download_error', {
            message: 'Something went wrong when downloading the video.'
        });
    }
});

/** Gets video information and returns it as an object */
app.get( "/api/info/video", async (req, res) => {
    // parse request
    const youtubeURL: string = req.query.url as string;

    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }

    // get video info
    const vidInfo: ytdl.videoInfo = await ytdl.getInfo(youtubeURL);

    // find necessary video information
    const vidName: string = vidInfo.videoDetails.title;
    const vidAuthor: string = vidInfo.videoDetails.ownerChannelName;
    let vidThumbnail: string = null;
    let largestQualityWidth: number = 0;
    for (let thumbnail of vidInfo.videoDetails.thumbnails) {
        if (thumbnail.width > largestQualityWidth) {
            largestQualityWidth = thumbnail.width;
            vidThumbnail = thumbnail.url
        }
    }

    // check if thumbnail doesn't exist
    if (vidThumbnail == null) {
        res.status(500).send('No thumbnail found for video!');
        return;
    }

    // find valid formats
    var validFormats: Array<VideoQualityInfo> = [];
    for (let format of vidInfo.formats) {
        if (format.container == 'mp4' && format.hasVideo && !format.hasAudio) { // ignore all formats that are not mp4
            let qualityAlreadyAdded = !validFormats.every(e => e.qualityLabel != format.qualityLabel); // will return true if this format's quality has already been added.
            if (!qualityAlreadyAdded) {
                validFormats.push({
                    quality: format.quality.toString(),
                    qualityLabel: format.qualityLabel
                });
            }
        }
    }

    // check if there are no valid video formats
    if (validFormats.length == 0) {
        res.status(500).send('No valid video formats found!');
        return;
    }

    res.send({
        url: youtubeURL,
        name: vidName,
        author: vidAuthor,
        thumbnailURL: vidThumbnail,
        formats: validFormats
    });
});

httpServer.listen( port, () => {
    console.log(`Server started at http://localhost:${port}`);
});