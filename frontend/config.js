'use strict';

window.APP_CONFIG = Object.freeze({
  apiBaseUrl: window.location.port === '5500'
    ? 'http://localhost:3000'
    : window.location.origin
});
