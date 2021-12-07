import express, { application } from 'express';
import path from 'path';
import ffmpeg from 'ffmpeg';
import ytdl from 'ytdl-core';
import { v4 as uuid } from 'uuid';
import fs from 'fs';

const app = express();
const port = process.env.PORT || 8002;

app.use("/static", express.static('public'));
app.use(express.json());

app.get( "/", (req, res) => {
    res.sendFile(path.join(__dirname, '../html/index.html'));
});

app.get( "/converttomp3", (req, res) => {
    res.sendFile(path.join(__dirname, '../html/converttomp3.html'));
});

// ping method
app.get( "/api/ping", (req, res) => {
    res.sendStatus(200);
});

/* UTILITIES */
type MP3ConvertInfo = {
    downloadPath: string,
    audioPath: string,
    progress: number,
    converting: boolean,
    finished: boolean,
    error: boolean,
    errorMessage: string,
}
let downloadsMP3 = new Map<string, MP3ConvertInfo>();
function unlinkPath(path: string) {
    fs.unlink(path, (err) => {});
}

/**
 * Verifies that a given video URL is a real youtube video.
 */
app.get( "/api/verify", (req, res) => {
    const url: string = req.query.url as string;

    if (!url) { res.status(400).send("'url' parameter is required."); return; }

    let isValidURL: boolean = ytdl.validateURL(url);
    res.send({ 'valid': isValidURL });
});

/**
 * Gets the progress of an mp3 conversion
 */
app.get( "/api/status/mp3", async (req, res) => {
    const token: string = req.query.token as string;

    if (!token) { res.status(400).send("'token' parameter is required."); return; }

    let isValidToken = downloadsMP3.has(token);
    if (!isValidToken) { res.status(404).send('Invalid token.'); return; }

    let download = downloadsMP3.get(token);
    
    if (download.error) {
        res.send({
            'error': true,
            'message': download.errorMessage
        });
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.delete(token);
        return;
    }

    res.send({
        'progress': download.progress,
        'converting': download.converting,
        'finished': download.finished,
        'error': false,
    });
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
        unlinkPath(download.downloadPath);
        unlinkPath(download.audioPath);
        downloadsMP3.delete(token);
    });
});

/**
 * Starts converting a youtube video to mp3.
 */
app.get( "/api/convert/mp3", (req, res) => {
    const youtubeURL: string = req.query.url as string;

    if (!youtubeURL) { res.status(400).send("'url' parameter is required."); return; }

    const downloadPath: string = `/tmp/${uuid()}.mp4`;
    const audioPath: string = `/tmp/${uuid()}.mp3`;

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
    }
    downloadsMP3.set(videoToken, download);
    res.status(202).send({ 'token': videoToken });

    try {
        let stream = fs.createWriteStream(download.downloadPath);
        let video = ytdl(youtubeURL, { quality: 'highestaudio', filter: 'audioonly' });
        let pipe = video.pipe(stream);

        video.on('progress', (length: number, downloaded: number, totalLength: number) => {
            let download = downloadsMP3.get(videoToken);
            download.progress = Math.round((downloaded / totalLength) * 100);
            downloadsMP3.set(videoToken, download);
        });

        pipe.on('finish', async () => {
            let download = downloadsMP3.get(videoToken);
            download.converting = true;
            downloadsMP3.set(videoToken, download);

            try {
                let download = downloadsMP3.get(videoToken);
                let video = await new ffmpeg(download.downloadPath);
                await video.fnExtractSoundToMP3(download.audioPath);
                download.finished = true;
                downloadsMP3.set(videoToken, download);
                setTimeout(() => {
                    unlinkPath(download.downloadPath);
                    unlinkPath(download.audioPath);
                }, 10 * 60 * 1000); // remove both files in 10 minutes
            } catch (err) {
                let download = downloadsMP3.get(videoToken);
                download.error = true;
                download.errorMessage = 'Something went wrong when converting the video.';
                unlinkPath(download.downloadPath);
                unlinkPath(download.audioPath);
                downloadsMP3.set(videoToken, download);
                console.error(err);
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
    }
});

app.listen( port, () => {
    console.log(`Server started at http://localhost:${port}`);
});