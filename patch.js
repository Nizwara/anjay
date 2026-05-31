const fs = require('fs');
let code = fs.readFileSync('src/worker.js', 'utf8');

if (!code.includes('function manageDNS(zoneId, domainName)')) {
  const scriptSearch = '</script>';
  const dnsLogic = fs.readFileSync('dns-logic.js', 'utf8');
  const scriptInsert = dnsLogic + '\n</script>';
  code = code.replace(scriptSearch, scriptInsert);
  fs.writeFileSync('src/worker.js', code);
}
