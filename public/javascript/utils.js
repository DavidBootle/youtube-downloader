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
function updateLoadingDots() {
    if (numOfLoadingDots == 0) {
        $('#loading-dots-1').addClass('loading-dot-invisible');
        $('#loading-dots-2').addClass('loading-dot-invisible');
        $('#loading-dots-3').addClass('loading-dot-invisible');
        numOfLoadingDots = 1;
    }
    else if (numOfLoadingDots == 1) {
        $('#loading-dots-1').removeClass('loading-dot-invisible');
        numOfLoadingDots = 2;
    }
    else if (numOfLoadingDots == 2) {
        $('#loading-dots-2').removeClass('loading-dot-invisible');
        numOfLoadingDots = 3;
    }
    else if (numOfLoadingDots == 3) {
        $('#loading-dots-3').removeClass('loading-dot-invisible');
        numOfLoadingDots = 0;
    }
}