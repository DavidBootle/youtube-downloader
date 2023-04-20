import express, { application } from 'express';
import path from 'path';
import ffmpeg from 'ffmpeg';
import ytdl from 'ytdl-core';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import { createServer } from "http";
import { Server } from "socket.io";
import { MP3Conversion, MP4Conversion, SocketResponse, ConversionState } from './utils';
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8002;
const httpServer = createServer(app);
const io = new Server(httpServer, { /* options */ });

app.use("/static", express.static('public'));
app.use("/favicon.ico", express.static('favicon.ico'));
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

let downloadsMP3 = new Map<string, MP3Conversion>();
let downloadsMP4 = new Map<string, MP4Conversion>();

function unlinkPath(path: string) {
    fs.unlink(path, (err) => {});
}
type VideoQualityInfo = {
    quality: string,
    qualityLabel: string
}

/** SOCKET.IO **/

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

app.get('/api/verify-token', (req, res) => {
    // get token from parameters
    const token: string = req.query.token as string;

    // validate paramters
    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    // check if the token is valid
    let isValidToken = downloadsMP3.has(token) || downloadsMP4.has(token);
    
    res.json({
        'valid': isValidToken
    });
});

/**
 * Gets the download of an mp3 conversion
 */
app.get( "/api/download/:type", async (req, res) => {
    // get url parameters
    const token: string = req.query.token as string;
    const { type } = req.params;

    // validate paramters
    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP3.has(token) || downloadsMP4.has(token);
    if (!isValidToken) { res.status(404).send("Invalid token."); return; }

    // get MP3Conversion object
    let download: MP3Conversion | MP4Conversion;
    if (type == 'mp3') {
        download = downloadsMP3.get(token);
    }
    
    else if (type == 'mp4') {
        download = downloadsMP4.get(token);
    }
    
    else {
        res.status(404).send('Invalid type.');
        return;
    }

    // if the download has failed
    if (download.state == ConversionState.FAILED) {
        // send an error message
        res.status(500).send('An error occurred while converting to audio.');
        // delete the download
        download.delete();
    }

    // if the download isn't completed
    else if (download.state != ConversionState.COMPLETED) {
        // respond that the file is not ready for download
        res.status(400).send('File is not ready for download.');
    }

    // if the download is completed
    else {
        // get video name
        let info = await ytdl.getInfo(download.youtubeUrl);
        info.videoDetails.title;
        res.download(download.outputPath, `${info.videoDetails.title}.${type}`, (err) => {
            setTimeout(() => {
                download.delete();
            }, parseInt(process.env.YTDL_CLEAR_AFTER_DOWNLOAD_TIME) * 60000);
        });
    }
    
});

/**
 * Starts converting a youtube video to mp3.
 */
app.get( "/api/convert/mp3", async (req, res) => {
    // get url parameters
    const youtubeURL: string = req.query.url as string;

    // verify that the url parameter is provided and that the link is valid
    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }

    try {
        await ytdl.getVideoID(youtubeURL); // run this to make sure it's a valid video
    } catch {
        res.status(400).send('Not a valid YouTube video.');
        return;
    }

    if (!ytdl.validateURL(youtubeURL)) { res.status(400).send('Not a valid YouTube video.'); return; }

    // create paths and generate token
    const downloadPath: string = `/${process.env.YTDL_PATH}/${uuid()}.mp4`;
    const outputPath: string = `/${process.env.YTDL_PATH}/${uuid()}.mp3`;
    const videoToken: string = uuid();

    // create new conversion object
    let download = new MP3Conversion(videoToken, youtubeURL, downloadPath, outputPath, io, () => {
        // delete conversion object from map when the conversion deletes itself
        downloadsMP3.delete(videoToken);
    });

    // save conversion object to map
    downloadsMP3.set(videoToken, download);

    // respond to the client that the video conversion process has begun
    res.status(202).send({ 'token': videoToken });

    // initate download process
    download.startDownload();
});

/**
 * Starts converting a youtube video to mp4.
 */
app.get( "/api/convert/mp4", async (req, res) => {
    // get url parameters
    const youtubeURL: string = decodeURIComponent(req.query.url as string);
    const quality: string = decodeURIComponent(req.query.quality as string);

    // verify url parameters
    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }
    if (!quality) { res.status(400).send("'quality' parameter is required."); return; }
    if (!ytdl.validateURL(youtubeURL)) { res.status(400).send('Not a valid YouTube video.'); return; }
    
    // set paths and generate token
    const videoDownloadPath: string = `${process.env.YTDL_PATH}/${uuid()}.mp4`;
    const audioDownloadPath: string = `${process.env.YTDL_PATH}/${uuid()}.mp4`;
    const outputPath: string = `${process.env.YTDL_PATH}/${uuid()}.mp4`;
    const token: string = uuid();

    // generate download object
    let download = new MP4Conversion(token, youtubeURL, quality, videoDownloadPath, audioDownloadPath, outputPath, io, () => {
        downloadsMP4.delete(token);
    });

    // save to map
    downloadsMP4.set(token, download);

    // tell client that the download has started
    res.status(202).send({ token });

    // start download
    download.startDownload();
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