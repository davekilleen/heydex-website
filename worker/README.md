# heydex-subscribe Cloudflare Worker

Proxies newsletter signups from heydex-website to Beehiiv. Keeps the API key server-side.

## First-time setup

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Log in to Cloudflare

```bash
wrangler login
```

A browser window will open — log in with your Cloudflare account.

### 3. Deploy the worker

From this directory (`heydex-website/worker/`):

```bash
wrangler deploy
```

You'll see output like:
```
Published heydex-subscribe (1.23 sec)
  https://heydex-subscribe.YOUR-SUBDOMAIN.workers.dev
```

Copy that URL — you'll need it in the next step.

### 4. Set secrets

```bash
wrangler secret put API_KEY
```
Paste your Beehiiv API key when prompted.

```bash
wrangler secret put PUB_ID
```
Paste your Beehiiv publication ID when prompted (example: `pub_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

### 5. Update the website

In the static marketing landing (`heydex-website/index-landing.html`), find this line near the bottom:

```js
const SUBSCRIBE_URL = 'WORKER_URL_HERE';
```

Replace `WORKER_URL_HERE` with your worker URL from step 3:

```js
const SUBSCRIBE_URL = 'https://heydex-subscribe.heydex.workers.dev';
```

## Redeployment

If you change `subscribe.js`, just run `wrangler deploy` again from this directory.
Secrets persist — you don't need to re-set them.
