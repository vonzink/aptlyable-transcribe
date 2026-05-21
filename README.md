# AptlyAble

**AptlyAble** is a production-ready MVP for bulk MP3/MP4 transcription. Drag
and drop one or many MP3 or MP4 files into the web app, pick a transcription
engine, and AptlyAble uploads to S3, queues a job per file, and runs
each through the chosen provider on a scale-to-zero ECS Fargate Spot
worker. Transcripts and raw provider JSON are stored back in S3; job
metadata lives in DynamoDB. The dashboard polls for status and lets you
view, copy, and download the results.

**Supported transcription engines** (per-job, picked at upload time):
- **Deepgram Nova-3** — speaker labels, very fast, no per-file size cap. **Default.**
- **OpenAI gpt-4o-transcribe** — high accuracy, no diarization, **25 MB hard file limit**.
- **AssemblyAI Universal-2** — speaker labels, async (poll-based) flow.

**Ingest sources:**
- **Direct upload** — drag-and-drop in the dashboard.
- **Twilio recording webhook** — Twilio POSTs `recordingStatusCallback`,
  AptlyAble pulls the MP3 from Twilio and queues transcription
  automatically. See "Twilio integration" below.

> ⚠️ **Security notice.** AptlyAble keeps each provider API key in **AWS
> Secrets Manager** and only the worker task role can read them. The frontend
> never sees a key. **If any of your provider keys (Deepgram, OpenAI,
> AssemblyAI) has ever been exposed in client-side code, version
> control, screenshots, or chat logs — rotate it immediately at the
> respective provider console.**

---

## What it does

1. User drops MP3 or MP4 files into the dashboard.
2. Frontend asks the API for short-lived presigned S3 PUT URLs.
3. Frontend uploads files directly to S3 (3–5 concurrent uploads).
4. Frontend tells the API the uploads are complete; the API enqueues an
   SQS message per file.
5. CloudWatch sees the queue go non-empty and scales the Fargate worker
   service from 0 → 1 task. The worker long-polls SQS, generates a
   short-lived presigned GET URL for each media file, and hands it to the
   chosen provider's API.
6. Worker writes `transcripts/<jobId>/transcript.txt` and
   `transcripts/<jobId>/<provider>.json` to S3, updates the DynamoDB row
   to `completed`, and deletes the SQS message.
7. The frontend polls `GET /api/jobs` and renders status, transcript
   preview, and download buttons.

---

## Architecture

```
   ┌──────────────┐      presigned PUT       ┌──────────────┐
   │  Browser     │ ───────────────────────► │   S3 bucket  │
   │  Next.js UI  │                          │  uploads/…   │
   └──────┬───────┘                          └──────────────┘
          │  REST                                    ▲
          ▼                                          │
   ┌──────────────┐    DynamoDB / SQS / S3   ┌──────────────┐
   │ API Gateway  │ ───────────────────────► │   AWS data   │
   │  + Lambda    │                          │   plane      │
   └──────────────┘                          └──────┬───────┘
                                                    │
                                                    │ SQS poll
                                                    ▼
                                          ┌──────────────────┐
                                          │ Fargate Spot     │
                                          │ worker (0..N)    │
                                          └────────┬─────────┘
                                                   │
                          transcript.txt / deepgram.json
                                                   ▼
                                          ┌──────────────┐
                                          │   S3 bucket  │
                                          │ transcripts/ │
                                          └──────────────┘
```

### Why SQS + Fargate Spot worker (not Lambda for transcription)?

- Average recordings are 3–10 minutes, sometimes longer. Provider responses
  vary; AssemblyAI in particular polls. A worker that's not on Lambda's
  15-minute clock avoids edge-case timeouts.
- SQS gives durable retries, visibility timeout, and a DLQ for free.
- `WORKER_CONCURRENCY` inside the worker process is the simplest knob
  for rate-limiting provider calls during bulk uploads.

Lambda still handles the API surface (presigned URLs, DynamoDB
reads/writes, SQS sends, Twilio webhook) — those are short and bursty.

### Scale-to-zero Fargate Spot

The worker runs as an **ECS Fargate Spot service** that scales between
0 and 5 tasks based on SQS depth:

- `desiredCount` starts at **0** — when the queue is empty there are no
  running tasks and you pay nothing for compute.
- A CloudWatch alarm on `ApproximateNumberOfMessagesVisible` flips
  desired count to 1 (or +2 for big bursts) within ~1 minute of the
  first job arriving.
- A second alarm on `visible + in-flight = 0` for 5 consecutive minutes
  scales the service back down to 0.
- Capacity provider is `FARGATE_SPOT` (~70% cheaper than on-demand).
  Tasks can be reclaimed with 2 minutes notice; the worker handles
  SIGTERM and drains in-flight jobs (`stopTimeout = 120s`), and any
  unfinished message is re-delivered by SQS — idempotent on re-pickup.

---

## Repo layout

```
AptlyAble/
  apps/web/                Next.js + Tailwind frontend
  services/api/            Lambda API (handlers + AWS clients)
  services/worker/         Fargate Spot worker (SQS poll → provider → S3 → DDB)
  infrastructure/          AWS CDK (TypeScript)
  scripts/                 deploy-worker.sh, build-all.sh, create-secret.sh
  .env.example             Reference env vars
```

---

## Prerequisites

- Node.js 20+
- npm 10+ (workspaces)
- AWS CLI v2, configured (`aws configure`)
- AWS CDK v2 (`npm i -g aws-cdk`)
- An AWS account + region (default: `us-east-1`)
- A Deepgram account and API key (https://console.deepgram.com)

---

## Local setup

```bash
git clone <this-repo> AptlyAble && cd AptlyAble
cp .env.example .env
npm install
```

Run a type check across all workspaces:

```bash
npm run typecheck
```

---

## Run the frontend locally

```bash
cd apps/web
cp ../../.env.example .env.local
# Edit .env.local and set NEXT_PUBLIC_API_BASE_URL to your deployed API URL
npm run dev
# → http://localhost:3000
```

---

## Deploy AWS infrastructure

```bash
cd infrastructure
npm install
npx cdk bootstrap            # one-time per account/region
npx cdk deploy
```

CDK outputs:

- `ApiUrl` — paste into `apps/web/.env.local` as `NEXT_PUBLIC_API_BASE_URL`
- `BucketName`, `JobsTableName`, `QueueUrl` — for reference / debugging
- `WorkerClusterName`, `WorkerServiceName` — handy for `aws ecs describe-services`

CDK provisions:

- Private S3 bucket (block public access, SSE, CORS for the configured frontend origin)
- DynamoDB table `aptlyable-transcription-jobs` (PK `jobId`, GSI `status-createdAt-index`)
- SQS main queue + DLQ (visibility timeout 30 min, max receive count 3)
- Secrets Manager secrets for each transcription provider + Twilio (placeholders — set them next)
- Lambda functions for each API route, fronted by API Gateway HTTP API
- ECS Fargate Spot service for the worker (auto-scales 0..5 on SQS depth)
- Least-privilege IAM roles for API Lambdas and the worker task

---

## Configure provider secrets

After `cdk deploy`, set the API key for whichever providers you plan to
use. Each provider has its own Secrets Manager entry, all independent —
unused providers can stay at their placeholder value:

```bash
./scripts/create-secret.sh deepgram   "<YOUR_DEEPGRAM_API_KEY>"
./scripts/create-secret.sh openai     "<YOUR_OPENAI_API_KEY>"
./scripts/create-secret.sh assemblyai "<YOUR_ASSEMBLYAI_API_KEY>"

# Or directly:
aws secretsmanager put-secret-value \
  --secret-id aptlyable/deepgram/api-key \
  --secret-string "<YOUR_KEY>"
```

The worker fetches each key on first use and caches it for the process
lifetime. To pick up a rotated key, force the running task to restart:

```bash
aws ecs update-service \
  --cluster <WorkerClusterName> \
  --service <WorkerServiceName> \
  --force-new-deployment
```

(Or just wait for the next scale-up — once the existing task drains and
exits, the new one fetches the rotated secret on startup.)

If a job is submitted for a provider whose key is still the placeholder,
that single job fails with a clear error in DynamoDB. Other providers
keep working.

---

## Deploying / updating the worker

The worker is a Fargate Spot service whose container image is built
from [`services/worker/Dockerfile`](services/worker/Dockerfile) using
CDK's `ContainerImage.fromAsset()`. **A code change ships via**
**`cdk deploy`** — CDK rebuilds the image, pushes it to its managed ECR
repo, updates the Task Definition, and ECS rolls out the new revision.

```bash
./scripts/deploy-worker.sh
# or directly:
cd infrastructure && npx cdk deploy
```

Worker logs:

```bash
aws logs tail /aptlyable/worker --follow
```

Watch the service / task state:

```bash
aws ecs describe-services \
  --cluster <WorkerClusterName> \
  --services <WorkerServiceName> \
  --query 'services[0].{Desired:desiredCount,Running:runningCount,Pending:pendingCount}'

aws ecs list-tasks --cluster <WorkerClusterName> --service-name <WorkerServiceName>
```

You'll typically see `Desired: 0, Running: 0` when the queue is empty.

---

## Twilio integration

AptlyAble exposes a Twilio-compatible recording webhook so calls
recorded via Twilio Voice / Programmable Voice / Studio land directly
in the system without a manual upload.

**Flow:** Twilio finishes a recording → POSTs to AptlyAble → AptlyAble
verifies the signature, downloads the MP3 via Twilio's REST API,
uploads to S3, creates a DDB job, enqueues SQS. Same downstream
pipeline as a manual upload.

### One-time setup

1. **Set the auth token in Secrets Manager** (after `cdk deploy`):

   ```bash
   ./scripts/create-secret.sh twilio "<TWILIO_AUTH_TOKEN>"
   ```

   Find the token at https://console.twilio.com → Account → API keys & tokens.
   The Account SID is sent on every webhook, so you don't need to store it.

2. **Set the webhook URL.** `cdk deploy` outputs `TwilioWebhookUrl`
   (something like `https://abcd1234.execute-api.us-east-1.amazonaws.com/api/twilio/recording-callback`).
   Configure your Twilio resource to POST recording-status callbacks to that URL.

   - **TwiML `<Record>`:** add the attribute
     `recordingStatusCallback="<TwilioWebhookUrl>"` and
     `recordingStatusCallbackMethod="POST"`.
   - **Studio "Record Voicemail" widget:** set the
     "Recording Status Callback URL" field.
   - **Twilio API:** set `RecordingStatusCallback` on the call create request.

3. **Choose a transcription engine per source (optional).** Append
   `?provider=deepgram|openai|assemblyai` to the webhook URL to pin a
   provider for that Twilio app. Without the param, jobs use
   `DEFAULT_PROVIDER`.

### Security model

- The Lambda **rejects requests with an invalid `X-Twilio-Signature`**.
  Without the auth token, an attacker can't forge a webhook (HMAC-SHA1
  over URL + sorted POST params).
- The Twilio recording REST API requires HTTP-Basic auth with
  `(AccountSid, AuthToken)`. AptlyAble fetches the token from Secrets
  Manager at Lambda cold-start.
- The Twilio Lambda has its own IAM role with the **minimum** grants:
  `s3:PutObject` on `uploads/*`, DDB read/write on the jobs table,
  `sqs:SendMessage` on the transcription queue, and
  `secretsmanager:GetSecretValue` on the Twilio secret only.

### Idempotency

Twilio retries webhooks on non-2xx responses. AptlyAble keys
idempotency on `RecordingSid` — a duplicate webhook returns 200
without re-creating the job.

### Limits

- The Lambda buffers the recording in memory (1024 MB allocated). For
  typical call recordings up to ~30 min mono mp3 (~7 MB) this is
  comfortable. For multi-hour recordings, switch the Lambda to stream
  directly into S3 multipart upload.
- Lambda timeout is 60 s. If Twilio's recording download takes longer
  than that, the function fails and Twilio retries.

---

## API surface

All routes return JSON. CORS is restricted to `ALLOWED_ORIGINS`.

| Method | Path                                  | Purpose                                       |
| ------ | ------------------------------------- | --------------------------------------------- |
| POST   | `/api/uploads/create`                 | Validate files, create DDB rows, return PUT URLs |
| POST   | `/api/uploads/complete`               | Mark uploaded, enqueue SQS message per job    |
| GET    | `/api/jobs`                           | List jobs (newest first, paginated)           |
| GET    | `/api/jobs/:jobId`                    | Get one job's metadata                        |
| GET    | `/api/jobs/:jobId/transcript`         | Transcript text (and short-lived URL)         |
| GET    | `/api/jobs/:jobId/raw`                | Presigned GET URL for raw Deepgram JSON       |
| POST   | `/api/jobs/:jobId/retry`              | Reset failed job to `queued` and re-enqueue   |
| POST   | `/api/twilio/recording-callback`      | Twilio recording webhook (signature-verified) |

---

## Job status transitions

```
pending_upload  ──►  uploaded  ──►  queued  ──►  transcribing  ──►  completed
                                       │                           │
                                       └─────────► failed ◄────────┘
                                                     │
                                                     └─► (retry) ─► queued
```

---

## Cost notes (rough — verify against AWS Pricing)

You pay for:

- **S3** storage + PUT/GET requests for media files and transcripts.
- **DynamoDB** reads/writes (on-demand pricing in this stack).
- **SQS** request count (very small per job).
- **Lambda** invocations + duration (each API call is short).
- **API Gateway** HTTP API requests.
- **Fargate Spot** task-seconds (only while transcribing — `desiredCount=0` when idle).
- **Provider** transcription minutes (Deepgram/OpenAI/AssemblyAI). This dominates spend at scale.
- **CloudWatch Logs** for Lambda and worker logs.
- **Secrets Manager** $0.40/month per secret × 4.

The worker scales to zero when idle, so the dominant fixed cost is
~$1.60/month for Secrets Manager. While transcribing, a 0.5-vCPU /
1-GB Fargate Spot task is roughly $0.012/hour. Provider costs scale
with audio minutes processed.

---

## Known MVP limits / TODOs

- No authentication — any caller hitting the API URL can upload.
- No per-user/team isolation, quotas, or rate limiting.
- No virus / malware scanning of uploaded media files.
- No bulk ZIP export of transcripts (single-file download only).
- Polling, not WebSockets/SSE — fine for hundreds of jobs, not thousands.
- Worker deployment is via `cdk deploy`, not a CI/CD pipeline.
- Fargate Spot can be reclaimed with 2 minutes notice; mitigated by
  SIGTERM drain + idempotent SQS re-delivery, but still worth a
  fallback on-demand capacity provider for production.
- Very large media files (multi-GB) may need streaming uploads / multipart support.

---

## Production hardening checklist

- [ ] Add authentication (Cognito / Auth0 / Clerk) and per-user job ownership
- [ ] Add usage limits and rate limiting (API Gateway throttling + DDB per-user counters)
- [ ] Add malware scanning before transcription (e.g. GuardDuty Malware Protection for S3)
- [ ] Add CloudWatch alarms (DLQ depth > 0, worker CPU, Lambda errors)
- [ ] Add DLQ monitoring + replay tooling
- [ ] Add a regional Fargate (on-demand) capacity provider as a fallback for Spot reclamation
- [ ] Step Functions if the workflow grows beyond transcribe-once-and-store
- [ ] Transcript search (OpenSearch or Athena over S3)
- [ ] Full audit logs (who triggered which job)
- [ ] S3 lifecycle / retention policies for old transcripts
- [ ] Move all secrets to Secrets Manager / SSM Parameter Store
- [ ] CI/CD (GitHub Actions: lint, type-check, unit tests, CDK diff)
- [ ] Expand the test suite beyond the formatter / validation units
- [ ] Admin dashboard
- [ ] Bulk ZIP export of transcripts
- [ ] Replace polling with WebSockets / SSE / EventBridge

---

## License

Proprietary — internal MVP. Do not redistribute without permission.
# aptlyable-transcribe
