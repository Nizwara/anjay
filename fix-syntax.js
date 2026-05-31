const fs = require('fs');
let code = fs.readFileSync('src/worker.js', 'utf8');
code = code.replace('<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11">// --- DNS MANAGEMENT CODE START ---', '<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>\n<script>\n// --- DNS MANAGEMENT CODE START ---');
fs.writeFileSync('src/worker.js', code);
