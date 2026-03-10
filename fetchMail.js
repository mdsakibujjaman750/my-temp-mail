// ============================================================
//  DropMail — Netlify Serverless Function
//  File: netlify/functions/fetchMail.js
//
//  Proxies requests to the 1secmail public API to avoid CORS
//  issues and keep the API calls server-side.
//
//  Endpoints handled:
//    ?action=getMessages&login=XXX&domain=YYY   → list inbox
//    ?action=readMessage&login=XXX&domain=YYY&id=ZZZ → fetch one email
// ============================================================

const https = require('https');
const http  = require('http');

const BASE_URL = 'https://www.1secmail.com/api/v1/';

// ---- CORS headers returned on every response --------------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ---- Simple HTTP GET helper (no external deps) -----------
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let raw = '';
      res.on('data',  chunk => { raw += chunk; });
      res.on('end',   ()    => resolve({ status: res.statusCode, body: raw }));
      res.on('error', err   => reject(err));
    }).on('error', err => reject(err));
  });
}

// ---- Validate inputs (basic sanitization) ----------------
function isValidLogin(login) {
  return /^[a-z0-9._+-]{1,64}$/i.test(login);
}

function isValidDomain(domain) {
  // Only allow known 1secmail domains
  const allowed = [
    '1secmail.com', '1secmail.org', '1secmail.net',
    'wwjmp.com', 'esiix.com', 'xojxe.com', 'yoggm.com',
    'kzccv.com', 'qiott.com', 'mjjes.com'
  ];
  return allowed.includes(domain.toLowerCase());
}

function isValidId(id) {
  return /^\d+$/.test(id);
}

// ---- Handler ----------------------------------------------
exports.handler = async function (event) {

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Only allow GET
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const params  = event.queryStringParameters || {};
  const action  = params.action  || '';
  const login   = (params.login  || '').toLowerCase().trim();
  const domain  = (params.domain || '').toLowerCase().trim();
  const id      = (params.id     || '').trim();

  // ---- Validate common params ----------------------------
  if (!login || !domain) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing login or domain parameter' }),
    };
  }

  if (!isValidLogin(login)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid login format' }),
    };
  }

  if (!isValidDomain(domain)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Domain not allowed' }),
    };
  }

  // ---- Route actions -------------------------------------
  try {
    let apiUrl = '';

    if (action === 'getMessages') {
      // List all messages in inbox
      apiUrl = `${BASE_URL}?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`;

    } else if (action === 'readMessage') {
      // Fetch single message body
      if (!id || !isValidId(id)) {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: 'Missing or invalid message id' }),
        };
      }
      apiUrl = `${BASE_URL}?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(id)}`;

    } else {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: `Unknown action: ${action}` }),
      };
    }

    // ---- Proxy the request to 1secmail ----------------
    const response = await httpGet(apiUrl);

    if (response.status !== 200) {
      console.error(`1secmail returned ${response.status}: ${response.body}`);
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Upstream API error', upstream: response.status }),
      };
    }

    // Validate JSON before forwarding
    let parsed;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      return {
        statusCode: 502,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Invalid JSON from upstream API' }),
      };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    console.error('fetchMail function error:', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error', message: err.message }),
    };
  }
};
