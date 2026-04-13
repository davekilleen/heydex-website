#!/bin/bash
set -e
BASE_URL="${1:-https://heydex.ai}"
echo "Testing $BASE_URL"
curl -sf "$BASE_URL/connect/" | grep -q 'id="root"' && echo "✅ /connect/ OK" || exit 1
curl -sf "$BASE_URL/diff/" | grep -q 'id="root"' && echo "✅ /diff/ OK" || exit 1
curl -sf "$BASE_URL/diff/profile/" | grep -q 'id="root"' && echo "✅ /diff/profile/ OK" || exit 1
curl -sf "$BASE_URL/diff/review/" | grep -q 'id="root"' && echo "✅ /diff/review/ OK" || exit 1
curl -sf "$BASE_URL/diff/@route-smoke/" | grep -q 'id="root"' && echo "✅ /diff/@route-smoke/ OK" || exit 1
curl -sf "$BASE_URL/diff/review/" | grep -q '<base href="/diff/">' && echo "✅ /diff base href OK" || exit 1
curl -sf "$BASE_URL/connect/" | grep -q '<base href="/connect/">' && echo "✅ /connect base href OK" || exit 1
echo "✅ Tests passed"
