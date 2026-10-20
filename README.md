# Flow AI

**Understand the science. Follow the logic.**

Flow AI is a mobile-first CBSE Class 9–10 science concept tutor. Students describe a specific confusion, optionally supply an NCERT passage or textbook-page image, get a structured seven-section explanation, inspect a safe SVG diagram, and answer one application question. Separate backend calls evaluate reasoning, provide a hint, and reveal a model answer after an attempt.

This version uses **Cloudflare Workers AI**, rather than Gemini API. Google's current Gemini API terms prohibit using Gemini API as part of a website directed at or likely to be accessed by under-18s. Because Flow AI is designed for Class 9–10 students, do not connect a Gemini API key to this product. See the current [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms).

## What is included

- React + TypeScript + Vite frontend.
- Cloudflare Pages Functions for `/api/explain`, `/api/evaluate`, `/api/hint`, and `/api/reveal-answer`.
- Cloudflare Workers AI through a server-side `AI` binding. There is no external model API key in this version.
- Seven-section explanation, schema validation, controlled retry, multimodal textbook input (up to two pages combined into one image in the browser), SVG diagram validation/rendering, answer feedback, hint, reveal flow, local lesson history, copy, print, and delete controls.
- Automated tests for schema/storage/diagram behavior and API input/configuration failures.

## Cost and limits

Cloudflare Workers AI currently includes **10,000 Neurons per day** on its free allocation. The allowance resets daily at 00:00 UTC. Once exhausted, AI requests can fail until the next reset unless you upgrade. Do not upgrade or add paid billing if your budget is strictly ₹0. Check the [current Workers AI pricing and limits](https://developers.cloudflare.com/workers-ai/platform/pricing/) because plans can change. Cloudflare Pages also has its own free-plan limits.

The model default is `@cf/meta/llama-3.2-11b-vision-instruct`, a vision-capable model listed by Cloudflare as supporting JSON Mode. Model availability and quotas may change. Check the [model page](https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/) if requests fail.

## Project structure

```text
flow-ai/
├── functions/
│   ├── _shared.ts                  # Workers AI calls, validation, error handling
│   └── api/
│       ├── explain.ts              # Structured multimodal explanation
│       ├── evaluate.ts              # Reasoning feedback, no model answer
│       ├── hint.ts                 # Contextual hint
│       └── reveal-answer.ts        # Model answer after an attempt
├── src/
│   ├── App.tsx                     # Screens and learning workflow
│   ├── components/Diagram.tsx      # Validated diagram → native SVG
│   ├── lib/api.ts                  # Same-origin API client
│   ├── lib/contracts.ts            # Zod contracts and JSON schemas
│   ├── lib/storage.ts              # Browser-local lesson storage
│   └── styles.css                 # Responsive styling and print layout
├── tests/api-routes.test.ts
├── .env.example
├── .gitignore
├── package.json
├── vite.config.ts
└── wrangler.toml
```

## Easiest deployment path

### 1. Put the files in GitHub

1. Download and extract this ZIP.
2. Create a repository named `flow-ai` on GitHub.
3. Upload the **contents inside the `flow-ai` project folder** to the repository root. Do not upload only the outer folder or leave everything buried one level deeper.
4. Commit the upload. Check that `package.json`, `wrangler.toml`, `src/`, and `functions/` are visible at the top level.

Do not upload `.dev.vars`, API keys, account tokens, or private credentials. This project does not need a Gemini API key.

### 2. Connect GitHub to Cloudflare Pages

1. Sign in to Cloudflare and open **Workers & Pages**.
2. Choose **Create application** → **Pages** → **Connect to Git** (wording may vary slightly).
3. Authorize Cloudflare to access GitHub, then select the `flow-ai` repository.
4. Set the build command to `npm run build`.
5. Set the build output directory to `dist`.
6. Keep the root directory blank because `package.json` is at the repository root.
7. Deploy.

Cloudflare builds the project from GitHub and gives it a public `*.pages.dev` address. Later, a GitHub commit triggers another deployment automatically.

### 3. Enable the AI binding

After the first deployment:

1. In Cloudflare, open **Workers & Pages** → your `flow-ai` Pages project.
2. Open **Settings** → **Bindings** → **Add** → **Workers AI**.
3. Set **Variable name / binding name** to exactly `AI`.
4. Save the binding and redeploy the project.

The binding is how the backend requests model inference from Cloudflare. The API calls run server-side; the browser never receives a provider API key. Do not create a `GEMINI_API_KEY` for this version.

The default model is set in `wrangler.toml`:

```toml
[vars]
WORKERS_AI_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct"
```

If Cloudflare requires you to accept the model's license before first use, follow the model card's license-acceptance instructions. Do not paste account tokens into application source or GitHub files.

### 4. Check the live site

Open the `pages.dev` URL and test these in order:

1. Start a Class 9 or Class 10 lesson with one clear confusion and pasted NCERT text.
2. Confirm all seven explanation sections and a diagram appear.
3. Submit an answer to the single understanding-check question.
4. Confirm feedback appears without revealing the complete model answer.
5. Try a hint, retry, and then reveal the answer.
6. Save a lesson, refresh, reopen it, copy it, print it, and delete it.
7. Start a new lesson with an image. Confirm the backend reads the page and the explanation honestly assesses its source.

The first backend response may fail if the AI binding is not added, the model is temporarily out of capacity, the free daily allowance is used up, or a model license has not been accepted. Read the on-screen error and the deployment/runtime logs before changing code.

## Optional local development (requires a computer or a browser-based terminal)

Requirements: Node.js 20+ and npm. Cloudflare Workers AI requests in local development still use your Cloudflare account and consume AI usage, so running locally is not free of quota usage.

```bash
npm install
npx wrangler login
cp .env.example .dev.vars
npm run dev:full
```

Open the local Vite address printed in the terminal. The command starts Vite and Cloudflare Pages Functions; the `/api` requests go to the Pages Functions process with the `AI` binding.

Run checks:

```bash
npm test
npm run build
```

Preview the built site and functions:

```bash
npm run pages:dev
```

## Troubleshooting

- **The page is published but AI does not respond:** Check that the Cloudflare Pages project has a Workers AI binding named exactly `AI`, then redeploy.
- **`AI is not connected yet`:** The binding is missing or the project has not been redeployed since adding it.
- **Model unavailable:** Check `WORKERS_AI_MODEL` and choose a currently available vision model that supports JSON Mode. Don't simply paste in a random model ID.
- **Daily AI limit / neuron allocation reached:** Wait for the daily reset. Staying at ₹0 means not upgrading to a paid plan.
- **Output failed validation:** Retry with a more specific confusion and a shorter source excerpt. The app intentionally refuses to show malformed or incomplete AI output.
- **Saved lesson missing on another device:** Local lessons remain in that browser's storage and do not sync.
- **Build failed:** Open the Cloudflare deployment log and read the first actual error. Confirm the repository root contains `package.json`, `src/`, and `functions/`.

## Privacy notes

- Lessons are stored in the current browser's local storage and are not synchronized across devices.
- Textbook images are sent to the backend for the AI request and are not included in saved lesson history.
- Cloudflare says standard Workers AI inference inputs and outputs are not retained after processing is complete, subject to documented exceptions. Review [Cloudflare's Workers AI data-use terms](https://developers.cloudflare.com/workers-ai/platform/data-usage/).
- Clearing/deleting local lessons removes the app's saved copy. It does not erase browser backups or guarantee deletion of data handled by infrastructure providers.
- No login, analytics, or third-party tracking is intentionally added.

## Important limitations

This is a starter application, not a guarantee of scientifically perfect tutoring. Validate its explanations against NCERT and teacher guidance. Public deployment means other people can use the site's AI allowance; there is no user authentication or globally shared rate limiter in this first version. Monitor Cloudflare usage and do not activate a paid plan if your budget is zero.
