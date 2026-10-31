# Live demo: visitor picks a route, the API makes one Bedrock call with a fixed
# prompt; the processing region is filled in from the invocation log stream.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  src        = "${path.module}/../../../lambda/live"
}

resource "aws_dynamodb_table" "live" {
  region       = var.region
  name         = "bedrock-atlas-live"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

data "archive_file" "live" {
  type        = "zip"
  output_path = "${path.module}/.build/live.zip"

  source {
    content  = file("${local.src}/live_api.py")
    filename = "live_api.py"
  }
  source {
    content  = file("${local.src}/log_processor.py")
    filename = "log_processor.py"
  }
  source {
    content  = file("${path.module}/../../../pricing/prices.json")
    filename = "prices.json"
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ---------- API Lambda (its role is the "live-demo" identity in Bedrock logs) ----------

resource "aws_iam_role" "api" {
  name               = "bedrock-atlas-live-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "api" {
  name = "live-api"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = concat(
          [for id in var.model_ids : "arn:${local.partition}:bedrock:*::foundation-model/${id}"],
          [for id in var.model_ids : "arn:${local.partition}:bedrock:*:${local.account_id}:inference-profile/*.${id}"],
        )
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.live.arn
      },
    ]
  })
}

resource "aws_lambda_function" "api" {
  region           = var.region
  function_name    = "bedrock-atlas-live-api"
  role             = aws_iam_role.api.arn
  runtime          = "python3.13"
  handler          = "live_api.handler"
  filename         = data.archive_file.live.output_path
  source_code_hash = data.archive_file.live.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      TABLE     = aws_dynamodb_table.live.name
      DAILY_CAP = tostring(var.daily_cap)
    }
  }
}

resource "aws_apigatewayv2_api" "live" {
  region        = var.region
  name          = "bedrock-atlas-live"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "live" {
  region                 = var.region
  api_id                 = aws_apigatewayv2_api.live.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "live" {
  for_each = toset(["GET /api/live", "POST /api/live", "GET /api/live/{id}"])

  region    = var.region
  api_id    = aws_apigatewayv2_api.live.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.live.id}"
}

resource "aws_apigatewayv2_stage" "live" {
  region      = var.region
  api_id      = aws_apigatewayv2_api.live.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = 2
    throttling_burst_limit = 5
  }
}

resource "aws_lambda_permission" "api" {
  region        = var.region
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.live.execution_arn}/*/*"
}

# ---------- Log processor, one per source region ----------

resource "aws_iam_role" "processor" {
  name               = "bedrock-atlas-live-log-processor"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "processor_logs" {
  role       = aws_iam_role.processor.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "processor" {
  name = "live-table"
  role = aws_iam_role.processor.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["dynamodb:UpdateItem"], Resource = aws_dynamodb_table.live.arn }]
  })
}

resource "aws_lambda_function" "processor" {
  for_each = var.log_groups

  region           = each.key
  function_name    = "bedrock-atlas-live-log-processor"
  role             = aws_iam_role.processor.arn
  runtime          = "python3.13"
  handler          = "log_processor.handler"
  filename         = data.archive_file.live.output_path
  source_code_hash = data.archive_file.live.output_base64sha256
  timeout          = 30

  environment {
    variables = {
      TABLE          = aws_dynamodb_table.live.name
      TABLE_REGION   = var.region
      LIVE_ROLE_NAME = aws_iam_role.api.name
    }
  }
}

resource "aws_lambda_permission" "processor" {
  for_each = var.log_groups

  region        = each.key
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.processor[each.key].function_name
  principal     = "logs.amazonaws.com"
  source_arn    = "arn:${local.partition}:logs:${each.key}:${local.account_id}:log-group:${each.value}:*"
}

resource "aws_cloudwatch_log_subscription_filter" "processor" {
  for_each = var.log_groups

  region          = each.key
  name            = "bedrock-atlas-live"
  log_group_name  = each.value
  filter_pattern  = ""
  destination_arn = aws_lambda_function.processor[each.key].arn

  depends_on = [aws_lambda_permission.processor]
}
