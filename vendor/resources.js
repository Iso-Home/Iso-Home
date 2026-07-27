/* Self-hosted runtime deps. dc-runtime (support.js) checks window.__resources
 * before touching a CDN: any URL found here loads from the local path instead.
 * The vendored files are byte-identical to the pinned unpkg versions — their
 * SHA-384 digests match the SRI constants in support.js. To upgrade a library,
 * replace the file in vendor/ AND update the matching URL/SRI in support.js. */
window.__resources = {
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "./vendor/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js": "./vendor/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js": "./vendor/babel.min.js",
};
