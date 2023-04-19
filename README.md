# youtube-downloader
A youtube downloader utility for MP3 and MP4.

## Website
This server is hosted on [https://ytdownloader.bootletools.com](https://ytdownloader.bootletools.com) and is part of the [Bootle Tools project](https://bootletools.com).

## Local Hosting
1. Install Node.js.
2. Clone the github repo to your device using the command `git clone https://github.com/TheWeirdSquid/youtube-downloader`
3. Run `npm install` in the repo root to install the necessary packages.
4. Create a `.env` file in the repo root. This will contain the following variables:
- `YTDL_PATH=<path>`: This is the temporary path in which to store files while they are being downloaded. The path must actually exist.
- `YTDL_CLEAR_AFTER_COMPLETE_TIME=<minutes>`: The number of minutes to wait after the video is done downloading before deleting it from the server.
- `YTDL_CLEAR_AFTER_DOWNLOAD_TIME=<minutes>`: The number of minutes to wait after the video has been downloaded by the user before deleting it from the server.
5. Run `npm run start` to build and run the server locally.
