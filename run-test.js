const fs = require('fs');

async function run() {
  const mod = await import('./src/worker.js');
  const worker = mod.default;

  // Test deploy-pages endpoint
  const req = new Request('http://localhost/api/deploy-pages', {
    method: 'POST',
    headers: {
      'X-Auth-Email': 'test@example.com',
      'X-Auth-Key': 'dummy_key',
      'X-Project-Name': 'test-project',
      'Content-Type': 'multipart/form-data; boundary=---boundary'
    },
    body: Buffer.from('---boundary\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\n\r\nhello\r\n---boundary--\r\n')
  });

  const res = await worker.fetch(req, {}, {});
  const data = await res.json();
  console.log("Response from deploy-pages endpoint:");
  console.log(data);
}

run();
