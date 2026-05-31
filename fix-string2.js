const fs = require('fs');
let code = fs.readFileSync('src/worker.js', 'utf8');

// We inserted ` using string literals into a string literal (the html variable)
// the html variable is defined as: const html = `...`
// Therefore inside the html variable, any nested backticks must be escaped!
// Let's escape the backticks in the DNS code that we inserted.

// find the injected dns logic block
const startIdx = code.indexOf('// --- DNS MANAGEMENT CODE START ---');
const endIdx = code.indexOf('// --- DNS MANAGEMENT CODE END ---');
if (startIdx !== -1 && endIdx !== -1) {
  let dnsLogic = code.substring(startIdx, endIdx);
  // escape backticks and interpolation inside html template literal
  dnsLogic = dnsLogic.replace(/`/g, '\\`');
  dnsLogic = dnsLogic.replace(/\$\{/g, '\\${');

  code = code.substring(0, startIdx) + dnsLogic + code.substring(endIdx);
  fs.writeFileSync('src/worker.js', code);
}
