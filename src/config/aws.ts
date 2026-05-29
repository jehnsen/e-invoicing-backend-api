import { SQSClient } from '@aws-sdk/client-sqs';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { env } from './env';

const awsConfig = {
  region: env.AWS_REGION,
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
};

export const sqsClient = new SQSClient(awsConfig);
export const s3Client = new S3Client(awsConfig);
export const secretsManagerClient = new SecretsManagerClient(awsConfig);
