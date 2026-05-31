#!/bin/bash
# We can't actually hit the API without real credentials, but we can see what the API responds to a bad request with multipart/form-data.
curl -X POST "https://api.cloudflare.com/client/v4/accounts/00000000000000000000000000000000/pages/projects/dummy/deployments" \
  -H "X-Auth-Email: test@example.com" \
  -H "X-Auth-Key: dummy" \
  -F "file=@test-cf-api.sh"
