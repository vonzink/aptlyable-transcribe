import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface StorageProps {
  /** Frontend origins allowed to PUT/GET via presigned URLs. */
  allowedOrigins: string[];
  /**
   * Explicit bucket name. S3 names are GLOBALLY unique — pick something
   * specific enough that no one else has it (e.g. include account id).
   * Default: `aptlyable-transcripts-<account>-<region>`.
   */
  bucketName?: string;
}

/**
 * Private S3 bucket for audio uploads + transcript outputs.
 * Layout:
 *   uploads/<jobId>/<sanitized-file-name>.mp3
 *   transcripts/<jobId>/transcript.txt
 *   transcripts/<jobId>/<provider>.json   (raw provider response: deepgram.json | openai.json | assemblyai.json)
 */
export class Storage extends Construct {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    const defaultName = `aptlyable-transcripts-${stack.account}-${stack.region}`;

    this.bucket = new s3.Bucket(this, 'AudioBucket', {
      bucketName: props.bucketName ?? defaultName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: props.allowedOrigins,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'expire-incomplete-multipart',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });
  }
}
