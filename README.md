# AptlyAble

**AptlyAble** is a production-ready MVP for bulk MP3 transcription. Drag
and drop one or many MP3 files into the web app, pick a transcription
engine, and AptlyAble uploads to S3, queues a job per file, and runs
each through the chosen provider on a long-lived EC2 worker. Transcripts
and raw provider JSON are stored back in S3; job metadata lives in
DynamoDB. The dashboard polls for status and lets you view, copy, and
download the results.

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
> Secrets Manager** and only the EC2 worker can read them. The frontend
> never sees a key. **If any of your provider keys (Deepgram, OpenAI,
> AssemblyAI) has ever been exposed in client-side code, version
> control, screenshots, or chat logs — rotate it immediately at the
> respective provider console.**

---

## What it does

1. User drops MP3 files into the dashboard.
2. Frontend asks the API for short-lived presigned S3 PUT URLs.
3. Frontend uploads files directly to S3 (3–5 concurrent uploads).
4. Frontend tells the API the uploads are complete; the API enqueues an
   SQS message per file.
5. The EC2 worker long-polls SQS, generates a short-lived presigned GET
   URL for each MP3, and hands it to Deepgram's prerecorded API.
6. Worker writes `transcripts/<jobId>/transcript.txt` and
   `transcripts/<jobId>/deepgram.json` to S3, updates the DynamoDB row to
   `completed`, and deletes the SQS message.
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
                                          │ EC2 worker (TS)  │
                                          │ Deepgram Nova-3  │
                                          └────────┬─────────┘
                                                   │
                          transcript.txt / deepgram.json
                                                   ▼
                                          ┌──────────────┐
                                          │   S3 bucket  │
                                          │ transcripts/ │
                                          └──────────────┘
```

### Why SQS + EC2 worker (not Lambda for transcription)?

- Average MP3s are 3–10 minutes, sometimes longer. Deepgram's prerecorded
  endpoint is fast but not instant; bursts are easy to hit. A long-lived
  worker avoids Lambda's 15-minute ceiling and cold-start churn.
- SQS gives durable retries, visibility timeout, and a DLQ for free.
- A single EC2 process with `WORKER_CONCURRENCY` is the simplest knob
  for rate-limiting Deepgram calls during bulk uploads.
- Easy migration path: the same worker code can move to ECS/Fargate
  later without changing the queue contract.

Lambda is still used for the API surface (presigned URLs, DynamoDB
reads/writes, SQS sends) — those are short and bursty.

---

## Repo layout

```
AptlyAble/
  apps/web/                Next.js + Tailwind frontend
  services/api/            Lambda API (handlers + AWS clients)
  services/worker/         EC2 worker (SQS poll → Deepgram → S3 → DDB)
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
- `WorkerInstanceId` — used by `scripts/deploy-worker.sh`

CDK provisions:

- Private S3 bucket (block public access, SSE, CORS for the configured frontend origin)
- DynamoDB table `aptlyable-transcription-jobs` (PK `jobId`, GSI `status-createdAt-index`)
- SQS main queue + DLQ (visibility timeout 30 min, max receive count 3)
- Secrets Manager secret `aptlyable/deepgram/api-key` (placeholder value — set it next)
- Lambda functions for each API route, fronted by API Gateway HTTP API
- EC2 worker instance (Amazon Linux 2023, t3.small) with instance profile, systemd unit
- Least-privilege IAM roles for API Lambdas and the worker

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
lifetime. Restart the worker (`sudo systemctl restart aptlyable-worker`,
or just re-run `./scripts/deploy-worker.sh`) after rotating any key.

If a job is submitted for a provider whose key is still the placeholder,
that single job fails with a clear error in DynamoDB. Other providers
keep working.

---

## Deploy / start the EC2 worker

The CDK stack creates the EC2 instance and a `aptlyable-worker.service`
systemd unit that expects code in `/opt/aptlyable/worker`. To push code:

```bash
./scripts/deploy-worker.sh
```

That script:

1. Builds `services/worker` to plain JS.
2. Bundles `dist/` and `package.json`.
3. Uses **AWS Systems Manager Run Command** (`aws ssm send-command`) to
   copy the bundle to the instance, install deps, and restart the
   systemd service. (No SSH keys required — uses the IAM role.)

You can also `ssh ec2-user@<instance>` if you opted in to a `WORKER_SSH_CIDR`.

Worker logs:

```bash
aws logs tail /aptlyable/worker --follow
# or on the box:
sudo journalctl -u aptlyable-worker -f
```

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

- **S3** storage + PUT/GET requests for MP3s and transcripts.
- **DynamoDB** reads/writes (on-demand pricing in this stack).
- **SQS** request count (very small per job).
- **Lambda** invocations + duration (each API call is short).
- **API Gateway** HTTP API requests.
- **EC2** instance-hours (the worker runs continuously — biggest fixed cost).
- **Deepgram** transcription minutes (this dominates spend at scale).
- **CloudWatch Logs** for Lambda and worker logs.

A 24/7 `t3.small` is roughly a few US dollars per month; Deepgram and S3
storage scale with usage. Stop the EC2 instance when you're not bulk
processing to save the fixed cost.

---

## Known MVP limits / TODOs

- No authentication — any caller hitting the API URL can upload.
- No per-user/team isolation, quotas, or rate limiting.
- No virus / malware scanning of uploaded MP3s.
- No bulk ZIP export of transcripts (single-file download only).
- Polling, not WebSockets/SSE — fine for hundreds of jobs, not thousands.
- Worker deployment is via SSM Run Command, not full CI/CD.
- Single EC2 instance — no auto-scaling. Move to ECS/Fargate before scale.
- Very large MP3s (multi-GB) may need streaming uploads / multipart support.

---

## Production hardening checklist

- [ ] Add authentication (Cognito / Auth0 / Clerk) and per-user job ownership
- [ ] Add usage limits and rate limiting (API Gateway throttling + DDB per-user counters)
- [ ] Add malware scanning before transcription (e.g. GuardDuty Malware Protection for S3)
- [ ] Add CloudWatch alarms (DLQ depth > 0, worker CPU, Lambda errors)
- [ ] Add DLQ monitoring + replay tooling
- [ ] Replace single EC2 with ECS/Fargate or an Auto Scaling Group
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
