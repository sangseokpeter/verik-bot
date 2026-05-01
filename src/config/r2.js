const { S3Client } = require('@aws-sdk/client-s3');

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
  console.warn(
    '⚠️ R2 config incomplete — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.'
  );
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

function getPublicUrl(key) {
  return `${publicBaseUrl}/${key}`;
}

module.exports = { r2, bucket, getPublicUrl };
