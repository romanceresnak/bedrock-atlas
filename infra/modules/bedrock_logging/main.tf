data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
}

# Private bucket. Logs contain prompts and responses — never public.
resource "aws_s3_bucket" "logs" {
  region = var.region
  bucket = "bedrock-atlas-invocation-logs-${local.account_id}-${var.region}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  region = var.region
  bucket = aws_s3_bucket.logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  region = var.region
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "bedrock_write" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:bedrock:${var.region}:${local.account_id}:*"]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  region = var.region
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.bedrock_write.json
}

resource "aws_bedrock_model_invocation_logging_configuration" "this" {
  region = var.region

  logging_config {
    text_data_delivery_enabled      = true
    image_data_delivery_enabled     = false
    embedding_data_delivery_enabled = false
    video_data_delivery_enabled     = false

    s3_config {
      bucket_name = aws_s3_bucket.logs.id
      key_prefix  = "invocations"
    }
  }

  # Bedrock validates write access when the configuration is saved.
  depends_on = [aws_s3_bucket_policy.logs]
}
