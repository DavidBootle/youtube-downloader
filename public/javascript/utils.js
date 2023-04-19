/**
 * Gets a given url parameter by name.
 * @param {*} sParam 
 * @returns 
 */
function getUrlParameter(sParam) {
    var sPageURL = window.location.search.substring(1),
        sURLVariables = sPageURL.split('&'),
        sParameterName,
        i;

    for (i = 0; i < sURLVariables.length; i++) {
        sParameterName = sURLVariables[i].split('=');

        if (sParameterName[0] === sParam) {
            return typeof sParameterName[1] === undefined ? true : decodeURIComponent(sParameterName[1]);
        }
    }
    return false;
};

/**
 * Updates the progress bar
 * @param {number} progress
 */
function setProgress(progress) {
    $('#startingText').hide();
    $('#downloadProgress').width(`${progress}%`);
    $('#downloadPercentage').text(progress.toString());
}

/**
 * Sets the page to the downloading state.
 */
function setDownloading() {
    $('#starting-text').hide();
    $('#starting-subtext').hide();
    $('#status-text').show();
    $('#progress-bar-container').show();
    $('#spinner-circle').hide();
}

/**
 * Sets the page to the converting state.
 */
function setConverting() {
    setProgress(100);
    $('#starting-subtext').show();
    $('#status-text').text('Converting');
    $('#status-text').removeClass('mb-3');
    $('#status-text').addClass('mb-1');
}

/**
 * Sets the page to the finished state
 */
function setFinished() {
    $('#status-text').text('Completed');
    $('#progress-bar-container').hide();
    $('#starting-subtext').hide();
    $('#download-button').show();
    $('#back-button').show();
    $('#status-text').removeClass('mb-1');
    $('#status-text').addClass('mb-3');
}

/**
 * Sets the page to the error state.
 * @param {*} message 
 */
function setError(message) {
    $('#errorIcon').show();
    $('#starting-text').hide();
    $('#status-text').show();
    $('#status-text').text('Something Went Wrong');
    if (message) {
        $('#starting-subtext').show();
        $('#starting-subtext').text(message);
    } else {
        $('#starting-subtext').hide();
    }
    $('#progress-bar-container').hide();
    $('#download-button').hide();
    $('#back-button').show();
}

/**
 * Updates the loading dots to show that the page is loading.
 */
function updateLoadingDots(numOfLoadingDots) {
    if (numOfLoadingDots == 0) {
        $('#loading-dots-1').addClass('loading-dot-invisible');
        $('#loading-dots-2').addClass('loading-dot-invisible');
        $('#loading-dots-3').addClass('loading-dot-invisible');
        return 1;
    }
    else if (numOfLoadingDots == 1) {
        $('#loading-dots-1').removeClass('loading-dot-invisible');
        return 2;
    }
    else if (numOfLoadingDots == 2) {
        $('#loading-dots-2').removeClass('loading-dot-invisible');
        return 3;
    }
    else if (numOfLoadingDots == 3) {
        $('#loading-dots-3').removeClass('loading-dot-invisible');
        return 0;
    }
}

function registerSocket(socket, debug) {
    // handle socket connection
    socket.on('connect', () => {
        console.log('Connected to server!');

        // when socket connects, register with the server so that it can recieve progress updates
        socket.emit('register', {
            token: getUrlParameter('token'),
        });

        // request latest information from the server
        // the server will emit back the last event
        socket.emit('update_request', {
            token: getUrlParameter('token'),
        });
    });

    // handle register_response from the server
    socket.on('register_response', (data) => {
        if (data.success) {
            console.log('Registered with server!');
        } else {
            console.log(`Failed to register with server. Reason: "${data.message}"`);

            // set the page to the error state if not debug
            if (!debug) {
                if (data.message == 'Invalid token.') {
                    setError('Your session has expired. Please start a new download.');
                } else {
                    setError('Something went wrong! Please try again later.');
                }
            }
        }
    });

    // handle starting
    // this should only be recieved if the client requests an update and the server has not send any progress updates
    socket.on('starting', () => {
        if (window.pageState != 'STARTING') {
            window.pageState = 'STARTING';
            $('#starting-text').show();
            $('#status-text').hide();
            $('#spinner-circle').show();
        }
    });

    // handle downloading update
    socket.on('downloading', (data) => {
        const { progress } = data;
        if (window.pageState != 'DOWNLOADING') {
            window.pageState = 'DOWNLOADING';
            setDownloading();
        }
        setProgress(progress);
    });

    // handle converting update
    socket.on('converting', () => {
        if (window.pageState != 'CONVERTING') {
            window.pageState = 'CONVERTING';
            setConverting();
        }
    });

    // handle download error
    socket.on('download_error', (data) => {
        const { message } = data;
        window.pageState = 'ERROR';
        setError(message);
    });

    // handle finished
    socket.on('finished', () => {
        window.pageState = 'FINISHED';
        setFinished();
    });

    // if the socket fails to connect to the server, inform the user through the console
    socket.on('connect_error', () => {
        console.log("Socket failed to connect!");
    });

    // if the socket is disconnected from the server, inform the user through the console
    socket.on('disconnect', () => {
        console.log('Socket disconnected froms server!');
    });
}