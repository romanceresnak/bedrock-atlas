#!/usr/bin/env bash
# Build the web app and publish it to S3 + CloudFront.
# Usage: AWS_PROFILE=bedrock-atlas ./scripts/deploy_web.sh
set -euo pipefail
cd "$(dirname "$0")/.."

tf() { terraform -chdir=infra/envs/demo output -raw "$1"; }
BUCKET=$(tf web_bucket)
DIST=$(tf web_distribution_id)
KEY=$(aws location describe-key --key-name "$(tf map_key_name)" --region eu-central-1 --query Key --output text)

cd web
npm ci
VITE_LOCATION_API_KEY="$KEY" npm run build
aws s3 sync dist "s3://$BUCKET" --delete
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query Invalidation.Id --output text
echo "Deployed: $(cd .. && tf web_url)"
