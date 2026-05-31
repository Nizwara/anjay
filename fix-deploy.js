const fs = require('fs');
let code = fs.readFileSync('src/worker.js', 'utf8');

// The worker reads the JSON body at the very beginning of the POST handler:
// `const body = await request.json();`
// BUT for deploy-pages, we are sending FormData, so parsing JSON fails!

// We need to bypass `request.json()` if the path is `/api/deploy-pages`

const search = `// Tangani Operasi API Post (Rute Backend Worker)
if (request.method === 'POST') {
try {
const body = await request.json();`;

const replace = `// Tangani Operasi API Post (Rute Backend Worker)
if (request.method === 'POST') {
try {
let body = {};
// deploy-pages API sends FormData, not JSON, so we skip JSON parse for it.
if (url.pathname !== '/api/deploy-pages') {
  body = await request.json();
} else {
  // For deploy-pages, extract credentials from headers
  body = {
    email: request.headers.get('X-Auth-Email') || "",
    apiKey: request.headers.get('X-Auth-Key') || ""
  };
}`;

code = code.replace(search, replace);

// Let's also check where the content-type is overridden in fetch.
const deployProxySearch = `    const deployRes = await fetch(\`https://api.cloudflare.com/client/v4/accounts/\${accountId}/pages/projects/\${projectName}/deployments\`, {
      method: 'POST',
      headers: { ...commonHeaders },
      body: request.body
    });`;
// When proxying FormData, we MUST remove Content-Type from commonHeaders so the fetch API automatically sets it to multipart/form-data with the correct boundary!
const deployProxyReplace = `    const headersForDeploy = { ...commonHeaders };
    delete headersForDeploy["Content-Type"]; // Allow fetch to set boundary automatically
    // The request content type should be passed through
    const contentType = request.headers.get("content-type");
    if (contentType) headersForDeploy["Content-Type"] = contentType;

    const deployRes = await fetch(\`https://api.cloudflare.com/client/v4/accounts/\${accountId}/pages/projects/\${projectName}/deployments\`, {
      method: 'POST',
      headers: headersForDeploy,
      body: request.body
    });`;

code = code.replace(deployProxySearch, deployProxyReplace);

fs.writeFileSync('src/worker.js', code);
