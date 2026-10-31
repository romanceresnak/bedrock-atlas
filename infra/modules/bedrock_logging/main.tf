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

# CloudWatch Logs copy of the same invocation logs: arrives in seconds, which
# the live demo needs to show the processing region of a fresh request.
resource "aws_cloudwatch_log_group" "invocations" {
  region            = var.region
  name              = "/bedrock-atlas/invocations"
  retention_in_days = 7
}

data "aws_iam_policy_document" "bedrock_assume" {
  statement {
    actions = ["sts:AssumeRole"]

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

resource "aws_iam_role" "cloudwatch" {
  name               = "bedrock-atlas-invocation-logs-${var.region}"
  assume_role_policy = data.aws_iam_policy_document.bedrock_assume.json
}

resource "aws_iam_role_policy" "cloudwatch" {
  name = "write-invocation-logs"
  role = aws_iam_role.cloudwatch.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.invocations.arn}:log-stream:*"
    }]
  })
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

    cloudwatch_config {
      log_group_name = aws_cloudwatch_log_group.invocations.name
      role_arn       = aws_iam_role.cloudwatch.arn
    }
  }

  # Bedrock validates write access when the configuration is saved.
  depends_on = [aws_s3_bucket_policy.logs, aws_iam_role_policy.cloudwatch]
}
