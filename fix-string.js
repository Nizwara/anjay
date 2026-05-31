const fs = require('fs');
let code = fs.readFileSync('src/worker.js', 'utf8');
code = code.replace(/openModal\(\`DNS Records - \$\{domainName\}\`, \`/g, "openModal(`DNS Records - \\${domainName}`, `");
fs.writeFileSync('src/worker.js', code);
