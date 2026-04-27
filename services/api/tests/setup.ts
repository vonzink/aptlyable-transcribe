// Loaded via `node --import` BEFORE any test file imports config.ts.
process.env.S3_BUCKET_NAME ??= 'test-bucket';
process.env.JOBS_TABLE_NAME ??= 'test-table';
process.env.TRANSCRIPTION_QUEUE_URL ??= 'https://sqs.test/queue';
process.env.MAX_FILE_SIZE_MB ??= '10';
process.env.AWS_REGION ??= 'us-east-1';
